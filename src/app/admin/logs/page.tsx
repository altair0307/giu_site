import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { pruneActivityLogsAction } from "@/app/actions";
import { prisma } from "@/lib/db";
import { createKoreaDateFormatter } from "@/lib/date-time";

const LOG_PAGE_SIZE = 50;
const ALL_LOG_SOURCE_LIMIT = 40;
const ALL_LOG_DISPLAY_LIMIT = 50;

const dateTimeFormatter = createKoreaDateFormatter({
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

type ActivityLogsPageProps = {
  searchParams: Promise<{
    notice?: string;
    days?: string;
    kind?: string;
    period?: string;
    q?: string;
    page?: string;
  }>;
};

type LogKind = "all" | "loans" | "meetups" | "general";
type LogViewRow = {
  id: string;
  kind: "대여/반납" | "게임 약속" | "관리 작업";
  occurredAt: Date;
  title: string;
  meta: string;
  detail?: string;
};

type ParticipantSnapshot = {
  name: string;
  loginId?: string | null;
  studentId?: string | null;
};

function formatPerson(name: string, loginId?: string | null, studentId?: string | null) {
  return `${name}(${loginId ?? "-"}${studentId ? ` · ${studentId}` : ""})`;
}

function formatActor(name?: string | null, loginId?: string | null) {
  if (!name && !loginId) {
    return "시스템";
  }

  return `${name ?? "이름 없음"}(${loginId ?? "-"})`;
}

function readParticipants(value: unknown): ParticipantSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is ParticipantSnapshot => {
      return typeof item === "object" && item !== null && "name" in item && typeof item.name === "string";
    })
    .map((item) => ({
      name: item.name,
      loginId: typeof item.loginId === "string" ? item.loginId : null,
      studentId: typeof item.studentId === "string" ? item.studentId : null
    }));
}

function parseKind(value?: string): LogKind {
  return value === "loans" || value === "meetups" || value === "general" ? value : "all";
}

function parsePeriod(value?: string) {
  if (value === "7" || value === "30" || value === "90" || value === "365") {
    return Number(value);
  }

  return null;
}

function parsePage(value?: string) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function buildQueryHref(params: { kind: LogKind; period: string; q: string; page?: number }) {
  const query = new URLSearchParams();

  if (params.kind !== "all") {
    query.set("kind", params.kind);
  }

  if (params.period !== "all") {
    query.set("period", params.period);
  }

  if (params.q) {
    query.set("q", params.q);
  }

  if (params.page && params.page > 1) {
    query.set("page", String(params.page));
  }

  const text = query.toString();
  return text ? `/admin/logs?${text}` : "/admin/logs";
}

function buildExportHref(params: { kind: LogKind; period: string; q: string }) {
  const query = new URLSearchParams();

  if (params.kind !== "all") {
    query.set("kind", params.kind);
  }

  if (params.period !== "all") {
    query.set("period", params.period);
  }

  if (params.q) {
    query.set("q", params.q);
  }

  const text = query.toString();
  return text ? `/admin/logs/export?${text}` : "/admin/logs/export";
}

function periodLabel(days: number | null) {
  return days ? `최근 ${days}일` : "전체 기간";
}

export default async function AdminActivityLogsPage({ searchParams }: ActivityLogsPageProps) {
  const params = await searchParams;
  const selectedKind = parseKind(params.kind);
  const selectedPeriod = params.period === "all" ? "all" : params.period ?? "30";
  const periodDays = parsePeriod(selectedPeriod);
  const query = String(params.q ?? "").trim();
  const page = parsePage(params.page);
  const skip = (page - 1) * LOG_PAGE_SIZE;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const periodFilter = periodDays ? { gte: new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000) } : undefined;
  const occurredAtWhere = periodFilter ? { occurredAt: periodFilter } : {};
  const loanWhere: Prisma.LoanActivityLogWhereInput = {
    ...occurredAtWhere,
    ...(query
      ? {
          OR: [
            { gameTitle: { contains: query, mode: "insensitive" } },
            { borrowerName: { contains: query, mode: "insensitive" } },
            { borrowerLoginId: { contains: query, mode: "insensitive" } },
            { borrowerStudentId: { contains: query, mode: "insensitive" } }
          ]
        }
      : {})
  };
  const meetupWhere: Prisma.MeetupActivityLogWhereInput = {
    ...occurredAtWhere,
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { gameTitle: { contains: query, mode: "insensitive" } },
            { tableName: { contains: query, mode: "insensitive" } },
            { hostName: { contains: query, mode: "insensitive" } },
            { hostLoginId: { contains: query, mode: "insensitive" } }
          ]
        }
      : {})
  };
  const generalWhere: Prisma.GeneralActivityLogWhereInput = {
    ...occurredAtWhere,
    ...(query
      ? {
          OR: [
            { category: { contains: query, mode: "insensitive" } },
            { action: { contains: query, mode: "insensitive" } },
            { actorName: { contains: query, mode: "insensitive" } },
            { actorLoginId: { contains: query, mode: "insensitive" } },
            { targetName: { contains: query, mode: "insensitive" } },
            { message: { contains: query, mode: "insensitive" } }
          ]
        }
      : {})
  };

  const [
    loanLogs,
    meetupLogs,
    generalLogs,
    loanLogCount,
    meetupLogCount,
    generalLogCount,
    recentBorrowCount,
    recentReturnCount,
    recentMeetupCount,
    recentGeneralCount,
    filteredLoanCount,
    filteredMeetupCount,
    filteredGeneralCount
  ] =
    await Promise.all([
      selectedKind === "all" || selectedKind === "loans"
        ? prisma.loanActivityLog.findMany({
            where: loanWhere,
            orderBy: { occurredAt: "desc" },
            skip: selectedKind === "loans" ? skip : 0,
            take: selectedKind === "loans" ? LOG_PAGE_SIZE : ALL_LOG_SOURCE_LIMIT
          })
        : [],
      selectedKind === "all" || selectedKind === "meetups"
        ? prisma.meetupActivityLog.findMany({
            where: meetupWhere,
            orderBy: { occurredAt: "desc" },
            skip: selectedKind === "meetups" ? skip : 0,
            take: selectedKind === "meetups" ? LOG_PAGE_SIZE : ALL_LOG_SOURCE_LIMIT
          })
        : [],
      selectedKind === "all" || selectedKind === "general"
        ? prisma.generalActivityLog.findMany({
            where: generalWhere,
            orderBy: { occurredAt: "desc" },
            skip: selectedKind === "general" ? skip : 0,
            take: selectedKind === "general" ? LOG_PAGE_SIZE : ALL_LOG_SOURCE_LIMIT
          })
        : [],
      prisma.loanActivityLog.count(),
      prisma.meetupActivityLog.count(),
      prisma.generalActivityLog.count(),
      prisma.loanActivityLog.count({ where: { type: "BORROW", occurredAt: { gte: since } } }),
      prisma.loanActivityLog.count({ where: { type: "RETURN", occurredAt: { gte: since } } }),
      prisma.meetupActivityLog.count({
        where: {
          type: { in: ["SCHEDULED", "COMPLETED"] },
          occurredAt: { gte: since }
        }
      }),
      prisma.generalActivityLog.count({ where: { occurredAt: { gte: since } } }),
      prisma.loanActivityLog.count({ where: loanWhere }),
      prisma.meetupActivityLog.count({ where: meetupWhere }),
      prisma.generalActivityLog.count({ where: generalWhere })
    ]);
  const filteredTotal = filteredLoanCount + filteredMeetupCount + filteredGeneralCount;
  const selectedCount =
    selectedKind === "loans"
      ? filteredLoanCount
      : selectedKind === "meetups"
        ? filteredMeetupCount
        : selectedKind === "general"
          ? filteredGeneralCount
          : filteredTotal;
  const totalPages = Math.max(1, Math.ceil(selectedCount / LOG_PAGE_SIZE));
  const visibleRows: LogViewRow[] = [
    ...loanLogs.map((log) => ({
      id: `loan-${log.id}`,
      kind: "대여/반납" as const,
      occurredAt: log.occurredAt,
      title: `${log.type === "BORROW" ? "대여" : "반납"} · ${log.gameTitle}`,
      meta: `${formatPerson(log.borrowerName, log.borrowerLoginId, log.borrowerStudentId)} · ${dateTimeFormatter.format(log.occurredAt)}`,
      detail: log.dueAt ? `반납 예정 ${dateTimeFormatter.format(log.dueAt)}` : undefined
    })),
    ...meetupLogs.map((log) => {
      const participants = readParticipants(log.participants);

      return {
        id: `meetup-${log.id}`,
        kind: "게임 약속" as const,
        occurredAt: log.occurredAt,
        title: `${log.type === "SCHEDULED" ? "생성" : log.type === "COMPLETED" ? "완료" : "취소"} · ${log.title}`,
        meta: `${log.gameTitle ?? "게임 미정"} · ${log.tableName ?? "테이블 미정"} · ${formatPerson(log.hostName, log.hostLoginId)} 개최 · ${dateTimeFormatter.format(log.startsAt)} · ${log.participantCount}/${log.maxPeople}명`,
        detail:
          participants.length > 0
            ? `함께한 사람: ${participants.map((participant) => formatPerson(participant.name, participant.loginId, participant.studentId)).join(", ")}`
            : "함께한 사람: 기록 없음"
      };
    }),
    ...generalLogs.map((log) => ({
      id: `general-${log.id}`,
      kind: "관리 작업" as const,
      occurredAt: log.occurredAt,
      title: `${log.category} · ${log.action}${log.targetName ? ` · ${log.targetName}` : ""}`,
      meta: `${formatActor(log.actorName, log.actorLoginId)} · ${dateTimeFormatter.format(log.occurredAt)}${log.targetType ? ` · 대상 ${log.targetType}` : ""}`,
      detail: log.message
    }))
  ]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, selectedKind === "all" ? ALL_LOG_DISPLAY_LIMIT : LOG_PAGE_SIZE);

  return (
    <section className="admin-page">
      {params.notice === "logs-pruned" ? (
        <p className="notice success-notice">{params.days ?? "365"}일보다 오래된 운영 로그를 정리했습니다.</p>
      ) : null}

      <div className="admin-summary-grid">
        <div className="admin-summary-card">
          <span>최근 30일 대여</span>
          <strong>{recentBorrowCount}</strong>
        </div>
        <div className="admin-summary-card">
          <span>최근 30일 반납</span>
          <strong>{recentReturnCount}</strong>
        </div>
        <div className="admin-summary-card">
          <span>최근 30일 약속</span>
          <strong>{recentMeetupCount}</strong>
        </div>
        <div className="admin-summary-card">
          <span>최근 30일 관리 작업</span>
          <strong>{recentGeneralCount}</strong>
        </div>
        <div className="admin-summary-card">
          <span>전체 로그</span>
          <strong>{loanLogCount + meetupLogCount + generalLogCount}</strong>
        </div>
      </div>

      <section className="panel log-filter-panel">
        <form className="log-filter-form" action="/admin/logs">
          <label>
            <span>종류</span>
            <select name="kind" defaultValue={selectedKind}>
              <option value="all">전체</option>
              <option value="loans">대여/반납</option>
              <option value="meetups">게임 약속</option>
              <option value="general">관리 작업</option>
            </select>
          </label>
          <label>
            <span>기간</span>
            <select name="period" defaultValue={selectedPeriod}>
              <option value="7">최근 7일</option>
              <option value="30">최근 30일</option>
              <option value="90">최근 90일</option>
              <option value="365">최근 1년</option>
              <option value="all">전체 기간</option>
            </select>
          </label>
          <label>
            <span>검색</span>
            <input name="q" defaultValue={query} placeholder="게임, 이용자, 작업명" />
          </label>
          <div className="row-actions">
            <button className="secondary-button">조회</button>
            <Link className="ghost-link" href="/admin/logs">
              초기화
            </Link>
          </div>
        </form>
      </section>

      <section className="panel log-maintenance">
        <div>
          <h2>로그 보관 관리</h2>
          <p className="muted">선택한 보관 기간보다 오래된 대여/반납, 약속, 관리 작업 로그를 삭제합니다.</p>
        </div>
        <form className="row-actions" action={pruneActivityLogsAction}>
          <select name="days" aria-label="보관 기간">
            <option value="365">1년 보관</option>
            <option value="730">2년 보관</option>
            <option value="1095">3년 보관</option>
          </select>
          <button className="ghost-button">오래된 로그 정리</button>
        </form>
      </section>

      <section className="panel log-maintenance">
        <div>
          <h2>로그 다운로드</h2>
          <p className="muted">현재 조회 조건의 운영 로그를 CSV 파일로 내려받습니다.</p>
        </div>
        <div className="row-actions">
          <a className="secondary-link" href={buildExportHref({ kind: selectedKind, period: selectedPeriod, q: query })}>
            현재 조건 CSV
          </a>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>운영 로그</h2>
          <span>
            {periodLabel(periodDays)} · {selectedCount}건
            {selectedKind === "all" ? ` 중 최근 ${visibleRows.length}건 표시` : ` 중 ${visibleRows.length}건 표시`}
          </span>
        </div>
        <div className="admin-meetup-list">
          {visibleRows.map((log) => (
            <article className="admin-meetup-row log-row" key={log.id}>
              <span className="log-kind">{log.kind}</span>
              <div>
                <strong>{log.title}</strong>
                <p className="muted">{log.meta}</p>
                {log.detail ? <p className="participants">{log.detail}</p> : null}
              </div>
            </article>
          ))}
          {visibleRows.length === 0 ? <p className="empty">조회 조건에 맞는 운영 로그가 없습니다.</p> : null}
        </div>
        {selectedKind !== "all" ? (
          <div className="pager">
            <Link
              className={`pager-link${page <= 1 ? " disabled" : ""}`}
              href={buildQueryHref({ kind: selectedKind, period: selectedPeriod, q: query, page: page - 1 })}
            >
              이전
            </Link>
            <span className="pager-status">
              {page} / {totalPages}
            </span>
            <Link
              className={`pager-link${page >= totalPages ? " disabled" : ""}`}
              href={buildQueryHref({ kind: selectedKind, period: selectedPeriod, q: query, page: page + 1 })}
            >
              다음
            </Link>
          </div>
        ) : null}
      </section>
    </section>
  );
}

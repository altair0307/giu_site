import { pruneActivityLogsAction } from "@/app/actions";
import { prisma } from "@/lib/db";

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
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
  }>;
};

type ParticipantSnapshot = {
  name: string;
  loginId?: string | null;
  studentId?: string | null;
};

function formatPerson(name: string, loginId?: string | null, studentId?: string | null) {
  return `${name}(${loginId ?? "-"}${studentId ? ` · ${studentId}` : ""})`;
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

export default async function AdminActivityLogsPage({ searchParams }: ActivityLogsPageProps) {
  const params = await searchParams;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [loanLogs, meetupLogs, loanLogCount, meetupLogCount, recentBorrowCount, recentReturnCount, recentMeetupCount] =
    await Promise.all([
      prisma.loanActivityLog.findMany({
        orderBy: { occurredAt: "desc" },
        take: 80
      }),
      prisma.meetupActivityLog.findMany({
        orderBy: { occurredAt: "desc" },
        take: 80
      }),
      prisma.loanActivityLog.count(),
      prisma.meetupActivityLog.count(),
      prisma.loanActivityLog.count({ where: { type: "BORROW", occurredAt: { gte: since } } }),
      prisma.loanActivityLog.count({ where: { type: "RETURN", occurredAt: { gte: since } } }),
      prisma.meetupActivityLog.count({
        where: {
          type: { in: ["SCHEDULED", "COMPLETED"] },
          occurredAt: { gte: since }
        }
      })
    ]);

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
          <span>전체 로그</span>
          <strong>{loanLogCount + meetupLogCount}</strong>
        </div>
      </div>

      <section className="panel log-maintenance">
        <div>
          <h2>로그 보관 관리</h2>
          <p className="muted">사진 원본은 로그에 복제하지 않고, 조회에 필요한 텍스트 스냅샷만 저장합니다.</p>
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

      <section className="section-block">
        <div className="section-heading">
          <h2>대여/반납 로그</h2>
          <span>{loanLogs.length}건 표시</span>
        </div>
        <div className="admin-meetup-list">
          {loanLogs.map((log) => (
            <article className="admin-meetup-row" key={log.id}>
              <div>
                <strong>
                  {log.type === "BORROW" ? "대여" : "반납"} · {log.gameTitle}
                </strong>
                <p className="muted">
                  {formatPerson(log.borrowerName, log.borrowerLoginId, log.borrowerStudentId)} ·{" "}
                  {dateTimeFormatter.format(log.occurredAt)}
                  {log.dueAt ? ` · 반납 예정 ${dateTimeFormatter.format(log.dueAt)}` : ""}
                </p>
              </div>
            </article>
          ))}
          {loanLogs.length === 0 ? <p className="empty">아직 대여/반납 로그가 없습니다.</p> : null}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <h2>게임 약속 로그</h2>
          <span>{meetupLogs.length}건 표시</span>
        </div>
        <div className="admin-meetup-list">
          {meetupLogs.map((log) => {
            const participants = readParticipants(log.participants);

            return (
              <article className="admin-meetup-row" key={log.id}>
                <div>
                  <strong>
                    {log.type === "SCHEDULED" ? "생성" : log.type === "COMPLETED" ? "완료" : "취소"} · {log.title}
                  </strong>
                  <p className="muted">
                    {log.gameTitle ?? "게임 미정"} · {log.tableName ?? "테이블 미정"} · {formatPerson(log.hostName, log.hostLoginId)} 개최 ·{" "}
                    {dateTimeFormatter.format(log.startsAt)} · {log.participantCount}/{log.maxPeople}명
                  </p>
                  <p className="participants">
                    함께한 사람:{" "}
                    {participants.length > 0
                      ? participants.map((participant) => formatPerson(participant.name, participant.loginId, participant.studentId)).join(", ")
                      : "기록 없음"}
                  </p>
                </div>
              </article>
            );
          })}
          {meetupLogs.length === 0 ? <p className="empty">아직 게임 약속 로그가 없습니다.</p> : null}
        </div>
      </section>
    </section>
  );
}

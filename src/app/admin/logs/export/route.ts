import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type ParticipantSnapshot = {
  name: string;
  loginId?: string | null;
  studentId?: string | null;
};

const logDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false
});

function formatDate(value?: Date | null) {
  return value ? logDateFormatter.format(value) : "";
}

function formatPerson(name: string, loginId?: string | null, studentId?: string | null) {
  return `${name}(${loginId ?? "-"}${studentId ? ` / ${studentId}` : ""})`;
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

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows: (string | number | null | undefined)[][]) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function filenameFor(kind: string) {
  const date = new Date().toISOString().slice(0, 10);

  if (kind === "loans") {
    return `activity-loans-${date}.csv`;
  }

  if (kind === "meetups") {
    return `activity-meetups-${date}.csv`;
  }

  return `activity-logs-${date}.csv`;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user || user.role !== "ADMIN") {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const kind = request.nextUrl.searchParams.get("kind") ?? "all";
  const includeLoans = kind === "all" || kind === "loans";
  const includeMeetups = kind === "all" || kind === "meetups";

  if (!includeLoans && !includeMeetups) {
    return new NextResponse("Invalid export kind", { status: 400 });
  }

  const [loanLogs, meetupLogs] = await Promise.all([
    includeLoans
      ? prisma.loanActivityLog.findMany({
          orderBy: { occurredAt: "desc" }
        })
      : [],
    includeMeetups
      ? prisma.meetupActivityLog.findMany({
          orderBy: { occurredAt: "desc" }
        })
      : []
  ]);

  const rows: (string | number | null | undefined)[][] = [
    ["분류", "상태", "로그시각", "예약/반납예정시각", "제목/게임명", "이용자/개최자", "로그인ID", "학번", "테이블", "참가자", "인원", "비고"]
  ];

  const activityRows = [
    ...loanLogs.map((log) => ({
      occurredAt: log.occurredAt,
      row: [
        "대여",
        log.type === "BORROW" ? "대여" : "반납",
        formatDate(log.occurredAt),
        formatDate(log.dueAt),
        log.gameTitle,
        log.borrowerName,
        log.borrowerLoginId,
        log.borrowerStudentId,
        "",
        "",
        "",
        log.loanId ? `loanId=${log.loanId}` : ""
      ]
    })),
    ...meetupLogs.map((log) => {
      const participants = readParticipants(log.participants);

      return {
        occurredAt: log.occurredAt,
        row: [
          "약속",
          log.type === "SCHEDULED" ? "생성" : log.type === "COMPLETED" ? "완료" : "취소",
          formatDate(log.occurredAt),
          formatDate(log.startsAt),
          log.title,
          log.hostName,
          log.hostLoginId,
          "",
          log.tableName,
          participants.map((participant) => formatPerson(participant.name, participant.loginId, participant.studentId)).join(", "),
          `${log.participantCount}/${log.maxPeople}`,
          log.gameTitle ? `게임=${log.gameTitle}` : "게임 미정"
        ]
      };
    })
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  rows.push(...activityRows.map((activityRow) => activityRow.row));

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameFor(kind)}"`
    }
  });
}

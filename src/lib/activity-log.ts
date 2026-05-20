import { Prisma } from "@prisma/client";

type LogClient = Prisma.TransactionClient;

type SnapshotParticipant = {
  id: string;
  name: string;
  loginId: string | null;
  studentId: string | null;
};

type LoanLogInput = {
  type: "BORROW" | "RETURN";
  loanId: string;
  gameId: string;
  gameTitle: string;
  borrowerId: string;
  borrowerName: string;
  borrowerLoginId: string;
  borrowerStudentId?: string | null;
  occurredAt: Date;
  dueAt?: Date | null;
};

export async function createLoanActivityLog(tx: LogClient, input: LoanLogInput) {
  await tx.loanActivityLog.create({
    data: {
      type: input.type,
      loanId: input.loanId,
      gameId: input.gameId,
      gameTitle: input.gameTitle,
      borrowerId: input.borrowerId,
      borrowerName: input.borrowerName,
      borrowerLoginId: input.borrowerLoginId,
      borrowerStudentId: input.borrowerStudentId ?? null,
      occurredAt: input.occurredAt,
      dueAt: input.dueAt ?? null
    }
  });
}

type MeetupForLog = {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  maxPeople: number;
  gameId: string | null;
  tableId: string;
  hostId: string;
  game?: { title: string } | null;
  table: { name: string };
  host: {
    name: string;
    loginId: string;
  };
  participants: {
    user: {
      id: string;
      name: string;
      loginId: string;
      studentId: string | null;
    };
  }[];
};

export async function createMeetupActivityLog(
  tx: LogClient,
  type: "SCHEDULED" | "COMPLETED" | "CANCELED",
  meetup: MeetupForLog,
  occurredAt: Date
) {
  const participants: SnapshotParticipant[] = meetup.participants.map((participant) => ({
    id: participant.user.id,
    name: participant.user.name,
    loginId: participant.user.loginId,
    studentId: participant.user.studentId
  }));

  await tx.meetupActivityLog.create({
    data: {
      type,
      meetupId: meetup.id,
      title: meetup.title,
      description: meetup.description,
      startsAt: meetup.startsAt,
      maxPeople: meetup.maxPeople,
      gameId: meetup.gameId,
      gameTitle: meetup.game?.title ?? null,
      tableId: meetup.tableId,
      tableName: meetup.table.name,
      hostId: meetup.hostId,
      hostName: meetup.host.name,
      hostLoginId: meetup.host.loginId,
      participants,
      participantCount: participants.length,
      occurredAt
    }
  });
}

import { Prisma } from "@prisma/client";

type LogClient = Prisma.TransactionClient;
type GeneralLogClient = {
  generalActivityLog: {
    create: (args: Prisma.GeneralActivityLogCreateArgs) => Promise<unknown>;
  };
};

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

type GeneralLogInput = {
  category: string;
  action: string;
  actor?: {
    id: string;
    name: string;
    loginId: string;
    role?: string | null;
  } | null;
  target?: {
    type: string;
    id?: string | null;
    name?: string | null;
  } | null;
  message: string;
  metadata?: Prisma.InputJsonValue;
  occurredAt?: Date;
};

export async function createGeneralActivityLog(client: GeneralLogClient, input: GeneralLogInput) {
  await client.generalActivityLog.create({
    data: {
      category: input.category,
      action: input.action,
      actorId: input.actor?.id ?? null,
      actorName: input.actor?.name ?? null,
      actorLoginId: input.actor?.loginId ?? null,
      actorRole: input.actor?.role ?? null,
      targetType: input.target?.type ?? null,
      targetId: input.target?.id ?? null,
      targetName: input.target?.name ?? null,
      message: input.message,
      metadata: input.metadata ?? Prisma.JsonNull,
      occurredAt: input.occurredAt ?? new Date()
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

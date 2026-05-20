CREATE TYPE "LoanActivityType" AS ENUM ('BORROW', 'RETURN');

CREATE TYPE "MeetupActivityType" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELED');

CREATE TABLE "LoanActivityLog" (
    "id" TEXT NOT NULL,
    "type" "LoanActivityType" NOT NULL,
    "loanId" TEXT,
    "gameId" TEXT,
    "gameTitle" TEXT NOT NULL,
    "borrowerId" TEXT,
    "borrowerName" TEXT NOT NULL,
    "borrowerLoginId" TEXT,
    "borrowerStudentId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MeetupActivityLog" (
    "id" TEXT NOT NULL,
    "type" "MeetupActivityType" NOT NULL,
    "meetupId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "maxPeople" INTEGER NOT NULL,
    "gameId" TEXT,
    "gameTitle" TEXT,
    "tableId" TEXT,
    "tableName" TEXT,
    "hostId" TEXT,
    "hostName" TEXT NOT NULL,
    "hostLoginId" TEXT,
    "participants" JSONB NOT NULL,
    "participantCount" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetupActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanActivityLog_type_idx" ON "LoanActivityLog"("type");
CREATE INDEX "LoanActivityLog_occurredAt_idx" ON "LoanActivityLog"("occurredAt");
CREATE INDEX "LoanActivityLog_gameId_idx" ON "LoanActivityLog"("gameId");
CREATE INDEX "LoanActivityLog_borrowerId_idx" ON "LoanActivityLog"("borrowerId");

CREATE INDEX "MeetupActivityLog_type_idx" ON "MeetupActivityLog"("type");
CREATE INDEX "MeetupActivityLog_startsAt_idx" ON "MeetupActivityLog"("startsAt");
CREATE INDEX "MeetupActivityLog_occurredAt_idx" ON "MeetupActivityLog"("occurredAt");
CREATE INDEX "MeetupActivityLog_gameId_idx" ON "MeetupActivityLog"("gameId");
CREATE INDEX "MeetupActivityLog_hostId_idx" ON "MeetupActivityLog"("hostId");

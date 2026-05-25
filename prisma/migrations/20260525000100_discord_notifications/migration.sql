CREATE TYPE "NotificationType" AS ENUM ('RETURN_REQUESTED', 'LOAN_OVERDUE');

CREATE TYPE "NotificationChannel" AS ENUM ('DISCORD');

CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED');

CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "loanId" TEXT,
    "loanRequestId" TEXT,
    "userId" TEXT,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationLog_dedupeKey_key" ON "NotificationLog"("dedupeKey");
CREATE INDEX "NotificationLog_type_idx" ON "NotificationLog"("type");
CREATE INDEX "NotificationLog_channel_idx" ON "NotificationLog"("channel");
CREATE INDEX "NotificationLog_status_idx" ON "NotificationLog"("status");
CREATE INDEX "NotificationLog_loanId_idx" ON "NotificationLog"("loanId");
CREATE INDEX "NotificationLog_loanRequestId_idx" ON "NotificationLog"("loanRequestId");
CREATE INDEX "NotificationLog_userId_idx" ON "NotificationLog"("userId");
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");

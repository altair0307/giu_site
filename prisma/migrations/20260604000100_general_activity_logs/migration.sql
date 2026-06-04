CREATE TABLE "GeneralActivityLog" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorLoginId" TEXT,
    "actorRole" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "targetName" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneralActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GeneralActivityLog_category_idx" ON "GeneralActivityLog"("category");
CREATE INDEX "GeneralActivityLog_action_idx" ON "GeneralActivityLog"("action");
CREATE INDEX "GeneralActivityLog_actorId_idx" ON "GeneralActivityLog"("actorId");
CREATE INDEX "GeneralActivityLog_targetType_idx" ON "GeneralActivityLog"("targetType");
CREATE INDEX "GeneralActivityLog_targetId_idx" ON "GeneralActivityLog"("targetId");
CREATE INDEX "GeneralActivityLog_occurredAt_idx" ON "GeneralActivityLog"("occurredAt");

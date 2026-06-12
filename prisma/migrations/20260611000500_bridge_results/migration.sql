-- AlterEnum
ALTER TYPE "BridgeEventType" ADD VALUE 'ROUND_COMPLETED';

-- AlterTable
ALTER TABLE "BridgeDeal" ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "declarerTricks" INTEGER,
ADD COLUMN "defenderTricks" INTEGER,
ADD COLUMN "contractMade" BOOLEAN,
ADD COLUMN "overtricks" INTEGER,
ADD COLUMN "undertricks" INTEGER,
ADD COLUMN "score" INTEGER;

-- CreateIndex
CREATE INDEX "BridgeDeal_completedAt_idx" ON "BridgeDeal"("completedAt");

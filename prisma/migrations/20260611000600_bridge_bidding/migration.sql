-- CreateEnum
CREATE TYPE "BridgeCallType" AS ENUM ('PASS', 'BID', 'DOUBLE', 'REDOUBLE');

-- CreateEnum
CREATE TYPE "BridgeDoubleStatus" AS ENUM ('UNDOUBLED', 'DOUBLED', 'REDOUBLED');

-- CreateEnum
CREATE TYPE "BridgeVulnerability" AS ENUM ('NONE', 'NS', 'EW', 'BOTH');

-- AlterTable
ALTER TABLE "BridgeDeal" ADD COLUMN "vulnerability" "BridgeVulnerability" NOT NULL DEFAULT 'NONE',
ADD COLUMN "biddingTurn" "BridgeSeatPosition",
ADD COLUMN "doubleStatus" "BridgeDoubleStatus" NOT NULL DEFAULT 'UNDOUBLED';

-- CreateTable
CREATE TABLE "BridgeCall" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "position" "BridgeSeatPosition" NOT NULL,
    "type" "BridgeCallType" NOT NULL,
    "level" INTEGER,
    "suit" "BridgeContractSuit",
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgeCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BridgeCall_dealId_sequence_key" ON "BridgeCall"("dealId", "sequence");

-- CreateIndex
CREATE INDEX "BridgeCall_roomId_idx" ON "BridgeCall"("roomId");

-- CreateIndex
CREATE INDEX "BridgeCall_dealId_idx" ON "BridgeCall"("dealId");

-- CreateIndex
CREATE INDEX "BridgeCall_position_idx" ON "BridgeCall"("position");

-- CreateIndex
CREATE INDEX "BridgeDeal_biddingTurn_idx" ON "BridgeDeal"("biddingTurn");

-- AddForeignKey
ALTER TABLE "BridgeCall" ADD CONSTRAINT "BridgeCall_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "BridgeDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

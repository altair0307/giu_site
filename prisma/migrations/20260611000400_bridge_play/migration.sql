-- CreateEnum
CREATE TYPE "BridgeContractSuit" AS ENUM ('CLUBS', 'DIAMONDS', 'HEARTS', 'SPADES', 'NOTRUMP');

-- AlterEnum
ALTER TYPE "BridgeEventType" ADD VALUE 'CONTRACT_SET';

-- AlterTable
ALTER TABLE "BridgeDeal" ADD COLUMN "contractLevel" INTEGER,
ADD COLUMN "contractSuit" "BridgeContractSuit",
ADD COLUMN "declarer" "BridgeSeatPosition",
ADD COLUMN "dummy" "BridgeSeatPosition",
ADD COLUMN "currentTurn" "BridgeSeatPosition",
ADD COLUMN "playStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BridgeTrick" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "trickNumber" INTEGER NOT NULL,
    "leader" "BridgeSeatPosition" NOT NULL,
    "winner" "BridgeSeatPosition",
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgeTrick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgePlay" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "trickId" TEXT NOT NULL,
    "position" "BridgeSeatPosition" NOT NULL,
    "card" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgePlay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BridgeDeal_currentTurn_idx" ON "BridgeDeal"("currentTurn");

-- CreateIndex
CREATE UNIQUE INDEX "BridgeTrick_dealId_trickNumber_key" ON "BridgeTrick"("dealId", "trickNumber");

-- CreateIndex
CREATE INDEX "BridgeTrick_roomId_idx" ON "BridgeTrick"("roomId");

-- CreateIndex
CREATE INDEX "BridgeTrick_winner_idx" ON "BridgeTrick"("winner");

-- CreateIndex
CREATE UNIQUE INDEX "BridgePlay_trickId_position_key" ON "BridgePlay"("trickId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "BridgePlay_dealId_card_key" ON "BridgePlay"("dealId", "card");

-- CreateIndex
CREATE INDEX "BridgePlay_roomId_idx" ON "BridgePlay"("roomId");

-- CreateIndex
CREATE INDEX "BridgePlay_dealId_idx" ON "BridgePlay"("dealId");

-- CreateIndex
CREATE INDEX "BridgePlay_position_idx" ON "BridgePlay"("position");

-- AddForeignKey
ALTER TABLE "BridgeTrick" ADD CONSTRAINT "BridgeTrick_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "BridgeRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeTrick" ADD CONSTRAINT "BridgeTrick_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "BridgeDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgePlay" ADD CONSTRAINT "BridgePlay_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "BridgeDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgePlay" ADD CONSTRAINT "BridgePlay_trickId_fkey" FOREIGN KEY ("trickId") REFERENCES "BridgeTrick"("id") ON DELETE CASCADE ON UPDATE CASCADE;

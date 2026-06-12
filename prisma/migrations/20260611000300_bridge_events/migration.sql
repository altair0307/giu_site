-- CreateEnum
CREATE TYPE "BridgeEventType" AS ENUM ('ROOM_CREATED', 'SEAT_JOINED', 'SEAT_LEFT', 'DEAL_CREATED', 'CALL_MADE', 'CARD_PLAYED', 'TRICK_COMPLETED');

-- CreateTable
CREATE TABLE "BridgeEvent" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "type" "BridgeEventType" NOT NULL,
    "actorId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BridgeEvent_roomId_createdAt_idx" ON "BridgeEvent"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "BridgeEvent_roomId_id_idx" ON "BridgeEvent"("roomId", "id");

-- CreateIndex
CREATE INDEX "BridgeEvent_type_idx" ON "BridgeEvent"("type");

-- AddForeignKey
ALTER TABLE "BridgeEvent" ADD CONSTRAINT "BridgeEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "BridgeRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "MeetupKind" AS ENUM ('GENERAL', 'BRIDGE');

-- CreateEnum
CREATE TYPE "BridgeRoomStatus" AS ENUM ('LOBBY', 'PLAYING', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "BridgeSeatPosition" AS ENUM ('NORTH', 'EAST', 'SOUTH', 'WEST');

-- AlterTable
ALTER TABLE "Meetup" ADD COLUMN "kind" "MeetupKind" NOT NULL DEFAULT 'GENERAL';

-- CreateTable
CREATE TABLE "BridgeRoom" (
    "id" TEXT NOT NULL,
    "meetupId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "status" "BridgeRoomStatus" NOT NULL DEFAULT 'LOBBY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BridgeRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgeSeat" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" "BridgeSeatPosition" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgeSeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meetup_kind_idx" ON "Meetup"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "BridgeRoom_meetupId_key" ON "BridgeRoom"("meetupId");

-- CreateIndex
CREATE INDEX "BridgeRoom_status_idx" ON "BridgeRoom"("status");

-- CreateIndex
CREATE INDEX "BridgeRoom_hostId_idx" ON "BridgeRoom"("hostId");

-- CreateIndex
CREATE UNIQUE INDEX "BridgeSeat_roomId_position_key" ON "BridgeSeat"("roomId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "BridgeSeat_roomId_userId_key" ON "BridgeSeat"("roomId", "userId");

-- CreateIndex
CREATE INDEX "BridgeSeat_userId_idx" ON "BridgeSeat"("userId");

-- AddForeignKey
ALTER TABLE "BridgeRoom" ADD CONSTRAINT "BridgeRoom_meetupId_fkey" FOREIGN KEY ("meetupId") REFERENCES "Meetup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeRoom" ADD CONSTRAINT "BridgeRoom_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeSeat" ADD CONSTRAINT "BridgeSeat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "BridgeRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BridgeSeat" ADD CONSTRAINT "BridgeSeat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

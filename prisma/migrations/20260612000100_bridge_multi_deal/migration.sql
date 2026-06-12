ALTER TABLE "BridgeDeal" ADD COLUMN "boardNumber" INTEGER NOT NULL DEFAULT 1;

DROP INDEX "BridgeDeal_roomId_key";

CREATE UNIQUE INDEX "BridgeDeal_roomId_boardNumber_key" ON "BridgeDeal"("roomId", "boardNumber");
CREATE INDEX "BridgeDeal_roomId_idx" ON "BridgeDeal"("roomId");

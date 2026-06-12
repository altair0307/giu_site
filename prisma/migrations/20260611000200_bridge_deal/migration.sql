-- CreateTable
CREATE TABLE "BridgeDeal" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "dealer" "BridgeSeatPosition" NOT NULL,
    "hands" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BridgeDeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BridgeDeal_roomId_key" ON "BridgeDeal"("roomId");

-- CreateIndex
CREATE INDEX "BridgeDeal_dealer_idx" ON "BridgeDeal"("dealer");

-- AddForeignKey
ALTER TABLE "BridgeDeal" ADD CONSTRAINT "BridgeDeal_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "BridgeRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

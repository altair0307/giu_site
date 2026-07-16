ALTER TABLE "Game"
ADD COLUMN "owner" TEXT;

CREATE INDEX "Game_owner_idx" ON "Game"("owner");

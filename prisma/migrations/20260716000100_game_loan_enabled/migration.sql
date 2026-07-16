ALTER TABLE "Game"
ADD COLUMN "isLoanEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Game_isLoanEnabled_idx" ON "Game"("isLoanEnabled");

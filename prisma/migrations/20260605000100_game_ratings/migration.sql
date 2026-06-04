CREATE TYPE "RatingPlayedStatus" AS ENUM ('VERIFIED', 'SELF_REPORTED', 'UNVERIFIED');

CREATE TABLE "GameRating" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "playedStatus" "RatingPlayedStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "trustWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "reasonTags" TEXT[],
    "comment" TEXT,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameRating_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameRating_gameId_userId_key" ON "GameRating"("gameId", "userId");
CREATE INDEX "GameRating_userId_idx" ON "GameRating"("userId");
CREATE INDEX "GameRating_gameId_idx" ON "GameRating"("gameId");
CREATE INDEX "GameRating_playedStatus_idx" ON "GameRating"("playedStatus");
CREATE INDEX "GameRating_isHidden_idx" ON "GameRating"("isHidden");

ALTER TABLE "GameRating" ADD CONSTRAINT "GameRating_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameRating" ADD CONSTRAINT "GameRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Game"
ADD COLUMN "players" TEXT,
ADD COLUMN "bestPlayers" TEXT,
ADD COLUMN "playTime" TEXT,
ADD COLUMN "quantity" INTEGER,
ADD COLUMN "note" TEXT,
ADD COLUMN "genre" TEXT,
ADD COLUMN "isPresent" BOOLEAN,
ADD COLUMN "weight" TEXT;

UPDATE "Game"
SET
  "players" = "minPlayers"::TEXT || '~' || "maxPlayers"::TEXT,
  "bestPlayers" = NULL,
  "playTime" = "playMinutes"::TEXT,
  "quantity" = 1,
  "note" = NULL,
  "genre" = NULL,
  "isPresent" = TRUE,
  "weight" = "difficulty"::TEXT;

ALTER TABLE "Game"
DROP COLUMN "minPlayers",
DROP COLUMN "maxPlayers",
DROP COLUMN "playMinutes",
DROP COLUMN "difficulty";

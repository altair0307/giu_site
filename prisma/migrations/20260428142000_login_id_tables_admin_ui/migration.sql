-- Add login IDs while preserving existing local users.
ALTER TABLE "User" ADD COLUMN "loginId" TEXT;
UPDATE "User" SET "loginId" = "studentId" WHERE "loginId" IS NULL;
ALTER TABLE "User" ALTER COLUMN "loginId" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "studentId" DROP NOT NULL;

DROP INDEX IF EXISTS "User_studentId_key";
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");
CREATE INDEX "User_loginId_idx" ON "User"("loginId");

-- Game storage location is no longer part of the game record.
ALTER TABLE "Game" DROP COLUMN "location";

-- Reservable club-room tables for meetups.
CREATE TABLE "GameTable" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameTable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameTable_name_key" ON "GameTable"("name");

INSERT INTO "GameTable" ("id", "name", "capacity")
VALUES
  ('round-table', '원형 테이블', 4),
  ('large-table', '대형 테이블', 8),
  ('medium-table', '중형 테이블', 6)
ON CONFLICT ("name") DO NOTHING;

ALTER TABLE "Meetup" ADD COLUMN "tableId" TEXT;
UPDATE "Meetup" SET "tableId" = 'medium-table' WHERE "tableId" IS NULL;
ALTER TABLE "Meetup" ALTER COLUMN "tableId" SET NOT NULL;

CREATE INDEX "Meetup_tableId_idx" ON "Meetup"("tableId");

ALTER TABLE "Meetup" ADD CONSTRAINT "Meetup_tableId_fkey"
FOREIGN KEY ("tableId") REFERENCES "GameTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

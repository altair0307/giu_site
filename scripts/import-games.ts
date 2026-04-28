import fs from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { parseGameWorkbook } from "../src/lib/game-spreadsheet";

const prisma = new PrismaClient();

async function main() {
  const path = process.argv[2];

  if (!path) {
    throw new Error("Usage: tsx scripts/import-games.ts <xlsx-path>");
  }

  const rows = await parseGameWorkbook(await fs.readFile(path));

  await prisma.$transaction(async (tx) => {
    await tx.meetup.updateMany({ data: { gameId: null } });
    await tx.loan.deleteMany({});
    await tx.game.deleteMany({});
    await tx.game.createMany({
      data: rows.map((row) => ({
        title: row.title,
        players: row.players,
        bestPlayers: row.bestPlayers,
        playTime: row.playTime,
        quantity: row.quantity,
        note: row.note,
        genre: row.genre,
        isPresent: row.isPresent,
        weight: row.weight
      }))
    });
  });

  console.log(`Imported ${rows.length} games`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });

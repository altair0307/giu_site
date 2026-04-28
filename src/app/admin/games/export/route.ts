import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildGameWorkbook } from "@/lib/game-spreadsheet";

export async function GET() {
  const user = await getCurrentUser();

  if (!user || user.role !== "ADMIN") {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const games = await prisma.game.findMany({
    orderBy: { title: "asc" }
  });
  const buffer = await buildGameWorkbook(games);

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="boardgame-db.xlsx"`
    }
  });
}

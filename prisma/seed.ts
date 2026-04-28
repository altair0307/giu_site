import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminPasswordHash = await bcrypt.hash("admin1234", 12);
  const memberPasswordHash = await bcrypt.hash("user1234", 12);

  await prisma.user.upsert({
    where: { loginId: "admin" },
    update: {},
    create: {
      loginId: "admin",
      name: "관리자",
      studentId: "admin",
      passwordHash: adminPasswordHash,
      role: "ADMIN"
    }
  });

  await prisma.user.upsert({
    where: { loginId: "user" },
    update: {},
    create: {
      loginId: "user",
      name: "일반회원",
      studentId: "20240000",
      passwordHash: memberPasswordHash,
      role: "MEMBER"
    }
  });

  await prisma.gameTable.createMany({
    data: [
      { name: "원형 테이블", capacity: 4 },
      { name: "대형 테이블", capacity: 8 },
      { name: "중형 테이블", capacity: 6 }
    ],
    skipDuplicates: true
  });

  const games = [
    {
        title: "스플렌더",
        players: "2~4",
        bestPlayers: null,
        playTime: "30",
        quantity: 1,
        note: null,
        genre: null,
        isPresent: true,
        weight: "2"
    },
    {
        title: "뱅!",
        players: "4~7",
        bestPlayers: null,
        playTime: "40",
        quantity: 1,
        note: null,
        genre: null,
        isPresent: true,
        weight: "2"
    },
    {
        title: "카탄",
        players: "3~4",
        bestPlayers: null,
        playTime: "75",
        quantity: 1,
        note: null,
        genre: null,
        isPresent: true,
        weight: "3"
    }
  ];

  for (const game of games) {
    const existing = await prisma.game.findFirst({ where: { title: game.title } });
    if (!existing) {
      await prisma.game.create({ data: game });
    }
  }
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

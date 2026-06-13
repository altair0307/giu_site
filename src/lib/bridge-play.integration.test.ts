import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient, type BridgeSeatPosition } from "@prisma/client";
import { playBridgeCard } from "./bridge-play";

const databaseUrl = process.env.DATABASE_URL ?? "";

if (!databaseUrl.includes("boardgame_test")) {
  throw new Error("브릿지 통합 테스트는 boardgame_test 데이터베이스에서만 실행할 수 있습니다.");
}

const prisma = new PrismaClient();
const testRunId = `bridge-play-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const createdMeetupIds: string[] = [];
const createdUserIds: string[] = [];
const ranks = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];

type Hands = Record<BridgeSeatPosition, string[]>;
type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture(hands: Hands) {
  const table = await prisma.gameTable.upsert({
    where: { name: "브릿지 플레이 통합 테스트 테이블" },
    update: { capacity: 4 },
    create: { name: "브릿지 플레이 통합 테스트 테이블", capacity: 4 }
  });
  const positions = ["NORTH", "EAST", "SOUTH", "WEST"] as const;
  const users = await Promise.all(
    positions.map((position) =>
      prisma.user.create({
        data: {
          loginId: `${testRunId}-${position}-${createdUserIds.length}`,
          name: `플레이테스트 ${position}`,
          passwordHash: "integration-test-only"
        }
      })
    )
  );
  createdUserIds.push(...users.map((user) => user.id));

  const meetup = await prisma.meetup.create({
    data: {
      kind: "BRIDGE",
      title: "브릿지 플레이 통합 테스트",
      startsAt: new Date(),
      maxPeople: 4,
      hostId: users[0].id,
      tableId: table.id,
      participants: { create: users.map((user) => ({ userId: user.id })) },
      bridgeRoom: {
        create: {
          hostId: users[0].id,
          status: "PLAYING",
          seats: {
            create: positions.map((position, index) => ({ position, userId: users[index].id }))
          },
          deals: {
            create: {
              boardNumber: 1,
              dealer: "NORTH",
              vulnerability: "NONE",
              hands,
              biddingTurn: null,
              contractLevel: 1,
              contractSuit: "NOTRUMP",
              declarer: "NORTH",
              dummy: "SOUTH",
              currentTurn: "EAST",
              playStartedAt: new Date()
            }
          }
        }
      }
    },
    include: { bridgeRoom: { include: { deals: true } } }
  });
  createdMeetupIds.push(meetup.id);

  return {
    roomId: meetup.bridgeRoom!.id,
    dealId: meetup.bridgeRoom!.deals[0].id,
    userByPosition: Object.fromEntries(positions.map((position, index) => [position, users[index]])) as Record<
      BridgeSeatPosition,
      (typeof users)[number]
    >
  };
}

async function play(fixture: Fixture, actorPosition: BridgeSeatPosition, card: string) {
  const user = fixture.userByPosition[actorPosition];

  await prisma.$transaction((tx) =>
    playBridgeCard(tx, {
      roomId: fixture.roomId,
      card,
      actor: {
        id: user.id,
        name: user.name,
        loginId: user.loginId,
        role: user.role
      }
    })
  );
}

before(async () => {
  await prisma.$connect();
});

after(async () => {
  await prisma.meetup.deleteMany({ where: { id: { in: createdMeetupIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

test("follow suit violations roll back the play, hand, turn, and events", async () => {
  const fixture = await createFixture({
    NORTH: ["2S"],
    EAST: ["2C"],
    SOUTH: ["3C", "2D"],
    WEST: ["2H"]
  });

  await play(fixture, "EAST", "2C");
  await assert.rejects(() => play(fixture, "NORTH", "2D"), /같은 무늬가 있으면 먼저 따라 내야 합니다/);

  const deal = await prisma.bridgeDeal.findUniqueOrThrow({ where: { id: fixture.dealId } });
  assert.equal(deal.currentTurn, "SOUTH");
  assert.deepEqual((deal.hands as Hands).SOUTH, ["3C", "2D"]);
  assert.equal(await prisma.bridgePlay.count({ where: { dealId: fixture.dealId } }), 1);
  assert.equal(await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId, type: "CARD_PLAYED" } }), 1);
});

test("only the declarer can play dummy cards", async () => {
  const fixture = await createFixture({
    NORTH: ["2S"],
    EAST: ["2C"],
    SOUTH: ["2D"],
    WEST: ["2H"]
  });

  await play(fixture, "EAST", "2C");
  await assert.rejects(() => play(fixture, "SOUTH", "2D"), /더미 차례에는 선언자만 카드를 낼 수 있습니다/);
  assert.equal(await prisma.bridgePlay.count({ where: { dealId: fixture.dealId } }), 1);
});

test("thirteen completed tricks persist the result, score, events, and activity log", async () => {
  const fixture = await createFixture({
    NORTH: ranks.map((rank) => `${rank}S`),
    EAST: ranks.map((rank) => `${rank}C`),
    SOUTH: ranks.map((rank) => `${rank}D`),
    WEST: ranks.map((rank) => `${rank}H`)
  });

  for (const rank of ranks) {
    await play(fixture, "EAST", `${rank}C`);
    await play(fixture, "NORTH", `${rank}D`);
    await play(fixture, "WEST", `${rank}H`);
    await play(fixture, "NORTH", `${rank}S`);
  }

  const deal = await prisma.bridgeDeal.findUniqueOrThrow({ where: { id: fixture.dealId } });
  const tricks = await prisma.bridgeTrick.findMany({ where: { dealId: fixture.dealId }, orderBy: { trickNumber: "asc" } });

  assert.ok(deal.completedAt);
  assert.equal(deal.currentTurn, null);
  assert.equal(deal.declarerTricks, 0);
  assert.equal(deal.defenderTricks, 13);
  assert.equal(deal.contractMade, false);
  assert.equal(deal.undertricks, 7);
  assert.equal(deal.score, -350);
  assert.equal(tricks.length, 13);
  assert.ok(tricks.every((trick) => trick.winner === "EAST" && trick.completedAt));
  assert.equal(await prisma.bridgePlay.count({ where: { dealId: fixture.dealId } }), 52);
  assert.equal(await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId, type: "TRICK_COMPLETED" } }), 13);
  assert.equal(await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId, type: "ROUND_COMPLETED" } }), 1);
  assert.equal(
    await prisma.generalActivityLog.count({
      where: { targetId: fixture.roomId, category: "BRIDGE", action: "ROUND_COMPLETE" }
    }),
    1
  );
});

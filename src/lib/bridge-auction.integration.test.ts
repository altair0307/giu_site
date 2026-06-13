import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient, type BridgeSeatPosition } from "@prisma/client";
import { makeBridgeCall, type BridgeCallType } from "./bridge-auction";
import type { BridgeContractSuit } from "./bridge-scoring";

const databaseUrl = process.env.DATABASE_URL ?? "";

if (!databaseUrl.includes("boardgame_test")) {
  throw new Error("브릿지 통합 테스트는 boardgame_test 데이터베이스에서만 실행할 수 있습니다.");
}

const prisma = new PrismaClient();
const testRunId = `bridge-auction-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const createdMeetupIds: string[] = [];
const createdUserIds: string[] = [];

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const table = await prisma.gameTable.upsert({
    where: { name: "브릿지 통합 테스트 테이블" },
    update: { capacity: 4 },
    create: { name: "브릿지 통합 테스트 테이블", capacity: 4 }
  });
  const positions = ["NORTH", "EAST", "SOUTH", "WEST"] as const;
  const users = await Promise.all(
    positions.map((position) =>
      prisma.user.create({
        data: {
          loginId: `${testRunId}-${position}-${createdUserIds.length}`,
          name: `통합테스트 ${position}`,
          passwordHash: "integration-test-only"
        }
      })
    )
  );
  createdUserIds.push(...users.map((user) => user.id));

  const meetup = await prisma.meetup.create({
    data: {
      kind: "BRIDGE",
      title: "브릿지 비딩 통합 테스트",
      startsAt: new Date(),
      maxPeople: 4,
      hostId: users[0].id,
      tableId: table.id,
      participants: {
        create: users.map((user) => ({ userId: user.id }))
      },
      bridgeRoom: {
        create: {
          hostId: users[0].id,
          status: "PLAYING",
          seats: {
            create: positions.map((position, index) => ({
              position,
              userId: users[index].id
            }))
          },
          deals: {
            create: {
              boardNumber: 1,
              dealer: "NORTH",
              biddingTurn: "NORTH",
              vulnerability: "NONE",
              hands: {}
            }
          }
        }
      }
    },
    include: {
      bridgeRoom: {
        include: { deals: true }
      }
    }
  });
  createdMeetupIds.push(meetup.id);

  const userByPosition = Object.fromEntries(positions.map((position, index) => [position, users[index]])) as Record<
    BridgeSeatPosition,
    (typeof users)[number]
  >;

  return {
    roomId: meetup.bridgeRoom!.id,
    dealId: meetup.bridgeRoom!.deals[0].id,
    userByPosition
  };
}

async function call(
  fixture: Fixture,
  position: BridgeSeatPosition,
  callType: BridgeCallType,
  level?: number,
  suit?: BridgeContractSuit
) {
  await prisma.$transaction((tx) =>
    makeBridgeCall(tx, {
      roomId: fixture.roomId,
      userId: fixture.userByPosition[position].id,
      callType,
      level,
      suit
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

test("three passes after a bid persist the contract, declarer, turn, and events", async () => {
  const fixture = await createFixture();

  await call(fixture, "NORTH", "BID", 1, "HEARTS");
  await call(fixture, "EAST", "PASS");
  await call(fixture, "SOUTH", "PASS");
  await call(fixture, "WEST", "PASS");

  const deal = await prisma.bridgeDeal.findUniqueOrThrow({
    where: { id: fixture.dealId },
    include: { calls: { orderBy: { sequence: "asc" } } }
  });
  const events = await prisma.bridgeEvent.findMany({ where: { roomId: fixture.roomId } });

  assert.equal(deal.contractLevel, 1);
  assert.equal(deal.contractSuit, "HEARTS");
  assert.equal(deal.declarer, "NORTH");
  assert.equal(deal.dummy, "SOUTH");
  assert.equal(deal.currentTurn, "EAST");
  assert.equal(deal.biddingTurn, null);
  assert.deepEqual(deal.calls.map((item) => item.type), ["BID", "PASS", "PASS", "PASS"]);
  assert.equal(events.filter((event) => event.type === "CALL_MADE").length, 4);
  assert.equal(events.filter((event) => event.type === "CONTRACT_SET").length, 1);
});

test("four opening passes complete the board as a zero-score passout", async () => {
  const fixture = await createFixture();

  await call(fixture, "NORTH", "PASS");
  await call(fixture, "EAST", "PASS");
  await call(fixture, "SOUTH", "PASS");
  await call(fixture, "WEST", "PASS");

  const deal = await prisma.bridgeDeal.findUniqueOrThrow({ where: { id: fixture.dealId } });
  const events = await prisma.bridgeEvent.findMany({ where: { roomId: fixture.roomId } });

  assert.ok(deal.completedAt);
  assert.equal(deal.score, 0);
  assert.equal(deal.contractLevel, null);
  assert.equal(deal.biddingTurn, null);
  assert.equal(events.filter((event) => event.type === "ROUND_COMPLETED").length, 1);
});

test("a player cannot bid outside their turn", async () => {
  const fixture = await createFixture();

  await assert.rejects(() => call(fixture, "EAST", "BID", 1, "CLUBS"), /현재 비딩 차례가 아닙니다/);

  assert.equal(await prisma.bridgeCall.count({ where: { dealId: fixture.dealId } }), 0);
  assert.equal(await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId } }), 0);
});

test("double and redouble survive through contract completion", async () => {
  const fixture = await createFixture();

  await call(fixture, "NORTH", "BID", 1, "SPADES");
  await call(fixture, "EAST", "DOUBLE");
  await call(fixture, "SOUTH", "REDOUBLE");
  await call(fixture, "WEST", "PASS");
  await call(fixture, "NORTH", "PASS");
  await call(fixture, "EAST", "PASS");

  const deal = await prisma.bridgeDeal.findUniqueOrThrow({ where: { id: fixture.dealId } });

  assert.equal(deal.contractLevel, 1);
  assert.equal(deal.contractSuit, "SPADES");
  assert.equal(deal.doubleStatus, "REDOUBLED");
  assert.equal(deal.declarer, "NORTH");
});

test("an invalid double rolls back without calls or events", async () => {
  const fixture = await createFixture();

  await assert.rejects(() => call(fixture, "NORTH", "DOUBLE"), /상대 팀의 마지막 입찰에만 더블할 수 있습니다/);

  assert.equal(await prisma.bridgeCall.count({ where: { dealId: fixture.dealId } }), 0);
  assert.equal(await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId } }), 0);
});

test("simultaneous duplicate calls commit only once", async () => {
  const fixture = await createFixture();
  const results = await Promise.allSettled([
    call(fixture, "NORTH", "BID", 1, "CLUBS"),
    call(fixture, "NORTH", "BID", 1, "CLUBS")
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(await prisma.bridgeCall.count({ where: { dealId: fixture.dealId } }), 1);
  assert.equal(await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId, type: "CALL_MADE" } }), 1);
});

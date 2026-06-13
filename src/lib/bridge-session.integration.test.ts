import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { PrismaClient, type BridgeSeatPosition } from "@prisma/client";
import { completeBridgeSession, createBridgeDeal, expireBridgeRoom, setBridgeSpectatorAccess } from "./bridge-session";
import { removeMeetupParticipant } from "./bridge-lobby";
import { pruneBridgeEvents } from "./bridge-events";

const databaseUrl = process.env.DATABASE_URL ?? "";

if (!databaseUrl.includes("boardgame_test")) {
  throw new Error("브릿지 통합 테스트는 boardgame_test 데이터베이스에서만 실행할 수 있습니다.");
}

const prisma = new PrismaClient();
const testRunId = `bridge-session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const createdMeetupIds: string[] = [];
const createdUserIds: string[] = [];
const deck = ["S", "H", "D", "C"].flatMap((suit) =>
  ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"].map((rank) => `${rank}${suit}`)
);

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture({ activeDeal = false, completedDeal = false } = {}) {
  const table = await prisma.gameTable.upsert({
    where: { name: "브릿지 세션 통합 테스트 테이블" },
    update: { capacity: 4 },
    create: { name: "브릿지 세션 통합 테스트 테이블", capacity: 4 }
  });
  const positions = ["NORTH", "EAST", "SOUTH", "WEST"] as const;
  const users = await Promise.all(
    positions.map((position) =>
      prisma.user.create({
        data: {
          loginId: `${testRunId}-${position}-${createdUserIds.length}`,
          name: `세션테스트 ${position}`,
          passwordHash: "integration-test-only"
        }
      })
    )
  );
  createdUserIds.push(...users.map((user) => user.id));

  const meetup = await prisma.meetup.create({
    data: {
      kind: "BRIDGE",
      title: "브릿지 세션 통합 테스트",
      startsAt: new Date(),
      maxPeople: 4,
      hostId: users[0].id,
      tableId: table.id,
      participants: { create: users.map((user) => ({ userId: user.id })) },
      bridgeRoom: {
        create: {
          hostId: users[0].id,
          status: activeDeal || completedDeal ? "PLAYING" : "LOBBY",
          seats: { create: positions.map((position, index) => ({ position, userId: users[index].id })) },
          deals:
            activeDeal || completedDeal
              ? {
                  create: {
                    boardNumber: 1,
                    dealer: "NORTH",
                    vulnerability: "NONE",
                    biddingTurn: activeDeal ? "NORTH" : null,
                    hands: Object.fromEntries(positions.map((position, index) => [position, deck.slice(index * 13, (index + 1) * 13)])),
                    completedAt: completedDeal ? new Date() : null,
                    score: completedDeal ? 0 : null
                  }
                }
              : undefined
        }
      }
    },
    include: { bridgeRoom: true }
  });
  createdMeetupIds.push(meetup.id);

  return {
    meetupId: meetup.id,
    roomId: meetup.bridgeRoom!.id,
    actor: {
      id: users[0].id,
      name: users[0].name,
      loginId: users[0].loginId,
      role: users[0].role
    },
    nonHostActor: {
      id: users[1].id,
      name: users[1].name,
      loginId: users[1].loginId,
      role: users[1].role
    },
    targetUserId: users[2].id,
    initialSeatByUser: Object.fromEntries(users.map((user, index) => [user.id, positions[index]])) as Record<
      string,
      BridgeSeatPosition
    >
  };
}

async function createDeal(fixture: Fixture) {
  return prisma.$transaction((tx) =>
    createBridgeDeal(tx, {
      roomId: fixture.roomId,
      actor: fixture.actor,
      deck
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

test("the next deal advances board, dealer, vulnerability, and keeps seats", async () => {
  const fixture = await createFixture({ completedDeal: true });
  const deal = await createDeal(fixture);
  const room = await prisma.bridgeRoom.findUniqueOrThrow({
    where: { id: fixture.roomId },
    include: { seats: true }
  });

  assert.equal(deal.boardNumber, 2);
  assert.equal(deal.dealer, "EAST");
  assert.equal(deal.biddingTurn, "EAST");
  assert.equal(deal.vulnerability, "NS");
  assert.equal(room.status, "PLAYING");
  assert.deepEqual(
    Object.fromEntries(room.seats.map((seat) => [seat.userId, seat.position])),
    fixture.initialSeatByUser
  );
  assert.equal(await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId, type: "DEAL_CREATED" } }), 1);
  assert.equal(
    await prisma.generalActivityLog.count({
      where: { targetId: fixture.roomId, category: "BRIDGE", action: "DEAL_CREATE" }
    }),
    1
  );
});

test("an active deal blocks another deal without leaving logs or events", async () => {
  const fixture = await createFixture({ activeDeal: true });

  await assert.rejects(() => createDeal(fixture), /진행 중인 딜이 있습니다/);
  assert.equal(await prisma.bridgeDeal.count({ where: { roomId: fixture.roomId } }), 1);
  assert.equal(await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId } }), 0);
  assert.equal(await prisma.generalActivityLog.count({ where: { targetId: fixture.roomId } }), 0);
});

test("an active deal blocks session completion", async () => {
  const fixture = await createFixture({ activeDeal: true });

  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        completeBridgeSession(tx, { meetupId: fixture.meetupId, actor: fixture.actor })
      ),
    /진행 중인 딜이 끝난 뒤 세션을 종료할 수 있습니다/
  );

  const room = await prisma.bridgeRoom.findUniqueOrThrow({ where: { id: fixture.roomId } });
  assert.equal(room.status, "PLAYING");
  assert.equal(await prisma.generalActivityLog.count({ where: { targetId: fixture.roomId } }), 0);
});

test("a session with no active deal completes and writes one activity log", async () => {
  const fixture = await createFixture({ completedDeal: true });
  await prisma.bridgeEvent.create({ data: { roomId: fixture.roomId, type: "CALL_MADE" } });
  const roomId = await prisma.$transaction((tx) =>
    completeBridgeSession(tx, { meetupId: fixture.meetupId, actor: fixture.actor })
  );
  const room = await prisma.bridgeRoom.findUniqueOrThrow({ where: { id: fixture.roomId } });

  assert.equal(roomId, fixture.roomId);
  assert.equal(room.status, "COMPLETED");
  assert.equal(await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId } }), 0);
  assert.equal(
    await prisma.generalActivityLog.count({
      where: { targetId: fixture.roomId, category: "BRIDGE", action: "SESSION_COMPLETE" }
    }),
    1
  );
});

test("a room cannot expire before its inactivity threshold", async () => {
  const fixture = await createFixture();

  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        expireBridgeRoom(tx, { roomId: fixture.roomId, actor: fixture.actor, now: new Date() })
      ),
    /아직 만료 기준 시간이 지나지 않았습니다/
  );

  const room = await prisma.bridgeRoom.findUniqueOrThrow({ where: { id: fixture.roomId } });
  assert.equal(room.status, "LOBBY");
});

test("an inactive room becomes expired and cannot be completed afterward", async () => {
  const fixture = await createFixture();

  await prisma.$transaction((tx) =>
    expireBridgeRoom(tx, {
      roomId: fixture.roomId,
      actor: fixture.actor,
      now: new Date(Date.now() + 31 * 60 * 1000)
    })
  );

  const room = await prisma.bridgeRoom.findUniqueOrThrow({ where: { id: fixture.roomId } });
  assert.equal(room.status, "EXPIRED");
  assert.equal(
    await prisma.generalActivityLog.count({
      where: { targetId: fixture.roomId, category: "BRIDGE", action: "ROOM_EXPIRE" }
    }),
    1
  );
  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        completeBridgeSession(tx, { meetupId: fixture.meetupId, actor: fixture.actor })
      ),
    /진행 중인 브릿지 세션만 종료할 수 있습니다/
  );
});

test("the host can enable spectators with an event and activity log", async () => {
  const fixture = await createFixture();

  await prisma.$transaction((tx) =>
    setBridgeSpectatorAccess(tx, {
      roomId: fixture.roomId,
      allowSpectators: true,
      actor: fixture.actor
    })
  );

  const room = await prisma.bridgeRoom.findUniqueOrThrow({ where: { id: fixture.roomId } });
  assert.equal(room.allowSpectators, true);
  assert.equal(
    await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId, type: "SPECTATOR_SETTING_CHANGED" } }),
    1
  );
  assert.equal(
    await prisma.generalActivityLog.count({
      where: { targetId: fixture.roomId, category: "BRIDGE", action: "SPECTATOR_SETTING_CHANGE" }
    }),
    1
  );
});

test("a regular participant cannot change spectator access", async () => {
  const fixture = await createFixture();

  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        setBridgeSpectatorAccess(tx, {
          roomId: fixture.roomId,
          allowSpectators: true,
          actor: fixture.nonHostActor
        })
      ),
    /방장 또는 관리자만 관전 설정을 변경할 수 있습니다/
  );

  const room = await prisma.bridgeRoom.findUniqueOrThrow({ where: { id: fixture.roomId } });
  assert.equal(room.allowSpectators, false);
});

test("the host can remove a lobby participant and their seat", async () => {
  const fixture = await createFixture();

  await prisma.$transaction((tx) =>
    removeMeetupParticipant(tx, {
      meetupId: fixture.meetupId,
      targetUserId: fixture.targetUserId,
      actor: fixture.actor
    })
  );

  assert.equal(
    await prisma.meetupParticipant.count({
      where: { meetupId: fixture.meetupId, userId: fixture.targetUserId }
    }),
    0
  );
  assert.equal(
    await prisma.bridgeSeat.count({
      where: { roomId: fixture.roomId, userId: fixture.targetUserId }
    }),
    0
  );
  assert.equal(await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId, type: "SEAT_LEFT" } }), 1);
});

test("a regular participant cannot remove someone else", async () => {
  const fixture = await createFixture();

  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        removeMeetupParticipant(tx, {
          meetupId: fixture.meetupId,
          targetUserId: fixture.targetUserId,
          actor: fixture.nonHostActor
        })
      ),
    /방장 또는 관리자만 참여자를 내보낼 수 있습니다/
  );
});

test("participants cannot leave after a bridge deal has started", async () => {
  const fixture = await createFixture({ activeDeal: true });

  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        removeMeetupParticipant(tx, {
          meetupId: fixture.meetupId,
          targetUserId: fixture.nonHostActor.id,
          actor: fixture.nonHostActor
        })
      ),
    /이미 딜이 시작된 브릿지 약속에서는 나갈 수 없습니다/
  );
});

test("the bridge host cannot leave their own room", async () => {
  const fixture = await createFixture();

  await assert.rejects(
    () =>
      prisma.$transaction((tx) =>
        removeMeetupParticipant(tx, {
          meetupId: fixture.meetupId,
          targetUserId: fixture.actor.id,
          actor: fixture.actor
        })
      ),
    /방장은 방에서 나가거나 내보낼 수 없습니다/
  );
});

test("active rooms retain only the latest 500 bridge events", async () => {
  const fixture = await createFixture();
  await prisma.bridgeEvent.createMany({
    data: Array.from({ length: 520 }, () => ({ roomId: fixture.roomId, type: "CALL_MADE" as const }))
  });

  const deletedCount = await prisma.$transaction((tx) => pruneBridgeEvents(tx, fixture.roomId));

  assert.equal(deletedCount, 20);
  assert.equal(await prisma.bridgeEvent.count({ where: { roomId: fixture.roomId } }), 500);
});

import type { Prisma } from "@prisma/client";
import { randomInt } from "node:crypto";
import { createGeneralActivityLog } from "@/lib/activity-log";
import { isBridgeRoomExpired, latestBridgeActivityAt } from "@/lib/bridge-expiration";
import {
  BRIDGE_SEAT_POSITIONS,
  bridgeDealerForBoard,
  bridgeVulnerabilityForBoard,
  type BridgeSeatPosition
} from "@/lib/bridge-scoring";

const BRIDGE_SUITS = ["S", "H", "D", "C"] as const;
const BRIDGE_RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

type BridgeActor = { id: string; name: string; loginId: string; role?: string | null };

function createShuffledBridgeDeck() {
  const deck = BRIDGE_SUITS.flatMap((suit) => BRIDGE_RANKS.map((rank) => `${rank}${suit}`));

  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [deck[index], deck[swapIndex]] = [deck[swapIndex], deck[index]];
  }

  return deck;
}

function shuffledBridgeSeatPositions(count: number) {
  const positions = [...BRIDGE_SEAT_POSITIONS];

  for (let index = positions.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [positions[index], positions[swapIndex]] = [positions[swapIndex], positions[index]];
  }

  return positions.slice(0, count);
}

export async function createBridgeDeal(
  tx: Prisma.TransactionClient,
  input: {
    roomId: string;
    actor: BridgeActor;
    deck?: string[];
    firstBoardPositions?: BridgeSeatPosition[];
  }
) {
  const room = await tx.bridgeRoom.findUnique({
    where: { id: input.roomId },
    include: {
      deals: {
        select: { id: true, boardNumber: true, completedAt: true },
        orderBy: { boardNumber: "desc" }
      },
      seats: {
        include: { user: { select: { id: true, name: true, loginId: true } } },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!room) {
    throw new Error("브릿지 방을 찾을 수 없습니다.");
  }

  if (room.hostId !== input.actor.id && input.actor.role !== "ADMIN") {
    throw new Error("방장 또는 관리자만 딜을 생성할 수 있습니다.");
  }

  if (room.status !== "LOBBY" && room.status !== "PLAYING") {
    throw new Error("진행 가능한 브릿지 방에서만 딜을 생성할 수 있습니다.");
  }

  if (room.deals.some((deal) => !deal.completedAt)) {
    throw new Error("진행 중인 딜이 있습니다.");
  }

  if (room.seats.length !== 4) {
    throw new Error("좌석 4명이 모두 배정되어야 딜을 생성할 수 있습니다.");
  }

  const boardNumber = (room.deals[0]?.boardNumber ?? 0) + 1;
  const dealer = bridgeDealerForBoard(boardNumber);
  const vulnerability = bridgeVulnerabilityForBoard(boardNumber);
  const positions =
    boardNumber === 1
      ? input.firstBoardPositions ?? shuffledBridgeSeatPositions(room.seats.length)
      : room.seats.map((seat) => seat.position);

  if (positions.length !== 4 || new Set(positions).size !== 4 || positions.some((position) => !BRIDGE_SEAT_POSITIONS.includes(position))) {
    throw new Error("올바른 브릿지 좌석 배치가 아닙니다.");
  }

  if (boardNumber === 1) {
    await tx.bridgeSeat.deleteMany({ where: { roomId: input.roomId } });
    await tx.bridgeSeat.createMany({
      data: room.seats.map((seat, index) => ({
        roomId: input.roomId,
        userId: seat.userId,
        position: positions[index]
      }))
    });
  }

  const deck = input.deck ?? createShuffledBridgeDeck();

  if (deck.length !== 52 || new Set(deck).size !== 52) {
    throw new Error("브릿지 덱은 서로 다른 52장이어야 합니다.");
  }

  const hands = Object.fromEntries(
    BRIDGE_SEAT_POSITIONS.map((position, index) => [position, deck.slice(index * 13, (index + 1) * 13)])
  );
  const deal = await tx.bridgeDeal.create({
    data: {
      roomId: input.roomId,
      boardNumber,
      dealer,
      biddingTurn: dealer,
      vulnerability,
      hands
    }
  });

  await tx.bridgeRoom.update({ where: { id: input.roomId }, data: { status: "PLAYING" } });
  await tx.bridgeEvent.create({
    data: {
      roomId: input.roomId,
      type: "DEAL_CREATED",
      actorId: input.actor.id,
      payload: {
        boardNumber,
        dealer,
        vulnerability,
        seats: room.seats.map((seat, index) => ({ position: positions[index], userId: seat.userId }))
      }
    }
  });
  await createGeneralActivityLog(tx, {
    category: "BRIDGE",
    action: "DEAL_CREATE",
    actor: input.actor,
    target: { type: "BRIDGE_ROOM", id: input.roomId },
    message: `${input.actor.name} 사용자가 브릿지 딜을 생성했습니다.`,
    metadata: {
      boardNumber,
      dealer,
      vulnerability,
      participants: room.seats.map((seat, index) => ({
        position: positions[index],
        userId: seat.user.id,
        name: seat.user.name,
        loginId: seat.user.loginId
      }))
    }
  });

  return deal;
}

export async function completeBridgeSession(
  tx: Prisma.TransactionClient,
  input: { meetupId: string; actor: BridgeActor }
) {
  const room = await tx.bridgeRoom.findUnique({
    where: { meetupId: input.meetupId },
    include: {
      meetup: { select: { title: true } },
      deals: { where: { completedAt: null }, select: { id: true } }
    }
  });

  if (!room) {
    return null;
  }

  if (room.status !== "LOBBY" && room.status !== "PLAYING") {
    throw new Error("진행 중인 브릿지 세션만 종료할 수 있습니다.");
  }

  if (room.deals.length > 0) {
    throw new Error("진행 중인 딜이 끝난 뒤 세션을 종료할 수 있습니다.");
  }

  await tx.bridgeRoom.update({ where: { id: room.id }, data: { status: "COMPLETED" } });
  await tx.bridgeEvent.deleteMany({ where: { roomId: room.id } });
  await createGeneralActivityLog(tx, {
    category: "BRIDGE",
    action: "SESSION_COMPLETE",
    actor: input.actor,
    target: { type: "BRIDGE_ROOM", id: room.id, name: room.meetup.title },
    message: `${input.actor.name} 사용자가 브릿지 세션을 종료했습니다.`,
    metadata: { meetupId: input.meetupId }
  });

  return room.id;
}

export async function expireBridgeRoom(
  tx: Prisma.TransactionClient,
  input: { roomId: string; actor: BridgeActor; now?: Date }
) {
  const room = await tx.bridgeRoom.findUnique({
    where: { id: input.roomId },
    include: {
      meetup: { select: { title: true } },
      events: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  if (!room) {
    throw new Error("브릿지 방을 찾을 수 없습니다.");
  }

  if (room.status !== "LOBBY" && room.status !== "PLAYING") {
    throw new Error("진행 중인 브릿지 방만 만료 처리할 수 있습니다.");
  }

  const lastActivityAt = latestBridgeActivityAt(room.updatedAt, room.events[0]?.createdAt);

  if (!isBridgeRoomExpired(room.status, lastActivityAt, input.now)) {
    throw new Error("아직 만료 기준 시간이 지나지 않았습니다.");
  }

  await tx.bridgeRoom.update({ where: { id: room.id }, data: { status: "EXPIRED" } });
  await tx.bridgeEvent.deleteMany({ where: { roomId: room.id } });
  await createGeneralActivityLog(tx, {
    category: "BRIDGE",
    action: "ROOM_EXPIRE",
    actor: input.actor,
    target: { type: "BRIDGE_ROOM", id: room.id, name: room.meetup.title },
    message: `${input.actor.name} 관리자가 브릿지 방을 만료 처리했습니다.`,
    metadata: {
      previousStatus: room.status,
      lastActivityAt: lastActivityAt.toISOString()
    }
  });
}

export async function setBridgeSpectatorAccess(
  tx: Prisma.TransactionClient,
  input: { roomId: string; allowSpectators: boolean; actor: BridgeActor }
) {
  const room = await tx.bridgeRoom.findUnique({
    where: { id: input.roomId },
    include: { meetup: { select: { title: true } } }
  });

  if (!room) {
    throw new Error("브릿지 방을 찾을 수 없습니다.");
  }

  if (room.hostId !== input.actor.id && input.actor.role !== "ADMIN") {
    throw new Error("방장 또는 관리자만 관전 설정을 변경할 수 있습니다.");
  }

  if (room.status !== "LOBBY" && room.status !== "PLAYING") {
    throw new Error("진행 중인 브릿지 방에서만 관전 설정을 변경할 수 있습니다.");
  }

  if (room.allowSpectators === input.allowSpectators) {
    return;
  }

  await tx.bridgeRoom.update({
    where: { id: room.id },
    data: { allowSpectators: input.allowSpectators }
  });
  await tx.bridgeEvent.create({
    data: {
      roomId: room.id,
      type: "SPECTATOR_SETTING_CHANGED",
      actorId: input.actor.id,
      payload: { allowSpectators: input.allowSpectators }
    }
  });
  await createGeneralActivityLog(tx, {
    category: "BRIDGE",
    action: "SPECTATOR_SETTING_CHANGE",
    actor: input.actor,
    target: { type: "BRIDGE_ROOM", id: room.id, name: room.meetup.title },
    message: `${input.actor.name} 사용자가 브릿지 관전을 ${input.allowSpectators ? "허용" : "차단"}했습니다.`,
    metadata: { allowSpectators: input.allowSpectators }
  });
}

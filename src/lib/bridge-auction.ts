import type { Prisma } from "@prisma/client";
import {
  BRIDGE_CONTRACT_SUITS,
  BRIDGE_SEAT_POSITIONS,
  bridgeTeam,
  type BridgeContractSuit,
  type BridgeDoubleStatus,
  type BridgeSeatPosition
} from "@/lib/bridge-scoring";

export const BRIDGE_CALL_TYPES = ["PASS", "BID", "DOUBLE", "REDOUBLE"] as const;

export type BridgeCallType = (typeof BRIDGE_CALL_TYPES)[number];

function nextBridgeTurn(position: BridgeSeatPosition) {
  return BRIDGE_SEAT_POSITIONS[(BRIDGE_SEAT_POSITIONS.indexOf(position) + 1) % BRIDGE_SEAT_POSITIONS.length];
}

function bridgePartner(position: BridgeSeatPosition) {
  return BRIDGE_SEAT_POSITIONS[(BRIDGE_SEAT_POSITIONS.indexOf(position) + 2) % BRIDGE_SEAT_POSITIONS.length];
}

function bridgeContractOrder(level: number, suit: BridgeContractSuit) {
  return (level - 1) * BRIDGE_CONTRACT_SUITS.length + BRIDGE_CONTRACT_SUITS.indexOf(suit);
}

export async function makeBridgeCall(
  tx: Prisma.TransactionClient,
  input: {
    roomId: string;
    userId: string;
    callType: BridgeCallType;
    level?: number;
    suit?: BridgeContractSuit;
  }
) {
  const room = await tx.bridgeRoom.findUnique({
    where: { id: input.roomId },
    include: {
      deals: {
        where: { completedAt: null },
        take: 1,
        include: {
          calls: { orderBy: { sequence: "asc" } }
        }
      },
      seats: true
    }
  });
  const deal = room?.deals[0];

  if (!room || !deal) {
    throw new Error("딜이 생성된 뒤 비딩할 수 있습니다.");
  }

  if (room.status !== "PLAYING") {
    throw new Error("진행 중인 방에서만 비딩할 수 있습니다.");
  }

  if (deal.contractLevel || deal.completedAt || !deal.biddingTurn) {
    throw new Error("이미 비딩이 끝났습니다.");
  }

  const mySeat = room.seats.find((seat) => seat.userId === input.userId)?.position;

  if (!mySeat) {
    throw new Error("좌석에 앉은 사용자만 비딩할 수 있습니다.");
  }

  if (mySeat !== deal.biddingTurn) {
    throw new Error("현재 비딩 차례가 아닙니다.");
  }

  const calls = deal.calls;
  const lastBid = [...calls].reverse().find((call) => call.type === "BID");
  const lastBidTeam = lastBid ? bridgeTeam(lastBid.position) : null;
  const myTeam = bridgeTeam(mySeat);
  const nextSequence = calls.length + 1;
  let nextDoubleStatus = deal.doubleStatus as BridgeDoubleStatus;
  let callLevel: number | null = null;
  let callSuit: BridgeContractSuit | null = null;

  if (input.callType === "BID") {
    if (!Number.isInteger(input.level) || !input.level || input.level < 1 || input.level > 7) {
      throw new Error("입찰 레벨은 1부터 7까지 선택해주세요.");
    }

    if (!input.suit || !BRIDGE_CONTRACT_SUITS.includes(input.suit)) {
      throw new Error("입찰 무늬를 선택해주세요.");
    }

    if (
      lastBid?.level &&
      lastBid.suit &&
      bridgeContractOrder(input.level, input.suit) <= bridgeContractOrder(lastBid.level, lastBid.suit)
    ) {
      throw new Error("이전 입찰보다 높은 계약만 부를 수 있습니다.");
    }

    callLevel = input.level;
    callSuit = input.suit;
    nextDoubleStatus = "UNDOUBLED";
  }

  if (input.callType === "DOUBLE") {
    if (!lastBid || !lastBidTeam || lastBidTeam === myTeam) {
      throw new Error("상대 팀의 마지막 입찰에만 더블할 수 있습니다.");
    }

    if (deal.doubleStatus !== "UNDOUBLED") {
      throw new Error("이미 더블 또는 리더블된 계약입니다.");
    }

    nextDoubleStatus = "DOUBLED";
  }

  if (input.callType === "REDOUBLE") {
    if (!lastBid || !lastBidTeam || lastBidTeam !== myTeam || deal.doubleStatus !== "DOUBLED") {
      throw new Error("상대가 더블한 우리 팀 계약에만 리더블할 수 있습니다.");
    }

    nextDoubleStatus = "REDOUBLED";
  }

  await tx.bridgeCall.create({
    data: {
      roomId: input.roomId,
      dealId: deal.id,
      position: mySeat,
      type: input.callType,
      level: callLevel,
      suit: callSuit,
      sequence: nextSequence
    }
  });

  const updatedCalls = [
    ...calls,
    {
      position: mySeat,
      type: input.callType,
      level: callLevel,
      suit: callSuit,
      sequence: nextSequence
    }
  ];
  const updatedLastBid = [...updatedCalls].reverse().find((call) => call.type === "BID");
  const trailingPasses = [...updatedCalls].reverse().findIndex((call) => call.type !== "PASS");
  const passCount = trailingPasses === -1 ? updatedCalls.length : trailingPasses;
  const allPassedOut = !updatedLastBid && updatedCalls.length >= 4;
  const auctionComplete = Boolean(updatedLastBid && passCount >= 3);

  if (allPassedOut) {
    await tx.bridgeDeal.update({
      where: { id: deal.id },
      data: {
        biddingTurn: null,
        completedAt: new Date(),
        score: 0
      }
    });
  } else if (auctionComplete && updatedLastBid?.level && updatedLastBid.suit) {
    const contractTeam = bridgeTeam(updatedLastBid.position);
    const declarerCall = updatedCalls.find(
      (call) => call.type === "BID" && call.suit === updatedLastBid.suit && bridgeTeam(call.position) === contractTeam
    );
    const declarer = declarerCall?.position;

    if (!declarer) {
      throw new Error("선언자를 결정할 수 없습니다.");
    }

    const dummy = bridgePartner(declarer);
    const openingLeader = nextBridgeTurn(declarer);

    await tx.bridgeDeal.update({
      where: { id: deal.id },
      data: {
        biddingTurn: null,
        contractLevel: updatedLastBid.level,
        contractSuit: updatedLastBid.suit,
        doubleStatus: nextDoubleStatus,
        declarer,
        dummy,
        currentTurn: openingLeader,
        playStartedAt: new Date()
      }
    });

    await tx.bridgeEvent.create({
      data: {
        roomId: input.roomId,
        type: "CONTRACT_SET",
        actorId: input.userId,
        payload: {
          contractLevel: updatedLastBid.level,
          contractSuit: updatedLastBid.suit,
          doubleStatus: nextDoubleStatus,
          declarer,
          dummy,
          currentTurn: openingLeader
        }
      }
    });
  } else {
    await tx.bridgeDeal.update({
      where: { id: deal.id },
      data: {
        biddingTurn: nextBridgeTurn(mySeat),
        doubleStatus: nextDoubleStatus
      }
    });
  }

  await tx.bridgeEvent.create({
    data: {
      roomId: input.roomId,
      type: "CALL_MADE",
      actorId: input.userId,
      payload: {
        position: mySeat,
        type: input.callType,
        level: callLevel,
        suit: callSuit,
        sequence: nextSequence,
        nextTurn: allPassedOut || auctionComplete ? null : nextBridgeTurn(mySeat)
      }
    }
  });

  if (allPassedOut) {
    await tx.bridgeEvent.create({
      data: {
        roomId: input.roomId,
        type: "ROUND_COMPLETED",
        actorId: input.userId,
        payload: {
          passedOut: true,
          score: 0
        }
      }
    });
  }
}

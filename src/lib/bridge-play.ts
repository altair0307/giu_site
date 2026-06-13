import type { Prisma } from "@prisma/client";
import { createGeneralActivityLog } from "@/lib/activity-log";
import { pruneBridgeEvents } from "@/lib/bridge-events";
import {
  BRIDGE_SEAT_POSITIONS,
  bridgeTeam,
  bridgeVulnerabilityForTeam,
  calculateBridgeContractResult,
  type BridgeContractSuit,
  type BridgeSeatPosition
} from "@/lib/bridge-scoring";

const BRIDGE_SUITS = ["S", "H", "D", "C"] as const;
const BRIDGE_RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

type BridgeSuit = (typeof BRIDGE_SUITS)[number];
type BridgeRank = (typeof BRIDGE_RANKS)[number];

function nextBridgeTurn(position: BridgeSeatPosition) {
  return BRIDGE_SEAT_POSITIONS[(BRIDGE_SEAT_POSITIONS.indexOf(position) + 1) % BRIDGE_SEAT_POSITIONS.length];
}

export function parseBridgeCard(card: string) {
  const suit = card.slice(-1) as BridgeSuit;
  const rank = card.slice(0, -1) as BridgeRank;

  if (!BRIDGE_SUITS.includes(suit) || !BRIDGE_RANKS.includes(rank)) {
    throw new Error("올바르지 않은 카드입니다.");
  }

  return { rank, suit };
}

function contractSuitToCardSuit(contractSuit: BridgeContractSuit) {
  const suitMap = {
    CLUBS: "C",
    DIAMONDS: "D",
    HEARTS: "H",
    SPADES: "S",
    NOTRUMP: null
  } as const;

  return suitMap[contractSuit];
}

function readBridgeHands(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("손패 정보를 읽을 수 없습니다.");
  }

  return Object.fromEntries(
    BRIDGE_SEAT_POSITIONS.map((position) => {
      const cards = (value as Record<string, unknown>)[position];
      return [position, Array.isArray(cards) ? cards.filter((card): card is string => typeof card === "string") : []];
    })
  ) as Record<BridgeSeatPosition, string[]>;
}

function chooseBridgeTrickWinner(
  plays: { position: BridgeSeatPosition; card: string; createdAt: Date }[],
  contractSuit: BridgeContractSuit
) {
  const orderedPlays = [...plays].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const leadSuit = parseBridgeCard(orderedPlays[0].card).suit;
  const trumpSuit = contractSuitToCardSuit(contractSuit);

  return orderedPlays.reduce((winner, play) => {
    const winnerCard = parseBridgeCard(winner.card);
    const playCard = parseBridgeCard(play.card);
    const winnerIsTrump = trumpSuit !== null && winnerCard.suit === trumpSuit;
    const playIsTrump = trumpSuit !== null && playCard.suit === trumpSuit;

    if (playIsTrump && !winnerIsTrump) {
      return play;
    }

    if (playIsTrump === winnerIsTrump && playCard.suit === winnerCard.suit) {
      const playRank = BRIDGE_RANKS.indexOf(playCard.rank);
      const winnerRank = BRIDGE_RANKS.indexOf(winnerCard.rank);

      if (playRank < winnerRank) {
        return play;
      }
    }

    if (!winnerIsTrump && !playIsTrump && winnerCard.suit !== leadSuit && playCard.suit === leadSuit) {
      return play;
    }

    return winner;
  }, orderedPlays[0]).position;
}

export async function playBridgeCard(
  tx: Prisma.TransactionClient,
  input: {
    roomId: string;
    card: string;
    actor: { id: string; name: string; loginId: string; role?: string | null };
  }
) {
  parseBridgeCard(input.card);
  const room = await tx.bridgeRoom.findUnique({
    where: { id: input.roomId },
    include: {
      deals: {
        where: { completedAt: null },
        take: 1
      },
      seats: true
    }
  });
  const deal = room?.deals[0];

  if (!room || !deal) {
    throw new Error("딜이 생성된 방에서만 카드를 낼 수 있습니다.");
  }

  if (room.status !== "PLAYING") {
    throw new Error("진행 중인 방에서만 카드를 낼 수 있습니다.");
  }

  if (!deal.contractLevel || !deal.contractSuit || !deal.declarer || !deal.dummy || !deal.currentTurn) {
    throw new Error("컨트랙트가 정해진 뒤 카드를 낼 수 있습니다.");
  }

  const mySeat = room.seats.find((seat) => seat.userId === input.actor.id)?.position;

  if (!mySeat) {
    throw new Error("좌석에 앉은 사용자만 카드를 낼 수 있습니다.");
  }

  const currentTurn = deal.currentTurn;
  const playedPosition = currentTurn;

  if (currentTurn === deal.dummy) {
    if (mySeat !== deal.declarer) {
      throw new Error("더미 차례에는 선언자만 카드를 낼 수 있습니다.");
    }
  } else if (mySeat !== currentTurn) {
    throw new Error("현재 차례가 아닙니다.");
  }

  const hands = readBridgeHands(deal.hands);
  const hand = hands[playedPosition];

  if (!hand.includes(input.card)) {
    throw new Error("해당 좌석의 손패에 없는 카드입니다.");
  }

  let trick = await tx.bridgeTrick.findFirst({
    where: {
      dealId: deal.id,
      completedAt: null
    },
    include: {
      plays: { orderBy: { createdAt: "asc" } }
    },
    orderBy: { trickNumber: "desc" }
  });

  if (!trick) {
    const trickCount = await tx.bridgeTrick.count({ where: { dealId: deal.id } });

    if (trickCount >= 13) {
      throw new Error("이미 모든 트릭이 끝났습니다.");
    }

    trick = await tx.bridgeTrick.create({
      data: {
        roomId: input.roomId,
        dealId: deal.id,
        trickNumber: trickCount + 1,
        leader: currentTurn
      },
      include: {
        plays: { orderBy: { createdAt: "asc" } }
      }
    });
  }

  if (trick.plays.some((play) => play.position === playedPosition)) {
    throw new Error("이미 이 트릭에 카드를 냈습니다.");
  }

  if (trick.plays.length > 0) {
    const leadSuit = parseBridgeCard(trick.plays[0].card).suit;
    const cardSuit = parseBridgeCard(input.card).suit;
    const canFollowSuit = hand.some((handCard) => parseBridgeCard(handCard).suit === leadSuit);

    if (canFollowSuit && cardSuit !== leadSuit) {
      throw new Error("같은 무늬가 있으면 먼저 따라 내야 합니다.");
    }
  }

  await tx.bridgePlay.create({
    data: {
      roomId: input.roomId,
      dealId: deal.id,
      trickId: trick.id,
      position: playedPosition,
      card: input.card
    }
  });

  const updatedHands = {
    ...hands,
    [playedPosition]: hand.filter((handCard) => handCard !== input.card)
  };
  const plays = await tx.bridgePlay.findMany({
    where: { trickId: trick.id },
    orderBy: { createdAt: "asc" }
  });
  const trickCompleted = plays.length === 4;
  const winner = trickCompleted
    ? chooseBridgeTrickWinner(
        plays.map((play) => ({
          position: play.position,
          card: play.card,
          createdAt: play.createdAt
        })),
        deal.contractSuit
      )
    : null;
  const nextTurn = winner ?? nextBridgeTurn(playedPosition);
  const roundCompleted = trickCompleted && winner !== null && trick.trickNumber === 13;
  let roundResult:
    | {
        declarerTricks: number;
        defenderTricks: number;
        contractMade: boolean;
        overtricks: number;
        undertricks: number;
        score: number;
      }
    | null = null;

  if (roundCompleted && winner) {
    const previousCompletedTricks = await tx.bridgeTrick.findMany({
      where: {
        dealId: deal.id,
        completedAt: { not: null }
      },
      select: { winner: true }
    });
    const declarerTeam = bridgeTeam(deal.declarer);
    const completedWinners = [...previousCompletedTricks.map((completedTrick) => completedTrick.winner), winner];
    const declarerTricks = completedWinners.filter(
      (completedWinner): completedWinner is BridgeSeatPosition =>
        completedWinner !== null && bridgeTeam(completedWinner) === declarerTeam
    ).length;
    const defenderTricks = 13 - declarerTricks;
    const contractResult = calculateBridgeContractResult({
      contractLevel: deal.contractLevel,
      contractSuit: deal.contractSuit,
      declarerTricks,
      doubleStatus: deal.doubleStatus,
      vulnerable: bridgeVulnerabilityForTeam(declarerTeam, deal.vulnerability)
    });

    roundResult = {
      declarerTricks,
      defenderTricks,
      ...contractResult
    };
  }

  await tx.bridgeDeal.update({
    where: { id: deal.id },
    data: {
      hands: updatedHands,
      currentTurn: roundCompleted ? null : nextTurn,
      completedAt: roundCompleted ? new Date() : undefined,
      declarerTricks: roundResult?.declarerTricks,
      defenderTricks: roundResult?.defenderTricks,
      contractMade: roundResult?.contractMade,
      overtricks: roundResult?.overtricks,
      undertricks: roundResult?.undertricks,
      score: roundResult?.score
    }
  });

  if (trickCompleted && winner) {
    await tx.bridgeTrick.update({
      where: { id: trick.id },
      data: {
        winner,
        completedAt: new Date()
      }
    });
  }

  await tx.bridgeEvent.create({
    data: {
      roomId: input.roomId,
      type: "CARD_PLAYED",
      actorId: input.actor.id,
      payload: {
        trickNumber: trick.trickNumber,
        position: playedPosition,
        card: input.card,
        nextTurn
      }
    }
  });

  if (trickCompleted && winner) {
    await tx.bridgeEvent.create({
      data: {
        roomId: input.roomId,
        type: "TRICK_COMPLETED",
        actorId: input.actor.id,
        payload: {
          trickNumber: trick.trickNumber,
          winner,
          nextTurn
        }
      }
    });
  }

  if (roundCompleted && winner && roundResult) {
    await tx.bridgeEvent.create({
      data: {
        roomId: input.roomId,
        type: "ROUND_COMPLETED",
        actorId: input.actor.id,
        payload: {
          declarer: deal.declarer,
          declarerTeam: bridgeTeam(deal.declarer),
          doubleStatus: deal.doubleStatus,
          vulnerability: deal.vulnerability,
          declarerTricks: roundResult.declarerTricks,
          defenderTricks: roundResult.defenderTricks,
          contractMade: roundResult.contractMade,
          overtricks: roundResult.overtricks,
          undertricks: roundResult.undertricks,
          score: roundResult.score
        }
      }
    });

    await createGeneralActivityLog(tx, {
      category: "BRIDGE",
      action: "ROUND_COMPLETE",
      actor: input.actor,
      target: { type: "BRIDGE_ROOM", id: input.roomId },
      message: `${input.actor.name} 사용자가 브릿지 라운드를 완료했습니다.`,
      metadata: {
        declarer: deal.declarer,
        declarerTeam: bridgeTeam(deal.declarer),
        contractLevel: deal.contractLevel,
        contractSuit: deal.contractSuit,
        doubleStatus: deal.doubleStatus,
        vulnerability: deal.vulnerability,
        declarerTricks: roundResult.declarerTricks,
        defenderTricks: roundResult.defenderTricks,
        contractMade: roundResult.contractMade,
        overtricks: roundResult.overtricks,
        undertricks: roundResult.undertricks,
        score: roundResult.score
      }
    });
    await pruneBridgeEvents(tx, input.roomId);
  }
}

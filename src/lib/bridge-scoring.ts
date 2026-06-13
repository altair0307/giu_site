export const BRIDGE_SEAT_POSITIONS = ["NORTH", "EAST", "SOUTH", "WEST"] as const;
export const BRIDGE_CONTRACT_SUITS = ["CLUBS", "DIAMONDS", "HEARTS", "SPADES", "NOTRUMP"] as const;

export type BridgeSeatPosition = (typeof BRIDGE_SEAT_POSITIONS)[number];
export type BridgeContractSuit = (typeof BRIDGE_CONTRACT_SUITS)[number];
export type BridgeDoubleStatus = "UNDOUBLED" | "DOUBLED" | "REDOUBLED";
export type BridgeVulnerability = "NONE" | "NS" | "EW" | "BOTH";
export type BridgeTeam = "NS" | "EW";

const BRIDGE_VULNERABILITY_CYCLE: BridgeVulnerability[] = [
  "NONE",
  "NS",
  "EW",
  "BOTH",
  "NS",
  "EW",
  "BOTH",
  "NONE",
  "EW",
  "BOTH",
  "NONE",
  "NS",
  "BOTH",
  "NONE",
  "NS",
  "EW"
];

export function bridgeDealerForBoard(boardNumber: number) {
  return BRIDGE_SEAT_POSITIONS[(boardNumber - 1) % BRIDGE_SEAT_POSITIONS.length];
}

export function bridgeVulnerabilityForBoard(boardNumber: number): BridgeVulnerability {
  return BRIDGE_VULNERABILITY_CYCLE[(boardNumber - 1) % BRIDGE_VULNERABILITY_CYCLE.length];
}

export function bridgeTeam(position: BridgeSeatPosition): BridgeTeam {
  return position === "NORTH" || position === "SOUTH" ? "NS" : "EW";
}

export function bridgeVulnerabilityForTeam(team: BridgeTeam, vulnerability: BridgeVulnerability) {
  return vulnerability === "BOTH" || vulnerability === team;
}

export function calculateBridgeContractResult({
  contractLevel,
  contractSuit,
  declarerTricks,
  doubleStatus = "UNDOUBLED",
  vulnerable = false
}: {
  contractLevel: number;
  contractSuit: BridgeContractSuit;
  declarerTricks: number;
  doubleStatus?: BridgeDoubleStatus;
  vulnerable?: boolean;
}) {
  const targetTricks = contractLevel + 6;
  const contractMade = declarerTricks >= targetTricks;
  const overtricks = contractMade ? declarerTricks - targetTricks : 0;
  const undertricks = contractMade ? 0 : targetTricks - declarerTricks;

  if (!contractMade) {
    if (doubleStatus === "UNDOUBLED") {
      return {
        contractMade,
        overtricks,
        undertricks,
        score: undertricks * (vulnerable ? -100 : -50)
      };
    }

    const doubledPenalty = Array.from({ length: undertricks }, (_, index) => {
      if (vulnerable) {
        return index === 0 ? 200 : 300;
      }

      if (index === 0) {
        return 100;
      }

      return index < 3 ? 200 : 300;
    }).reduce((sum, penalty) => sum + penalty, 0);
    const multiplier = doubleStatus === "REDOUBLED" ? 2 : 1;

    return {
      contractMade,
      overtricks,
      undertricks,
      score: doubledPenalty * multiplier * -1
    };
  }

  const isMinor = contractSuit === "CLUBS" || contractSuit === "DIAMONDS";
  const isNotrump = contractSuit === "NOTRUMP";
  const baseTrickScore = isNotrump ? 40 + Math.max(0, contractLevel - 1) * 30 : contractLevel * (isMinor ? 20 : 30);
  const scoreMultiplier = doubleStatus === "REDOUBLED" ? 4 : doubleStatus === "DOUBLED" ? 2 : 1;
  const trickScore = baseTrickScore * scoreMultiplier;
  const overtrickValue =
    doubleStatus === "REDOUBLED"
      ? vulnerable
        ? 400
        : 200
      : doubleStatus === "DOUBLED"
        ? vulnerable
          ? 200
          : 100
        : isMinor
          ? 20
          : 30;
  const insultBonus = doubleStatus === "REDOUBLED" ? 100 : doubleStatus === "DOUBLED" ? 50 : 0;
  const gameBonus = trickScore >= 100 ? (vulnerable ? 500 : 300) : 50;
  const slamBonus = contractLevel === 6 ? (vulnerable ? 750 : 500) : contractLevel === 7 ? (vulnerable ? 1500 : 1000) : 0;

  return {
    contractMade,
    overtricks,
    undertricks,
    score: trickScore + overtricks * overtrickValue + insultBonus + gameBonus + slamBonus
  };
}

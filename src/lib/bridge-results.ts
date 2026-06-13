import type { BridgeSeatPosition } from "@prisma/client";

export function bridgeResultTeam(position: BridgeSeatPosition) {
  return position === "NORTH" || position === "SOUTH" ? "NS" : "EW";
}

export function calculateBridgeSessionScore(
  deals: { declarer: BridgeSeatPosition | null; score: number | null }[]
) {
  return deals.reduce(
    (total, deal) => {
      if (typeof deal.score !== "number" || !deal.declarer) {
        return total;
      }

      if (bridgeResultTeam(deal.declarer) === "NS") {
        return { ns: total.ns + deal.score, ew: total.ew - deal.score };
      }

      return { ns: total.ns - deal.score, ew: total.ew + deal.score };
    },
    { ns: 0, ew: 0 }
  );
}

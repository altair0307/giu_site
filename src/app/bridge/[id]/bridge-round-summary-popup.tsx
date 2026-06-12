"use client";

import { useEffect } from "react";

type BridgeRoundSummaryPopupProps = {
  dealId: string;
  declarerTeam: string;
  wonTricks: number;
  targetTricks: number;
  contractMade: boolean;
  overtricks: number;
  undertricks: number;
  score: number;
  doubleStatus: "UNDOUBLED" | "DOUBLED" | "REDOUBLED";
};

export function BridgeRoundSummaryPopup({
  dealId,
  declarerTeam,
  wonTricks,
  targetTricks,
  contractMade,
  overtricks,
  undertricks,
  score,
  doubleStatus
}: BridgeRoundSummaryPopupProps) {
  useEffect(() => {
    const storageKey = `bridge-round-summary:${dealId}`;

    if (window.localStorage.getItem(storageKey)) {
      return;
    }

    window.localStorage.setItem(storageKey, "shown");
    const doubleLabel = doubleStatus === "DOUBLED" ? "더블" : doubleStatus === "REDOUBLED" ? "리더블" : null;

    window.alert(
      [
        `선언자 점수: ${score > 0 ? `+${score}` : score}`,
        doubleLabel ? `계약 상태: ${doubleLabel}` : null,
        `${declarerTeam} 획득 트릭: ${wonTricks}`,
        `필요했던 트릭: ${targetTricks}`,
        contractMade ? `계약 성공 · 초과 트릭 ${overtricks}` : `계약 실패 · 부족 트릭 ${undertricks}`
      ]
        .filter(Boolean)
        .join("\n")
    );
  }, [contractMade, dealId, declarerTeam, doubleStatus, overtricks, score, targetTricks, undertricks, wonTricks]);

  return null;
}

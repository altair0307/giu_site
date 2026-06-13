import assert from "node:assert/strict";
import test from "node:test";
import {
  bridgeDealerForBoard,
  bridgeVulnerabilityForBoard,
  calculateBridgeContractResult
} from "./bridge-scoring";

test("boards 1-16 use the standard duplicate dealer and vulnerability cycle", () => {
  const expected = [
    ["NORTH", "NONE"],
    ["EAST", "NS"],
    ["SOUTH", "EW"],
    ["WEST", "BOTH"],
    ["NORTH", "NS"],
    ["EAST", "EW"],
    ["SOUTH", "BOTH"],
    ["WEST", "NONE"],
    ["NORTH", "EW"],
    ["EAST", "BOTH"],
    ["SOUTH", "NONE"],
    ["WEST", "NS"],
    ["NORTH", "BOTH"],
    ["EAST", "NONE"],
    ["SOUTH", "NS"],
    ["WEST", "EW"]
  ];

  assert.deepEqual(
    expected.map((_, index) => [bridgeDealerForBoard(index + 1), bridgeVulnerabilityForBoard(index + 1)]),
    expected
  );
});

test("vulnerability changes game and undertrick scores", () => {
  assert.equal(calculateBridgeContractResult({ contractLevel: 4, contractSuit: "HEARTS", declarerTricks: 10 }).score, 420);
  assert.equal(
    calculateBridgeContractResult({ contractLevel: 4, contractSuit: "HEARTS", declarerTricks: 10, vulnerable: true }).score,
    620
  );
  assert.equal(calculateBridgeContractResult({ contractLevel: 4, contractSuit: "HEARTS", declarerTricks: 9 }).score, -50);
  assert.equal(
    calculateBridgeContractResult({ contractLevel: 4, contractSuit: "HEARTS", declarerTricks: 9, vulnerable: true }).score,
    -100
  );
});

test("doubled vulnerable undertricks use the standard escalating penalties", () => {
  assert.equal(
    calculateBridgeContractResult({
      contractLevel: 4,
      contractSuit: "SPADES",
      declarerTricks: 7,
      doubleStatus: "DOUBLED",
      vulnerable: true
    }).score,
    -800
  );
});

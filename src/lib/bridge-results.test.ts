import assert from "node:assert/strict";
import test from "node:test";
import { calculateBridgeSessionScore } from "./bridge-results";

test("session scores assign declarer scores to the correct partnership", () => {
  assert.deepEqual(
    calculateBridgeSessionScore([
      { declarer: "NORTH", score: 420 },
      { declarer: "EAST", score: 110 },
      { declarer: "SOUTH", score: -50 },
      { declarer: "WEST", score: -100 }
    ]),
    { ns: 360, ew: -360 }
  );
});

test("passouts and incomplete results do not change the session score", () => {
  assert.deepEqual(
    calculateBridgeSessionScore([
      { declarer: null, score: 0 },
      { declarer: "NORTH", score: null }
    ]),
    { ns: 0, ew: 0 }
  );
});

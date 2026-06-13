import assert from "node:assert/strict";
import test from "node:test";
import {
  bridgeRoomExpiresAt,
  isBridgeRoomExpired,
  latestBridgeActivityAt
} from "./bridge-expiration";

test("lobby rooms expire after 30 minutes and playing rooms after 3 hours", () => {
  const activity = new Date("2026-06-12T00:00:00.000Z");

  assert.equal(bridgeRoomExpiresAt("LOBBY", activity).toISOString(), "2026-06-12T00:30:00.000Z");
  assert.equal(bridgeRoomExpiresAt("PLAYING", activity).toISOString(), "2026-06-12T03:00:00.000Z");
  assert.equal(isBridgeRoomExpired("LOBBY", activity, new Date("2026-06-12T00:29:59.999Z")), false);
  assert.equal(isBridgeRoomExpired("LOBBY", activity, new Date("2026-06-12T00:30:00.000Z")), true);
});

test("the latest room update or event becomes the activity timestamp", () => {
  const roomUpdatedAt = new Date("2026-06-12T00:10:00.000Z");
  const eventCreatedAt = new Date("2026-06-12T00:20:00.000Z");

  assert.equal(latestBridgeActivityAt(roomUpdatedAt, eventCreatedAt), eventCreatedAt);
  assert.equal(latestBridgeActivityAt(roomUpdatedAt, null), roomUpdatedAt);
});

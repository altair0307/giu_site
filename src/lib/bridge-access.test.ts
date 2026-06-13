import assert from "node:assert/strict";
import test from "node:test";
import { canViewBridgeRoom, isBridgeSpectator } from "./bridge-access";

test("participants and admins can always view a bridge room", () => {
  assert.equal(canViewBridgeRoom({ isParticipant: true, isAdmin: false, allowSpectators: false }), true);
  assert.equal(canViewBridgeRoom({ isParticipant: false, isAdmin: true, allowSpectators: false }), true);
});

test("nonparticipants can view only when spectators are allowed", () => {
  assert.equal(canViewBridgeRoom({ isParticipant: false, isAdmin: false, allowSpectators: false }), false);
  assert.equal(canViewBridgeRoom({ isParticipant: false, isAdmin: false, allowSpectators: true }), true);
  assert.equal(isBridgeSpectator({ isParticipant: false, isAdmin: false }), true);
});

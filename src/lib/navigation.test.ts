import assert from "node:assert/strict";
import test from "node:test";
import { safeAdminPath, safeInternalPath } from "@/lib/navigation";

test("safeInternalPath preserves local paths and rejects external redirects", () => {
  assert.equal(safeInternalPath("/bridge/room-1?tab=result#board-2"), "/bridge/room-1?tab=result#board-2");
  assert.equal(safeInternalPath("https://example.com"), "/");
  assert.equal(safeInternalPath("//example.com/path"), "/");
  assert.equal(safeInternalPath("/\\example.com/path"), "/");
  assert.equal(safeInternalPath("not-a-path", "/account"), "/account");
});

test("safeAdminPath accepts only the admin route boundary", () => {
  assert.equal(safeAdminPath("/admin/games?page=2#game-edit"), "/admin/games?page=2#game-edit");
  assert.equal(safeAdminPath("/administrator"), "/admin");
  assert.equal(safeAdminPath("/account"), "/admin");
});

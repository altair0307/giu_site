import assert from "node:assert/strict";
import test from "node:test";
import { getKoreaMonthRange, loanDueAt } from "@/lib/loan-policy";

test("loan due date follows the configured number of days", () => {
  const borrowedAt = new Date("2026-08-13T06:00:00.000Z");

  assert.equal(loanDueAt(borrowedAt, 30).toISOString(), "2026-09-12T06:00:00.000Z");
});

test("monthly loan limits reset at midnight on the first day in Korea", () => {
  const august = getKoreaMonthRange(new Date("2026-08-31T14:59:59.000Z"));
  const september = getKoreaMonthRange(new Date("2026-08-31T15:00:00.000Z"));

  assert.equal(august.start.toISOString(), "2026-07-31T15:00:00.000Z");
  assert.equal(august.end.toISOString(), "2026-08-31T15:00:00.000Z");
  assert.equal(september.start.toISOString(), "2026-08-31T15:00:00.000Z");
  assert.equal(september.end.toISOString(), "2026-09-30T15:00:00.000Z");
});

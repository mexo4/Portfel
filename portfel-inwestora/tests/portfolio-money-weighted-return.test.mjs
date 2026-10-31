import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateNetExternalCapital,
  calculateXirr,
} from "../src/lib/portfolio-money-weighted-return.ts";
import { calculateCagrFromTotalReturn } from "../src/lib/portfolio-risk-analytics.ts";

test("net external capital counts deposits and withdrawals, not internal portfolio events", () => {
  const value = calculateNetExternalCapital([
    { date: "2024-01-01", amount: 1_000 },
    { date: "2024-03-01", amount: 250 },
    { date: "2024-08-01", amount: -100 },
  ]);
  assert.deepEqual(value, { deposits: 1_250, withdrawals: 100, net: 1_150 });
});

test("net external capital preserves gross same-day deposit and withdrawal evidence", () => {
  const value = calculateNetExternalCapital([
    { date: "2024-01-01", amount: 1_000 },
    { date: "2024-01-01", amount: -400 },
  ]);
  assert.deepEqual(value, { deposits: 1_000, withdrawals: 400, net: 600 });
});

test("net external capital ignores an account archive projection adjustment", () => {
  const value = calculateNetExternalCapital([
    { date: "2024-01-01", amount: 1_000 },
    { date: "2024-06-01", amount: -300, kind: "ARCHIVE_ADJUSTMENT" },
  ]);
  assert.deepEqual(value, { deposits: 1_000, withdrawals: 0, net: 1_000 });
});

test("XIRR solves a dated cash-flow series with a stable zero NPV", () => {
  const externalCashFlows = [
    { date: "2024-01-01", amount: 1_000 },
    { date: "2024-07-01", amount: 300 },
  ];
  const result = calculateXirr({ externalCashFlows, terminalValue: 1_430, terminalDate: "2025-01-01" });
  assert.notEqual(result.value, null);
  assert.ok(result.value > 0);
  const start = Date.parse("2024-01-01T00:00:00.000Z");
  const npv = -1_000 - 300 / (1 + result.value) ** ((Date.parse("2024-07-01T00:00:00.000Z") - start) / 86_400_000 / 365.2425) + 1_430 / (1 + result.value) ** ((Date.parse("2025-01-01T00:00:00.000Z") - start) / 86_400_000 / 365.2425);
  assert.ok(Math.abs(npv) < 0.00001);
});

test("XIRR refuses ambiguous investor cash flows instead of selecting an arbitrary root", () => {
  const result = calculateXirr({
    externalCashFlows: [
      { date: "2024-01-01", amount: 1_000 },
      { date: "2024-06-01", amount: -1_500 },
      { date: "2024-10-01", amount: 700 },
    ],
    terminalValue: 500,
    terminalDate: "2025-01-01",
  });
  assert.equal(result.value, null);
  assert.equal(result.unavailableCode, "AMBIGUOUS_CASH_FLOWS");
});

test("CAGR is unavailable before a full year and uses actual date duration afterwards", () => {
  assert.equal(calculateCagrFromTotalReturn({ totalReturn: 0.1, startDate: "2025-01-01", endDate: "2025-12-31" }), null);
  const value = calculateCagrFromTotalReturn({ totalReturn: 0.1, startDate: "2024-01-01", endDate: "2025-01-01" });
  assert.notEqual(value, null);
  assert.ok(value > 0.099 && value < 0.101);
});

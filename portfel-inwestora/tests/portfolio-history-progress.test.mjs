import assert from "node:assert/strict";
import test from "node:test";
import { toPortfolioHistoryProgress } from "../src/lib/portfolio-history-progress.ts";
import {
  finishPortfolioHistoryProgress,
  failPortfolioHistoryProgress,
  getPortfolioHistoryProgress,
  registerPortfolioHistoryProgress,
  reportPortfolioHistoryProgress,
} from "../src/lib/server/portfolio-history-progress.ts";

test("history progress percentage is derived only from completed work and clamps invalid bounds", () => {
  assert.deepEqual(
    toPortfolioHistoryProgress({ completed: 2, total: 5, phase: "quotes" }),
    { completed: 2, total: 5, phase: "quotes", percentage: 40, done: false },
  );
  assert.equal(toPortfolioHistoryProgress({ completed: 8, total: 5, phase: "done" }).percentage, 100);
  assert.equal(toPortfolioHistoryProgress({ completed: -1, total: 0, phase: "init" }).percentage, 0);
  assert.equal(toPortfolioHistoryProgress({ completed: 0, total: 4, phase: "done" }, true).percentage, 100);
});

test("history progress handles are scoped to their authenticated user", () => {
  const id = `progress-test-${Date.now()}-owner`;
  const buildKey = `build-test-${Date.now()}`;
  assert.equal(registerPortfolioHistoryProgress(id, "user-a", buildKey), true);
  reportPortfolioHistoryProgress(buildKey, "user-a", {
    completed: 3,
    total: 8,
    phase: "Notowania gotowe",
  });

  assert.equal(getPortfolioHistoryProgress(id, "user-a")?.percentage, 37);
  assert.equal(getPortfolioHistoryProgress(id, "user-b"), undefined);
  finishPortfolioHistoryProgress(buildKey, "user-a");
  assert.equal(getPortfolioHistoryProgress(id, "user-a")?.done, true);
  assert.equal(getPortfolioHistoryProgress(id, "user-a")?.percentage, 100);
});

test("a failed history request preserves real progress instead of claiming completion", () => {
  const id = `progress-test-${Date.now()}-failed`;
  const buildKey = `build-test-${Date.now()}-failed`;
  registerPortfolioHistoryProgress(id, "user-a", buildKey);
  reportPortfolioHistoryProgress(buildKey, "user-a", {
    completed: 2,
    total: 5,
    phase: "Pobieranie notowań",
  });

  failPortfolioHistoryProgress(buildKey, "user-a");
  const progress = getPortfolioHistoryProgress(id, "user-a");
  assert.equal(progress?.done, true);
  assert.equal(progress?.percentage, 40);
  assert.equal(progress?.phase, "Nie udało się pobrać historii");
});

test("history progress ignores malformed handles and rejects cross-user build updates", () => {
  const id = `progress-test-${Date.now()}-reject`;
  const buildKey = `build-test-${Date.now()}-reject`;
  assert.equal(registerPortfolioHistoryProgress("short", "user-a", buildKey), false);
  assert.equal(registerPortfolioHistoryProgress(id, "user-a", buildKey), true);
  reportPortfolioHistoryProgress(buildKey, "user-b", {
    completed: 1,
    total: 1,
    phase: "unauthorized",
  });
  assert.equal(getPortfolioHistoryProgress(id, "user-a")?.completed, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPortfolioHistoryResponseCache,
  getCachedPortfolioHistoryResponse,
  setCachedPortfolioHistoryResponse,
} from "../src/lib/server/portfolio-history-response-cache.ts";
import {
  EMPTY_HISTORY_CACHE_TTL_MS,
  isReusableHistoryCacheEntry,
} from "../src/lib/server/portfolio-history-cache-policy.ts";

const history = (total) => ({
  points: [{ date: "2026-10-12", portfolioValuePln: total }],
  warnings: [],
  assetSeries: [],
  benchmarkSeries: [],
});

test("empty provider histories are cached briefly to avoid repeating slow unsupported-symbol lookups", () => {
  const now = Date.parse("2026-10-12T10:00:00.000Z");
  assert.equal(isReusableHistoryCacheEntry([], new Date(now - 30_000).toISOString(), now), true);
  assert.equal(
    isReusableHistoryCacheEntry([], new Date(now - EMPTY_HISTORY_CACHE_TTL_MS - 1).toISOString(), now),
    false,
  );
  assert.equal(isReusableHistoryCacheEntry([{ date: "2026-10-10", close: 10 }], "invalid", now), true);
  assert.equal(isReusableHistoryCacheEntry([], "invalid", now), false);
});

test("calculated history response cache reuses fresh output and expires it", () => {
  clearPortfolioHistoryResponseCache();
  const cached = history(1_234);
  setCachedPortfolioHistoryResponse("user-a:revision-4:scope-1:PLN", cached, 1_000);

  assert.equal(getCachedPortfolioHistoryResponse("user-a:revision-4:scope-1:PLN", 2_000), cached);
  assert.equal(getCachedPortfolioHistoryResponse("user-a:revision-4:scope-1:PLN", 181_001), undefined);
});

test("history responses remain isolated by user, revision, scope, and presentation currency key", () => {
  clearPortfolioHistoryResponseCache();
  setCachedPortfolioHistoryResponse("user-a:rev-1:p1:PLN", history(100), 1_000);
  assert.equal(getCachedPortfolioHistoryResponse("user-b:rev-1:p1:PLN", 2_000), undefined);
  assert.equal(getCachedPortfolioHistoryResponse("user-a:rev-2:p1:PLN", 2_000), undefined);
  assert.equal(getCachedPortfolioHistoryResponse("user-a:rev-1:p2:PLN", 2_000), undefined);
  assert.equal(getCachedPortfolioHistoryResponse("user-a:rev-1:p1:USD", 2_000), undefined);
});

test("history response cache keeps memory bounded and skips a single oversized history", () => {
  clearPortfolioHistoryResponseCache();
  for (let index = 0; index < 25; index += 1) {
    setCachedPortfolioHistoryResponse(`entry-${index}`, history(index), 1_000);
  }
  assert.equal(getCachedPortfolioHistoryResponse("entry-0", 2_000), undefined);
  assert.equal(getCachedPortfolioHistoryResponse("entry-24", 2_000)?.points[0]?.portfolioValuePln, 24);

  const oversized = history("x".repeat(2_100_000));
  setCachedPortfolioHistoryResponse("oversized", oversized, 1_000);
  assert.equal(getCachedPortfolioHistoryResponse("oversized", 2_000), undefined);
});

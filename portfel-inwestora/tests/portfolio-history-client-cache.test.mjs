import assert from "node:assert/strict";
import test from "node:test";
import {
  createPortfolioHistoryRequestCache,
  createPortfolioHistoryRequestDescriptor,
  hasPortfolioHistoryInputs,
} from "../src/lib/portfolio-history-client-cache.ts";

const asset = (patch = {}) => ({
  id: "asset-1",
  name: "Example",
  symbol: "EXAMPLE",
  kind: "stock",
  quantity: 1,
  purchasePrice: 10,
  purchaseCurrency: "PLN",
  marketCurrency: "PLN",
  latestPrice: 12,
  latestPriceDate: "2026-10-30",
  latestPriceMarketTimestamp: "2026-10-30T15:00:00.000Z",
  latestPriceFetchedAt: "2026-10-30T15:01:00.000Z",
  previousClose: 11,
  lastUpdatedAt: "2026-10-30T15:02:00.000Z",
  ...patch,
});

const payload = (patch = {}) => ({
  assets: [asset()],
  sales: [],
  realizedAdjustments: [],
  operations: [],
  accounts: [],
  benchmarks: [],
  presentationCurrency: "PLN",
  ...patch,
});

const createSessionStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test("history request identity ignores changing live quotes but includes user, scope, currency, and revision", () => {
  const first = createPortfolioHistoryRequestDescriptor({
    userId: "user-a",
    refreshRevision: 2,
    payload: payload(),
  });
  const quoteRefreshed = createPortfolioHistoryRequestDescriptor({
    userId: "user-a",
    refreshRevision: 2,
    payload: payload({ assets: [asset({ latestPrice: 13, latestPriceDate: "2026-10-31" })] }),
  });

  assert.equal(first.key, quoteRefreshed.key);
  assert.equal(first.payload.assets[0].latestPrice, undefined);
  assert.equal(first.payload.assets[0].previousClose, undefined);
  assert.notEqual(first.key, createPortfolioHistoryRequestDescriptor({ userId: "user-b", refreshRevision: 2, payload: payload() }).key);
  assert.notEqual(first.key, createPortfolioHistoryRequestDescriptor({ userId: "user-a", refreshRevision: 3, payload: payload() }).key);
  assert.notEqual(first.key, createPortfolioHistoryRequestDescriptor({ userId: "user-a", refreshRevision: 2, payload: payload({ presentationCurrency: "USD" }) }).key);
});

test("aggregate history identity keeps real portfolio boundaries and excludes flat assets from the request", () => {
  const descriptor = createPortfolioHistoryRequestDescriptor({
    userId: "user-a",
    refreshRevision: 0,
    payload: payload({
      portfolioScopes: [{
        portfolioId: "portfolio-1",
        assets: [asset()],
        sales: [],
        realizedAdjustments: [],
        operations: [],
        accounts: [],
      }],
    }),
  });

  assert.deepEqual(descriptor.payload.assets, []);
  assert.equal(descriptor.payload.portfolioScopes[0].portfolioId, "portfolio-1");
  assert.equal(hasPortfolioHistoryInputs(descriptor.payload), true);
});

test("request cache shares in-flight work and reuses the completed response until TTL expiry", async () => {
  let now = 100;
  let loads = 0;
  const cache = createPortfolioHistoryRequestCache({ ttlMs: 50, now: () => now });
  const load = async () => {
    loads += 1;
    await Promise.resolve();
    return { points: [1] };
  };

  const prefetched = cache.getOrLoad("same-request", load);
  const chartRequest = cache.getOrLoad("same-request", load);
  assert.equal(prefetched, chartRequest);
  assert.deepEqual(await chartRequest, { points: [1] });
  assert.equal(loads, 1);
  assert.deepEqual(await cache.getOrLoad("same-request", load), { points: [1] });
  assert.equal(loads, 1);

  now += 51;
  await cache.getOrLoad("same-request", load);
  assert.equal(loads, 2);
});

test("failed prefetches are not cached and may be retried by the chart", async () => {
  const cache = createPortfolioHistoryRequestCache();
  let loads = 0;
  await assert.rejects(cache.getOrLoad("retry", async () => {
    loads += 1;
    throw new Error("temporary failure");
  }), /temporary failure/);

  assert.deepEqual(await cache.getOrLoad("retry", async () => {
    loads += 1;
    return { points: [] };
  }), { points: [] });
  assert.equal(loads, 2);
});

test("request cache stays bounded under changing portfolio scopes", async () => {
  const cache = createPortfolioHistoryRequestCache({ maxEntries: 2 });
  await cache.getOrLoad("one", async () => 1);
  await cache.getOrLoad("two", async () => 2);
  await cache.getOrLoad("three", async () => 3);
  assert.equal(cache.size, 2);
  assert.equal(await cache.getOrLoad("one", async () => 4), 4);
});

test("session cache survives a full page reload and serves the exact user request without another API call", async () => {
  let now = 100;
  let apiCalls = 0;
  const storage = createSessionStorage();
  const response = { points: [{ date: "2026-10-31", value: 4_179.68 }] };
  const beforeReload = createPortfolioHistoryRequestCache({
    ttlMs: 30 * 60 * 1_000,
    now: () => now,
    storage,
  });

  assert.deepEqual(await beforeReload.getOrLoad("user-a:portfolio-all:PLN:revision-1", async () => {
    apiCalls += 1;
    return response;
  }), response);
  assert.equal(apiCalls, 1);

  const afterReload = createPortfolioHistoryRequestCache({
    ttlMs: 30 * 60 * 1_000,
    now: () => now,
    storage,
  });
  assert.deepEqual(await afterReload.getOrLoad("user-a:portfolio-all:PLN:revision-1", async () => {
    apiCalls += 1;
    return { points: [] };
  }), response);
  assert.equal(apiCalls, 1);

  const otherUserCache = createPortfolioHistoryRequestCache({ now: () => now, storage });
  await otherUserCache.getOrLoad("user-b:portfolio-all:PLN:revision-1", async () => {
    apiCalls += 1;
    return { points: ["other user"] };
  });
  assert.equal(apiCalls, 2);

  now += 30 * 60 * 1_000 + 1;
  const expiredCache = createPortfolioHistoryRequestCache({ now: () => now, storage });
  await expiredCache.getOrLoad("user-b:portfolio-all:PLN:revision-1", async () => {
    apiCalls += 1;
    return { points: ["fresh"] };
  });
  assert.equal(apiCalls, 3);
});

test("session storage failures never prevent a successful history request", async () => {
  const storage = {
    getItem() { throw new Error("storage disabled"); },
    setItem() { throw new Error("storage full"); },
    removeItem() { throw new Error("storage disabled"); },
  };
  const cache = createPortfolioHistoryRequestCache({ storage });

  assert.deepEqual(await cache.getOrLoad("history", async () => ({ points: [1] })), { points: [1] });
});

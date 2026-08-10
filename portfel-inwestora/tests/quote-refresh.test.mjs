import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRefreshedPortfolioAssetSnapshot,
  mergeQuoteIntoPortfolioAsset,
  refreshPortfolioQuotesWithProgress,
} from "../src/lib/api.ts";
import { getGpwScopedProviderCandidates } from "../src/lib/server/market-data.ts";

const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("reports real quote progress and leaves an asset without a quote unchanged", async () => {
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url), "http://localhost");
    const symbol = requestUrl.searchParams.get("symbol");

    if (symbol === "MISSING") {
      return new Response(JSON.stringify({ error: "Brak kursu" }), { status: 404 });
    }

    if (symbol === "INVALID") {
      return new Response(
        JSON.stringify({
          quote: {
            symbol: "INVALID",
            price: 0,
            marketCurrency: "USD",
            provider: "yahoo",
            fetchedAt: "2026-08-09T12:00:00.000Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        quote: {
          symbol: "MDV.WA",
          name: "Modivo",
          price: 101.25,
          marketCurrency: "PLN",
          provider: "stooq",
          fetchedAt: "2026-08-09T12:00:00.000Z",
          priceDate: "2026-08-07",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const progress = [];
  const result = await refreshPortfolioQuotesWithProgress(
    [
      {
        id: "asset-1",
        kind: "stock",
        symbol: "MDV.WA",
        name: "Modivo",
        marketCurrency: "PLN",
        provider: "stooq",
      },
      {
        id: "asset-2",
        kind: "stock",
        symbol: "MISSING",
        name: "Brak kursu",
        marketCurrency: "PLN",
        provider: "stooq",
      },
      {
        id: "asset-3",
        kind: "stock",
        symbol: "INVALID",
        name: "Ostatni dobry kurs",
        marketCurrency: "USD",
        provider: "yahoo",
        latestPrice: 91.25,
        latestPriceFetchedAt: "2026-08-09T11:00:00.000Z",
        lastUpdatedAt: "2026-08-09T11:00:00.000Z",
      },
    ],
    (event) => progress.push(event)
  );

  assert.deepEqual(progress[0], { completed: 0, total: 3 });
  assert.deepEqual(progress.at(-1), { completed: 3, total: 3 });
  assert.equal(result.total, 3);
  assert.equal(result.missing, 2);
  assert.equal(result.assets[0].latestPrice, 101.25);
  assert.equal(result.assets[0].latestPriceDate, "2026-08-07");
  assert.equal(result.assets[0].latestPriceFetchedAt, "2026-08-09T12:00:00.000Z");
  assert.equal(result.assets[1].latestPrice, undefined);
  assert.equal(result.assets[2].latestPrice, 91.25);
});

test("keeps the last known good price through malformed refreshes and stale responses", () => {
  const current = {
    id: "lpp",
    kind: "stock",
    symbol: "LPP.PL",
    name: "LPP",
    marketCurrency: "PLN",
    provider: "stooq",
    quantity: 0.03,
    latestPrice: 22200,
    latestPriceDate: "2026-08-07",
    latestPriceFetchedAt: "2026-08-10T12:10:00.000Z",
    lastUpdatedAt: "2026-08-10T12:10:00.000Z",
  };

  assert.deepEqual(
    mergeQuoteIntoPortfolioAsset(current, {
      symbol: "LPP.PL",
      price: 0,
      marketCurrency: "PLN",
      provider: "stooq",
      fetchedAt: "2026-08-10T12:11:00.000Z",
    }),
    current
  );

  const stale = applyRefreshedPortfolioAssetSnapshot(current, {
    ...current,
    latestPrice: 21000,
    latestPriceFetchedAt: "2026-08-10T12:09:00.000Z",
  });
  assert.deepEqual(stale, current);

  const newer = applyRefreshedPortfolioAssetSnapshot(current, {
    ...current,
    latestPrice: 22300,
    latestPriceDate: "2026-08-08",
    latestPriceMarketTimestamp: "2026-08-08T17:00:00",
    latestPriceFetchedAt: "2026-08-10T12:12:00.000Z",
    lastUpdatedAt: "2026-08-10T12:12:00.000Z",
  });
  assert.equal(newer.latestPrice, 22300);
  assert.equal(newer.latestPriceDate, "2026-08-08");
  assert.equal(newer.latestPriceMarketTimestamp, "2026-08-08T17:00:00");
});

test("keeps a GPW identity intact and rejects a global USD ticker collision", () => {
  const dia = {
    id: "dia",
    kind: "stock",
    symbol: "DIA.PL",
    name: "Diagnostyka",
    marketCurrency: "PLN",
    provider: "stooq",
    providerId: undefined,
  };

  const collided = mergeQuoteIntoPortfolioAsset(dia, {
    symbol: "DIA.PL",
    name: "State Street SPDR Dow Jones Industrial Average ETF Trust",
    price: 538.99,
    marketCurrency: "USD",
    provider: "yahoo",
    providerId: "DIA",
    fetchedAt: "2026-08-10T12:00:00.000Z",
  });

  assert.deepEqual(collided, dia);

  const gpwQuote = mergeQuoteIntoPortfolioAsset(dia, {
    symbol: "DIA.PL",
    name: "Diagnostyka S.A.",
    price: 41.53,
    marketCurrency: "PLN",
    provider: "yahoo",
    providerId: "DIA.WA",
    fetchedAt: "2026-08-10T12:00:00.000Z",
    priceDate: "2026-08-07",
  });

  assert.deepEqual(
    {
      symbol: gpwQuote.symbol,
      name: gpwQuote.name,
      marketCurrency: gpwQuote.marketCurrency,
      provider: gpwQuote.provider,
      providerId: gpwQuote.providerId,
      latestPrice: gpwQuote.latestPrice,
      latestPriceDate: gpwQuote.latestPriceDate,
    },
    {
      symbol: "DIA.PL",
      name: "Diagnostyka",
      marketCurrency: "PLN",
      provider: "stooq",
      providerId: undefined,
      latestPrice: 41.53,
      latestPriceDate: "2026-08-07",
    }
  );
});

test("GPW fallback candidates never contain a bare globally-colliding ticker", () => {
  assert.deepEqual(
    getGpwScopedProviderCandidates(["DIA", "DIA.PL", "DIA.WA", "DNP"]),
    ["DIA.WA", "DIA.PL"]
  );
  assert.deepEqual(
    getGpwScopedProviderCandidates(["DNP", "DNP.PL", "DNP.WA"]),
    ["DNP.WA", "DNP.PL"]
  );
});

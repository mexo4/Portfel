import assert from "node:assert/strict";
import test from "node:test";
import {
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
    ],
    (event) => progress.push(event)
  );

  assert.deepEqual(progress[0], { completed: 0, total: 2 });
  assert.deepEqual(progress.at(-1), { completed: 2, total: 2 });
  assert.equal(result.total, 2);
  assert.equal(result.missing, 1);
  assert.equal(result.assets[0].latestPrice, 101.25);
  assert.equal(result.assets[0].latestPriceDate, "2026-08-07");
  assert.equal(result.assets[1].latestPrice, undefined);
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

import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRefreshedPortfolioAssetSnapshot,
  fetchFxRates,
  hasSameStoredQuoteSnapshot,
  mergeQuoteIntoPortfolioAsset,
  refreshPortfolioQuotesWithProgress,
} from "../src/lib/api.ts";
import {
  fetchAssetQuoteServer,
  getGpwScopedProviderCandidates,
  isFreshCryptoQuote,
} from "../src/lib/server/market-data.ts";

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

  const olderMarketQuoteArrivingLater = applyRefreshedPortfolioAssetSnapshot(newer, {
    ...newer,
    latestPrice: 22000,
    latestPriceMarketTimestamp: "2026-08-08T16:59:00",
    latestPriceFetchedAt: "2026-08-10T12:20:00.000Z",
    lastUpdatedAt: "2026-08-10T12:20:00.000Z",
  });
  assert.deepEqual(olderMarketQuoteArrivingLater, newer);
});

test("does not replace an unchanged quote only because it was fetched again", () => {
  const current = {
    id: "btc",
    kind: "crypto",
    symbol: "BTC",
    name: "Bitcoin",
    marketCurrency: "USD",
    provider: "binance",
    providerId: "bitcoin",
    latestPrice: 63897.6,
    latestPriceDate: "2026-08-12",
    latestPriceFetchedAt: "2026-08-12T12:00:00.000Z",
    lastUpdatedAt: "2026-08-12T12:00:00.000Z",
  };

  const repeated = applyRefreshedPortfolioAssetSnapshot(current, {
    ...current,
    latestPriceFetchedAt: "2026-08-12T12:00:15.000Z",
    lastUpdatedAt: "2026-08-12T12:00:15.000Z",
  });

  assert.equal(repeated, current);
  assert.equal(hasSameStoredQuoteSnapshot(current, repeated), true);

  const newerMarketQuote = applyRefreshedPortfolioAssetSnapshot(current, {
    ...current,
    latestPriceMarketTimestamp: "2026-08-12T12:00:14.000Z",
    latestPriceFetchedAt: "2026-08-12T12:00:15.000Z",
    lastUpdatedAt: "2026-08-12T12:00:15.000Z",
  });

  assert.notEqual(newerMarketQuote, current);
  assert.equal(newerMarketQuote.latestPriceMarketTimestamp, "2026-08-12T12:00:14.000Z");
});

test("uses Binance latest price with its quote timestamp for crypto, never previous close", async () => {
  let binanceCalls = 0;
  const quoteTimestamp = Date.now() - 1_000;

  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    assert.equal(requestUrl.hostname, "api.binance.com");
    assert.equal(requestUrl.pathname, "/api/v3/ticker/24hr");
    assert.equal(requestUrl.searchParams.get("symbol"), "BTCUSDT");
    binanceCalls += 1;

    return new Response(
      JSON.stringify({
        lastPrice: "63123.4500",
        prevClosePrice: "64123.4500",
        closeTime: quoteTimestamp,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const input = {
    symbol: "BTC",
    kind: "crypto",
    marketCurrency: "USD",
    provider: "coingecko",
    providerId: "bitcoin",
  };
  const first = await fetchAssetQuoteServer(input);
  const second = await fetchAssetQuoteServer(input);

  assert.equal(first?.provider, "binance");
  assert.equal(first?.price, 63123.45);
  assert.notEqual(first?.price, 64123.45);
  assert.equal(first?.marketCurrency, "USD");
  assert.equal(first?.marketTimestamp, new Date(quoteTimestamp).toISOString());
  assert.equal(first?.priceDate, new Date(quoteTimestamp).toISOString().slice(0, 10));
  assert.equal(isFreshCryptoQuote(first), true);
  assert.equal(second?.price, first?.price);
  assert.equal(binanceCalls, 1);

  assert.equal(
    isFreshCryptoQuote({
      ...first,
      marketTimestamp: new Date(Date.now() - 20_001).toISOString(),
    }),
    false
  );
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

test("deduplicates identical FX requests in flight", async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url), "http://localhost");
    assert.equal(requestUrl.pathname, "/api/fx");
    assert.equal(requestUrl.searchParams.get("codes"), "USD,EUR");
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(
      JSON.stringify({ rates: { PLN: 1, USD: 4, EUR: 4.3 }, fetchedAt: "2026-08-11T12:00:00.000Z" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const [first, second] = await Promise.all([
    fetchFxRates(["USD", "EUR"]),
    fetchFxRates(["USD", "EUR"]),
  ]);

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
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

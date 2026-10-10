import assert from "node:assert/strict";
import test from "node:test";
import { mergePortfolioBookQuoteSnapshots } from "../src/lib/server/portfolio-quote-snapshots.ts";

const makeBook = (asset) => ({
  schemaVersion: 2,
  activePortfolioId: "portfolio-1",
  portfolios: [
    {
      id: "portfolio-1",
      name: "Test",
      baseCurrency: "PLN",
      assets: [asset],
      sales: [],
      realizedAdjustments: [],
      accounts: [],
      instruments: [],
      operations: [],
      subPortfolios: [],
      tags: [],
      tagAssignments: [],
      benchmarks: [],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ],
});

test("merges a newer persisted quote without replacing portfolio identity", () => {
  const asset = {
    id: "asset-1",
    symbol: "DIA.PL",
    name: "Diagnostyka",
    kind: "stock",
    marketCurrency: "PLN",
    provider: "stooq",
    latestPrice: 41.2,
    latestPriceFetchedAt: "2026-08-10T10:00:00.000Z",
  };
  const snapshots = new Map([
    [
      "portfolio-1:asset-1",
      {
        portfolioId: "portfolio-1",
        assetId: "asset-1",
        latestPrice: 42.15,
        latestPriceDate: "2026-08-10",
        latestPriceMarketTimestamp: "2026-08-10T15:30:00.000Z",
        latestPriceFetchedAt: "2026-08-10T15:31:00.000Z",
        marketCurrency: "PLN",
        provider: "stooq",
      },
    ],
  ]);

  const merged = mergePortfolioBookQuoteSnapshots(makeBook(asset), snapshots);
  const next = merged.portfolios[0].assets[0];

  assert.equal(next.latestPrice, 42.15);
  assert.equal(next.symbol, "DIA.PL");
  assert.equal(next.name, "Diagnostyka");
  assert.equal(next.marketCurrency, "PLN");
  assert.equal(next.provider, "stooq");
});

test("does not let an older snapshot overwrite last-known-good quote", () => {
  const asset = {
    id: "asset-1",
    symbol: "BTC",
    name: "Bitcoin",
    kind: "crypto",
    marketCurrency: "USD",
    provider: "binance",
    latestPrice: 64000,
    latestPriceMarketTimestamp: "2026-08-10T15:32:00.000Z",
    latestPriceFetchedAt: "2026-08-10T15:33:00.000Z",
  };
  const snapshots = new Map([
    [
      "portfolio-1:asset-1",
      {
        portfolioId: "portfolio-1",
        assetId: "asset-1",
        latestPrice: 63800,
        latestPriceMarketTimestamp: "2026-08-10T15:31:00.000Z",
        latestPriceFetchedAt: "2026-08-10T15:40:00.000Z",
      },
    ],
  ]);

  const merged = mergePortfolioBookQuoteSnapshots(makeBook(asset), snapshots);
  assert.equal(merged.portfolios[0].assets[0].latestPrice, 64000);
});

test("applies a manual quote even if its timestamp is older and clears market-only fields", () => {
  const asset = {
    id: "legacy-asset",
    symbol: "OLD.MARKET",
    name: "Delisted holding",
    kind: "stock",
    instrumentType: "OTHER",
    marketCurrency: "GBP",
    provider: "manual-entry",
    latestPrice: 70,
    latestPriceFetchedAt: "2026-10-10T12:00:00.000Z",
    latestPriceMarketTimestamp: "2026-10-10T11:00:00.000Z",
    previousClose: 69,
  };
  const snapshots = new Map([
    ["portfolio-1:legacy-asset", {
      portfolioId: "portfolio-1",
      assetId: "legacy-asset",
      latestPrice: 75,
      latestPriceDate: "2026-10-09",
      latestPriceFetchedAt: "2026-10-09T10:00:00.000Z",
      marketCurrency: "USD",
      priceSource: "MANUAL",
    }],
  ]);

  const merged = mergePortfolioBookQuoteSnapshots(makeBook(asset), snapshots);
  const next = merged.portfolios[0].assets[0];
  assert.equal(next.latestPrice, 75);
  assert.equal(next.marketCurrency, "USD");
  assert.equal(next.priceSource, "MANUAL");
  assert.equal(next.previousClose, undefined);
  assert.equal(next.latestPriceMarketTimestamp, undefined);
});

test("does not let a newer automatic quote silently replace a manual override", () => {
  const asset = {
    id: "btc-lot",
    symbol: "BTC",
    name: "Bitcoin",
    kind: "crypto",
    instrumentType: "OTHER",
    marketCurrency: "USD",
    priceSource: "MANUAL",
    latestPrice: 60000,
    latestPriceFetchedAt: "2026-10-10T10:00:00.000Z",
  };
  const snapshots = new Map([
    ["portfolio-1:btc-lot", {
      portfolioId: "portfolio-1",
      assetId: "btc-lot",
      latestPrice: 65000,
      latestPriceMarketTimestamp: "2026-10-10T12:00:00.000Z",
      latestPriceFetchedAt: "2026-10-10T12:01:00.000Z",
      priceSource: "AUTOMATIC",
    }],
  ]);

  const merged = mergePortfolioBookQuoteSnapshots(makeBook(asset), snapshots);
  assert.equal(merged.portfolios[0].assets[0].latestPrice, 60000);
  assert.equal(merged.portfolios[0].assets[0].priceSource, "MANUAL");
});

test("manual quote snapshots remain isolated to the selected portfolio", () => {
  const first = makeBook({
    id: "shared-asset-id",
    symbol: "BTC",
    name: "Bitcoin",
    kind: "crypto",
    instrumentType: "OTHER",
    marketCurrency: "USD",
  });
  const secondPortfolio = {
    ...first.portfolios[0],
    id: "portfolio-2",
    assets: [{ ...first.portfolios[0].assets[0], latestPrice: 64000 }],
  };
  const snapshots = new Map([
    ["portfolio-1:shared-asset-id", {
      portfolioId: "portfolio-1",
      assetId: "shared-asset-id",
      latestPrice: 60000,
      marketCurrency: "USD",
      priceSource: "MANUAL",
    }],
  ]);

  const merged = mergePortfolioBookQuoteSnapshots({ ...first, portfolios: [first.portfolios[0], secondPortfolio] }, snapshots);
  assert.equal(merged.portfolios[0].assets[0].latestPrice, 60000);
  assert.equal(merged.portfolios[0].assets[0].priceSource, "MANUAL");
  assert.equal(merged.portfolios[1].assets[0].latestPrice, 64000);
  assert.equal(merged.portfolios[1].assets[0].priceSource, undefined);
});

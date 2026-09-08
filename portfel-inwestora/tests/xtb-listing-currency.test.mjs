import assert from "node:assert/strict";
import test from "node:test";
import { inferXtbListingCurrency } from "../src/lib/import-operations.ts";
import { repairMisclassifiedXtbListingCurrencies } from "../src/lib/operation-engine.ts";
import { getTickerLookupCandidates } from "../src/lib/ticker-normalizer.ts";

const NOW = "2026-09-08T10:00:00.000Z";

test("XTB statement amount identifies a USD London listing without assuming GBP from .UK", () => {
  assert.equal(
    inferXtbListingCurrency({
      symbol: "VWRD.UK",
      accountCurrency: "USD",
      cashAmount: 187.76,
      marketAmount: 187.76,
    }),
    "USD"
  );
  assert.equal(
    inferXtbListingCurrency({
      symbol: "VHYD.UK",
      accountCurrency: "USD",
      cashAmount: 47.17,
      marketAmount: 47.165,
    }),
    "USD"
  );
});

test("a real cross-currency XTB trade still uses the listing currency fallback", () => {
  assert.equal(
    inferXtbListingCurrency({
      symbol: "VWRL.UK",
      accountCurrency: "USD",
      cashAmount: 240,
      marketAmount: 187.76,
    }),
    "GBP"
  );
});

test("London broker symbols prefer exact provider venue variants before a bare ticker", () => {
  const candidates = getTickerLookupCandidates({
    symbol: "VWRD.UK",
    kind: "etf",
    marketCurrency: "USD",
  }).map((candidate) => candidate.value);

  assert.deepEqual(candidates.slice(0, 4), ["VWRD.L", "VWRD.LSE", "VWRD.UK", "VWRD"]);
});

test("legacy false 1:1 XTB FX is repaired once without touching the trade identity", () => {
  const instrumentId = "portfolio-1:instrument:stock:VWRD.UK";
  const portfolio = {
    id: "portfolio-1",
    name: "XTB USD",
    baseCurrency: "USD",
    assets: [
      {
        id: "lot-vwrd",
        name: "Vanguard FTSE All-World UCITS ETF",
        symbol: "VWRD.UK",
        kind: "stock",
        purchaseDate: "2026-08-10",
        quantity: 1,
        purchasePrice: 187.76,
        purchaseCurrency: "USD",
        purchasePriceCurrency: "GBP",
        purchaseFxRateToPln: 5.0201,
        purchaseSettlementFxRateToPln: 3.7085,
        feePln: 0,
        marketCurrency: "GBP",
        provider: "catalog",
        latestPrice: 188,
        latestPriceDate: "2026-09-05",
        createdAt: NOW,
      },
    ],
    sales: [],
    realizedAdjustments: [],
    accounts: [],
    instruments: [
      {
        id: instrumentId,
        portfolioId: "portfolio-1",
        type: "STOCK",
        assetKind: "stock",
        symbol: "VWRD.UK",
        name: "Vanguard FTSE All-World UCITS ETF",
        marketCurrency: "GBP",
        provider: "catalog",
        metadata: {},
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    operations: [
      {
        id: "buy-vwrd",
        portfolioId: "portfolio-1",
        accountId: "portfolio-1:account:investment:default",
        assetId: instrumentId,
        operationType: "BUY",
        quantity: 1,
        price: 187.76,
        currency: "GBP",
        exchangeRate: 1,
        fee: 0,
        tax: 0,
        amount: 187.76,
        date: "2026-08-10",
        notes: "",
        metadata: {
          importSource: "XTB",
          lotId: "lot-vwrd",
          marketCurrency: "GBP",
          cashCurrency: "USD",
          marketAmount: 187.76,
          cashAmount: 187.76,
          autoFxConversion: true,
          autoFxTradeNormalized: true,
        },
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "buy-vwrd:auto-fx",
        portfolioId: "portfolio-1",
        accountId: "portfolio-1:account:investment:default",
        assetId: null,
        operationType: "CONVERSION",
        quantity: null,
        price: null,
        currency: "USD",
        exchangeRate: null,
        fee: 0,
        tax: 0,
        amount: 187.76,
        date: "2026-08-10",
        notes: "Automatyczne przewalutowanie brokera",
        metadata: {
          importSource: "XTB",
          autoFxConversion: true,
          autoFxForOperationId: "buy-vwrd",
          targetCurrency: "GBP",
          targetAmount: 187.76,
        },
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    tags: [],
    tagAssignments: [],
    benchmarks: [],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  };

  const repaired = repairMisclassifiedXtbListingCurrencies(portfolio);
  const trade = repaired.operations.find((operation) => operation.id === "buy-vwrd");

  assert.equal(repaired.operations.length, 1);
  assert.equal(trade.currency, "USD");
  assert.equal(trade.metadata.marketCurrency, "USD");
  assert.equal(trade.metadata.autoFxConversion, false);
  assert.equal(repaired.assets[0].marketCurrency, "USD");
  assert.equal(repaired.assets[0].purchasePriceCurrency, "USD");
  assert.equal(repaired.assets[0].purchaseFxRateToPln, 3.7085);
  assert.equal(repaired.assets[0].latestPrice, undefined);
  assert.equal(repaired.instruments[0].marketCurrency, "USD");
  assert.deepEqual(repairMisclassifiedXtbListingCurrencies(repaired), repaired);
});

test("repair leaves a genuine XTB FX trade and its conversion untouched", () => {
  const portfolio = {
    id: "portfolio-1",
    name: "XTB USD",
    baseCurrency: "USD",
    assets: [],
    sales: [],
    realizedAdjustments: [],
    operations: [
      {
        id: "buy-gbp",
        portfolioId: "portfolio-1",
        accountId: "account-1",
        assetId: null,
        operationType: "BUY",
        quantity: 1,
        price: 100,
        currency: "GBP",
        exchangeRate: 1.28,
        fee: 0,
        tax: 0,
        amount: 100,
        date: "2026-08-10",
        notes: "",
        metadata: {
          importSource: "XTB",
          marketCurrency: "GBP",
          cashCurrency: "USD",
          marketAmount: 100,
          cashAmount: 128,
          autoFxConversion: true,
          autoFxTradeNormalized: true,
        },
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    instruments: [],
    accounts: [],
    tags: [],
    tagAssignments: [],
    benchmarks: [],
    metadata: {},
    createdAt: NOW,
    updatedAt: NOW,
  };

  assert.equal(repairMisclassifiedXtbListingCurrencies(portfolio), portfolio);
});

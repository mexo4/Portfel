import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_FX_RATES } from "../src/lib/constants.ts";
import { classifyInstrument, normalizeProviderInstrumentType } from "../src/lib/instrument-classification.ts";
import { mergeQuoteIntoPortfolioAsset } from "../src/lib/api.ts";
import { getAssetClassAllocation, getGeographicAllocation } from "../src/lib/geographic-allocation.ts";
import { getGroupedPortfolioAssets } from "../src/lib/portfolio-engine.ts";
import { fetchYahooQuote } from "../src/lib/server/yahoo.ts";
import { normalizeStoredPortfolioAssets } from "../src/lib/portfolio-state.ts";
import { mergePortfolioBookQuoteSnapshots } from "../src/lib/server/portfolio-quote-snapshots.ts";

const quoteDate = "2026-10-10T15:00:00.000Z";
const originalFetch = globalThis.fetch;

test.after(() => {
  globalThis.fetch = originalFetch;
});

const legacyVanguardAsset = (overrides = {}) => ({
  id: "vanguard-lot-1",
  name: "Vanguard FTSE All-World UCITS ETF USD Distributing",
  symbol: "VWRD.UK",
  kind: "stock",
  instrumentType: "STOCK",
  purchaseDate: "2025-01-02",
  quantity: 2,
  purchasePrice: 100,
  purchaseCurrency: "USD",
  purchasePriceCurrency: "USD",
  purchaseFxRateToPln: 4,
  feePln: 8,
  marketCurrency: "USD",
  provider: "yahoo",
  providerId: "VWRD.L",
  latestPrice: 120,
  latestPriceDate: "2026-10-09",
  latestPriceFetchedAt: "2026-10-09T15:00:00.000Z",
  lastUpdatedAt: "2026-10-09T15:00:00.000Z",
  createdAt: "2025-01-02T10:00:00.000Z",
  ...overrides,
});

test("provider product types are normalized without treating generic ETP as ETF", () => {
  assert.equal(normalizeProviderInstrumentType("ETF"), "ETF");
  assert.equal(normalizeProviderInstrumentType("Exchange Traded Commodity"), "ETC");
  assert.equal(normalizeProviderInstrumentType("ETN"), "ETN");
  assert.equal(normalizeProviderInstrumentType("EQUITY"), "STOCK");
  assert.equal(normalizeProviderInstrumentType("ETP"), "OTHER");
});

test("verified venue-aware ETF identity repairs legacy stock-kind VWRD and VHYD instruments", () => {
  for (const { ticker, providerId, name } of [
    { ticker: "VWRD.UK", providerId: "VWRD.L", name: "Vanguard FTSE All-World UCITS ETF" },
    { ticker: "VHYD.UK", providerId: "VHYD.L", name: "Vanguard FTSE All-World High Dividend Yield UCITS ETF" },
  ]) {
    const legacy = legacyVanguardAsset({
      symbol: ticker,
      providerId,
      name,
      instrumentIdentity: {
        ticker: ticker.replace(".UK", ""),
        name,
        instrumentType: "ETF",
        exchange: "London Stock Exchange",
        exchangeCode: "LSE",
        currency: "USD",
        securityType: "ETF",
      },
    });
    const [normalized] = normalizeStoredPortfolioAssets([legacy]);

    assert.equal(normalized.kind, "stock", "legacy operation grouping kind is intentionally preserved");
    assert.equal(normalized.instrumentType, "STOCK");
    assert.equal(normalized.instrumentIdentity.instrumentType, "ETF");
    assert.equal(classifyInstrument(normalized), "etf");
  }
});

test("ISIN corroborates an ETF identity only when its listing venue is known", () => {
  const identity = {
    instrumentType: "ETF",
    exchange: "London Stock Exchange",
    exchangeCode: "LSE",
  };

  assert.equal(
    classifyInstrument({ kind: "stock", instrumentIdentity: identity, isin: "IE00B3RBWM25" }),
    "etf"
  );
  assert.equal(
    classifyInstrument({ kind: "stock", instrumentIdentity: identity }),
    "unverified",
    "an ETF product type without a stable identifier is left unverified"
  );
  assert.equal(
    classifyInstrument({
      kind: "stock",
      instrumentType: "STOCK",
      instrumentIdentity: { instrumentType: "ETF", ticker: "AMBIG" },
    }),
    "unverified",
    "an unresolved product-type conflict is not silently classified as stock"
  );
});

test("portfolio normalization preserves a valid listing ISIN without changing finance fields", () => {
  const source = legacyVanguardAsset({ isin: "ie00b3rbwm25" });
  const [normalized] = normalizeStoredPortfolioAssets([source]);

  assert.equal(normalized.isin, "IE00B3RBWM25");
  for (const field of ["quantity", "purchasePrice", "purchaseCurrency", "marketCurrency", "feePln"]) {
    assert.equal(normalized[field], source[field], `${field} is not classification metadata`);
  }
});

test("provider ETF metadata survives quote cache and corrects old positions without financial edits", () => {
  const original = legacyVanguardAsset();
  const quote = {
    symbol: "VWRD.UK",
    name: "Vanguard FTSE All-World UCITS ETF",
    price: 121.5,
    marketCurrency: "USD",
    provider: "yahoo",
    providerId: "VWRD.L",
    instrumentType: "ETF",
    fetchedAt: quoteDate,
  };
  const refreshed = mergeQuoteIntoPortfolioAsset(original, quote);
  assert.equal(refreshed.instrumentType, "ETF");
  assert.equal(refreshed.latestPrice, 121.5);
  for (const field of ["kind", "symbol", "marketCurrency", "quantity", "purchasePrice", "purchaseCurrency", "purchaseFxRateToPln", "feePln"]) {
    assert.equal(refreshed[field], original[field], `${field} must not change during type correction`);
  }

  const portfolioBook = {
    schemaVersion: 2,
    activePortfolioId: "p1",
    portfolios: [{ id: "p1", assets: [original] }],
  };
  const cachedBook = mergePortfolioBookQuoteSnapshots(
    portfolioBook,
    new Map([["p1:vanguard-lot-1", {
      portfolioId: "p1",
      assetId: "vanguard-lot-1",
      latestPrice: 121.5,
      latestPriceMarketTimestamp: quoteDate,
      latestPriceFetchedAt: quoteDate,
      marketCurrency: "USD",
      provider: "yahoo",
      providerId: "VWRD.L",
      instrumentType: "ETF",
    }]])
  );
  const restored = cachedBook.portfolios[0].assets[0];
  assert.equal(restored.instrumentType, "ETF");
  assert.equal(restored.quantity, original.quantity);
  assert.equal(restored.purchasePrice, original.purchasePrice);
  assert.equal(restored.marketCurrency, "USD");

  const sameInstrumentLegacyLot = legacyVanguardAsset({
    id: "vanguard-lot-2",
    quantity: 1,
    instrumentType: "STOCK",
  });
  const groups = getGroupedPortfolioAssets(
    [restored, sameInstrumentLegacyLot],
    FALLBACK_FX_RATES,
    "PLN"
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].quantity, 3);
  assert.deepEqual(getAssetClassAllocation(groups), [
    { id: "etf", label: "ETF", totalValue: groups[0].totalValue },
  ]);
  assert.deepEqual(getGeographicAllocation(groups), []);
});

test("Yahoo listing metadata reports ETF type and USD quote currency for VWRD and VHYD LSE lines", async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/v7/finance/quote?")) {
      const symbol = new URL(url).searchParams.get("symbols")?.split(",")[0] ?? "VWRD.L";
      return new Response(JSON.stringify({ quoteResponse: { result: [{
        symbol,
        currency: "USD",
        regularMarketPrice: 121.5,
        quoteType: "ETF",
        longName: symbol === "VHYD.L"
          ? "Vanguard FTSE All-World High Dividend Yield UCITS ETF"
          : "Vanguard FTSE All-World UCITS ETF",
      }] } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ chart: { result: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  for (const symbol of ["VWRD", "VHYD"]) {
    const quote = await fetchYahooQuote({ symbol: `${symbol}.UK`, providerId: `${symbol}.L`, fallbackCurrency: "GBP" });
    assert.equal(quote.instrumentType, "ETF");
    assert.equal(quote.marketCurrency, "USD");
    assert.equal(quote.providerId, `${symbol}.L`);
  }
});

test("negative classifications keep stocks, bonds, ETC, ETN, funds, CFD and unknown separate", () => {
  const expected = [
    [{ kind: "stock", instrumentType: "STOCK", name: "Ordinary shares" }, "stock"],
    [{ kind: "bond", instrumentType: "BOND", name: "Government bond" }, "bond"],
    [{ kind: "stock", instrumentType: "ETC", name: "Physical gold" }, "etc"],
    [{ kind: "stock", instrumentType: "ETN", name: "Index note" }, "etn"],
    [{ kind: "stock", instrumentType: "FUND", name: "Open-end fund" }, "fund"],
    [{ kind: "etf", instrumentType: "CFD", name: "ETF CFD" }, "cfd"],
    [{ kind: "stock", instrumentType: "OTHER", name: "Unresolved listing" }, "unverified"],
    [{ kind: "stock", instrumentType: "STOCK", name: "UCITS ETF" }, "unverified"],
  ];

  for (const [input, expectedClass] of expected) {
    assert.equal(classifyInstrument(input), expectedClass);
  }
});

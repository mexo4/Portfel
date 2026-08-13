import assert from "node:assert/strict";
import test from "node:test";
import {
  getDuplicatePortfolioName,
  assertUniquePortfolioNames,
} from "../src/lib/portfolio-state.ts";
import {
  ALL_PORTFOLIOS_ID,
  getPersistedPortfolioSelectionId,
  getWorkspaceReadHref,
} from "../src/lib/portfolio-selection.ts";
import {
  aggregatePortfolioSummaries,
  getAllPortfolioScopedGroups,
  getGroupedPortfolioAssets,
  getPortfolioSummary,
} from "../src/lib/portfolio-engine.ts";
import { getBlankDividendNumericInputs } from "../src/lib/dividend-input-defaults.ts";
import { getBestPortfolioDailyMetrics } from "../src/lib/portfolio-daily-metrics.ts";
import { aggregatePortfolioHistoryPoints } from "../src/lib/server/portfolio-history.ts";
import { getGeographicAllocation, UNKNOWN_COUNTRY_LABEL } from "../src/lib/geographic-allocation.ts";

const portfolioNames = [
  { id: "one", name: "Portfel długoterminowy" },
  { id: "two", name: "Trading" },
];

test("portfolio labels are unique per user after trim and case normalization", () => {
  assert.equal(getDuplicatePortfolioName(portfolioNames, "  PORTFEL DŁUGOTERMINOWY ")?.id, "one");
  assert.equal(getDuplicatePortfolioName(portfolioNames, "trading", "two"), null);
  assert.throws(
    () => assertUniquePortfolioNames([...portfolioNames, { id: "three", name: "TRADING" }]),
    /Masz już portfel/
  );
});

test("virtual all-portfolios selector cannot become a persisted portfolio id", () => {
  assert.equal(
    getPersistedPortfolioSelectionId(ALL_PORTFOLIOS_ID, ["one", "two"], "one"),
    "one"
  );
  assert.equal(getPersistedPortfolioSelectionId("two", ["one", "two"], "one"), "two");
});

test("read navigation retains virtual all-portfolios scope and presentation currency", () => {
  for (const path of [
    "/dashboard",
    "/portfolio/positions",
    "/portfolio/operations",
    "/portfolio/dividends",
    "/analytics/performance",
    "/analytics/charts",
    "/analytics/structure",
    "/analytics/benchmarks",
    "/market/events",
  ]) {
    assert.equal(
      getWorkspaceReadHref(path, ALL_PORTFOLIOS_ID, "USD"),
      `${path}?portfolio=all&currency=USD`
    );
  }
  assert.equal(
    getWorkspaceReadHref("/analytics/charts?mode=value", ALL_PORTFOLIOS_ID, "EUR"),
    "/analytics/charts?mode=value&portfolio=all&currency=EUR"
  );
  assert.equal(getWorkspaceReadHref("/portfolio/positions", "one", "USD"), "/portfolio/positions");
});

test("position gain percent is derived from the same market value and cost basis", () => {
  const groups = getGroupedPortfolioAssets(
    [
      {
        id: "lot-1",
        name: "Testowa pozycja",
        symbol: "TST",
        kind: "stock",
        purchaseDate: "2026-01-01",
        quantity: 2,
        purchasePrice: 100,
        purchaseCurrency: "PLN",
        purchasePriceCurrency: "PLN",
        purchaseFxRateToPln: 1,
        purchaseSettlementFxRateToPln: 1,
        feePln: 0,
        marketCurrency: "PLN",
        provider: "catalog",
        latestPrice: 125,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    { PLN: 1 },
    "PLN"
  );

  assert.equal(groups[0].profitLossBase, 50);
  assert.equal(groups[0].costBasisBase, 200);
  assert.equal(groups[0].profitLossPercent, 25);
});

test("new dividend numeric inputs are blank-safe until submit validation", () => {
  assert.deepEqual(getBlankDividendNumericInputs(), {
    quantity: 0,
    exchangeRate: 0,
  });
});

const aggregateTestAsset = ({ id, currency, purchasePrice, latestPrice }) => ({
  id,
  name: "Wspólny ticker",
  symbol: "SAME",
  kind: "stock",
  purchaseDate: "2026-01-01",
  quantity: 1,
  purchasePrice,
  purchaseCurrency: currency,
  purchasePriceCurrency: currency,
  purchaseFxRateToPln: currency === "USD" ? 4 : 1,
  purchaseSettlementFxRateToPln: currency === "USD" ? 4 : 1,
  feePln: 0,
  marketCurrency: currency,
  provider: "catalog",
  latestPrice,
  createdAt: "2026-01-01T00:00:00.000Z",
});

test("virtual aggregate retains same-symbol portfolio identity and sums independently valued bases", () => {
  const fxRates = { PLN: 1, USD: 4 };
  const plnAsset = aggregateTestAsset({ id: "pln-lot", currency: "PLN", purchasePrice: 100, latestPrice: 125 });
  const usdAsset = aggregateTestAsset({ id: "usd-lot", currency: "USD", purchasePrice: 10, latestPrice: 20 });
  const groups = getAllPortfolioScopedGroups([
    { id: "long-term", name: "Długoterminowy", assets: [plnAsset] },
    { id: "trading", name: "Trading", assets: [usdAsset] },
  ], fxRates, "PLN");

  assert.equal(groups.length, 2);
  assert.notEqual(groups[0].key, groups[1].key);
  assert.deepEqual(groups.map((group) => group.portfolioId).sort(), ["long-term", "trading"]);

  const aggregate = aggregatePortfolioSummaries([
    getPortfolioSummary([plnAsset], [], [], fxRates, "PLN"),
    getPortfolioSummary([usdAsset], [], [], fxRates, "USD"),
  ], fxRates, "USD");

  assert.equal(aggregate.totalValuePln, 205);
  assert.equal(aggregate.totalValue, 51.25);
  assert.equal(aggregate.assetsCount, 2);
});

test("cash-flow-neutral daily metric is separate from the raw best-day value change", () => {
  const { bestRaw, bestCashFlowNeutral } = getBestPortfolioDailyMetrics([
    { date: "2026-01-01", portfolioValuePln: 10_000, netInvestedPln: 10_000, profitLossPln: 0, timeWeightedReturnPercent: 0 },
    // +900 external capital plus +120 investment result.
    { date: "2026-01-02", portfolioValuePln: 11_020, netInvestedPln: 10_900, profitLossPln: 120, timeWeightedReturnPercent: 1.2 },
  ]);

  assert.equal(bestRaw?.rawValueChangePln, 1020);
  assert.equal(bestCashFlowNeutral?.cashFlowNeutralResultPln, 120);
});

test("virtual history aggregates independently calculated portfolios in PLN without merging equal tickers", () => {
  const points = aggregatePortfolioHistoryPoints([
    { points: [
      { date: "2026-01-01", portfolioValuePln: 100, netInvestedPln: 100, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2026-01-02", portfolioValuePln: 110, netInvestedPln: 100, profitLossPln: 10, timeWeightedReturnPercent: 10 },
    ] },
    { points: [
      { date: "2026-01-01", portfolioValuePln: 400, netInvestedPln: 400, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2026-01-02", portfolioValuePln: 420, netInvestedPln: 400, profitLossPln: 20, timeWeightedReturnPercent: 5 },
    ] },
  ]);

  assert.deepEqual(points[1], {
    date: "2026-01-02",
    portfolioValuePln: 530,
    netInvestedPln: 500,
    profitLossPln: 30,
    timeWeightedReturnPercent: 6,
  });
});

test("geographic allocation uses only confirmed issuer metadata and excludes ETFs", () => {
  const groups = [
    // Legacy lots lack the field; exact catalog identity supplies confirmed metadata.
    { kind: "stock", symbol: "DNP.PL", totalValue: 100, lots: [{ symbol: "DNP.PL", provider: "stooq" }] },
    { kind: "stock", symbol: "AAPL", totalValue: 200, lots: [{ symbol: "AAPL", provider: "finnhub" }] },
    { kind: "stock", symbol: "NOVO-B.CO", totalValue: 300, lots: [{ symbol: "NOVO-B.CO", provider: "yahoo" }] },
    { kind: "stock", symbol: "SAP.DE", totalValue: 400, lots: [{ symbol: "SAP.DE", provider: "yahoo" }] },
    // A suffix alone cannot establish a country.
    { kind: "stock", symbol: "UNKNOWN.DE", totalValue: 50, lots: [{}] },
    // ETF country is not a look-through allocation and must be omitted.
    { kind: "etf", symbol: "VWCE", totalValue: 999, lots: [{ issuerCountry: "Irlandia" }] },
  ];
  const allocation = getGeographicAllocation(groups);

  assert.deepEqual(allocation, [
    { country: "Niemcy", totalValue: 400 },
    { country: "Dania", totalValue: 300 },
    { country: "USA", totalValue: 200 },
    { country: "Polska", totalValue: 100 },
    { country: UNKNOWN_COUNTRY_LABEL, totalValue: 50 },
  ]);
});

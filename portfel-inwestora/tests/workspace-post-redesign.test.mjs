import assert from "node:assert/strict";
import test from "node:test";
import {
  getDuplicatePortfolioName,
  assertUniquePortfolioNames,
} from "../src/lib/portfolio-state.ts";
import {
  ALL_PORTFOLIOS_ID,
  getPersistedPortfolioSelectionId,
} from "../src/lib/portfolio-selection.ts";
import {
  aggregatePortfolioSummaries,
  getAllPortfolioScopedGroups,
  getGroupedPortfolioAssets,
  getPortfolioSummary,
} from "../src/lib/portfolio-engine.ts";
import { getBlankDividendNumericInputs } from "../src/lib/dividend-input-defaults.ts";

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

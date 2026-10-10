import assert from "node:assert/strict";
import test from "node:test";
import { getAssetValuation, getGroupedPortfolioAssets, getPortfolioSummary } from "../src/lib/portfolio-engine.ts";

test("keeps the LPP unit quote separate from its PLN position value and P/L", () => {
  const lpp = {
    id: "lpp",
    kind: "stock",
    name: "LPP",
    symbol: "LPP.PL",
    quantity: 0.03,
    purchasePrice: 19617,
    purchaseCurrency: "PLN",
    purchaseDate: "2026-08-01",
    feePln: 0,
    marketCurrency: "PLN",
    provider: "stooq",
    latestPrice: 22200,
    latestPriceDate: "2026-08-07",
    latestPriceFetchedAt: "2026-08-10T12:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
  };

  const valuation = getAssetValuation(lpp, { PLN: 1 }, "PLN");
  assert.equal(valuation.currentUnitPrice, 22200);
  assert.equal(valuation.marketValueQuote, 666);
  assert.equal(valuation.marketValueBase, 666);
  assert.equal(valuation.costBasisBase, 588.51);
  assert.equal(valuation.profitLossBase, 77.49);

  const group = getGroupedPortfolioAssets([lpp], { PLN: 1 }, "PLN")[0];
  assert.equal(group.currentUnitPrice, 22200);
  assert.equal(group.marketValueQuote, 666);
  assert.equal(group.marketValueBase, 666);
  assert.equal(group.costBasisBase, 588.51);
  assert.equal(group.profitLossBase, 77.49);
});

test("keeps Bitcoin's unit quote, USD position value and PLN P/L distinct", () => {
  const btc = {
    id: "btc",
    kind: "crypto",
    name: "Bitcoin",
    symbol: "BTC",
    quantity: 0.002,
    purchasePrice: 66831.9,
    purchaseCurrency: "USD",
    purchaseFxRateToPln: 3.722623477710495,
    purchaseDate: "2026-08-01",
    feePln: 0,
    marketCurrency: "USD",
    provider: "coingecko",
    providerId: "bitcoin",
    latestPrice: 64114.05,
    latestPriceFetchedAt: "2026-08-10T12:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
  };

  const valuation = getAssetValuation(btc, { PLN: 1, USD: 3.722584987221989 }, "PLN");
  assert.equal(valuation.currentUnitPrice, 64114.05);
  assert.equal(valuation.marketValueQuote, 128.2281);
  assert.equal(valuation.marketValueBase, 477.34);
  assert.equal(valuation.costBasisBase, 497.58);
  assert.equal(valuation.profitLossBase, -20.24);
});

test("supports a manual BTC quote with USD P/L and fees in the cost basis", () => {
  const btc = {
    id: "btc-lot",
    kind: "crypto",
    instrumentType: "OTHER",
    name: "Bitcoin",
    symbol: "BTC",
    quantity: 0.05,
    purchasePrice: 50000,
    purchaseCurrency: "USD",
    purchasePriceCurrency: "USD",
    purchaseFxRateToPln: 4,
    purchaseDate: "2026-01-01",
    feePln: 100,
    marketCurrency: "USD",
    latestPrice: 60000,
    latestPriceDate: "2026-10-10",
    latestPriceFetchedAt: "2026-10-10T10:00:00.000Z",
    priceSource: "MANUAL",
  };

  const valuation = getAssetValuation(btc, { PLN: 1, USD: 4 }, "USD");
  const group = getGroupedPortfolioAssets([btc], { PLN: 1, USD: 4 }, "USD")[0];
  assert.equal(valuation.marketValueQuote, 3000);
  assert.equal(valuation.marketValueBase, 3000);
  assert.equal(valuation.costBasisBase, 2525);
  assert.equal(valuation.profitLossBase, 475);
  assert.equal(group.profitLossPercent, 18.81);
  assert.equal(group.hasBaseValuation, true);
});

test("does not treat an unknown quote or missing FX as a zero-price loss", () => {
  const unknownQuote = {
    id: "legacy-asset",
    kind: "stock",
    instrumentType: "OTHER",
    name: "Delisted holding",
    symbol: "OLD.MARKET",
    quantity: 10,
    purchasePrice: 25,
    purchaseCurrency: "USD",
    purchasePriceCurrency: "USD",
    purchaseFxRateToPln: 4,
    purchaseDate: "2020-01-01",
    feePln: 0,
    marketCurrency: "USD",
  };
  const unknownFx = {
    ...unknownQuote,
    latestPrice: 20,
    marketCurrency: "ZZZ",
    purchaseCurrency: "ZZZ",
    purchasePriceCurrency: "ZZZ",
    purchaseFxRateToPln: undefined,
  };

  for (const asset of [unknownQuote, unknownFx]) {
    const group = getGroupedPortfolioAssets([asset], { PLN: 1, USD: 4 }, "PLN")[0];
    const summary = getPortfolioSummary([asset], [], [], { PLN: 1, USD: 4 }, "PLN");
    assert.equal(group.hasBaseValuation, false);
    assert.equal(summary.unpricedPositionsCount, 1);
    assert.equal(summary.openProfitLoss, 0);
  }
});

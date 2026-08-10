import assert from "node:assert/strict";
import test from "node:test";
import { getAssetValuation, getGroupedPortfolioAssets } from "../src/lib/portfolio-engine.ts";

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

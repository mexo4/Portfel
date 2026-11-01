import test from "node:test";
import assert from "node:assert/strict";
import { buildPortfolioHistory } from "../src/lib/server/portfolio-history.ts";

const makeAsset = (index) => ({
  id: `history-output-${index}`,
  name: `Test asset ${index}`,
  symbol: `TEST${index}.US`,
  kind: "stock",
  purchaseDate: "2025-08-01",
  quantity: index + 1,
  purchasePrice: 100 + index,
  purchaseCurrency: "PLN",
  purchasePriceCurrency: "PLN",
  marketCurrency: "PLN",
  provider: "stooq",
  createdAt: "2025-08-01T00:00:00.000Z",
});

test("omitting unused per-asset chart series preserves portfolio history exactly", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  // Make missing-cache reads fail before any provider call; this test checks
  // the local history aggregation path and never needs external data or a DB.
  process.env.DATABASE_URL = "";
  const input = {
    assets: [makeAsset(1), makeAsset(2), makeAsset(3)],
    sales: [],
    realizedAdjustments: [],
  };

  try {
    const withAssetSeries = await buildPortfolioHistory(input);
    const withoutAssetSeries = await buildPortfolioHistory({
      ...input,
      includeAssetSeries: false,
    });

    assert.equal(withAssetSeries.assetSeries.length, 3);
    assert.ok(withAssetSeries.assetSeries.every((series) => series.points.length === withAssetSeries.points.length));
    assert.deepEqual(withoutAssetSeries.assetSeries, []);
    assert.deepEqual(withoutAssetSeries.points, withAssetSeries.points);
    assert.deepEqual(withoutAssetSeries.benchmarkSeries, withAssetSeries.benchmarkSeries);
    assert.deepEqual(withoutAssetSeries.warnings, withAssetSeries.warnings);
    assert.equal(withoutAssetSeries.twrStatus, withAssetSeries.twrStatus);
    assert.equal(withoutAssetSeries.presentationTwrStatus, withAssetSeries.presentationTwrStatus);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

import assert from "node:assert/strict";
import test from "node:test";

const { buildClosedInvestments, daysBetween } = await import("../src/lib/closed-investments.ts");

const sale = (id, fields) => ({
  id,
  assetKey: id,
  transactionKind: "sale",
  kind: "stock",
  provider: "yahoo",
  marketCurrency: "PLN",
  feePln: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  allocations: [],
  ...fields,
});
const portfolio = (id, name, sales) => ({ id, name, assets: [], sales, realizedAdjustments: [], createdAt: "", updatedAt: "" });

const allocation = (purchaseDate, quantity, purchasePrice, investedPln, allocatedBuyFeePln = 0) => ({
  lotId: `${purchaseDate}-${quantity}`, purchaseDate, quantity, purchasePrice, purchaseCurrency: "PLN", allocatedBuyFeePln, investedPln,
});

const portfolios = [
  portfolio("p1", "Główny", [
    sale("s1", {
      name: "Orlen", symbol: "PKN.PL", saleDate: "2026-03-01", quantity: 10, salePrice: 80,
      realizedInvestedPln: 600, realizedProceedsPln: 800, realizedProfitLossPln: 200,
      allocations: [allocation("2026-01-01", 4, 55, 220), allocation("2026-02-01", 6, 63.33, 380)],
    }),
    sale("s2", {
      name: "CD Projekt", symbol: "CDR.PL", saleDate: "2025-06-10", quantity: 2, salePrice: 100,
      realizedInvestedPln: 300, realizedProceedsPln: 200, realizedProfitLossPln: -100,
      allocations: [allocation("2025-06-01", 2, 150, 300)],
    }),
  ]),
  portfolio("p2", "IKE", [
    sale("s3", {
      name: "Orlen", symbol: "PKN.PL", saleDate: "2026-05-01", quantity: 5, salePrice: 70,
      realizedInvestedPln: 300, realizedProceedsPln: 350, realizedProfitLossPln: 50,
      allocations: [allocation("2026-04-01", 5, 60, 300)],
    }),
  ]),
];

test("days between two dates ignore the time of day and never go negative", () => {
  assert.equal(daysBetween("2026-01-01", "2026-03-01"), 59);
  assert.equal(daysBetween("2026-03-01T22:00:00Z", "2026-03-02"), 1);
  assert.equal(daysBetween("2026-03-02", "2026-03-01"), 0);
});

test("each sale lists the lots it closed, with a quantity-weighted holding period", () => {
  const { trades } = buildClosedInvestments(portfolios);
  const orlen = trades.find((trade) => trade.id === "s1");

  assert.deepEqual(trades.map((trade) => trade.id), ["s3", "s1", "s2"], "newest first");
  assert.equal(orlen.portfolioName, "Główny");
  assert.deepEqual(orlen.lots.map((lot) => [lot.purchaseDate, lot.quantity, lot.holdingDays]), [["2026-01-01", 4, 59], ["2026-02-01", 6, 28]]);
  assert.equal(orlen.holdingDays, Math.round((59 * 4 + 28 * 6) / 10));
  assert.equal(orlen.returnPercent, 33.33);
});

test("the same instrument in two portfolios is one summary row, sorted by result", () => {
  const { summary } = buildClosedInvestments(portfolios);

  assert.deepEqual(summary.map((row) => [row.symbol, row.trades, row.profitLossPln]), [["PKN.PL", 2, 250], ["CDR.PL", 1, -100]]);
  assert.equal(summary[0].investedPln, 900);
  assert.equal(summary[0].returnPercent, 27.78);
  assert.equal(summary[0].firstSaleDate, "2026-03-01");
  assert.equal(summary[0].lastSaleDate, "2026-05-01");
});

test("totals: win rate, profit factor and average holding period", () => {
  const { totals, years } = buildClosedInvestments(portfolios);

  assert.deepEqual(years, [2026, 2025]);
  assert.equal(totals.trades, 3);
  assert.equal(totals.profitLossPln, 150);
  assert.equal(totals.winRatePercent, 66.7);
  assert.equal(totals.grossProfitPln, 250);
  assert.equal(totals.grossLossPln, 100);
  assert.equal(totals.profitFactor, 2.5);
  assert.ok(totals.averageHoldingDays > 0);
});

test("a year filter keeps only the sales of that year; no sales gives empty totals, not NaN", () => {
  const year2025 = buildClosedInvestments(portfolios, { year: 2025 });
  const none = buildClosedInvestments([portfolio("p", "Pusty", [])]);

  assert.deepEqual(year2025.trades.map((trade) => trade.id), ["s2"]);
  assert.equal(year2025.totals.profitFactor, 0, "only a loss: no profit against it");
  assert.equal(none.totals.trades, 0);
  assert.equal(none.totals.winRatePercent, null);
  assert.equal(none.totals.returnPercent, null);
  assert.equal(none.totals.averageHoldingDays, null);
});

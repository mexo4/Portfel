import assert from "node:assert/strict";
import test from "node:test";

const { listChartInstruments, buildInstrumentTimeline, averagePriceOn, priceExtremes, buildComparisonRows, separateOpposingTrades } =await import("../src/lib/instrument-chart.ts");

const lot = (id, date, quantity, price) => ({ id, name: "XTB", symbol: "XTB.PL", kind: "stock", purchaseDate: date, quantity, purchasePrice: price, purchaseCurrency: "PLN", feePln: 0, marketCurrency: "PLN", provider: "yahoo", latestPrice: 80, createdAt: "" });
const allocation = (lotId, quantity, purchaseDate, purchasePrice) => ({ lotId, quantity, purchaseDate, purchasePrice, purchaseCurrency: "PLN", allocatedBuyFeePln: 0, investedPln: quantity * purchasePrice });
const sale = (id, date, quantity, price, allocations) => ({ id, assetKey: "stock:XTB", name: "XTB", symbol: "XTB.PL", kind: "stock", transactionKind: "sale", quantity, salePrice: price, saleDate: date, feePln: 0, marketCurrency: "PLN", provider: "yahoo", realizedInvestedPln: 0, realizedProceedsPln: 0, realizedProfitLossPln: 0, allocations, createdAt: "" });

// Bought 10 @ 50 (lot a, sold in full later), 10 @ 70 (lot b, 4 still held) and 4 @ 90 (lot c).
const portfolio = {
  id: "p", name: "Główny", createdAt: "", updatedAt: "",
  assets: [lot("b", "2025-03-01", 4, 70), lot("c", "2025-06-01", 4, 90), { ...lot("bond", "2025-01-01", 10, 100), kind: "bond", symbol: "EDO0135", name: "EDO" }],
  sales: [
    sale("s1", "2025-04-01", 12, 80, [allocation("a", 10, "2025-01-10", 50), allocation("b", 2, "2025-03-01", 70)]),
    sale("s2", "2025-07-01", 4, 100, [allocation("b", 4, "2025-03-01", 70)]),
  ],
  realizedAdjustments: [], operations: [], accounts: [],
};

test("the list of instruments leaves out bonds and knows the first purchase", () => {
  const instruments = listChartInstruments([portfolio]);
  assert.deepEqual(instruments.map((item) => [item.key, item.quantity, item.isOpen, item.firstTradeDate]), [["stock:XTB", 8, true, "2025-01-10"]]);
});

test("purchases include the lot sold in full and the part of open lots already sold", () => {
  const [instrument] = listChartInstruments([portfolio]);
  const timeline = buildInstrumentTimeline([portfolio], instrument);

  assert.deepEqual(
    timeline.trades.map((trade) => [trade.side, trade.date, trade.quantity, trade.price]),
    [["buy", "2025-01-10", 10, 50], ["buy", "2025-03-01", 10, 70], ["sell", "2025-04-01", 12, 80], ["buy", "2025-06-01", 4, 90], ["sell", "2025-07-01", 4, 100]]
  );
  assert.equal(timeline.trades[1].amount, 700);
  assert.equal(timeline.skippedTrades, 0);
});

test("the average purchase price follows the FIFO allocations of each sale", () => {
  const [instrument] = listChartInstruments([portfolio]);
  const { averagePriceSteps } = buildInstrumentTimeline([portfolio], instrument);

  assert.equal(averagePriceOn(averagePriceSteps, "2025-01-01"), null, "nothing held before the first buy");
  assert.equal(averagePriceOn(averagePriceSteps, "2025-02-01"), 50);
  assert.equal(averagePriceOn(averagePriceSteps, "2025-03-15"), 60, "(10 × 50 + 10 × 70) / 20");
  assert.equal(averagePriceOn(averagePriceSteps, "2025-04-15"), 70, "the sale closed all of lot a and 2 of lot b");
  assert.equal(averagePriceOn(averagePriceSteps, "2025-06-15"), 76.666667, "(8 × 70 + 4 × 90) / 12 after the buy of lot c");
  assert.equal(averagePriceOn(averagePriceSteps, "2025-07-15"), 80, "(4 × 70 + 4 × 90) / 8");
});

test("one order filled in parts is one purchase, also after the parts were sold", () => {
  // The way XTB saves one order of 12 shares: four parts, later closed by four sales.
  const parts = {
    ...portfolio,
    assets: [],
    sales: [
      sale("s1", "2026-03-16", 1, 51.1, [allocation("f1", 1, "2026-03-16", 51.2)]),
      sale("s2", "2026-03-16", 3, 51.1, [allocation("f1", 3, "2026-03-16", 51.2)]),
      sale("s3", "2026-03-16", 7, 51.1, [allocation("f1", 3, "2026-03-16", 51.2), allocation("f2", 2, "2026-03-16", 51.2), allocation("f3", 2, "2026-03-16", 51.2)]),
      sale("s4", "2026-03-16", 1, 51.1, [allocation("f4", 1, "2026-03-16", 51.2)]),
    ],
  };
  const [instrument] = listChartInstruments([parts]);
  const { trades } = buildInstrumentTimeline([parts], instrument);
  assert.deepEqual(trades.filter((trade) => trade.side === "buy").map((trade) => [trade.quantity, trade.price, trade.amount]), [[12, 51.2, 614.4]]);
  assert.equal(trades.filter((trade) => trade.side === "sell").length, 4, "sales stay as they were booked");
});

test("purchases at another price, on another day or in another portfolio stay apart", () => {
  const first = { ...portfolio, sales: [], assets: [lot("a", "2025-01-10", 1, 50), lot("b", "2025-01-10", 2, 50), lot("c", "2025-01-10", 1, 51), lot("d", "2025-01-11", 1, 50)] };
  const second = { ...portfolio, id: "q", name: "Drugi", sales: [], assets: [lot("e", "2025-01-10", 1, 50)] };
  const [instrument] = listChartInstruments([first, second]);
  const { trades } = buildInstrumentTimeline([first, second], instrument);
  assert.deepEqual(trades.map((trade) => [trade.date, trade.quantity, trade.price, trade.portfolioName]).sort(), [
    ["2025-01-10", 1, 50, "Drugi"], ["2025-01-10", 1, 51, "Główny"], ["2025-01-10", 3, 50, "Główny"], ["2025-01-11", 1, 50, "Główny"],
  ]);
});

test("a purchase and a sale in the same place are moved apart so neither hides the other", () => {
  const marks = [
    { side: "buy", date: "2026-03-16" }, { side: "sell", date: "2026-03-16" }, { side: "sell", date: "2026-03-16" },
    { side: "buy", date: "2026-03-17" }, { side: "sell", date: "2026-03-18" },
  ];
  assert.deepEqual(separateOpposingTrades(marks, (mark) => mark.date).map((mark) => mark.nudge), [-1, 1, 1, 0, 0]);
});

test("trades priced in another currency are counted, not drawn", () => {
  const other = { ...portfolio, assets: [{ ...lot("x", "2025-01-01", 1, 20), purchasePriceCurrency: "USD", purchaseCurrency: "USD" }], sales: [] };
  const [instrument] = listChartInstruments([other]);
  const timeline = buildInstrumentTimeline([other], instrument);
  assert.equal(timeline.trades.length, 0);
  assert.equal(timeline.skippedTrades, 1);
});

test("extremes and the comparison rebased to the first common date", () => {
  const a = [{ date: "2025-01-01", close: 10 }, { date: "2025-01-02", close: 12 }, { date: "2025-01-03", close: 9 }];
  const b = [{ date: "2025-01-02", close: 100 }, { date: "2025-01-03", close: 110 }];
  assert.deepEqual(priceExtremes(a), { max: a[1], min: a[2], last: a[2] });
  assert.equal(priceExtremes([]), null);

  const { rows, baseDate } = buildComparisonRows([{ key: "a", points: a }, { key: "b", points: b }], "2025-01-01");
  assert.equal(baseDate, "2025-01-02");
  assert.deepEqual(rows, [{ date: "2025-01-02", a: 0, b: 0 }, { date: "2025-01-03", a: -25, b: 10 }]);
});

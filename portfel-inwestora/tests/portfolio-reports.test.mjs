import assert from "node:assert/strict";
import test from "node:test";

const { buildProfitByType, buildProfitByAccount, buildHoldingsByAccount, buildHeatmapCells, buildPeriodReturns, summarizePeriodReturns } = await import("../src/lib/portfolio-reports.ts");

const fxRates = { PLN: 1, USD: 4.5 };
const account = (id, name, isDefault = false) => ({ id, portfolioId: "p", name, kind: "cash", currency: "PLN", isDefault, metadata: {}, createdAt: "", updatedAt: "" });
const op = (id, operationType, accountId, metadata = {}, extra = {}) => ({
  id, portfolioId: "p", accountId, assetId: null, operationType, quantity: null, price: null, currency: "PLN", exchangeRate: 1, fee: 0, tax: 0, amount: 0,
  date: "2026-01-02", notes: "", metadata: { cashImpact: true, ...metadata }, createdAt: "", updatedAt: "", ...extra,
});

const portfolio = {
  id: "p", name: "Główny", createdAt: "", updatedAt: "",
  assets: [
    // AAPL: cost 10 × 100 × 4 + 8 = 4008, value 10 × 120 × 4.5 = 5400, result 1392.
    { id: "aapl", name: "Apple", symbol: "AAPL", kind: "stock", purchaseDate: "2026-01-02", quantity: 10, purchasePrice: 100, purchaseCurrency: "USD", purchasePriceCurrency: "USD", purchaseFxRateToPln: 4, feePln: 8, marketCurrency: "USD", provider: "yahoo", latestPrice: 120, createdAt: "" },
    // VWCE (ETF): cost 2 × 500 + 0 = 1000, value 1100, result 100.
    { id: "vwce", name: "Vanguard FTSE All-World", symbol: "VWCE.DE", kind: "etf", purchaseDate: "2026-01-03", quantity: 2, purchasePrice: 500, purchaseCurrency: "PLN", feePln: 0, marketCurrency: "PLN", provider: "yahoo", latestPrice: 550, createdAt: "" },
    // BTC without a quote: its cost counts, no value or result.
    { id: "btc", name: "Bitcoin", symbol: "BTC", kind: "crypto", purchaseDate: "2026-01-04", quantity: 0.01, purchasePrice: 300000, purchaseCurrency: "PLN", feePln: 0, marketCurrency: "PLN", provider: "coingecko", createdAt: "" },
  ],
  sales: [
    { id: "msft", assetKey: "MSFT", name: "Microsoft", symbol: "MSFT", kind: "stock", transactionKind: "sale", quantity: 5, salePrice: 300, saleDate: "2026-02-01", feePln: 6, marketCurrency: "USD", provider: "yahoo",
      realizedInvestedPln: 4004, realizedProceedsPln: 6594, realizedProfitLossPln: 2590, createdAt: "", allocations: [] },
    { id: "edo", assetKey: "EDO0135", name: "EDO", symbol: "EDO0135", kind: "bond", transactionKind: "bond-redemption", quantity: 10, salePrice: 112, saleDate: "2026-02-10", feePln: 0, marketCurrency: "PLN", provider: "obligacjeskarbowe",
      realizedInvestedPln: 1000, realizedProceedsPln: 1097.2, realizedProfitLossPln: 97.2, createdAt: "", allocations: [] },
  ],
  realizedAdjustments: [
    { id: "manual", amount: 50, currency: "PLN", amountPlnSnapshot: 50, date: "2025-12-01", source: "manual", createdAt: "" },
    { id: "coupon", amount: 30, currency: "PLN", amountPlnSnapshot: 30, date: "2026-02-01", source: "bond-coupon", createdAt: "" },
  ],
  accounts: [account("p:account:cash:PLN", "Gotówka PLN", true), account("p:account:xtb:1:PLN", "XTB PLN 1"), account("p:account:xtb:2:USD", "XTB USD 2")],
  instruments: [{ id: "inst-aapl", portfolioId: "p", type: "STOCK", assetKind: "stock", symbol: "AAPL", name: "Apple", marketCurrency: "USD", metadata: {}, createdAt: "", updatedAt: "" }],
  operations: [
    op("buy-aapl", "BUY", "p:account:xtb:2:USD", { lotId: "aapl" }),
    op("buy-vwce", "BUY", "p:account:xtb:1:PLN", { lotId: "vwce" }),
    op("sell-msft", "SELL", "p:account:xtb:2:USD", { saleId: "msft" }),
    // Dividend 10 USD at 4.00, 15% withheld: net 8.5 × 4 = 34 PLN.
    op("div", "DIVIDEND", "p:account:xtb:2:USD", { kind: "dividend", grossAmount: 10, withholdingTax: 1.5, domesticTax: 0, netAmount: 8.5, paymentDate: "2026-03-02" },
      { assetId: "inst-aapl", currency: "USD", exchangeRate: 4, quantity: 10, price: 1, amount: 8.5 }),
  ],
};

const byKey = (report) => Object.fromEntries(report.rows.map((row) => [row.key, row]));

test("the result by kind of investment adds open, sold, added results and dividends", () => {
  const report = buildProfitByType([portfolio], fxRates);
  const rows = byKey(report);

  assert.deepEqual(report.rows.map((row) => row.key), ["stock", "etf", "crypto", "bond", "other"]);
  assert.equal(rows.stock.openProfitPln, 1392);
  assert.equal(rows.stock.realizedProfitPln, 2590);
  assert.equal(rows.stock.dividendsPln, 34);
  assert.equal(rows.stock.totalProfitPln, 1392 + 2590 + 34);
  assert.equal(rows.stock.returnPercent, Math.round(((1392 + 2590 + 34) / (4008 + 4004)) * 10000) / 100);
  assert.equal(rows.etf.totalProfitPln, 100);
  assert.equal(rows.crypto.valuePln, 0, "a holding without a quote has no value yet");
  assert.equal(rows.crypto.openCostPln, 3000);
  assert.equal(rows.bond.realizedProfitPln, 97.2 + 30, "a coupon stays with the bonds");
  assert.equal(rows.other.realizedProfitPln, 50);
  assert.equal(report.total.totalProfitPln, 1392 + 2590 + 34 + 100 + 127.2 + 50);
  assert.equal(report.total.openPositions, 3);
});

test("the result by account follows the account of the operation recorded with each trade", () => {
  const report = buildProfitByAccount([portfolio], fxRates);
  const rows = byKey(report);

  assert.equal(rows["p|p:account:xtb:2:USD"].label, "XTB USD 2");
  assert.equal(rows["p|p:account:xtb:2:USD"].totalProfitPln, 1392 + 2590 + 34);
  assert.equal(rows["p|p:account:xtb:1:PLN"].totalProfitPln, 100);
  // The bitcoin bought without a broker operation, the bond and the added results stay on the main account.
  assert.equal(rows["p|default"].label, "Konto główne portfela");
  assert.equal(rows["p|default"].realizedProfitPln, 97.2 + 30 + 50);
  assert.equal(report.total.totalProfitPln, buildProfitByType([portfolio], fxRates).total.totalProfitPln, "the two reports add up to the same total");
});

test("with several portfolios the main account is named after its portfolio", () => {
  const second = { ...portfolio, id: "q", name: "IKE", operations: [], accounts: [], sales: [], realizedAdjustments: [] };
  const report = buildProfitByAccount([portfolio, second], fxRates);
  assert.ok(report.rows.some((row) => row.key === "q|default" && row.label === "IKE"));
});

test("holdings by account give each account's positions with their share", () => {
  const accounts = buildHoldingsByAccount([portfolio], fxRates);
  assert.deepEqual(accounts.map((item) => item.label), ["XTB USD 2", "XTB PLN 1"]);
  assert.equal(accounts[0].holdings[0].symbol, "AAPL");
  assert.equal(accounts[0].holdings[0].sharePercent, 100);
});

test("the heat map merges one instrument held in two portfolios and weights the daily change by value", () => {
  const group = (portfolioId, value, daily, invested) => ({ key: "AAPL", name: "Apple", symbol: "AAPL", totalValuePln: value, totalInvestedPln: invested, totalProfitLossPln: value - invested, hasBaseValuation: true, hasDailyChange: true, dailyChangePercent: daily, portfolioId });
  const cells = buildHeatmapCells([group("p", 3000, 2, 2000), group("q", 1000, -2, 1000), { ...group("p", 1000, 0, 1000), key: "PKN", symbol: "PKN" }]);

  assert.equal(cells.length, 2);
  assert.equal(cells[0].valuePln, 4000);
  assert.equal(cells[0].dailyChangePercent, 1, "(2 × 3000 − 2 × 1000) / 4000");
  assert.equal(cells[0].profitPercent, Math.round((1000 / 3000) * 10000) / 100);
  assert.equal(cells[0].sharePercent, 80);
});

const point = (date, value, daily) => ({ date, portfolioValuePln: value, netInvestedPln: 1000, profitLossPln: value - 1000, timeWeightedReturnPercent: null, dailyTimeWeightedReturnDecimal: daily });

test("period returns compound the daily cash-flow-neutral returns", () => {
  const points = [
    point("2026-01-30", 1000, null),
    point("2026-02-02", 1010, 0.01),
    point("2026-02-27", 1030, 0.02),
    point("2026-03-02", 1009.4, -0.02),
  ];
  const months = buildPeriodReturns(points, "month");
  assert.deepEqual(months.map((month) => [month.key, month.label, month.returnPercent]), [["2026-02", "lut 2026", 3.02], ["2026-03", "mar 2026", -2]]);

  const days = buildPeriodReturns(points, "day");
  assert.equal(days.length, 3);
  assert.equal(days[0].label, "2 lut 2026");

  const weeks = buildPeriodReturns(points, "week");
  assert.deepEqual(weeks.map((week) => week.key), ["2026-02-02", "2026-02-23", "2026-03-02"]);

  const stats = summarizePeriodReturns(days);
  assert.equal(stats.positive, 2);
  assert.equal(stats.negative, 1);
  assert.equal(stats.bestPercent, 2);
  assert.equal(stats.worstPercent, -2);
  assert.equal(summarizePeriodReturns([]), null);
});

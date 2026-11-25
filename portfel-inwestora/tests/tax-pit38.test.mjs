import assert from "node:assert/strict";
import test from "node:test";

const { buildPit38Report, collectPit38RateNeeds, createRateBefore, roundToWholeZloty } = await import("../src/lib/tax-pit38.ts");

// Hand-checked example. NBP rates are chosen so every conversion is easy to verify; a rate on the
// transaction day itself (9.99) must never be used, only the last business day before it.
const usd = [
  { date: "2025-10-31", rate: 3.7 },
  { date: "2026-01-14", rate: 4.0 },
  { date: "2026-02-11", rate: 4.0 },
  { date: "2026-03-09", rate: 4.1 },
  { date: "2026-03-10", rate: 9.99 },
  { date: "2026-03-31", rate: 4.0 },
  { date: "2026-06-09", rate: 4.0 },
  { date: "2026-06-30", rate: 4.0 },
];
const rateBefore = createRateBefore(new Map([["USD", usd]]));

const lot = (purchaseDate, quantity, purchasePrice, currency, allocatedBuyFeePln, extra = {}) => ({
  lotId: `lot-${purchaseDate}-${quantity}`,
  quantity,
  purchaseDate,
  purchasePrice,
  purchaseCurrency: currency,
  purchasePriceCurrency: currency,
  allocatedBuyFeePln,
  investedPln: 0,
  ...extra,
});

const sale = (id, fields) => ({
  id,
  assetKey: id,
  transactionKind: "sale",
  kind: "stock",
  realizedInvestedPln: 0,
  realizedProceedsPln: 0,
  realizedProfitLossPln: 0,
  provider: "yahoo",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...fields,
});

const portfolio = (id, name, sales, extra = {}) => ({
  id,
  name,
  accountType: "STANDARD",
  assets: [],
  sales,
  realizedAdjustments: [],
  operations: [],
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const main = portfolio(
  "p-main",
  "Główny",
  [
    sale("aapl", {
      name: "Apple", symbol: "AAPL", saleDate: "2026-03-10", quantity: 10, salePrice: 200, marketCurrency: "USD", feePln: 5,
      allocations: [lot("2025-11-03", 6, 150, "USD", 3), lot("2026-01-15", 4, 180, "USD", 2)],
    }),
    sale("pkn", {
      name: "Orlen", symbol: "PKN.PL", saleDate: "2026-05-05", quantity: 100, salePrice: 70, marketCurrency: "PLN", feePln: 4,
      allocations: [lot("2025-02-01", 100, 60, "PLN", 3)],
    }),
    sale("us500-short", {
      name: "US500", symbol: "US500", instrumentType: "CFD", positionDirection: "SHORT", saleDate: "2026-06-10", quantity: 1, salePrice: 5000, marketCurrency: "USD", feePln: 0,
      allocations: [lot("2026-06-01", 1, 5100, "USD", 0)],
    }),
    sale("oil-long", {
      name: "OIL", symbol: "OIL", instrumentType: "CFD", saleDate: "2026-07-01", quantity: 2, salePrice: 90, marketCurrency: "USD", feePln: 1,
      allocations: [lot("2026-06-20", 2, 100, "USD", 0)],
    }),
    sale("edo", { name: "EDO0135", symbol: "EDO0135", kind: "bond", transactionKind: "bond-redemption", saleDate: "2026-08-01", quantity: 10, salePrice: 110, marketCurrency: "PLN", feePln: 0, allocations: [] }),
    sale("btc", { name: "Bitcoin", symbol: "BTC", kind: "crypto", saleDate: "2026-09-01", quantity: 0.1, salePrice: 300000, marketCurrency: "PLN", feePln: 0, allocations: [] }),
    sale("old", { name: "Old", symbol: "OLD", saleDate: "2025-12-30", quantity: 1, salePrice: 10, marketCurrency: "PLN", feePln: 0, allocations: [lot("2025-01-02", 1, 5, "PLN", 0)] }),
  ],
  {
    realizedAdjustments: [
      { id: "imp", amount: 120, currency: "PLN", amountPlnSnapshot: 120, date: "2026-04-04", source: "broker-import", note: "Zamknięta pozycja bez danych otwarcia: XYZ", createdAt: "2026-04-04T00:00:00.000Z" },
      { id: "coupon", amount: 50, currency: "PLN", amountPlnSnapshot: 50, date: "2026-04-05", source: "bond-coupon", createdAt: "2026-04-05T00:00:00.000Z" },
    ],
  }
);
const ike = portfolio("p-ike", "IKE", [
  sale("ike-sale", { name: "CDR", symbol: "CDR.PL", saleDate: "2026-02-02", quantity: 1, salePrice: 100, marketCurrency: "PLN", feePln: 0, allocations: [lot("2025-02-02", 1, 50, "PLN", 0)] }),
], { accountType: "IKE" });

const dividend = (id, fields) => ({
  id, portfolioId: "p-main", accountId: "a", accountName: "a", instrumentId: id, quantity: 1, dividendPerShare: 1,
  domesticTax: 0, netAmount: 0, exchangeRate: null, grossAmountPln: 0, netAmountPln: 0, hasReliablePlnAnchor: false,
  exDividendDate: "", recordDate: "", notes: "", isAutomatic: false, operationId: id, createdAt: "", updatedAt: "",
  ...fields,
});
const dividendsByPortfolio = new Map([
  ["p-main", [
    dividend("d-aapl", { instrumentName: "Apple", symbol: "AAPL", grossAmount: 10, withholdingTax: 1.5, currency: "USD", paymentDate: "2026-02-12", country: "US" }),
    dividend("d-high-wht", { instrumentName: "Nestle", symbol: "NESN", grossAmount: 100, withholdingTax: 30, currency: "USD", paymentDate: "2026-04-01", country: "CH" }),
    dividend("d-pl", { instrumentName: "PZU", symbol: "PZU.PL", grossAmount: 50, withholdingTax: 0, domesticTax: 9.5, currency: "PLN", paymentDate: "2026-06-01", country: "PL" }),
  ]],
  ["p-ike", [dividend("d-ike", { portfolioId: "p-ike", instrumentName: "MSFT", symbol: "MSFT", grossAmount: 10, withholdingTax: 1.5, currency: "USD", paymentDate: "2026-02-12", country: "US" })]],
]);

const report = buildPit38Report({ portfolios: [main, ike], dividendsByPortfolio, year: 2026, rateBefore });

test("Polish tax rounding: below 50 gr down, from 50 gr up", () => {
  assert.equal(roundToWholeZloty(12.49), 12);
  assert.equal(roundToWholeZloty(12.5), 13);
  assert.equal(roundToWholeZloty(625.48), 625);
  assert.equal(roundToWholeZloty(0.49), 0);
});

test("the NBP rate is the one of the last business day before the transaction", () => {
  assert.deepEqual(rateBefore("USD", "2026-03-10"), { rate: 4.1, rateDate: "2026-03-09" });
  assert.deepEqual(rateBefore("USD", "2026-03-11"), { rate: 9.99, rateDate: "2026-03-10" });
  assert.equal(rateBefore("USD", "2025-10-31"), null, "no earlier point");
  assert.equal(rateBefore("EUR", "2026-03-10"), null, "unknown currency");
  // A point twelve days old means a gap in the series, not a weekend.
  assert.equal(createRateBefore(new Map([["USD", [{ date: "2026-01-01", rate: 4 }]]]))("USD", "2026-01-13"), null);
});

test("a foreign share sale: revenue at the sale's rate, each lot at its own purchase rate, fees as costs", () => {
  const aapl = report.securities.transactions.find((transaction) => transaction.id === "aapl");

  assert.equal(aapl.treatment, "shares");
  assert.equal(aapl.revenue.rate, 4.1);
  assert.equal(aapl.revenue.rateDate, "2026-03-09");
  assert.equal(aapl.revenuePln, 8200); // 10 × 200 USD × 4.10
  assert.deepEqual(aapl.purchases.map((purchase) => [purchase.amountPln, purchase.rateDate]), [[3330, "2025-10-31"], [2880, "2026-01-14"]]);
  assert.equal(aapl.feesPln, 10); // 3 + 2 buy, 5 sell
  assert.equal(aapl.costPln, 6220);
  assert.equal(aapl.incomePln, 1980);
});

test("CFDs: a profit is revenue, a loss and the fees are costs", () => {
  const short = report.securities.transactions.find((transaction) => transaction.id === "us500-short");
  const long = report.securities.transactions.find((transaction) => transaction.id === "oil-long");

  assert.equal(short.treatment, "derivative");
  assert.equal(short.revenuePln, 400); // (5100 − 5000) × 1 × 4.00
  assert.equal(short.costPln, 0);
  assert.equal(long.revenuePln, 0);
  assert.equal(long.costPln, 81); // (90 − 100) × 2 × 4.00 = −80, plus 1 PLN fee
});

test("part C totals, tax base and tax", () => {
  assert.equal(report.securities.transactions.length, 4);
  assert.equal(report.securities.revenuePln, 15600);
  assert.equal(report.securities.costPln, 12308);
  assert.equal(report.securities.incomePln, 3292);
  assert.equal(report.securities.lossPln, 0);
  assert.equal(report.securities.taxBasePln, 3292);
  assert.equal(report.securities.taxPln, 625); // 19% × 3292 = 625.48
});

test("foreign dividends: 19% less the tax withheld abroad, never more than 19% credited", () => {
  const rows = report.foreignDividends.rows;

  assert.deepEqual(rows.map((row) => row.symbol), ["AAPL", "NESN"], "Polish dividends and tax-free portfolios are left out");
  assert.equal(rows[0].gross.amountPln, 40);
  assert.equal(rows[0].polishTaxPln, 7.6);
  assert.equal(rows[0].creditablePln, 6);
  assert.equal(rows[0].toPayPln, 1.6);
  assert.equal(rows[1].creditablePln, 76, "30% withheld, only 19% credited");
  assert.equal(rows[1].toPayPln, 0);
  assert.equal(report.foreignDividends.toPayPln, 2);
});

test("what is left out is said, not silently dropped", () => {
  assert.deepEqual(report.excluded.taxFreePortfolios, ["IKE"]);
  assert.equal(report.excluded.bondTrades, 1);
  assert.equal(report.excluded.cryptoTrades, 1);
  assert.deepEqual(report.excluded.importedResults.map((item) => item.amountPln), [120]);
  assert.ok(!report.securities.transactions.some((transaction) => transaction.id === "old"), "another year");
  assert.deepEqual(report.missingRates, []);
});

test("a missing NBP rate is reported instead of counting the amount as zero silently", () => {
  const gbp = portfolio("p-gbp", "GBP", [
    sale("vod", { name: "Vodafone", symbol: "VOD.L", saleDate: "2026-03-10", quantity: 1, salePrice: 1, marketCurrency: "GBP", feePln: 0, allocations: [lot("2026-01-15", 1, 1, "GBP", 0)] }),
  ]);
  const result = buildPit38Report({ portfolios: [gbp], dividendsByPortfolio: new Map(), year: 2026, rateBefore });

  assert.deepEqual(result.missingRates, [{ currency: "GBP", date: "2026-01-15" }, { currency: "GBP", date: "2026-03-10" }]);
});

test("the rates to fetch are collected once per currency", () => {
  const needs = collectPit38RateNeeds([main, ike], dividendsByPortfolio, 2026);

  assert.deepEqual([...needs.keys()], ["USD"]);
  assert.deepEqual([...needs.get("USD")].sort(), ["2025-11-03", "2026-01-15", "2026-02-12", "2026-03-10", "2026-04-01", "2026-06-10", "2026-07-01"]);
});

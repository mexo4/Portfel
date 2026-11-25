import assert from "node:assert/strict";
import test from "node:test";

const { buildProfitBreakdown } = await import("../src/lib/profit-breakdown.ts");

const fxRates = { PLN: 1, USD: 4.5 };
const op = (id, operationType, amount, extra = {}) => ({
  id, portfolioId: "p", accountId: "cash", assetId: null, operationType, quantity: null, price: null, currency: "PLN",
  exchangeRate: 1, fee: 0, tax: 0, amount, date: "2026-03-01", notes: "", metadata: { kind: "cash", cashImpact: true, ...(extra.metadata ?? {}) },
  createdAt: "", updatedAt: "", ...extra, ...(extra.metadata ? { metadata: { kind: "cash", cashImpact: true, ...extra.metadata } } : {}),
});

const portfolio = {
  id: "p", name: "Główny", createdAt: "", updatedAt: "",
  assets: [
    { id: "aapl", name: "Apple", symbol: "AAPL", kind: "stock", purchaseDate: "2026-01-02", quantity: 10, purchasePrice: 100, purchaseCurrency: "USD", purchasePriceCurrency: "USD", purchaseFxRateToPln: 4, feePln: 8, marketCurrency: "USD", provider: "yahoo", latestPrice: 120, createdAt: "" },
    { id: "pkn", name: "Orlen", symbol: "PKN.PL", kind: "stock", purchaseDate: "2026-01-02", quantity: 10, purchasePrice: 50, purchaseCurrency: "PLN", feePln: 2, marketCurrency: "PLN", provider: "yahoo", latestPrice: 60, createdAt: "" },
  ],
  sales: [
    { id: "msft", assetKey: "msft", name: "Microsoft", symbol: "MSFT", kind: "stock", transactionKind: "sale", quantity: 5, salePrice: 300, saleDate: "2026-02-01", feePln: 6, marketCurrency: "USD", provider: "yahoo",
      realizedInvestedPln: 4004, realizedProceedsPln: 6594, realizedProfitLossPln: 2590, createdAt: "",
      allocations: [{ lotId: "m1", quantity: 5, purchaseDate: "2026-01-05", purchasePrice: 200, purchaseCurrency: "USD", purchasePriceCurrency: "USD", purchaseFxRateToPln: 4, allocatedBuyFeePln: 4, investedPln: 4004 }] },
    { id: "edo", assetKey: "edo", name: "EDO", symbol: "EDO0135", kind: "bond", transactionKind: "bond-redemption", quantity: 10, salePrice: 112, saleDate: "2026-02-10", feePln: 0, marketCurrency: "PLN", provider: "manual",
      realizedInvestedPln: 1000, realizedProceedsPln: 1097.2, realizedProfitLossPln: 97.2, grossProfitLossPln: 120, taxTotalPln: 22.8, createdAt: "", allocations: [] },
  ],
  realizedAdjustments: [
    { id: "manual", amount: 50, currency: "PLN", amountPlnSnapshot: 50, date: "2025-12-01", source: "manual", createdAt: "" },
    { id: "coupon", amount: 30, currency: "PLN", amountPlnSnapshot: 30, date: "2026-02-01", source: "bond-coupon", createdAt: "" },
  ],
  accounts: [{ id: "cash", portfolioId: "p", name: "Gotówka PLN", kind: "cash", currency: "PLN", isDefault: true, metadata: {}, createdAt: "", updatedAt: "" }],
  instruments: [{ id: "inst-aapl", portfolioId: "p", type: "STOCK", assetKind: "stock", symbol: "AAPL", name: "Apple", marketCurrency: "USD", metadata: {}, createdAt: "", updatedAt: "" }],
  operations: [
    { ...op("div", "DIVIDEND", 10), assetId: "inst-aapl", currency: "USD", exchangeRate: 4, quantity: 10, price: 1, paymentDate: "2026-03-02",
      metadata: { kind: "dividend", cashImpact: true, grossAmount: 10, withholdingTax: 1.5, domesticTax: 0, netAmount: 8.5, paymentDate: "2026-03-02" } },
    op("interest", "INTEREST", 12),
    op("fee", "FEE", 5),
    op("linked-fee", "FEE", 3, { metadata: { linkedFeeImportKey: "xtb:123" } }),
    op("tax", "TAX", 4),
    op("correction", "CUSTOM", -7),
  ],
};

const bySource = (breakdown) => Object.fromEntries(breakdown.sources.map((item) => [item.key, item.amountPln]));

test("an open foreign position splits into price, currency and commission, adding up to its result", () => {
  const sources = bySource(buildProfitBreakdown({ portfolios: [portfolio], fxRates }));

  // AAPL: price (120 − 100) × 10 × 4.00 = 800, currency 120 × 10 × (4.50 − 4.00) = 600, fee −8.
  // PKN (PLN): price 100, no currency effect, fee −2.
  assert.equal(sources["open-price"], 900);
  assert.equal(sources["open-fx"], 600);
  assert.equal(sources["open-fees"], -10);
});

test("a sold position splits the same way, and a bond redemption keeps its tax apart", () => {
  const sources = bySource(buildProfitBreakdown({ portfolios: [portfolio], fxRates }));

  // MSFT: price (300 − 200) × 5 × 4.00 = 2000, currency 2590 + 10 − 2000 = 600, fees −10.
  assert.equal(sources["realized-price"], 2000);
  assert.equal(sources["realized-fx"], 600);
  assert.equal(sources["realized-fees"], -10);
  assert.equal(sources.bonds, 150, "120 PLN gross redemption result and a 30 PLN coupon");
});

test("income and costs outside the nominal result are listed, a commission linked to a trade is not counted twice", () => {
  const sources = bySource(buildProfitBreakdown({ portfolios: [portfolio], fxRates }));

  assert.equal(sources["manual-results"], 50);
  assert.equal(sources.dividends, 40);
  assert.equal(sources["dividend-tax"], -6);
  assert.equal(sources.interest, 12);
  assert.equal(sources["cash-fees"], -5, "the 3 PLN commission imported with a trade is already in its cost");
  assert.equal(sources.taxes, -26.8, "4 PLN tax operation and 22.80 PLN withheld at bond redemption");
  assert.equal(sources["cash-corrections"], -7);
});

test("totals, and a remainder that closes the gap to the flows-based result", () => {
  const breakdown = buildProfitBreakdown({ portfolios: [portfolio], fxRates, flowsProfitLossPln: 4300 });

  // Open 1490, sold 2590, bonds 150, manual 50: what the summary shows as the nominal result.
  assert.equal(breakdown.nominalPln, 4280);
  assert.equal(breakdown.explainedPln, 4287.2);
  assert.equal(breakdown.sources.at(-1).key, "remainder");
  assert.equal(breakdown.sources.at(-1).amountPln, 12.8);
  assert.ok(!bySource(buildProfitBreakdown({ portfolios: [portfolio], fxRates })).remainder, "no remainder without a flows-based result");
});

test("the position group equals the nominal result computed by the summary engine", async () => {
  const { getPortfolioSummary } = await import("../src/lib/portfolio-engine.ts");
  const summary = getPortfolioSummary(portfolio.assets, portfolio.sales, portfolio.realizedAdjustments, fxRates);
  const breakdown = buildProfitBreakdown({ portfolios: [portfolio], fxRates });

  assert.equal(breakdown.nominalPln, summary.combinedProfitLossPln);
});

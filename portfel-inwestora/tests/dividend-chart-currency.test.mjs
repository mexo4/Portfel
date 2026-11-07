import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDividendChartSourceBreakdown,
  getDividendChartCurrencyLines,
} from "../src/lib/dividend-chart-currency.ts";

const dividend = (overrides = {}) => ({
  paymentDate: "2026-09-10",
  portfolioId: "usd-account",
  currency: "USD",
  netAmount: 12.5,
  grossAmount: 15,
  netAmountPln: 50,
  grossAmountPln: 60,
  hasReliablePlnAnchor: true,
  ...overrides,
});

test("chart keeps USD source dividend and its PLN anchor separate for a USD portfolio", () => {
  const breakdown = buildDividendChartSourceBreakdown([dividend()], "net", (item) => item.portfolioId);

  assert.deepEqual(breakdown["2026-09"]["usd-account"].USD, {
    amount: 12.5,
    amountPln: 50,
    hasReliablePlnAnchor: true,
  });

  const [line] = getDividendChartCurrencyLines(
    breakdown["2026-09"]["usd-account"],
    "PLN",
    { PLN: 1, USD: 4 },
    ["PLN", "USD"],
  );
  assert.equal(line.sourceCurrency, "USD");
  assert.equal(line.amount, 12.5);
  assert.equal(line.presentationEquivalent, 50);
});

test("chart exposes PLN source first with verified USD presentation equivalent", () => {
  const breakdown = buildDividendChartSourceBreakdown([
    dividend({ currency: "PLN", netAmount: 200, netAmountPln: 200, grossAmount: 240, grossAmountPln: 240 }),
  ], "gross", (item) => item.portfolioId);
  const [line] = getDividendChartCurrencyLines(
    breakdown["2026-09"]["usd-account"],
    "USD",
    { PLN: 1, USD: 4 },
    ["PLN", "USD"],
  );

  assert.equal(line.sourceCurrency, "PLN");
  assert.equal(line.amount, 240);
  assert.equal(line.presentationEquivalent, 60);
});

test("different source currencies stay in separate chart tooltip rows", () => {
  const breakdown = buildDividendChartSourceBreakdown([
    dividend(),
    dividend({ currency: "PLN", netAmount: 40, netAmountPln: 40 }),
  ], "net", (item) => item.portfolioId);
  const lines = getDividendChartCurrencyLines(
    breakdown["2026-09"]["usd-account"],
    "PLN",
    { PLN: 1, USD: 4 },
    ["PLN", "USD"],
  );

  assert.deepEqual(lines.map((line) => line.sourceCurrency), ["PLN", "USD"]);
  assert.equal(lines[0].amount, 40);
  assert.equal(lines[1].amount, 12.5);
});

test("chart does not claim a secondary currency conversion without a reliable historical anchor", () => {
  const breakdown = buildDividendChartSourceBreakdown([
    dividend({ hasReliablePlnAnchor: false }),
  ], "net", (item) => item.portfolioId);
  const [line] = getDividendChartCurrencyLines(
    breakdown["2026-09"]["usd-account"],
    "PLN",
    { PLN: 1, USD: 4 },
    ["PLN", "USD"],
  );

  assert.equal(line.amount, 12.5);
  assert.equal(line.presentationEquivalent, null);
});

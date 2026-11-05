import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDividendTotals } from "../src/lib/dividend-engine.ts";

const fxRates = { PLN: 1, USD: 4, EUR: 4.3, GBP: 5, DKK: 0.58 };

test("aggregate dividend totals convert mixed PLN and USD payments to display currency", () => {
  const dividends = [
    { currency: "PLN", grossAmountPln: 100, netAmountPln: 80 },
    // A USD payment is stored in PLN using its transaction-time exchange rate.
    { currency: "USD", grossAmountPln: 40, netAmountPln: 32 },
  ];

  assert.deepEqual(summarizeDividendTotals(dividends, "PLN", fxRates), {
    gross: 140,
    net: 112,
    taxes: 28,
    paymentsCount: 2,
  });
  assert.deepEqual(summarizeDividendTotals(dividends, "USD", fxRates), {
    gross: 35,
    net: 28,
    taxes: 7,
    paymentsCount: 2,
  });
});

test("aggregate dividend totals are zero for an empty selected scope", () => {
  assert.deepEqual(summarizeDividendTotals([], "PLN", fxRates), {
    gross: 0,
    net: 0,
    taxes: 0,
    paymentsCount: 0,
  });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getIncomePresentationEquivalent } from "../src/lib/income-currency.ts";

const rates = { PLN: 1, USD: 4, EUR: 4.3 };
const verified = ["PLN", "USD", "EUR"];

test("dividend display equivalent converts source currency into presentation currency", () => {
  assert.equal(getIncomePresentationEquivalent({
    amount: 12.5,
    sourceCurrency: "USD",
    presentationCurrency: "PLN",
    fxRates: rates,
    verifiedCurrencies: verified,
  }), 50);

  assert.equal(getIncomePresentationEquivalent({
    amount: 200,
    sourceCurrency: "PLN",
    presentationCurrency: "USD",
    fxRates: rates,
    verifiedCurrencies: verified,
  }), 50);

  assert.equal(getIncomePresentationEquivalent({
    amount: 10,
    sourceCurrency: "USD",
    presentationCurrency: "EUR",
    fxRates: rates,
    verifiedCurrencies: verified,
  }), 10 * 4 / 4.3);
});

test("same currency is not duplicated and historical PLN anchor is used for the equivalent", () => {
  assert.equal(getIncomePresentationEquivalent({
    amount: 12.5,
    sourceCurrency: "USD",
    presentationCurrency: "USD",
    fxRates: rates,
    verifiedCurrencies: verified,
  }), null);

  assert.equal(getIncomePresentationEquivalent({
    amount: 25,
    sourceCurrency: "USD",
    presentationCurrency: "USD",
    fxRates: rates,
    amountInPln: 100,
    verifiedCurrencies: verified,
  }), null);

  assert.equal(getIncomePresentationEquivalent({
    amount: 25,
    sourceCurrency: "EUR",
    presentationCurrency: "USD",
    fxRates: rates,
    amountInPln: 100,
    verifiedCurrencies: ["PLN", "USD"],
  }), 25);
});

test("fallback-only and absent FX never produce a fabricated zero or equivalent", () => {
  const fallbackOnlyRates = { PLN: 1, USD: 4, EUR: 4.3 };
  assert.equal(getIncomePresentationEquivalent({
    amount: 10,
    sourceCurrency: "USD",
    presentationCurrency: "PLN",
    fxRates: fallbackOnlyRates,
    verifiedCurrencies: ["PLN"],
  }), null);

  assert.equal(getIncomePresentationEquivalent({
    amount: 10,
    sourceCurrency: "USD",
    presentationCurrency: "EUR",
    fxRates: { PLN: 1 },
    verifiedCurrencies: ["PLN"],
  }), null);

  assert.equal(getIncomePresentationEquivalent({
    amount: 10,
    sourceCurrency: "USD",
    presentationCurrency: "PLN",
    fxRates: rates,
    verifiedCurrencies: verified,
  }), 40);
});

test("single and aggregate income views render source-first pairs and keep watchlist estimates hidden", async () => {
  const [cash, dashboard, route, upcoming] = await Promise.all([
    readFile(new URL("../src/components/DividendCashWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DividendIncomeDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/WorkspaceRouteViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/UpcomingDividendsPanel.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(cash, /dividend-payment-card-amount/);
  assert.match(cash, /amountInPln=\{dividend\.netAmountPln\}/);
  assert.match(dashboard, /amountInPln=\{forecast\.nextPayment\.netAmountPln\}/);
  assert.match(route, /presentationCurrency=\{workspace\.presentationCurrency\} fxRates=\{workspace\.fxRates\}/);
  assert.match(route, /suffix="netto"/);
  assert.match(upcoming, /!isWatchlistOnly && event\.estimatedGrossAmount !== undefined/);
  assert.match(upcoming, /Szacowana dywidenda brutto/);
  assert.match(upcoming, /Szacowany podatek/);
  assert.match(upcoming, /Szacowana dywidenda netto/);
});

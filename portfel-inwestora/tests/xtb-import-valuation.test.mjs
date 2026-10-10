import assert from "node:assert/strict";
import test from "node:test";
import {
  compareImportedBrokerOperations,
  getImportedStatementAccount,
  getImportedStandaloneExpense,
  getStoredImportedOperationKeys,
  prepareXtbImportOperations,
  requireImportedHistoricalFxRate,
  resolveImportedTradeValuation,
} from "../src/lib/xtb-import-valuation.ts";

const trade = (patch = {}) => ({
  rowNumber: 7, date: "2024-02-05", symbol: "AAPL.US", name: "Apple", kind: "stock",
  operationType: "BUY", quantity: 2, price: 100, marketAmount: 200,
  currency: "USD", marketCurrency: "USD", cashCurrency: "PLN", accountCurrency: "PLN",
  cashAmount: 820, amount: 820, feePln: 0, fee: 0, broker: "XTB", provider: "catalog",
  ...patch,
});

test("XTB newest-first rows sort by actual intraday execution time", () => {
  const sell = trade({ rowNumber: 1, operationType: "SELL", rawTime: "05.02.2024 14:30:00" });
  const buy = trade({ rowNumber: 2, rawTime: "05.02.2024 09:15:00" });
  assert.deepEqual([sell, buy].sort(compareImportedBrokerOperations), [buy, sell]);
  const excelSell = trade({ rowNumber: 1, operationType: "SELL", rawTime: "45327.75" });
  const excelBuy = trade({ rowNumber: 2, rawTime: "45327.375" });
  assert.deepEqual([excelSell, excelBuy].sort(compareImportedBrokerOperations), [excelBuy, excelSell]);
});

test("standalone XTB commission and swap retain investment expense without another cash operation", () => {
  assert.equal(getImportedStandaloneExpense(trade({ operationType: "FEE", rawType: "Commission", amount: 5, fee: 5 })), -5);
  assert.equal(getImportedStandaloneExpense(trade({ operationType: "FEE", rawType: "swap", amount: 3, financing: 3 })), -3);
  assert.equal(getImportedStandaloneExpense(trade({ operationType: "TAX", amount: 5 })), undefined);
  assert.equal(getImportedStandaloneExpense(trade({ broker: "generic", operationType: "FEE", amount: 5 })), undefined);
});

test("exact single-trade commission linkage allocates cost while preserving separate cash fee", () => {
  const operation = trade({ accountNumber: "123", rawSymbol: "AAPL.US", rawTime: "05.02.2024 10:00:00", importKey: "buy" });
  const fee = trade({ operationType: "FEE", rawType: "Commission", accountNumber: "123", rawSymbol: "AAPL.US", rawTime: "05.02.2024 10:00:00", importKey: "fee", amount: 5, fee: 5 });
  const [preparedBuy, preparedFee] = prepareXtbImportOperations([operation, fee]);
  assert.equal(resolveImportedTradeValuation(preparedBuy, {}).totalFeePln, 5);
  assert.equal(preparedBuy.fee, 0);
  assert.equal(preparedFee.amount, 5);
  assert.equal(preparedFee.linkedFeeImportKey, "buy");
  assert.equal(getImportedStandaloneExpense(preparedFee), undefined);
  const repeated = prepareXtbImportOperations([operation, { ...operation }, fee, { ...fee }]);
  assert.equal(resolveImportedTradeValuation(repeated[0], {}).totalFeePln, 5);
  assert.equal(repeated[3].linkedFeeImportKey, "buy");
});

test("ambiguous or date-only commissions remain explicit unallocated expenses", () => {
  const operation = trade({ accountNumber: "123", rawSymbol: "AAPL.US", rawTime: "05.02.2024 10:00:00", importKey: "buy" });
  const fee = trade({ operationType: "FEE", rawType: "Commission", accountNumber: "123", rawSymbol: "AAPL.US", rawTime: "05.02.2024 10:00:00", importKey: "fee", amount: 5, fee: 5 });
  const prepared = prepareXtbImportOperations([operation, { ...operation, importKey: "buy2" }, fee]);
  assert.equal(prepared[0].linkedCommissionAmount, undefined);
  assert.equal(getImportedStandaloneExpense(prepared[2]), -5);
  assert.match(prepared[2].importWarning, /jednoznacznie/);
  const dateOnly = prepareXtbImportOperations([{ ...operation, rawTime: operation.date }, { ...fee, rawTime: operation.date }]);
  assert.equal(dateOnly[0].linkedCommissionAmount, undefined);
});

test("legacy imported broker IDs dedupe across formatting changes and prevent new cost attribution", () => {
  const keys = getStoredImportedOperationKeys([{ metadata: { importSource: "XTB", accountNumber: "123", brokerOperationId: "5", importKey: "old-format" } }]);
  assert.ok(keys.has("xtb:v2:123:5"));
  const operation = trade({ accountNumber: "123", rawSymbol: "AAPL.US", rawTime: "05.02.2024 10:00:00", brokerOperationId: "5", importKey: "xtb:v2:123:5" });
  const fee = trade({ operationType: "FEE", rawType: "Commission", accountNumber: "123", rawSymbol: "AAPL.US", rawTime: "05.02.2024 10:00:00", importKey: "fee", amount: 5, fee: 5 });
  const prepared = prepareXtbImportOperations([operation, fee], keys);
  assert.equal(prepared[0].linkedCommissionAmount, undefined);
  assert.equal(getImportedStandaloneExpense(prepared[1]), -5);
});

test("partially imported consumed tax or P/L leg fails before a new merged operation is saved", () => {
  const dividend = trade({ operationType: "DIVIDEND", importKey: "dividend", legacyImportKeys: ["dividend-old", "tax"], consumedSourceImportKeys: ["tax"] });
  assert.throws(() => prepareXtbImportOperations([dividend], new Set(["tax"])), /część powiązanej operacji XTB/);
  assert.doesNotThrow(() => prepareXtbImportOperations([dividend], new Set(["dividend-old", "tax"])));
});

test("XTB uses actual PLN settlement rather than current FX for historic purchase", () => {
  const result = resolveImportedTradeValuation(trade(), {});
  assert.equal(result.purchaseFxRateToPln, 4.1);
  assert.equal(result.settlementFxRateToPln, 1);
  assert.equal(Math.round(result.unitPrice * 2 * result.purchaseFxRateToPln * 100) / 100, 820);
  assert.equal(result.priceCurrency, "USD");
});

test("statement amounts override an incorrect inherited 1:1 rate", () => {
  const result = resolveImportedTradeValuation(trade({ exchangeRate: 1 }), {});
  assert.equal(result.purchaseFxRateToPln, 4.1);
});

test("USD purchase on EUR account uses settlement historical anchor exactly once", () => {
  const result = resolveImportedTradeValuation(
    trade({ cashCurrency: "EUR", accountCurrency: "EUR", cashAmount: 180, amount: 180, exchangeRate: 0.9 }),
    { EUR: 4.5, USD: 4.2 }
  );
  assert.equal(result.settlementFxRateToPln, 4.5);
  assert.equal(result.purchaseFxRateToPln, 4.05);
  assert.equal(result.unitPrice * 2 * result.purchaseFxRateToPln, 810);
});

test("PLN USD EUR GBP same-currency statements preserve native prices and dated FX", () => {
  for (const [currency, rate] of [["PLN", 1], ["USD", 3.9], ["EUR", 4.4], ["GBP", 5.1]]) {
    const result = resolveImportedTradeValuation(
      trade({ currency, marketCurrency: currency, cashCurrency: currency, accountCurrency: currency, cashAmount: 200 }),
      { [currency]: rate }
    );
    assert.equal(result.unitPrice, 100);
    assert.equal(result.priceCurrency, currency);
    assert.equal(result.purchaseFxRateToPln, rate);
  }
});

test("native commission and financing convert once using dated settlement FX", () => {
  const result = resolveImportedTradeValuation(
    trade({ cashCurrency: "USD", accountCurrency: "USD", cashAmount: 200, fee: 2, financing: 0.5 }),
    { USD: 4.1 }
  );
  assert.equal(result.totalFeePln, 10.25);
});

test("missing historical anchor fails clearly without guessed parity or current rates", () => {
  assert.throws(
    () => resolveImportedTradeValuation(trade({ cashCurrency: "GBP", accountCurrency: "GBP" }), {}),
    /Wiersz 7.*2024-02-05.*brak historycznego kursu GBP\/PLN/
  );
  assert.throws(() => requireImportedHistoricalFxRate("USD", {}, trade()), /nie użyto kursu bieżącego ani 1:1/);
});

test("CFD result cash does not become the underlying conversion rate", () => {
  const result = resolveImportedTradeValuation(
    trade({ instrumentType: "CFD", cashCurrency: "PLN", cashAmount: 12, exchangeRate: 0.06 }),
    { USD: 4.1 }
  );
  assert.equal(result.purchaseFxRateToPln, 4.1);
});

test("incoming XTB transfer creates only current statement account identity", () => {
  assert.deepEqual(getImportedStatementAccount(trade({
    operationType: "DEPOSIT", accountNumber: "222222", accountCurrency: "EUR",
    sourceAccountNumber: "111111", sourceCurrency: "USD",
  })), { accountNumber: "222222", currency: "EUR" });
  assert.deepEqual(getImportedStatementAccount(trade({
    broker: "generic", accountNumber: "222222", accountCurrency: "EUR",
    sourceAccountNumber: "111111", sourceCurrency: "USD",
  })), { accountNumber: "111111", currency: "USD" });
});

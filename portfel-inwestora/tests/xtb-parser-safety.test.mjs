import assert from "node:assert/strict";
import test from "node:test";
import { parseBrokerOperationsCsv, parseXtbCashOperationRows } from "../src/lib/import-operations.ts";

const parse = (entries, currency = "PLN", columns = []) => parseXtbCashOperationRows([
  ["Account number", "111111"],
  ["Currency", currency],
  ["ID", "Type", "Time", "Comment", "Symbol", "Amount", ...columns],
  ...entries,
], "synthetic XTB statement");

test("XTB cash Type identifies a real CLOSE BUY as a sale of a long holding", () => {
  const result = parse([
    ["buy", "Stock purchase", "08/10/2026 10:00:00", "OPEN BUY 10 @ 100", "PKN.PL", "-1000"],
    ["sell", "Stock sell", "08/10/2026 11:00:00", "CLOSE BUY 4 @ 120", "PKN.PL", "480"],
  ]);
  assert.equal(result.skippedRows.length, 0);
  assert.deepEqual(result.operations.map(o => [o.operationType, o.positionDirection, o.positionEffect]), [
    ["BUY", "LONG", "OPEN"], ["SELL", "LONG", "CLOSE"],
  ]);
});

test("XTB accepts scientific numeric cells without changing their magnitude", () => {
  const result = parseBrokerOperationsCsv("Type;Date;Symbol;Quantity;Price;Currency;Value\nBuy;08.10.2026;AAPL.US;1E-05;1E+05;USD;1", "generic");
  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.operations[0].quantity, 0.00001);
  assert.equal(result.operations[0].price, 100000);
  assert.equal(result.operations[0].amount, 1);
  const cash = parse([["deposit", "Deposit", "08/10/2026 10:00:00", "", "", "1E+05"]]);
  assert.equal(cash.operations[0].amount, 100000);
});

test("explicit statement account currency cannot be overridden by transfer votes", () => {
  const result = parse([
    ["deposit", "Deposit", "08/10/2026 09:00:00", "", "", "1000"],
    ...["a", "b", "c"].map(id => [id, "Transfer", "08/10/2026 10:00:00", "Currency conversion, USD to EUR, from TA: 222222 to: 333333, exchange rate: 0.9", "", "-100"]),
  ]);
  assert.equal(result.operations[0].currency, "PLN");
  assert.equal(result.operations[0].accountCurrency, "PLN");
});

test("verified exact ISAC and ISLN London lines import as USD without pence scaling", () => {
  const result = parse([
    ["isac", "Stock purchase", "08/10/2026 10:00:00", "OPEN BUY 1 @ 100", "ISAC.UK", "-400"],
    ["isln", "Stock purchase", "08/10/2026 10:01:00", "OPEN BUY 2 @ 50", "ISLN.UK", "-400"],
  ]);
  assert.equal(result.skippedRows.length, 0);
  for (const operation of result.operations) {
    assert.equal(operation.currency, "USD");
    assert.equal(operation.marketCurrency, "USD");
    assert.equal(operation.kind, "etf");
    assert.equal(operation.priceScale, 1);
    assert.equal(operation.exchangeRate, 4);
  }
});

test("explicit quote currency wins even when cash and market amounts happen to match", () => {
  const result = parse([["trade", "Stock purchase", "08/10/2026 10:00:00", "OPEN BUY 1 @ 100", "UNKNOWN.UK", "-100", "USD"]], "EUR", ["Price Currency"]);
  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.operations[0].marketCurrency, "USD");
  assert.equal(result.operations[0].cashCurrency, "EUR");
  assert.equal(result.operations[0].exchangeRate, 1);
});

test("broker IDs distinguish same-day equal transfers while retaining older import identities", () => {
  const result = parse(["a", "b"].map((id, index) => [id, "Transfer", `08/10/2026 10:0${index}:00`, "Transfer from 222222 to 111111", "", "100"]));
  assert.notEqual(result.operations[0].importKey, result.operations[1].importKey);
  assert.ok(result.operations.every(o => o.importKey.startsWith("xtb:v2:111111:")));
  assert.ok(result.operations.every(o => o.legacyImportKeys.some(key => key.startsWith("xtb-transfer:"))));
  assert.ok(result.operations.every(o => o.sourceAccountNumber === undefined));
  assert.ok(result.operations.every(o => o.counterpartyAccountNumber === "222222"));
});

test("a merged dividend tax and close-trade entry keep their consumed source identities", () => {
  const result = parse([
    ["sell", "Stock sell", "08/10/2026 10:00:00", "CLOSE BUY 4 @ 120", "PKN.PL", "400"],
    ["profit", "close trade", "08/10/2026 10:00:01", "", "PKN.PL", "80"],
    ["div", "Dividend", "08/10/2026 12:00:00", "PLN 2 / SHR", "PKN.PL", "20"],
    ["tax", "Withholding Tax", "08/10/2026 12:00:01", "", "PKN.PL", "-3.8"],
  ]);
  assert.equal(result.operations.length, 2);
  const sale = result.operations.find(o => o.operationType === "SELL");
  const dividend = result.operations.find(o => o.operationType === "DIVIDEND");
  assert.equal(sale.cashAmount, 480);
  assert.equal(sale.amount, 400);
  assert.ok(sale.legacyImportKeys.includes("xtb:v2:111111:profit"));
  assert.ok(dividend.legacyImportKeys.includes("xtb:v2:111111:tax"));
  assert.ok(sale.consumedSourceImportKeys.includes("xtb:v2:111111:profit"));
  assert.ok(dividend.consumedSourceImportKeys.includes("xtb:v2:111111:tax"));
});

test("recognized XTB tables with no valid amounts retain actionable skipped-row diagnostics", () => {
  const result = parse([["bad", "Stock purchase", "08/10/2026 10:00:00", "OPEN BUY 1 @ 100", "PKN.PL", "not-a-number"]]);
  assert.ok(result);
  assert.equal(result.operations.length, 0);
  assert.match(result.skippedRows[0].reason, /Amount/);
});

test("foreign declared dividend keeps ledger amounts in statement currency", () => {
  const result = parse([
    ["div", "Dividend", "08/10/2026 10:00:00", "USD 1 / SHR", "AAPL.US", "40"],
    ["tax", "Withholding Tax", "08/10/2026 10:00:01", "USD", "AAPL.US", "-6"],
  ]);
  const dividend = result.operations[0];
  assert.equal(dividend.currency, "PLN");
  assert.equal(dividend.cashCurrency, "PLN");
  assert.equal(dividend.marketCurrency, "USD");
  assert.equal(dividend.declaredCurrency, "USD");
  assert.equal(dividend.grossAmount, 40);
  assert.equal(dividend.tax, 6);
  assert.equal(dividend.netAmount, 34);
  assert.equal(dividend.quantity, 0);
  assert.equal(dividend.exchangeRate, undefined);
});

test("standalone fee preserves instrument identity and account currency for safe cost matching", () => {
  const fee = parse([["fee", "Commission", "08/10/2026 10:00:00", "", "ISAC.UK", "-4"]]).operations[0];
  assert.equal(fee.rawSymbol, "ISAC.UK");
  assert.equal(fee.symbol, "ISAC.L");
  assert.equal(fee.currency, "PLN");
  assert.equal(fee.fee, 4);
});

test("positive swap and commission credits are not reversed into expenses", () => {
  const result = parse([
    ["swap-credit", "Swap", "08/10/2026 10:00:00", "", "US100", "5"],
    ["rebate", "Commission", "08/10/2026 10:01:00", "", "PKN.PL", "2"],
  ]);
  assert.deepEqual(result.operations.map(o => [o.operationType, o.cashAmount, o.realizedProfitLoss, o.fee]), [
    ["CUSTOM", 5, 5, 0], ["CUSTOM", 2, 2, 0],
  ]);
});

test("missing statement currency produces an actionable error rather than assumed PLN", () => {
  const result = parseXtbCashOperationRows([
    ["Account number", "111111"],
    ["ID", "Type", "Time", "Comment", "Symbol", "Amount"],
    ["buy", "Stock purchase", "08/10/2026 10:00:00", "OPEN BUY 1 @ 100", "AAPL.US", "-100"],
  ], "synthetic XTB statement");
  assert.ok(result);
  assert.equal(result.operations.length, 0);
  assert.match(result.skippedRows[0].reason, /waluty rachunku/);
});

test("a conversion explicitly naming the statement account can establish its currency", () => {
  const result = parseXtbCashOperationRows([
    ["Account number", "111111"],
    ["ID", "Type", "Time", "Comment", "Symbol", "Amount"],
    ["deposit", "Deposit", "08/10/2026 09:00:00", "", "", "1000"],
    ["transfer", "Transfer", "08/10/2026 10:00:00", "Currency conversion, EUR to USD, from TA: 111111 to: 222222, exchange rate: 1.1", "", "-100"],
  ], "synthetic XTB statement");
  assert.equal(result.skippedRows.length, 0);
  assert.equal(result.operations[0].accountCurrency, "EUR");
  assert.equal(result.operations[0].currency, "EUR");
});

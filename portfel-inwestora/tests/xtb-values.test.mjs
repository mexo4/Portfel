import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { parseBrokerOperationsXlsx } from "../src/lib/import-operations.ts";
import { calculateCashBalances } from "../src/lib/operation-engine.ts";
import { applySaleToPortfolio, normalizePortfolioBook } from "../src/lib/portfolio-state.ts";
import { getAssetProfitLossPln, getGroupedPortfolioAssets } from "../src/lib/portfolio-engine.ts";
import {
  compareImportedBrokerOperations,
  getImportedStandaloneExpense,
  prepareXtbImportOperations,
  resolveImportedTradeValuation,
} from "../src/lib/xtb-import-valuation.ts";

const NOW = "2026-10-09T10:00:00.000Z";
const HEADERS = ["ID", "Type", "Time", "Comment", "Symbol", "Amount", "Instrument"];
const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const excelColumn = (index) => {
  let label = "";
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) {
    label = String.fromCharCode(65 + ((number - 1) % 26)) + label;
  }
  return label;
};

// Small OOXML fixtures exercise the real ZIP/XML reader without requiring Excel
// or a new runtime dependency. Use numeric, inline and shared-string cells as
// found in broker exports; ZIP is DEFLATE-compressed, not a mocked parser result.
const workbook = (sheets) => {
  const shared = [];
  const entries = {};
  for (const [index, sheet] of sheets.entries()) {
    const rows = sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const ref = `${excelColumn(columnIndex)}${rowIndex + 1}`;
      if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
      if (columnIndex % 2 === 0) {
        const position = shared.push(String(value)) - 1;
        return `<c r="${ref}" t="s"><v>${position}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("")}</row>`).join("");
    entries[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  }
  entries["xl/sharedStrings.xml"] = strToU8(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared.map((value) => `<si><t>${xml(value)}</t></si>`).join("")}</sst>`);
  entries["xl/workbook.xml"] = strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${xml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`);
  entries["xl/_rels/workbook.xml.rels"] = strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}</Relationships>`);
  return zipSync(entries, { level: 6 });
};

const cashSheet = (currency, transactions, account = "777777") => ({
  name: "CASH OPERATION HISTORY",
  rows: [["Account number", account], ["Currency", currency], HEADERS, ...transactions],
});
const row = (id, type, comment, symbol, amount, time = "01.09.2026 10:00:00", name = symbol) => [id, type, time, comment, symbol, amount, name];
const parse = (currency, transactions, otherSheets = []) => parseBrokerOperationsXlsx(workbook([cashSheet(currency, transactions), ...otherSheets]), "xtb");

// This adapter copies parsed settlement fields to the existing public ledger
// API. It does not calculate amounts, FX, or investment results of its own.
const ledgerOperations = (operations) => operations.map((operation, index) => ({
  id: operation.importKey ?? `operation-${index}`,
  portfolioId: "p1", accountId: "account1", assetId: null,
  operationType: operation.operationType,
  quantity: operation.quantity || null, price: operation.price || null,
  currency: operation.currency, exchangeRate: operation.exchangeRate ?? null,
  fee: operation.fee ?? 0, tax: operation.tax ?? 0,
  amount: operation.grossAmount ?? operation.amount ?? 0,
  date: operation.date, notes: "", createdAt: NOW, updatedAt: NOW,
  metadata: {
    cashImpact: operation.instrumentType !== "CFD",
    cashSettlementDirect: operation.operationType === "BUY" || operation.operationType === "SELL",
    cashCurrency: operation.cashCurrency ?? operation.accountCurrency ?? operation.currency,
    cashAmount: operation.cashAmount ?? operation.amount,
    cashAmountIsNet: true,
    targetCurrency: operation.targetCurrency,
    targetAmount: operation.targetAmount,
  },
}));
const balance = (operations, currency) => calculateCashBalances(ledgerOperations(operations)).find((item) => item.currency === currency)?.amount ?? 0;
const asset = (operation, overrides = {}) => ({
  id: "lot1", name: operation.name, symbol: operation.symbol, kind: operation.kind,
  instrumentType: operation.instrumentType, positionDirection: operation.positionDirection,
  contractMultiplier: operation.contractMultiplier,
  purchaseDate: operation.date, quantity: operation.quantity,
  purchasePrice: operation.price, purchasePriceCurrency: operation.currency,
  purchaseCurrency: operation.cashCurrency ?? operation.currency,
  purchaseFxRateToPln: 1, purchaseSettlementFxRateToPln: 1,
  feePln: 0, marketCurrency: operation.currency, provider: operation.provider,
  createdAt: NOW, ...overrides,
});

test("XTB XLSX PLN partial sale keeps units, unit prices, commissions, cash and realized P/L", async () => {
  const result = await parse("PLN", [
    row("1", "Deposit", "Bank transfer", "", 2000),
    row("2", "Stock purchase", "OPEN BUY 10 @ 100", "DNP.PL", -1000),
    row("3", "Commission", "Broker commission", "DNP.PL", -5),
    row("4", "Stock sale", "CLOSE BUY 4 @ 120", "DNP.PL", 480, "02.09.2026 10:00:00"),
    row("5", "Commission", "Broker commission", "DNP.PL", -3, "02.09.2026 10:00:00"),
  ]);
  assert.deepEqual(result.skippedRows, []);
  const prepared = prepareXtbImportOperations(result.operations);
  const buy = prepared.find((operation) => operation.operationType === "BUY");
  const sell = prepared.find((operation) => operation.operationType === "SELL");
  assert.deepEqual([buy.quantity, buy.currency, buy.price, buy.marketAmount], [10, "PLN", 100, 1000]);
  assert.deepEqual([sell.quantity, sell.currency, sell.price, sell.marketAmount], [4, "PLN", 120, 480]);
  assert.equal(sell.positionDirection, "LONG");
  assert.equal(sell.positionEffect, "CLOSE");
  assert.equal(balance(result.operations, "PLN"), 1472);
  const buyValuation = resolveImportedTradeValuation(buy, { PLN: 1 });
  const sellValuation = resolveImportedTradeValuation(sell, { PLN: 1 });
  assert.equal(buyValuation.totalFeePln, 5);
  assert.equal(sellValuation.totalFeePln, 3);
  assert.ok(prepared.filter((operation) => operation.operationType === "FEE").every((operation) => getImportedStandaloneExpense(operation) === undefined));
  const lot = asset(buy, { feePln: buyValuation.totalFeePln });
  const group = getGroupedPortfolioAssets([lot], { PLN: 1 })[0];
  const closed = applySaleToPortfolio({ assets: [lot], group, draft: {
    ...group, groupKey: group.key, purchaseCurrency: "PLN", marketCurrency: "PLN",
    quantity: sell.quantity, salePrice: sell.price, saleDate: sell.date, feePln: sellValuation.totalFeePln,
  }, fxRates: { PLN: 1 } });
  assert.equal(closed.assets[0].quantity, 6);
  assert.equal(closed.assets[0].feePln, 3);
  assert.equal(closed.sale.realizedInvestedPln, 402);
  assert.equal(closed.sale.realizedProceedsPln, 477);
  assert.equal(closed.sale.realizedProfitLossPln, 75);
});

test("XTB XLSX USD instrument on PLN account preserves observed FX and debits settlement once", async () => {
  const result = await parse("PLN", [row("usd1", "Stock purchase", "OPEN BUY 2 @ 100", "AAPL.US", -820)]);
  assert.deepEqual(result.skippedRows, []);
  const [buy] = result.operations;
  assert.deepEqual([buy.quantity, buy.price, buy.currency, buy.cashCurrency, buy.marketAmount, buy.cashAmount, buy.exchangeRate], [2, 100, "USD", "PLN", 200, 820, 4.1]);
  assert.equal(balance(result.operations, "PLN"), -820);
  assert.equal(balance(result.operations, "USD"), 0);
  const valuation = resolveImportedTradeValuation(buy, { PLN: 1 });
  assert.equal(valuation.purchaseFxRateToPln, 4.1);
  assert.equal(valuation.settlementFxRateToPln, 1);
  const lot = asset(buy, { latestPrice: 110, purchaseFxRateToPln: valuation.purchaseFxRateToPln, purchaseSettlementFxRateToPln: valuation.settlementFxRateToPln });
  assert.equal(getAssetProfitLossPln(lot, { PLN: 1, USD: 4.1 }), 82);
});

test("XTB XLSX inverse currency pair uses cash per quote unit without inverting twice", async () => {
  const result = await parse("USD", [row("inverse", "Stock purchase", "OPEN BUY 1 @ 100", "DNP.PL", -25)]);
  const [buy] = result.operations;
  assert.deepEqual([buy.currency, buy.cashCurrency, buy.price, buy.marketAmount, buy.cashAmount, buy.exchangeRate], ["PLN", "USD", 100, 100, 25, 0.25]);
  assert.equal(balance(result.operations, "USD"), -25);
});

test("XTB XLSX same-currency PLN/USD/EUR/GBP trades retain values without scaling", async () => {
  for (const [currency, symbol] of [["PLN", "DNP.PL"], ["USD", "AAPL.US"], ["EUR", "SAP.DE"], ["GBP", "ULVR.UK"]]) {
    const result = await parse(currency, [row(`same-${currency}`, "Stock purchase", "OPEN BUY 2 @ 123.45", symbol, -246.9)]);
    const [buy] = result.operations;
    assert.deepEqual([buy.currency, buy.cashCurrency, buy.quantity, buy.price, buy.marketAmount, buy.cashAmount, buy.exchangeRate], [currency, currency, 2, 123.45, 246.9, 246.9, 1], currency);
    assert.equal(balance(result.operations, currency), -246.9);
  }
});

test("XTB XLSX London USD listing does not fabricate GBP or 1:1 conversion", async () => {
  for (const [symbol, price] of [["VWRD.UK", 187.76], ["VHYD.UK", 47.17]]) {
    const result = await parse("USD", [row(symbol, "Stock purchase", `OPEN BUY 1 @ ${price}`, symbol, -price)]);
    const [buy] = result.operations;
    assert.equal(buy.currency, "USD");
    assert.equal(buy.cashCurrency, "USD");
    assert.equal(buy.marketAmount, price);
    assert.equal(buy.autoFxConversion, false);
    assert.equal(balance(result.operations, "USD"), -price);
    assert.equal(balance(result.operations, "GBP"), 0);
  }
});

test("XTB cash-history comments recover ticker and executed partial-fill quantity when Symbol column is blank", async () => {
  const transactions = [
    // The actual cash-history export layout leaves column E (Symbol) empty;
    // ticker, executed fill/original volume and unit price live in Comment.
    row("comment-buy", "Stock purchase", "OPEN BUY DNP.PL 0,5/20,5 @ 34,330", "", "-17,165", "01.09.2026 10:00:00", "Dino Polska S.A."),
    row("comment-sell", "Stock sell", "CLOSE BUY DNP.PL 0.25/20.5 @ 35.00", "", "8.75", "02.09.2026 10:00:00", "Dino Polska S.A."),
    row("comment-fee", "Commission", "Commission DNP.PL", "DNP.PL", "-0.15", "02.09.2026 10:00:00", "Dino Polska S.A."),
  ];
  const result = await parse("PLN", transactions);
  assert.deepEqual(result.skippedRows, []);
  assert.equal(result.operations.length, 3);
  const repeatedImport = await parse("PLN", transactions);
  assert.deepEqual(repeatedImport.operations.map((operation) => operation.importKey), result.operations.map((operation) => operation.importKey));
  assert.equal(new Set(result.operations.map((operation) => operation.importKey)).size, result.operations.length);
  const prepared = prepareXtbImportOperations(result.operations);
  const buy = prepared.find((operation) => operation.brokerOperationId === "comment-buy");
  const sell = prepared.find((operation) => operation.brokerOperationId === "comment-sell");
  const fee = prepared.find((operation) => operation.brokerOperationId === "comment-fee");
  assert.deepEqual([buy.symbol, buy.quantity, buy.price, buy.currency, buy.marketAmount, buy.cashAmount], ["DNP.PL", 0.5, 34.33, "PLN", 17.165, 17.165]);
  assert.deepEqual([sell.symbol, sell.quantity, sell.price, sell.currency, sell.marketAmount, sell.cashAmount], ["DNP.PL", 0.25, 35, "PLN", 8.75, 8.75]);
  assert.deepEqual([fee.operationType, fee.fee, getImportedStandaloneExpense(fee)], ["FEE", 0.15, undefined]);
  assert.equal(fee.linkedFeeImportKey, sell.importKey);
  assert.equal(balance(result.operations, "PLN"), -8.565);

  const buyValuation = resolveImportedTradeValuation(buy, { PLN: 1 });
  const sellValuation = resolveImportedTradeValuation(sell, { PLN: 1 });
  assert.equal(sellValuation.totalFeePln, 0.15);
  const lot = asset(buy, { feePln: buyValuation.totalFeePln });
  const group = getGroupedPortfolioAssets([lot], { PLN: 1 })[0];
  const closed = applySaleToPortfolio({ assets: [lot], group, draft: {
    ...group, groupKey: group.key, purchaseCurrency: "PLN", marketCurrency: "PLN",
    quantity: sell.quantity, salePrice: sell.price, saleDate: sell.date,
    feePln: sellValuation.totalFeePln,
  }, fxRates: { PLN: 1 } });
  assert.equal(closed.assets[0].quantity, 0.25);
  assert.equal(closed.sale.realizedInvestedPln, 8.58);
  assert.equal(closed.sale.realizedProceedsPln, 8.6);
  assert.equal(closed.sale.realizedProfitLossPln, 0.02);
});

test("XTB comment symbols identify the exact USD VWRD/VHYD lines and SEC fee stays an expense", async () => {
  const result = await parse("USD", [
    row("vwrd-fill", "Stock purchase", "OPEN BUY VWRD.UK 2/2.3 @ 184.580", "", "-369.16", "01.09.2026 10:00:00", "Vanguard FTSE All-World UCITS ETF"),
    row("vhyd-fill", "Stock purchase", "OPEN BUY VHYD.UK 0.3/1.3 @ 47.170", "", "-14.151", "01.09.2026 10:01:00", "Vanguard FTSE All-World High Dividend Yield"),
    row("sec-fee", "SEC fee", "Sec Fee adj REXR.US 20260929", "", "-0.01", "29.09.2026 10:00:00", "Rexford Industrial Realty"),
  ]);
  assert.deepEqual(result.skippedRows, []);
  const vwrd = result.operations.find((operation) => operation.brokerOperationId === "vwrd-fill");
  const vhyd = result.operations.find((operation) => operation.brokerOperationId === "vhyd-fill");
  const secFee = result.operations.find((operation) => operation.brokerOperationId === "sec-fee");
  assert.deepEqual([vwrd.symbol, vwrd.quantity, vwrd.price, vwrd.marketAmount, vwrd.currency, vwrd.cashCurrency, vwrd.cashAmount, vwrd.exchangeRate], ["VWRD.UK", 2, 184.58, 369.16, "USD", "USD", 369.16, 1]);
  assert.deepEqual([vhyd.symbol, vhyd.quantity, vhyd.price, vhyd.marketAmount, vhyd.currency, vhyd.cashCurrency, vhyd.cashAmount, vhyd.exchangeRate], ["VHYD.UK", 0.3, 47.17, 14.151, "USD", "USD", 14.151, 1]);
  assert.deepEqual([secFee.operationType, secFee.fee, secFee.amount, getImportedStandaloneExpense(secFee)], ["FEE", 0.01, 0.01, -0.01]);
  assert.equal(result.operations.filter((operation) => operation.operationType === "BUY" || operation.operationType === "SELL").length, 2);
  assert.equal(balance(result.operations, "USD"), -383.321);
  assert.equal(balance(result.operations, "GBP"), 0);
});

test("XTB comment fill rejects impossible executed volume instead of accepting a fabricated quantity", async () => {
  const result = await parse("PLN", [
    row("impossible-fill", "Stock purchase", "OPEN BUY DNP.PL 2/1 @ 10.00", "", -20, "01.09.2026 10:00:00", "Dino Polska"),
  ]);
  assert.equal(result.operations.length, 0);
  assert.deepEqual(result.skippedRows.map(({ reason }) => reason), ["Nie udalo sie odczytac symbolu, ilosci albo ceny z transakcji XTB."]);
});

test("XTB XLSX decimal and thousands separators do not turn unit price into thousands or truncate it", async () => {
  for (const [price, amount] of [["1 234,56", "-1 234,56"], ["1,234.56", "-1,234.56"], ["1.234,56", "-1.234,56"], ["1234.56", -1234.56]]) {
    const result = await parse("USD", [row(`separators-${price}`, "Stock purchase", `OPEN BUY 1 @ ${price}`, "AAPL.US", amount)]);
    assert.deepEqual(result.skippedRows, [], price);
    assert.equal(result.operations[0].price, 1234.56, price);
    assert.equal(result.operations[0].cashAmount, 1234.56, price);
    assert.equal(balance(result.operations, "USD"), -1234.56, price);
  }
});

test("XTB XLSX dividend and withholding tax produce exactly one net cash credit", async () => {
  const result = await parse("PLN", [
    row("dividend", "DIVIDENT", "PLN 5 / SHR", "DNP.PL", 100),
    row("tax", "Withholding Tax", "PLN withholding tax", "DNP.PL", -19),
  ]);
  assert.deepEqual(result.skippedRows, []);
  assert.equal(result.operations.length, 1);
  const [dividend] = result.operations;
  assert.deepEqual([dividend.operationType, dividend.currency, dividend.quantity, dividend.dividendPerShare, dividend.grossAmount, dividend.tax, dividend.netAmount], ["DIVIDEND", "PLN", 20, 5, 100, 19, 81]);
  assert.equal(balance(result.operations, "PLN"), 81);
});

test("XTB XLSX own-account currency transfer retains observed legs and does not create an investment trade", async () => {
  const comment = "Currency conversion, PLN to USD from TA: 777777 to: 888888 exchange rate: 0.25";
  const source = await parse("PLN", [row("fx-source", "Transfer", comment, "", -400)]);
  const target = await parseBrokerOperationsXlsx(workbook([cashSheet("USD", [row("fx-target", "Transfer", comment, "", 100)], "888888")]), "xtb");
  assert.equal(source.operations[0].operationType, "WITHDRAW");
  assert.equal(target.operations[0].operationType, "DEPOSIT");
  assert.equal(source.operations[0].counterpartyAccountNumber, "888888");
  assert.equal(target.operations[0].counterpartyAccountNumber, "777777");
  assert.equal(balance(source.operations, "PLN"), -400);
  assert.equal(balance(target.operations, "USD"), 100);
  assert.equal(source.operations.some((operation) => ["BUY", "SELL"].includes(operation.operationType)), false);
});

test("XTB XLSX reimport and reordered rows retain stable source identities", async () => {
  const rows = [row("trade-a", "Stock purchase", "OPEN BUY 1 @ 100", "AAPL.US", -100), row("trade-b", "Stock purchase", "OPEN BUY 1 @ 110", "AAPL.US", -110)];
  const first = await parse("USD", rows);
  const second = await parse("USD", rows.toReversed());
  assert.deepEqual(first.operations.map((operation) => operation.importKey).sort(), second.operations.map((operation) => operation.importKey).sort());
  assert.equal(new Set([...first.operations, ...second.operations].map((operation) => operation.importKey)).size, 2);
  assert.equal(new Set(first.operations.map((operation) => operation.importKey)).size, 2);
});

test("XTB XLSX closed positions and close-trade rows do not count sale proceeds twice", async () => {
  const result = await parse("PLN", [
    row("sale", "Stock sale", "CLOSE BUY 4 @ 120", "DNP.PL", 400, "02.09.2026 10:00:00"),
    row("pnl", "close trade", "Profit from closed trade", "DNP.PL", 80, "02.09.2026 10:00:00"),
  ], [{ name: "CLOSED POSITIONS", rows: [
    ["Instrument", "Category", "Ticker", "Type", "Volume", "Open price", "Open time", "Close price", "Close time", "Profit/Loss", "Purchase value", "Sale value"],
    ["Dino Polska", "Stock", "DNP.PL", "BUY", 4, 100, "01.09.2026 10:00:00", 120, "02.09.2026 10:00:00", 80, 400, 480],
  ] }]);
  assert.deepEqual(result.skippedRows, []);
  assert.equal(result.operations.filter((operation) => operation.operationType === "SELL").length, 1);
  assert.equal(result.operations.some((operation) => operation.operationType === "CUSTOM"), false);
  const sale = result.operations[0];
  assert.equal(sale.quantity, 4);
  assert.equal(sale.price, 120);
  assert.equal(sale.purchaseValue, 400);
  assert.equal(sale.saleValue, 480);
  assert.equal(sale.realizedProfitLoss, 80);
  assert.equal(sale.cashAmount, 480);
  assert.equal(sale.currency, "PLN");
  assert.equal(balance(result.operations, "PLN"), 480);
});

test("XTB XLSX foreign settlement requires historical PLN anchor instead of substituting FX 1:1", async () => {
  const result = await parse("EUR", [row("foreign", "Stock purchase", "OPEN BUY 2 @ 100", "AAPL.US", -180)]);
  const [buy] = result.operations;
  assert.deepEqual([buy.currency, buy.cashCurrency, buy.marketAmount, buy.cashAmount, buy.exchangeRate], ["USD", "EUR", 200, 180, 0.9]);
  assert.throws(() => resolveImportedTradeValuation(buy, { PLN: 1 }), /EUR\/PLN/);
  const valuation = resolveImportedTradeValuation(buy, { PLN: 1, EUR: 4.5 });
  assert.equal(valuation.purchaseFxRateToPln, 4.05);
  assert.equal(valuation.settlementFxRateToPln, 4.5);
  const lot = asset(buy, { latestPrice: 110, purchaseFxRateToPln: valuation.purchaseFxRateToPln, purchaseSettlementFxRateToPln: valuation.settlementFxRateToPln });
  assert.equal(getAssetProfitLossPln(lot, { PLN: 1, USD: 4.05, EUR: 4.5 }), 81);
  assert.equal(balance(result.operations, "EUR"), -180);
});

test("XTB XLSX malformed Amount is rejected explicitly instead of becoming a zero-cash trade", async () => {
  for (const amount of ["", "not-a-number"]) {
    const result = await parse("PLN", [
      row("seed", "Deposit", "Bank transfer", "", 1000),
      row("invalid", "Stock purchase", "OPEN BUY 1 @ 100", "AAPL.US", amount),
    ]);
    assert.equal(result.operations.some((operation) => operation.brokerOperationId === "invalid"), false);
    assert.ok(result.skippedRows.length > 0);
    assert.match(result.skippedRows.map((item) => item.reason).join(" "), /kwot|amount/i);
    assert.equal(balance(result.operations, "PLN"), 1000);
  }
});

test("XTB XLSX contradictory trade cash signs do not silently turn debits into credits", async () => {
  for (const [type, comment, amount] of [["Stock purchase", "OPEN BUY 1 @ 100", 100], ["Stock sale", "CLOSE SELL 1 @ 100", -100]]) {
    const result = await parse("PLN", [row("seed", "Deposit", "Bank transfer", "", 1000), row("invalid-sign", type, comment, "DNP.PL", amount)]);
    assert.equal(result.operations.some((operation) => operation.brokerOperationId === "invalid-sign"), false);
    assert.ok(result.skippedRows.length > 0);
    assert.equal(balance(result.operations, "PLN"), 1000);
  }
});

test("XTB XLSX ambiguous London cross-currency listing reports missing currency instead of guessing GBP", async () => {
  const result = await parse("EUR", [
    row("seed", "Deposit", "Bank transfer", "", 1000),
    row("unknown-listing", "Stock purchase", "OPEN BUY 1 @ 100", "UNKNOWNLINE.UK", -90),
  ]);
  assert.equal(result.operations.some((operation) => operation.brokerOperationId === "unknown-listing"), false);
  assert.ok(result.skippedRows.length > 0);
  assert.match(result.skippedRows.map((item) => item.reason).join(" "), /walut|currency/i);
});

test("XTB XLSX CFD short derives contract size, preserves broker result and never spends underlying notional as cash", async () => {
  const result = await parse("USD", [
    row("seed", "Deposit", "Bank transfer", "", 1000),
    row("pnl", "close trade", "Result for closed position", "TSLA", 300, "02.09.2026 10:00:00"),
    row("commission", "Commission", "Broker commission", "TSLA", -2, "02.09.2026 10:00:00"),
    row("overnight", "Swap", "Overnight financing", "TSLA", -5, "02.09.2026 10:00:00"),
  ], [{ name: "CLOSED POSITIONS", rows: [
    ["Instrument", "Category", "Ticker", "Type", "Volume", "Open price", "Open time", "Close price", "Close time", "Profit/Loss", "Purchase value", "Sale value"],
    ["Tesla CFD", "CFD", "TSLA", "SELL", 1, 350, "01.09.2026 10:00:00", 320, "02.09.2026 10:00:00", 300, 3200, 3500],
  ] }]);
  assert.deepEqual(result.skippedRows, []);
  const trades = result.operations.filter((operation) => operation.instrumentType === "CFD");
  assert.equal(trades.length, 2);
  assert.deepEqual(trades.map((operation) => [operation.operationType, operation.positionEffect, operation.positionDirection, operation.contractMultiplier, operation.currency]), [["SELL", "OPEN", "SHORT", 10, "USD"], ["BUY", "CLOSE", "SHORT", 10, "USD"]]);
  assert.equal(trades[1].realizedProfitLoss, 300);
  assert.equal(balance(result.operations, "USD"), 1293);
  const lot = asset(trades[0], { latestPrice: 320, purchaseFxRateToPln: 4, purchaseSettlementFxRateToPln: 4 });
  assert.equal(getAssetProfitLossPln(lot, { PLN: 1, USD: 4 }), 1200);
  const group = getGroupedPortfolioAssets([lot], { PLN: 1, USD: 4 })[0];
  const closed = applySaleToPortfolio({ assets: [lot], group, draft: {
    ...group, groupKey: group.key, purchaseCurrency: "USD", marketCurrency: "USD",
    quantity: 1, salePrice: 320, saleDate: trades[1].date, feePln: 28,
  }, fxRates: { PLN: 1, USD: 4 } });
  assert.equal(closed.assets.length, 0);
  assert.equal(closed.sale.realizedProfitLossPln, 1172);
});

test("XTB XLSX generic history preserves unsupported closed asset and realized profit without a live quote", async () => {
  const result = await parseBrokerOperationsXlsx(workbook([{ name: "TRANSACTION HISTORY", rows: [
    ["Type", "Date", "Symbol", "Name", "Quantity", "Price", "Currency", "Value", "Asset Type"],
    ["Buy", "01.09.2026", "LEGACY1", "Historical warrant", 10, 100, "PLN", 1000, "Warrant"],
    ["Sell", "02.09.2026", "LEGACY1", "Historical warrant", 10, 140, "PLN", 1400, "Warrant"],
  ] }]), "xtb");
  assert.deepEqual(result.skippedRows, []);
  assert.equal(result.operations.length, 2);
  assert.ok(result.operations.every((operation) => operation.instrumentType === "OTHER"));
  const [buy, sell] = result.operations;
  const lot = asset(buy);
  assert.equal(lot.latestPrice, undefined);
  const group = getGroupedPortfolioAssets([lot], { PLN: 1 })[0];
  const closed = applySaleToPortfolio({ assets: [lot], group, draft: {
    ...group, groupKey: group.key, purchaseCurrency: "PLN", marketCurrency: "PLN",
    quantity: sell.quantity, salePrice: sell.price, saleDate: sell.date, feePln: 0,
  }, fxRates: { PLN: 1 } });
  assert.equal(closed.assets.length, 0);
  assert.equal(closed.sale.realizedInvestedPln, 1000);
  assert.equal(closed.sale.realizedProceedsPln, 1400);
  assert.equal(closed.sale.realizedProfitLossPln, 400);
});

test("XTB XLSX valuation and direct settlement survive portfolio JSON persistence and reload", async () => {
  const parsed = await parse("PLN", [row("persisted", "Stock purchase", "OPEN BUY 2 @ 100", "AAPL.US", -820)]);
  const [buy] = parsed.operations;
  const valuation = resolveImportedTradeValuation(buy, { PLN: 1 });
  const lot = asset(buy, {
    latestPrice: 110,
    purchaseFxRateToPln: valuation.purchaseFxRateToPln,
    purchaseSettlementFxRateToPln: valuation.settlementFxRateToPln,
  });
  const operation = ledgerOperations(parsed.operations)[0];
  operation.metadata = {
    ...operation.metadata, lotId: lot.id, kind: "stock", importSource: "XTB",
    importKey: buy.importKey, marketCurrency: buy.currency,
    marketAmount: buy.marketAmount, historicalFxVerified: true,
    historicalFxDate: buy.date,
    purchaseFxRateToPln: valuation.purchaseFxRateToPln,
    settlementFxRateToPln: valuation.settlementFxRateToPln,
    purchasePriceCurrency: valuation.priceCurrency,
  };
  const book = normalizePortfolioBook({ schemaVersion: 2, activePortfolioId: "p1", portfolios: [{
    id: "p1", name: "Imported XTB", baseCurrency: "PLN", assets: [lot], sales: [],
    realizedAdjustments: [], accounts: [{
      id: "account1", portfolioId: "p1", name: "XTB PLN", kind: "investment", broker: "XTB",
      currency: "PLN", isDefault: true, metadata: {}, createdAt: NOW, updatedAt: NOW,
    }], instruments: [], operations: [operation], createdAt: NOW, updatedAt: NOW,
  }] });
  const reloaded = normalizePortfolioBook(JSON.parse(JSON.stringify(book)));
  const portfolio = reloaded.portfolios[0];
  assert.equal(portfolio.assets.length, 1);
  assert.deepEqual([portfolio.assets[0].quantity, portfolio.assets[0].purchasePrice, portfolio.assets[0].purchasePriceCurrency, portfolio.assets[0].purchaseCurrency, portfolio.assets[0].purchaseFxRateToPln], [2, 100, "USD", "PLN", 4.1]);
  const persisted = portfolio.operations.find((item) => item.metadata.importKey === buy.importKey);
  assert.ok(persisted);
  assert.equal(persisted.metadata.historicalFxVerified, true);
  assert.equal(persisted.metadata.historicalFxDate, "2026-09-01");
  assert.equal(persisted.metadata.purchaseFxRateToPln, 4.1);
  assert.equal(persisted.metadata.cashSettlementDirect, true);
  assert.equal(calculateCashBalances(portfolio.operations, portfolio.accounts).find((item) => item.currency === "PLN").amount, -820);
  assert.equal(getAssetProfitLossPln(portfolio.assets[0], { PLN: 1, USD: 4.1 }), 82);
});

test("XTB XLSX newest-first same-day history imports buys before partial sales and preserves repurchases", async () => {
  const result = await parse("PLN", [
    row("sale-late", "Stock sell", "CLOSE BUY 3 @ 110", "DNP.PL", 330, "01.09.2026 16:00:00"),
    row("sale-early", "Stock sell", "CLOSE BUY 4 @ 120", "DNP.PL", 480, "01.09.2026 14:00:00"),
    row("buy-again", "Stock purchase", "OPEN BUY 2 @ 105", "DNP.PL", -210, "01.09.2026 12:00:00"),
    row("buy-first", "Stock purchase", "OPEN BUY 10 @ 100", "DNP.PL", -1000, "01.09.2026 11:00:00"),
    row("deposit", "Deposit", "Bank transfer", "", 2000, "01.09.2026 10:00:00"),
  ]);
  assert.deepEqual(result.skippedRows, []);
  const ordered = prepareXtbImportOperations(result.operations).toSorted(compareImportedBrokerOperations);
  assert.deepEqual(ordered.map((operation) => operation.brokerOperationId), ["deposit", "buy-first", "buy-again", "sale-early", "sale-late"]);
  let assets = [];
  let realized = 0;
  for (const operation of ordered) {
    if (operation.operationType === "BUY") {
      const valuation = resolveImportedTradeValuation(operation, { PLN: 1 });
      assets.push(asset(operation, { id: operation.importKey, feePln: valuation.totalFeePln }));
    } else if (operation.operationType === "SELL") {
      assert.equal(operation.positionDirection, "LONG");
      const group = getGroupedPortfolioAssets(assets, { PLN: 1 })[0];
      assert.ok(group);
      const valuation = resolveImportedTradeValuation(operation, { PLN: 1 });
      const closed = applySaleToPortfolio({ assets, group, draft: {
        ...group, groupKey: group.key, purchaseCurrency: "PLN", marketCurrency: "PLN",
        quantity: operation.quantity, salePrice: operation.price, saleDate: operation.date,
        feePln: valuation.totalFeePln,
      }, fxRates: { PLN: 1 } });
      assets = closed.assets;
      realized += closed.sale.realizedProfitLossPln;
    }
  }
  assert.equal(assets.reduce((sum, lot) => sum + lot.quantity, 0), 5);
  assert.equal(assets.reduce((sum, lot) => sum + lot.quantity * lot.purchasePrice, 0), 510);
  assert.equal(realized, 110);
  assert.equal(balance(ordered, "PLN"), 1600);
});

test("XTB XLSX refunded commission and positive swap retain credit signs instead of becoming expenses", async () => {
  const result = await parse("USD", [
    row("seed", "Deposit", "Bank transfer", "", 1000),
    row("fee", "Commission", "Broker commission", "TSLA", -5),
    row("refund", "Commission", "Commission refund", "TSLA", 2),
    row("swap-credit", "Swap", "Positive overnight financing", "TSLA", 3),
  ]);
  assert.deepEqual(result.skippedRows, []);
  const refund = result.operations.find((operation) => operation.brokerOperationId === "refund");
  const swap = result.operations.find((operation) => operation.brokerOperationId === "swap-credit");
  assert.equal(refund.operationType, "CUSTOM");
  assert.equal(refund.amount, 2);
  assert.equal(refund.realizedProfitLoss, 2);
  assert.equal(swap.operationType, "CUSTOM");
  assert.equal(swap.amount, 3);
  assert.equal(swap.realizedProfitLoss, 3);
  assert.equal(swap.financing, undefined);
  assert.equal(getImportedStandaloneExpense(refund), undefined);
  assert.equal(getImportedStandaloneExpense(swap), undefined);
  assert.equal(balance(result.operations, "USD"), 1000);
});

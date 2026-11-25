import assert from "node:assert/strict";
import test from "node:test";

const { buildOperationsCsv, buildPortfolioBackup, parsePortfolioBackup, toSafeFileName, OPERATIONS_CSV_HEADER } = await import("../src/lib/portfolio-export.ts");
const { normalizePortfolioBook, createInvestmentPortfolio } = await import("../src/lib/portfolio-state.ts");

const operation = (fields) => ({
  id: "op1", portfolioId: "p1", accountId: "a1", assetId: null, operationType: "BUY", quantity: 10, price: 62.5, currency: "PLN",
  exchangeRate: 1, fee: 3.9, tax: 0, amount: 625, date: "2026-03-01", notes: "", metadata: {}, createdAt: "", updatedAt: "",
  ...fields,
});
const row = (fields, op = {}) => ({
  key: "k", portfolioId: "p1", portfolioName: "Główny", operation: operation(op), instrumentName: "Orlen", instrumentSymbol: "PKN.PL",
  instrumentType: "STOCK", accountName: "XTB PLN", targetAccountName: null, result: null, resultPln: null, sale: null,
  realizedAdjustment: null, isSyntheticAdjustment: false, ...fields,
});

test("the operations CSV opens in Polish Excel: semicolons, decimal commas, BOM, quoted text", () => {
  const csv = buildOperationsCsv([
    row({}),
    row({ resultPln: 120.5 }, { operationType: "SELL", notes: 'Sprzedaż; "część" portfela\ndruga linia' }),
  ]);
  const lines = csv.slice(1).split("\r\n");

  assert.ok(csv.startsWith("﻿"), "byte order mark for Polish letters");
  assert.equal(lines[0], OPERATIONS_CSV_HEADER.join(";"));
  assert.equal(lines[1], "2026-03-01;Główny;Kupno;Orlen;PKN.PL;10;62,5;PLN;625;3,9;0;XTB PLN;;;");
  assert.match(csv, /;120,5;"Sprzedaż; ""część"" portfela\ndruga linia"\r\n$/);
});

test("a backup restores into the same account as a new portfolio with a new id and a free name", () => {
  const original = normalizePortfolioBook({
    portfolios: [createInvestmentPortfolio("Główny", { assets: [{ id: "lot-1", name: "Orlen", symbol: "PKN.PL", kind: "stock", purchaseDate: "2026-01-02", quantity: 10, purchasePrice: 60, purchaseCurrency: "PLN", feePln: 2, marketCurrency: "PLN", provider: "yahoo", createdAt: "2026-01-02T00:00:00.000Z" }], sales: [], realizedAdjustments: [] })],
  }).portfolios[0];
  const text = buildPortfolioBackup(original, "2026-11-25T10:00:00.000Z");

  const restored = parsePortfolioBackup(text, { existingIds: [original.id], existingNames: ["Główny", "Główny (kopia)"], createId: () => "portfolio-restored" });

  assert.equal(restored.id, "portfolio-restored");
  assert.equal(restored.name, "Główny (kopia 2)");
  assert.ok(!JSON.stringify(restored).includes(original.id), "no reference to the old id is left");
  assert.ok((restored.accounts ?? []).every((account) => account.portfolioId === "portfolio-restored"));

  const book = normalizePortfolioBook({ portfolios: [original, restored], activePortfolioId: original.id });
  const normalizedRestored = book.portfolios.find((portfolio) => portfolio.id === "portfolio-restored");
  assert.equal(normalizedRestored.assets.length, 1);
  assert.equal(normalizedRestored.assets[0].symbol, "PKN.PL");
});

test("every lot, sale and operation of a restored copy gets a new id, links between them kept", () => {
  const text = buildPortfolioBackup({
    id: "portfolio-x", name: "IKE", createdAt: "", updatedAt: "", realizedAdjustments: [],
    assets: [{ id: "lot-1" }], sales: [{ id: "sale-1", allocations: [{ lotId: "lot-1" }] }],
    operations: [{ id: "op-1", metadata: { lotId: "lot-1", saleId: "sale-1" } }],
  });
  const restored = parsePortfolioBackup(text, { existingIds: ["other"], existingNames: ["Główny"], createId: () => "portfolio-new123" });

  assert.equal(restored.id, "portfolio-new123");
  assert.equal(restored.name, "IKE");
  assert.equal(restored.assets[0].id, "lot-1-rnew123");
  assert.equal(restored.sales[0].allocations[0].lotId, "lot-1-rnew123");
  assert.deepEqual(restored.operations[0].metadata, { lotId: "lot-1-rnew123", saleId: "sale-1-rnew123" });
});

test("anything that is not a Mexo portfolio backup is refused with a clear message", () => {
  const options = { existingIds: [], existingNames: [], createId: () => "x" };

  assert.throws(() => parsePortfolioBackup("nie json", options), /nieprawidłowy JSON/);
  assert.throws(() => parsePortfolioBackup(JSON.stringify({ format: "inny" }), options), /To nie jest plik kopii portfela Mexo/);
  assert.throws(() => parsePortfolioBackup(JSON.stringify({ format: "mexo-portfolio-backup", version: 2, portfolio: {} }), options), /innej wersji/);
  assert.throws(() => parsePortfolioBackup(JSON.stringify({ format: "mexo-portfolio-backup", version: 1, portfolio: { id: "a", name: "b" } }), options), /niekompletna/);
  assert.throws(() => parsePortfolioBackup("x".repeat(8 * 1024 * 1024 + 1), options), /za duży/);
});

test("file names are safe on every system", () => {
  assert.equal(toSafeFileName("Główny portfel: IKE/2026"), "Glowny-portfel-IKE-2026");
  assert.equal(toSafeFileName("???"), "portfel");
});

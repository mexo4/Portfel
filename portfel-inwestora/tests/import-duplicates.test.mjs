import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { findImportedInOtherPortfolios, findOperationsHeldTwice, getImportedElsewhereMessage } = await import("../src/lib/xtb-import-valuation.ts");
const { normalizePortfolioBook } = await import("../src/lib/portfolio-state.ts");

const incoming = (id, account = "777777") => ({ broker: "XTB", accountNumber: account, brokerOperationId: id, importKey: `xtb:v2:${account}:${id}`, rowNumber: 1, operationType: "BUY" });
const stored = (id, account = "777777", metadata = {}) => ({
  id: `op-${account}-${id}`, operationType: "BUY",
  metadata: { importSource: "XTB", accountNumber: account, brokerOperationId: id, importKey: `xtb:v2:${account}:${id}`, ...metadata },
});

test("an operation another portfolio holds is found by account and broker operation id", () => {
  const matches = findImportedInOtherPortfolios(
    [incoming("1001"), incoming("1002"), incoming("1003")],
    [{ id: "b", name: "Drugi", operations: [stored("1001"), stored("1002")] }, { id: "c", name: "Pusty", operations: [] }]
  );
  assert.deepEqual(matches, [{ portfolioId: "b", portfolioName: "Drugi", count: 2 }]);
});

test("the two legs of one transfer on two accounts are not duplicates, and neither are old-format keys of other rows", () => {
  assert.deepEqual(findImportedInOtherPortfolios([incoming("2001", "888888")], [{ id: "b", name: "Drugi", operations: [stored("2001", "777777")] }]), []);
  // The same row stored by an older importer (another key format) still matches by account and id.
  const old = stored("1001", "777777", { importKey: "xtb:1001:45934.4:Stock purchase:777777:PKN.PL:500", legacyImportKeys: ["xtb:1001:45934.4:Stock purchase:PKN.PL:500"] });
  assert.equal(findImportedInOtherPortfolios([incoming("1001")], [{ id: "b", name: "Drugi", operations: [old] }])[0].count, 1);
});

test("the message names the portfolio to import into", () => {
  const message = getImportedElsewhereMessage([{ portfolioName: "Drugi", count: 13 }], "Główny");
  assert.match(message, /„Drugi” \(13 operacji\)/);
  assert.match(message, /importuj do portfela „Drugi”/);
  assert.match(message, /Nic nie zapisano/);
});

test("operations already stored in two portfolios are reported once each", () => {
  const result = findOperationsHeldTwice([
    { id: "a", name: "Główny", operations: [stored("1"), stored("2"), { id: "manual", metadata: {} }] },
    { id: "b", name: "Drugi", operations: [stored("1"), stored("2")] },
    { id: "c", name: "IKE", operations: [stored("3")] },
  ]);
  assert.deepEqual(result, { count: 2, portfolioNames: ["Główny", "Drugi"] });
  assert.equal(findOperationsHeldTwice([{ id: "a", name: "Główny", operations: [stored("1")] }]).count, 0);
});

const asPortfolio = (id, name) => ({
  id, name, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", assets: [], sales: [],
  realizedAdjustments: [{ id: "import-result-abc", amount: -0.4, currency: "PLN", amountPlnSnapshot: -0.4, date: "2026-01-05", source: "broker-import", importKey: "xtb:v2:777777:1014:result", createdAt: "2026-01-05T00:00:00.000Z" }],
});

test("the same imported cost in two portfolios gets two different operation ids", () => {
  const book = normalizePortfolioBook({ schemaVersion: 2, portfolios: [asPortfolio("p-a", "A"), asPortfolio("p-b", "B")], activePortfolioId: "p-a" });
  const ids = book.portfolios.flatMap((portfolio) => portfolio.operations ?? []).map((operation) => operation.id);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2, `ids must be unique across portfolios: ${ids.join(", ")}`);
});

test("a cost saved under the old id is replaced, not counted twice", () => {
  const saved = normalizePortfolioBook({ schemaVersion: 2, portfolios: [asPortfolio("p-a", "A")], activePortfolioId: "p-a" });
  const stale = structuredClone(saved);
  stale.portfolios[0].operations = stale.portfolios[0].operations.map((operation) => ({ ...operation, id: "op-adjustment-import-result-abc" }));
  const operations = normalizePortfolioBook(stale).portfolios[0].operations;
  assert.deepEqual(operations.map((operation) => operation.id), ["op-adjustment-p-a-import-result-abc"]);
});

test("the import checks the other portfolios before saving anything", async () => {
  const source = await readFile(new URL("../src/components/PortfolioApp.tsx", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf("const handleImportBrokerOperations"), source.indexOf("await queuePortfolioSave", source.indexOf("const handleImportBrokerOperations")));
  assert.match(handler, /findImportedInOtherPortfolios\(\s*operations,\s*portfoliosRef\.current\.filter\(\(portfolio\) => portfolio\.id !== portfolioId\)/);
  assert.match(handler, /throw new Error\(getImportedElsewhereMessage/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { auditXtbPortfolio } from "../src/lib/xtb-import-audit.ts";

const operation = (patch = {}) => ({
  id: "operation1", accountId: "account1", operationType: "BUY", quantity: 2,
  price: 100, currency: "USD", amount: 820, exchangeRate: 4.1, fee: 0,
  date: "2026-09-01", metadata: {
    importSource: "XTB", brokerOperationId: "broker1", accountNumber: "123456",
    marketCurrency: "USD", cashCurrency: "PLN", marketAmount: 200, cashAmount: 820,
    importKey: "xtb:v2:123456:broker1",
  }, ...patch,
});
const portfolio = (operations) => ({
  id: "portfolio1", accounts: [{ id: "account1", metadata: { accountNumber: "123456" } }],
  operations, assets: [], sales: [], realizedAdjustments: [],
});

test("XTB audit detects historical CLOSE BUY sale stored as a purchase without normalizing or modifying it", () => {
  const op = operation();
  op.metadata.brokerOperationType = "Stock sell";
  const document = portfolio([op]);
  const before = JSON.stringify(document);
  const findings = auditXtbPortfolio(document);
  assert.equal(findings.find(f => f.code === "STOCK_SALE_STORED_AS_BUY").severity, "ERROR");
  assert.equal(JSON.stringify(document), before);
});

test("XTB source-backed dry-run shows old and expected currency, cash and side without applying a patch", () => {
  const op = operation();
  const source = { brokerOperationId: "broker1", accountNumber: "123456", operationType: "SELL",
    quantity: 2, price: 100, currency: "USD", marketCurrency: "USD", cashCurrency: "PLN",
    marketAmount: 200, cashAmount: 830 };
  const document = portfolio([op]);
  const before = JSON.stringify(document);
  const finding = auditXtbPortfolio(document, [source]).find(f => f.code === "SOURCE_TRADE_MISMATCH");
  assert.equal(finding.evidence.before.operationType, "BUY");
  assert.equal(finding.evidence.expected.operationType, "SELL");
  assert.equal(finding.evidence.expected.cashAmount, 830);
  assert.match(finding.evidence.correction, /LINKED_LOTS_AND_SALES/);
  assert.equal(JSON.stringify(document), before);
});

test("XTB audit uses account-scoped broker IDs and flags parity only for review, never as proof", () => {
  const first = operation({ exchangeRate: 1 });
  const second = operation({ id: "other" });
  second.metadata = { ...second.metadata, accountNumber: "654321" };
  const findings = auditXtbPortfolio(portfolio([first, second]));
  assert.equal(findings.some(f => f.code === "DUPLICATE_BROKER_OPERATION"), false);
  assert.equal(findings.find(f => f.code === "CROSS_CURRENCY_PARITY_REQUIRES_SOURCE").severity, "REVIEW");
  const duplicates = auditXtbPortfolio(portfolio([first, { ...first, id: "duplicate" }]));
  assert.equal(duplicates.find(f => f.code === "DUPLICATE_BROKER_OPERATION").severity, "REVIEW");
});

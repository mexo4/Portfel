import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAggregateOperationRows,
  filterAggregateOperationRows,
  getAggregateOperationTypeLabel,
  getAggregateOperationTypeOptions,
  paginateAggregateOperationRows,
} from "../src/lib/aggregate-operations.ts";

const makeOperation = (overrides = {}) => ({
  id: "op-1",
  portfolioId: "p-1",
  accountId: "p-1:cash:PLN",
  assetId: "p-1:instrument:xtb",
  operationType: "BUY",
  quantity: 2,
  price: 50,
  currency: "PLN",
  exchangeRate: 1,
  fee: 0,
  tax: 0,
  amount: 100,
  date: "2026-11-06",
  notes: "",
  metadata: {},
  createdAt: "2026-11-06T10:00:00.000Z",
  updatedAt: "2026-11-06T10:00:00.000Z",
  ...overrides,
});

const makePortfolio = (id, name, operations, { symbol = "XTB.PL", instrumentId } = {}) => ({
  id,
  name,
  operations: operations.map((operation) => ({ ...operation, portfolioId: id })),
  accounts: [{ id: `${id}:cash:PLN`, name: `${name} cash`, currency: "PLN" }],
  instruments: [{ id: instrumentId ?? `${id}:instrument:xtb`, name: "XTB", symbol, type: "STOCK" }],
  assets: [],
});

test("aggregate rows keep identical operations separate by source portfolio identity", () => {
  const first = makePortfolio("p-1", "XTB", [makeOperation()]);
  const second = makePortfolio("p-2", "IKE", [makeOperation({ id: "op-1", assetId: "p-2:instrument:xtb" })]);
  const rows = buildAggregateOperationRows([first, second]);

  assert.deepEqual(rows.map((row) => row.key).sort(), ["p-1:op-1", "p-2:op-1"]);
  assert.deepEqual(rows.map((row) => row.portfolioName).sort(), ["IKE", "XTB"]);
  assert.deepEqual(rows.map((row) => [row.operation.amount, row.operation.currency]).sort((a, b) => a[1].localeCompare(b[1])), [[100, "PLN"], [100, "PLN"]]);
  assert.equal(rows.length, 2);
});

test("combined filters compose across portfolio, type, instrument, date, and text", () => {
  const portfolios = [
    makePortfolio("p-1", "Portfel XTB", [
      makeOperation({ id: "buy", operationType: "BUY", date: "2026-11-06" }),
      makeOperation({ id: "dividend", operationType: "DIVIDEND", assetId: null, date: "2026-11-04", amount: 12, notes: "dywidenda roczna", metadata: { symbol: "XTB.PL" } }),
    ]),
    makePortfolio("p-2", "Portfel IKE", [makeOperation({ id: "old", operationType: "BUY", date: "2026-10-30" })]),
  ];
  const rows = buildAggregateOperationRows(portfolios);

  const results = filterAggregateOperationRows(rows, {
    query: "DYWIDENDA ROCZNA",
    portfolioId: "p-1",
    operationType: "Dywidenda",
    instrument: "XTB.PL",
    dateFrom: "2026-11-01",
    dateTo: "2026-11-05",
  });
  assert.deepEqual(results.map((row) => row.key), ["p-1:dividend"]);
  assert.equal(filterAggregateOperationRows(rows, { dateFrom: "2026-11-07" }).length, 0);
  assert.equal(filterAggregateOperationRows([], {}).length, 0);
});

test("shows recorded realized result only for closing trades and preserves its source currency", () => {
  const portfolio = makePortfolio("p-1", "XTB", [
    makeOperation({
      id: "sell",
      operationType: "SELL",
      metadata: { realizedProfitLossValue: 7.25, realizedValueCurrency: "USD", realizedProfitLossPln: 28.1 },
    }),
    makeOperation({
      id: "buy",
      operationType: "BUY",
      metadata: { realizedProfitLossPln: 500 },
    }),
    makeOperation({
      id: "open-short",
      operationType: "SELL",
      metadata: { positionDirection: "SHORT", positionEffect: "OPEN", realizedProfitLossPln: 500 },
    }),
  ]);
  const rows = buildAggregateOperationRows([portfolio]);
  assert.deepEqual(rows.find((row) => row.operation.id === "sell")?.result, { amount: 7.25, currency: "USD" });
  assert.equal(rows.find((row) => row.operation.id === "buy")?.result, null);
  assert.equal(rows.find((row) => row.operation.id === "open-short")?.result, null);
  assert.equal(getAggregateOperationTypeLabel(makeOperation({
    operationType: "BUY",
    metadata: { positionDirection: "SHORT", positionEffect: "CLOSE" },
  })), "Zamknięcie shorta");
  assert.equal(getAggregateOperationTypeLabel(makeOperation({ operationType: "DIVIDEND" })), "Dywidenda");
});

test("operation type filter matches the visible short labels and retains localized raw types", () => {
  const rows = buildAggregateOperationRows([makePortfolio("p-1", "XTB", [
    makeOperation({ id: "buy", operationType: "BUY" }),
    makeOperation({ id: "short-open", operationType: "SELL", metadata: { positionDirection: "SHORT", positionEffect: "OPEN" } }),
    makeOperation({ id: "short-close", operationType: "BUY", metadata: { positionDirection: "SHORT", positionEffect: "CLOSE" } }),
  ])]);
  const options = getAggregateOperationTypeOptions(rows);

  assert.ok(options.includes("Kupno"));
  assert.ok(options.includes("Sprzedaż"));
  assert.ok(options.includes("Wpłata"));
  assert.ok(options.includes("Otwarcie shorta"));
  assert.ok(options.includes("Zamknięcie shorta"));
  assert.deepEqual(filterAggregateOperationRows(rows, { operationType: "Zamknięcie shorta" }).map((row) => row.operation.id), ["short-close"]);
  assert.deepEqual(filterAggregateOperationRows(rows, { operationType: "Otwarcie shorta" }).map((row) => row.operation.id), ["short-open"]);
});

test("load-more pagination can reach history beyond the former 100-row cap", () => {
  const operations = Array.from({ length: 137 }, (_, index) => makeOperation({
    id: `op-${index}`,
    date: `2026-${String(11 - Math.floor(index / 28)).padStart(2, "0")}-${String(28 - (index % 28)).padStart(2, "0")}`,
    createdAt: `2026-11-06T10:${String(index % 60).padStart(2, "0")}:00.000Z`,
  }));
  const rows = buildAggregateOperationRows([makePortfolio("p-1", "XTB", operations)]);
  const firstPage = paginateAggregateOperationRows(rows, 30);
  const laterPage = paginateAggregateOperationRows(rows, 120);

  assert.equal(rows.length, 137);
  assert.equal(firstPage.length, 30);
  assert.equal(laterPage.length, 120);
  assert.equal(laterPage.at(-1)?.key, rows[119].key);
  assert.notEqual(rows.at(-1)?.key, rows[99]?.key);
});

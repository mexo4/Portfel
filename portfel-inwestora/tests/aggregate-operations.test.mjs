import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAggregateOperationRows,
  filterAggregateOperationRows,
  getAggregateOperationTypeLabel,
  getAggregateOperationTypeOptions,
  getPolishOperationCountLabel,
  paginateAggregateOperationRows,
  sortAggregateOperationRows,
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
  accounts: [
    { id: `${id}:cash:PLN`, name: `${name} cash`, currency: "PLN" },
    { id: `${id}:cash:USD`, name: `${name} USD cash`, currency: "USD" },
  ],
  instruments: [{ id: instrumentId ?? `${id}:instrument:xtb`, name: "XTB", symbol, type: "STOCK" }],
  assets: [],
  sales: [],
  realizedAdjustments: [],
  accountType: "STANDARD",
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

test("shared operation filters include account and all recorded operation currencies", () => {
  const portfolios = [
    makePortfolio("p-1", "XTB", [makeOperation({
      id: "foreign-buy",
      currency: "PLN",
      accountId: "p-1:cash:PLN",
      metadata: { marketCurrency: "USD", feeCurrency: "PLN" },
    })]),
    makePortfolio("p-2", "IKE", [makeOperation({
      id: "usd-dividend",
      operationType: "DIVIDEND",
      assetId: null,
      currency: "USD",
      metadata: { symbol: "AAPL" },
    })]),
  ];
  const rows = buildAggregateOperationRows(portfolios);

  assert.deepEqual(filterAggregateOperationRows(rows, { currency: "USD" }).map((row) => row.operation.id).sort(), ["foreign-buy", "usd-dividend"]);
  assert.deepEqual(filterAggregateOperationRows(rows, { account: "XTB cash" }).map((row) => row.operation.id), ["foreign-buy"]);
  assert.deepEqual(filterAggregateOperationRows(rows, { portfolioId: "p-2", currency: "USD" }).map((row) => row.key), ["p-2:usd-dividend"]);

  const transferRows = buildAggregateOperationRows([makePortfolio("p-1", "XTB", [makeOperation({
    id: "transfer",
    operationType: "TRANSFER",
    targetAccountId: "p-1:cash:USD",
    metadata: { targetAccountId: "p-1:cash:USD" },
  })])]);
  assert.deepEqual(filterAggregateOperationRows(transferRows, { account: "XTB USD cash" }).map((row) => row.operation.id), ["transfer"]);
});

test("operation row links the original sale for safe single-portfolio undo without duplicating it", () => {
  const sale = {
    id: "sale-1",
    symbol: "XTB.PL",
    name: "XTB",
    transactionKind: "sale",
    marketCurrency: "PLN",
    realizedProfitLossPln: 12,
    allocations: [],
  };
  const portfolio = {
    ...makePortfolio("p-1", "XTB", [makeOperation({
      id: "ledger-sell-1",
      operationType: "SELL",
      metadata: { legacySource: "sale", legacySourceId: "sale-1", realizedProfitLossPln: 12 },
    })]),
    sales: [sale],
  };
  const rows = buildAggregateOperationRows([portfolio]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sale.id, "sale-1");
  assert.equal(rows[0].resultPln, 12);
  assert.equal(getAggregateOperationTypeLabel(makeOperation({ operationType: "SELL", metadata: { transactionKind: "bond-redemption" } })), "Wykup obligacji");
  assert.equal(getAggregateOperationTypeLabel(makeOperation({ operationType: "SELL", metadata: { transactionKind: "bond-swap" } })), "Zamiana obligacji");
});

test("manual and projected bond-coupon adjustments each appear once in the shared ledger", () => {
  const portfolio = {
    ...makePortfolio("p-1", "XTB", [makeOperation({
      id: "adjustment-manual-1",
      operationType: "CUSTOM",
      assetId: null,
      amount: 25,
      metadata: { legacySource: "realizedAdjustment", legacySourceId: "manual-1", source: "manual" },
    })]),
    realizedAdjustments: [
      { id: "manual-1", amount: 25, currency: "PLN", amountPlnSnapshot: 25, date: "2026-10-01", source: "manual", note: "Historyczna korekta", createdAt: "2026-10-01T00:00:00.000Z" },
      { id: "coupon-1", amount: 4, currency: "PLN", amountPlnSnapshot: 4, date: "2026-11-01", source: "bond-coupon", bondCode: "COI", note: "Kupon COI", createdAt: "2026-11-01T00:00:00.000Z" },
    ],
  };
  const rows = buildAggregateOperationRows([portfolio]);

  assert.equal(rows.length, 2);
  assert.equal(rows.filter((row) => row.realizedAdjustment?.id === "manual-1").length, 1);
  assert.equal(rows.filter((row) => row.realizedAdjustment?.id === "coupon-1").length, 1);
  assert.equal(rows.find((row) => row.realizedAdjustment?.id === "coupon-1")?.isSyntheticAdjustment, true);
});

test("result sorting compares only PLN-anchored values and keeps unknown results last", () => {
  const rows = buildAggregateOperationRows([makePortfolio("p-1", "XTB", [
    makeOperation({ id: "negative", operationType: "SELL", metadata: { realizedProfitLossValue: -5, realizedValueCurrency: "USD", realizedProfitLossPln: -20 } }),
    makeOperation({ id: "positive", operationType: "SELL", metadata: { realizedProfitLossValue: 7, realizedValueCurrency: "USD", realizedProfitLossPln: 28 } }),
    makeOperation({ id: "unanchored", operationType: "SELL", metadata: { realizedProfitLossValue: 50, realizedValueCurrency: "USD" } }),
  ])]);

  assert.deepEqual(sortAggregateOperationRows(rows, "result-desc").map((row) => row.operation.id), ["positive", "negative", "unanchored"]);
  assert.deepEqual(sortAggregateOperationRows(rows, "result-asc").map((row) => row.operation.id), ["negative", "positive", "unanchored"]);
});

test("operation counter uses correct Polish plural forms", () => {
  assert.equal(getPolishOperationCountLabel(1), "operacja");
  assert.equal(getPolishOperationCountLabel(2), "operacje");
  assert.equal(getPolishOperationCountLabel(4), "operacje");
  assert.equal(getPolishOperationCountLabel(5), "operacji");
  assert.equal(getPolishOperationCountLabel(12), "operacji");
  assert.equal(getPolishOperationCountLabel(22), "operacje");
});

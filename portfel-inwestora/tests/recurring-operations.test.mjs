import assert from "node:assert/strict";
import test from "node:test";

const {
  bookRecurringOccurrences,
  getDueRecurringOccurrences,
  getNextOccurrence,
  getOccurrenceDates,
  readRecurringOperations,
  withRecurringOperations,
} = await import("../src/lib/recurring-operations.ts");
const { getOperationCashDeltas } = await import("../src/lib/operation-engine.ts");

const definition = (fields) => ({
  id: "r1", operationType: "DEPOSIT", amount: 500, currency: "PLN", accountId: "acc", frequency: "monthly",
  startDate: "2026-01-31", endDate: null, notes: "", createdAt: "", ...fields,
});
const portfolio = (definitions, operations = []) => ({
  id: "p1", name: "Główny", assets: [], sales: [], realizedAdjustments: [], createdAt: "", updatedAt: "",
  accounts: [{ id: "acc", portfolioId: "p1", name: "Gotówka PLN", kind: "cash", currency: "PLN", isDefault: true, metadata: {}, createdAt: "", updatedAt: "" }],
  operations, metadata: { recurringOperations: definitions },
});

test("monthly dates are counted from the start, so the 31st stays the end of each month", () => {
  assert.deepEqual(getOccurrenceDates(definition({}), "2026-05-01"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(getOccurrenceDates(definition({ frequency: "weekly", startDate: "2026-01-01" }), "2026-01-20"), ["2026-01-01", "2026-01-08", "2026-01-15"]);
  assert.deepEqual(getOccurrenceDates(definition({ frequency: "quarterly", startDate: "2026-01-15", endDate: "2026-08-01" }), "2027-01-01"), ["2026-01-15", "2026-04-15", "2026-07-15"]);
  assert.equal(getNextOccurrence(definition({}), "2026-03-31"), "2026-04-30");
  assert.equal(getNextOccurrence(definition({ endDate: "2026-03-31" }), "2026-03-31"), null);
});

test("due dates exclude what is already booked, and booking creates ordinary cash operations", () => {
  const start = portfolio([definition({})]);
  const due = getDueRecurringOccurrences(start, "2026-03-31");
  assert.deepEqual(due.map((item) => item.date), ["2026-01-31", "2026-02-28", "2026-03-31"]);

  let counter = 0;
  const booked = bookRecurringOccurrences(start, due, () => `op-${++counter}`);
  assert.equal(booked.operations.length, 3);
  assert.equal(booked.operations[0].operationType, "DEPOSIT");
  assert.equal(booked.operations[0].amount, 500);
  assert.equal(booked.operations[0].date, "2026-01-31");
  assert.equal(booked.operations[0].metadata.recurringOccurrenceKey, "r1:2026-01-31");
  assert.deepEqual(getOperationCashDeltas(booked.operations[0]).map((delta) => delta.amount), [500], "a deposit raises the cash balance");

  assert.deepEqual(getDueRecurringOccurrences(booked, "2026-03-31"), [], "nothing is booked twice");
  assert.deepEqual(getDueRecurringOccurrences(booked, "2026-04-30").map((item) => item.date), ["2026-04-30"]);
});

test("an occurrence for an account that no longer exists is not booked", () => {
  const start = portfolio([definition({ accountId: "deleted" })]);
  const booked = bookRecurringOccurrences(start, getDueRecurringOccurrences(start, "2026-02-01"), () => "x");

  assert.equal(booked.operations.length, 0);
});

test("definitions are read defensively and saved in the portfolio's metadata", () => {
  const stored = withRecurringOperations(portfolio([]), [definition({}), { id: "bad", amount: -1 }]);
  const read = readRecurringOperations(stored);

  assert.equal(read.length, 1);
  assert.equal(read[0].id, "r1");
  assert.equal(readRecurringOperations({ metadata: { recurringOperations: [definition({ endDate: "2025-01-01" })] } })[0].endDate, null, "an end before the start is ignored");
});

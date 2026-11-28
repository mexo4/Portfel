import assert from "node:assert/strict";
import test from "node:test";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { gpwDividendNotices, gpwReportDateChanges } from "./fixtures/gpw-calendar-faults-2026-11-28.mjs";

// Real notices behind the calendar faults found on 28.11.2026: report date changes the parser read
// wrongly or not at all, and dividend notices it merged or missed. Each one is pinned to what its filing
// says, so a parser change that loses one of them fails here before it reaches the calendar.
const reportRows = (text) => parseCorporateEventDocument(text)
  .filter((event) => event.eventType.endsWith("_REPORT"))
  .map((event) => [
    event.eventType, event.eventDate, event.fiscalPeriod ?? null,
    event.fiscalYearLabel ?? (event.fiscalYear ? String(event.fiscalYear) : null), Boolean(event.requiresReview),
  ]);
const dividendRows = (text) => parseCorporateEventDocument(text)
  .filter((event) => event.eventType === "UPCOMING_DIVIDEND")
  .map((event) => [event.eventIdentity, event.recordDate ?? null, event.paymentDate ?? null, event.dividendPerShare ?? null, event.dividendStatus]);

for (const entry of gpwReportDateChanges) {
  test(`report date change ${entry.issuer} (${entry.id}): ${entry.note}`, () => {
    assert.deepEqual(reportRows(entry.text), entry.expected);
    // A change notice publishes only the new appointment, never the one it replaces.
    for (const [, date] of entry.expected) assert.notEqual(date, undefined);
  });
}

for (const entry of gpwDividendNotices) {
  test(`dividend notice ${entry.id}: ${entry.note}`, () => {
    assert.deepEqual(dividendRows(entry.text), entry.expected);
  });
}

test("the fixture keeps the cases that failed: lost notices, old dates taken for new ones, merged advances", () => {
  const byId = new Map(gpwReportDateChanges.map((entry) => [entry.id, entry.expected]));
  // Read nothing before 28.11.2026.
  assert.deepEqual(byId.get("gpw:500535"), [["QUARTERLY_REPORT", "2026-11-26", "Q3", "2026", false]]);
  assert.deepEqual(byId.get("gpw:500659"), [["QUARTERLY_REPORT", "2026-11-27", "Q3", "2026", false]]);
  // Took the replaced date for the new one before 28.11.2026.
  assert.deepEqual(byId.get("gpw:500170"), [["QUARTERLY_REPORT", "2026-11-10", "Q3", "2026", false]]);
  assert.deepEqual(byId.get("gpw:496133"), [["HALF_YEAR_REPORT", "2026-09-10", "H1", "2026", false]]);
  // One date for several reports: nothing, rather than a guess.
  assert.deepEqual(byId.get("gpw:489946"), []);
  const advances = gpwDividendNotices.flatMap((entry) => entry.expected.map((row) => row[0])).filter((identity) => identity.includes(":advance:"));
  assert.equal(new Set(advances).size, 3, "three different advances, the request and resolution of Text being one");
});

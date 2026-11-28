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

// Made-up notices around the one-date-for-several-reports rule: when a naming is unclear, nothing is published.
const changeNotice = (body) => `SPÓŁKA TESTOWA S.A. (9/2026) Zmiana terminów publikacji raportów okresowych\nTreść raportu:\n${body}`;
test("one new date for several reports: only when each report is named with its period and year", () => {
  assert.deepEqual(reportRows(changeNotice(
    "Zarząd informuje o zmianie terminów publikacji raportu rocznego za rok 2025 oraz raportu kwartalnego za I kwartał 2026 roku. Nowy termin publikacji raportów: 16 czerwca 2026 roku."
  )).sort(), [["ANNUAL_REPORT", "2026-06-16", "FY", "2025", false], ["QUARTERLY_REPORT", "2026-06-16", "Q1", "2026", false]]);
  // A full updated schedule after the change gives each report its own date: only the moved one changes.
  assert.deepEqual(reportRows(changeNotice(
    "Zarząd informuje o zmianie terminu przekazania raportu półrocznego za I półrocze 2026 roku z dnia 9 września 2026 roku na dzień 4 września 2026 roku. Zaktualizowane terminy: - raport roczny za 2025 rok - 30 marca 2026 r.; - raport półroczny za I półrocze 2026 roku - 4 września 2026 r."
  )).filter(([type]) => type === "ANNUAL_REPORT").filter(([, date]) => date === "2026-09-04"), []);
  // Two kinds in one phrase ("raportów rocznych i śródrocznego za rok 2025"): which period is meant is not clear.
  assert.deepEqual(reportRows(changeNotice(
    "Zarząd dokonuje zmiany terminu publikacji raportów rocznych i śródrocznego za rok 2025 oraz raportu kwartalnego za I kwartał 2026 roku. Nowy termin publikacji raportów: 29 maja 2026 roku."
  )), []);
  // A quarter without its number.
  assert.deepEqual(reportRows(changeNotice(
    "Zarząd zmienia termin publikacji raportu rocznego za rok 2025 oraz raportu kwartalnego za 2026 rok. Nowy termin publikacji raportów: 16 czerwca 2026 roku."
  )), []);
  // A period that has not ended by the new date is not a report that date can bring.
  assert.deepEqual(reportRows(changeNotice(
    "Zarząd zmienia termin publikacji raportu rocznego za rok 2025 oraz raportu półrocznego za I półrocze 2026 roku. Nowy termin publikacji raportów: 16 czerwca 2026 roku."
  )), []);
});

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
  // One date for several reports, each named with its period and year: every one of them moves.
  assert.deepEqual(byId.get("gpw:489946"), [
    ["ANNUAL_REPORT", "2026-06-16", "FY", "2025", false], ["QUARTERLY_REPORT", "2026-06-16", "Q1", "2026", false],
  ]);
  // "I kw." is the first quarter; the schedule's "w roku obrotowym 2026" is not the moved report's year.
  assert.deepEqual(byId.get("gpw:489665"), [["QUARTERLY_REPORT", "2026-06-01", "Q1", "2026", false]]);
  assert.deepEqual(byId.get("gpw:487052"), [["ANNUAL_REPORT", "2026-04-30", "FY", "2025", false]]);
  const advances = gpwDividendNotices.flatMap((entry) => entry.expected.map((row) => row[0])).filter((identity) => identity.includes(":advance:"));
  assert.equal(new Set(advances).size, 3, "three different advances, the request and resolution of Text being one");
});

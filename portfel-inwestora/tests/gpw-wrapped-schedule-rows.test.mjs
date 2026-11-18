import assert from "node:assert/strict";
import test from "node:test";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { gpwWrappedScheduleRows } from "./fixtures/gpw-wrapped-schedule-rows-2026-11-18.mjs";

const reportEvents = (text) => parseCorporateEventDocument(text)
  .filter((event) => event.eventType.endsWith("_REPORT"));
const asRows = (events) => events
  .map((event) => [
    event.eventType, event.eventDate, event.fiscalPeriod ?? null,
    event.fiscalYearLabel ?? (event.fiscalYear ? String(event.fiscalYear) : null),
    Boolean(event.isScheduleChange),
  ])
  .sort((left, right) => left.join("|").localeCompare(right.join("|")));

// The fixture entries are real filings. Each one is pinned to the complete set
// of report events its source announces: a lost row, a wrong period/year label
// and an invented event (for example a regulation date) all fail the same way.
for (const entry of gpwWrappedScheduleRows) {
  test(`${entry.issuer} (${entry.id}): ${entry.note}`, () => {
    const events = reportEvents(entry.text);
    assert.deepEqual(asRows(events), [...entry.expected].sort((left, right) => left.join("|").localeCompare(right.join("|"))));
    // Every event the policy lets through must be complete and unflagged.
    for (const event of events) {
      assert.ok(event.fiscalPeriod, `${entry.id} ${event.eventDate}: period`);
      assert.ok(event.fiscalYear, `${entry.id} ${event.eventDate}: year`);
      assert.equal(event.requiresReview ?? false, false, `${entry.id} ${event.eventDate}: ${event.reviewReasons}`);
    }
  });
}

test("a regulation date glued to the last list row is never a publication date", () => {
  const asb = gpwWrappedScheduleRows.find((entry) => entry.id === "gpw:479537");
  assert.match(asb.text, /26 marca 2026 r\.Rada Dyrektorów/u);
  assert.equal(reportEvents(asb.text).some((event) => event.eventDate.startsWith("2018-")), false);
});

test("the start of a fiscal-period range is not a publication date", () => {
  const events = reportEvents(`Terminy publikacji raportów okresowych w roku obrotowym 2026/27
Zarząd podaje terminy publikacji raportów okresowych:
1.Jednostkowy raport roczny za rok obrotowy 2025/26 tj. okres od 1 kwietnia 2025 roku
do 31 marca 2026 roku - publikacja dnia 25 czerwca 2026 r.`);
  assert.deepEqual(asRows(events), [["ANNUAL_REPORT", "2026-06-25", "FY", "2025/2026", false]]);
});

test("a row that closed its list item with a semicolon does not absorb the next date-first row", () => {
  const events = reportEvents(`Terminy publikacji raportów okresowych w roku obrotowym 2026
Zarząd podaje daty przekazywania raportów okresowych w roku obrotowym 2026:
- 01 czerwca 2026 r. - Kwartalny skonsolidowany raport za I kwartał 2026 roku zawierający
jednostkową kwartalną informację finansową;
- 30 września 2026 r. - Skonsolidowany raport półroczny zawierający półroczne skrócone
jednostkowe sprawozdanie finansowe za okres od 01.01.2026 roku do 30.06.2026 roku;`);
  assert.deepEqual(asRows(events), [
    ["HALF_YEAR_REPORT", "2026-09-30", "H1", "2026", false],
    ["QUARTERLY_REPORT", "2026-06-01", "Q1", "2026", false],
  ]);
});

test("rows that name no year take it from a calendar-year schedule title", () => {
  // "… w 2026 roku": the annual report published in it concerns 2025, the half-year report 2026.
  const events = reportEvents(`Harmonogram przekazywania raportów okresowych w 2026 roku
Raport roczny: 30 kwietnia 2026 r.
Raport półroczny: 30 września 2026 r.`);
  assert.deepEqual(asRows(events), [
    ["ANNUAL_REPORT", "2026-04-30", "FY", "2025", false],
    ["HALF_YEAR_REPORT", "2026-09-30", "H1", "2026", false],
  ]);
});

test("a title year does not label rows of an issuer with a non-calendar fiscal year", () => {
  const events = reportEvents(`Terminy publikacji raportów okresowych w 2026 roku
Zarząd podaje terminy publikacji w roku obrotowym trwającym od 1 października 2025 do 30 września 2026:
Raport półroczny: 30 maja 2026 r.`);
  assert.equal(events.length, 1);
  assert.equal(events[0].fiscalYearLabel ?? null, null);
  assert.deepEqual(events[0].reviewReasons, ["FISCAL_YEAR_NOT_EXPLICIT"]);
});

test("a quarter is expanded from its abbreviation only where it names a period", () => {
  const events = reportEvents(`Terminy publikacji raportów okresowych w 2026 roku
Skonsolidowane raporty kwartalne:
- za IV kw. 2025 roku - 26 lutego 2026 r.
- za I kw. 2026 roku - 7 maja 2026 r.`);
  assert.deepEqual(asRows(events), [
    ["QUARTERLY_REPORT", "2026-02-26", "Q4", "2025", false],
    ["QUARTERLY_REPORT", "2026-05-07", "Q1", "2026", false],
  ]);
});

test("a change notice that cites an old date stays with the correction lanes", () => {
  // Only one of the two dates may become an event, and it is the new one.
  const events = reportEvents(`Zmiana terminu publikacji raportu kwartalnego za I kwartał 2026 r.
Treść raportu:
Zarząd informuje o zmianie terminu publikacji raportu kwartalnego za I kwartał 2026 r.
Emitent ustalił następujący termin przekazania raportu kwartalnego za I kwartał 2026 r.: 08.05.2026 r.
Nowo ustalony termin przekazania raportu kwartalnego za I kwartał 2026 r. to: 29.05.2026 r.`);
  assert.deepEqual(asRows(events), [["QUARTERLY_REPORT", "2026-05-29", "Q1", "2026", true]]);
  assert.equal(events[0].previousEventDate, "2026-05-08");
});

// --- dates a schedule names without announcing a report on them --------------------------------------------

import { getReportScheduleNonPublicationDates } from "../src/lib/corporate-events.ts";

const fixtureText = (id) => gpwWrappedScheduleRows.find((entry) => entry.id === id).text;
const byDate = (dates) => new Map(dates.map((entry) => [entry.date, entry]));

test("LPP: the closing day of each fiscal quarter is named as such, and the real appointments are not", () => {
  const dates = byDate(getReportScheduleNonPublicationDates(fixtureText("gpw:480147")));
  assert.deepEqual(dates.get("2027-01-31")?.closes, { eventType: "QUARTERLY_REPORT", fiscalPeriod: "Q4", fiscalYear: 2026 });
  assert.deepEqual(dates.get("2026-04-30")?.closes, { eventType: "QUARTERLY_REPORT", fiscalPeriod: "Q1", fiscalYear: 2026 });
  for (const appointment of ["2026-03-26", "2026-06-11", "2026-09-17", "2026-12-03"]) {
    assert.equal(dates.has(appointment), false, appointment);
  }
});

test("a fiscal-year end is a boundary, never an appointment (Delko 30.06.2027)", () => {
  const dates = byDate(getReportScheduleNonPublicationDates(fixtureText("gpw:493765")));
  assert.equal(dates.get("2027-06-30")?.role, "PERIOD_BOUNDARY");
  for (const appointment of ["2026-10-29", "2026-11-25", "2027-03-25", "2027-05-26"]) {
    assert.equal(dates.has(appointment), false, appointment);
  }
});

test("the date of the cited regulation is a legal-act date (6 June 2025), not an appointment", () => {
  const dates = byDate(getReportScheduleNonPublicationDates(fixtureText("gpw:480814")));
  assert.equal(dates.get("2025-06-06")?.role, "LEGAL_ACT");
  assert.equal(dates.has("2026-04-29"), false);
});

// --- a change notice names the date it replaces ----------------------------------------------------------

test("each change notice carries the appointment it replaced, never a cited report's date", () => {
  const previous = {
    "gpw:500651": "2026-11-25", "gpw:500649": "2026-11-26", "gpw:499833": "2026-11-13", "gpw:476921": "2025-11-20",
    "gpw:485707": "2026-04-24", "gpw:475722": "2025-10-31", "gpw:488860": "2026-06-01", "gpw:489134": "2026-05-29",
    "gpw:488697": "2026-09-09", "gpw:475659": "2025-11-21", "gpw:485483": "2026-04-24", "gpw:499701": "2026-11-27",
  };
  for (const [id, date] of Object.entries(previous)) {
    const [event] = reportEvents(fixtureText(id));
    assert.equal(event.previousEventDate, date, id);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { assessReportPublicationBatch } from "../src/lib/report-schedule-publication.ts";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";

const report = (eventDate = "2026-11-20", overrides = {}) => ({
  eventType: "QUARTERLY_REPORT", eventDate, fiscalPeriod: "Q3", fiscalYear: 2026,
  isScheduleChange: false, ...overrides,
});

test("an explicit fiscal period and publication date can pass the read-side policy", () => {
  assert.deepEqual(assessReportPublicationBatch([report()]).map(({ publish, reasons }) => ({ publish, reasons })),
    [{ publish: true, reasons: [] }]);
});

test("an explicit official-style correction passes the gate with its old and new dates", () => {
  const parsed = parseCorporateEventDocument(
    "Zmiana terminu publikacji raportu kwartalnego za III kwartał 2026 roku z 1 listopada 2026 na 2 listopada 2026."
  );
  assert.deepEqual(parsed.map(({ previousEventDate, eventDate, isScheduleChange }) =>
    [previousEventDate, eventDate, isScheduleChange]), [["2026-11-01", "2026-11-02", true]]);
  assert.deepEqual(assessReportPublicationBatch(parsed).map(({ publish, reasons }) =>
    ({ publish, reasons })), [{ publish: true, reasons: [] }]);
});

test("legal-act and fiscal-end candidates needing review are quarantined", () => {
  const decisions = assessReportPublicationBatch([
    report("2025-06-06", { requiresReview: true, reviewReasons: ["LEGAL_ACT_DATE"] }),
    report("2027-06-30", { requiresReview: true, reviewReasons: ["FISCAL_PERIOD_END"] }),
  ]);
  assert.ok(decisions.every((decision) => !decision.publish));
  assert.deepEqual(decisions.map((decision) => decision.reasons[0]), ["LEGAL_ACT_DATE", "FISCAL_PERIOD_END"]);
});

test("two dates for one identity, unknown period and malformed date cannot publish", () => {
  const decisions = assessReportPublicationBatch([
    report("2026-11-20"), report("2026-11-21"),
    report("2026-11-22", { fiscalPeriod: undefined }),
    report("2026-11-31", { fiscalYear: undefined }),
  ]);
  assert.ok(decisions.slice(0, 2).every((decision) =>
    decision.reasons.includes("CONFLICTING_DATES_FOR_ONE_REPORT_IDENTITY")));
  assert.ok(decisions[2].reasons.includes("PERIOD_NOT_EXPLICIT"));
  assert.ok(decisions[3].reasons.includes("FISCAL_YEAR_NOT_EXPLICIT"));
  assert.ok(decisions[3].reasons.includes("INVALID_PUBLICATION_DATE"));
});

test("meeting and dividend events are unaffected by report publication policy", () => {
  const meetings = assessReportPublicationBatch([{ eventType: "GENERAL_MEETING", eventDate: "2026-12-01",
    isScheduleChange: false }, { eventType: "UPCOMING_DIVIDEND", eventDate: "2026-12-01",
    isScheduleChange: false }]);
  assert.ok(meetings.every((decision) => decision.publish));
});

// --- contradictory year: publish the report without the year, flagged (decision of 18.11.2026) -------------

const quarterRow = (label, date) => `Terminy publikacji raportów okresowych w 2026 roku
Skonsolidowane raporty kwartalne:
- za III kwartał ${label} roku - ${date}`;

test("Enter Air / Pharmena / IDM: 'Q3 2025' on a day in 2026 is published without the year and flagged", () => {
  const parsed = parseCorporateEventDocument(quarterRow("2025", "26 listopada 2026 r."));
  assert.equal(parsed.length, 1);
  assert.ok(parsed[0].reviewReasons.includes("REPORT_PERIOD_MAY_BE_OVERDUE"));
  const [decision] = assessReportPublicationBatch(parsed, { sourcePublishedAt: "2026-01-20T10:00:00.000Z" });
  assert.equal(decision.publish, true);
  assert.equal(decision.yearWithdrawn, true);
  assert.equal(decision.event.eventDate, "2026-11-26");
  assert.equal(decision.event.fiscalPeriod, "Q3");
  assert.equal(decision.event.fiscalYear, undefined);
  assert.equal(decision.event.fiscalYearLabel, undefined);
  assert.equal(decision.event.requiresReview, true);
});

test("ERG: 'Q3 2029' on a day in 2026 is published without the impossible year", () => {
  const parsed = parseCorporateEventDocument(quarterRow("2029", "19 listopada 2026 r."));
  const [decision] = assessReportPublicationBatch(parsed, { sourcePublishedAt: "2026-01-20T10:00:00.000Z" });
  assert.equal(decision.publish, true);
  assert.equal(decision.event.fiscalYear, undefined);
});

test("a date earlier than the announcement itself is a mistyped date, not a mistyped year (ATAL)", () => {
  const parsed = parseCorporateEventDocument(quarterRow("2026", "26 listopada 2025 r."));
  const [decision] = assessReportPublicationBatch(parsed, { sourcePublishedAt: "2026-01-20T10:00:00.000Z" });
  assert.equal(decision.publish, false);
  assert.ok(decision.reasons.includes("REPORT_DATE_NOT_AFTER_PERIOD_END"));
});

test("without the announcement date nothing is published without a year", () => {
  const [decision] = assessReportPublicationBatch(parseCorporateEventDocument(quarterRow("2025", "26 listopada 2026 r.")));
  assert.equal(decision.publish, false);
});

test("a contradictory year never publishes when the report type and period repeat, or for a change notice", () => {
  const base = { eventType: "QUARTERLY_REPORT", fiscalPeriod: "Q3", fiscalYear: 2024, eventDate: "2026-02-13",
    requiresReview: true, reviewReasons: ["REPORT_PERIOD_MAY_BE_OVERDUE"] };
  const context = { sourcePublishedAt: "2026-01-20T10:00:00.000Z" };
  const catchUp = assessReportPublicationBatch(
    [base, { ...base, fiscalYear: 2025, eventDate: "2026-12-29" }], context);
  assert.deepEqual(catchUp.map(({ publish }) => publish), [false, false]);
  const change = assessReportPublicationBatch([{ ...base, isScheduleChange: true }], context);
  assert.equal(change[0].publish, false);
});

test("a missing period or an invalid date is never published, whatever the year says", () => {
  const context = { sourcePublishedAt: "2026-01-20T10:00:00.000Z" };
  const noPeriod = assessReportPublicationBatch([{ eventType: "QUARTERLY_REPORT", fiscalYear: 2025,
    eventDate: "2026-11-26", requiresReview: true, reviewReasons: ["REPORT_PERIOD_MAY_BE_OVERDUE"] }], context);
  assert.equal(noPeriod[0].publish, false);
  const badDay = assessReportPublicationBatch([{ eventType: "QUARTERLY_REPORT", fiscalPeriod: "Q3", fiscalYear: 2025,
    eventDate: "2026-02-30", requiresReview: true, reviewReasons: ["REPORT_PERIOD_MAY_BE_OVERDUE"] }], context);
  assert.equal(badDay[0].publish, false);
});

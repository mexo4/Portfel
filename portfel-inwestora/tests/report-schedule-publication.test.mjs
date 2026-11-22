import test from "node:test";
import assert from "node:assert/strict";
import { assessReportPublicationBatch, countReportReviewItems } from "../src/lib/report-schedule-publication.ts";
import { getCorporateEventIdentityKey, parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { gpwLateIssuerAndCorrectionNotices } from "./fixtures/gpw-late-issuer-and-correction-notices-2026-11-22.mjs";

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

// The sync result ("reviewed") feeds the calendar's data-quality health. The PostgreSQL contract test expects a
// late schedule to be "surfaced for review"; since 18.11.2026 such a row is published without a year (when its
// date still lies ahead of the announcement) or held back (when it does not): both are review items.
test("review items count held-back events and events published without a year, not clean ones", () => {
  const announced = { sourcePublishedAt: "2026-11-10T10:00:00.000Z" };
  const text = "Raport kwartalny za III kwartał 2025 r. zostanie opublikowany 18 listopada 2026 r.";
  const withoutYear = assessReportPublicationBatch(parseCorporateEventDocument(text), announced);
  assert.deepEqual(withoutYear.map(({ publish, yearWithdrawn }) => [publish, yearWithdrawn]), [[true, true]]);
  assert.equal(countReportReviewItems(withoutYear), 1);

  const heldBack = assessReportPublicationBatch(parseCorporateEventDocument(text),
    { sourcePublishedAt: "2026-11-19T10:00:00.000Z" });
  assert.deepEqual(heldBack.map(({ publish }) => publish), [false]);
  assert.equal(countReportReviewItems(heldBack), 1);

  const clean = assessReportPublicationBatch([report()], announced);
  assert.equal(countReportReviewItems(clean), 0);
  assert.equal(countReportReviewItems([...clean, ...withoutYear, ...heldBack]), 2);
  assert.equal(countReportReviewItems([]), 0);
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

// EKO EXPORT is years behind with its reports and re-dates them again and again (notices 11/2026 of 9 September and
// 12/2026 of 18 November 2026). "Q3 2024 on 30 November 2026" is not a typo: the stored row of that very report moves.
const noticeText = (notice) => `${notice.sourceTitle}\n${notice.title}\n${notice.text}`;
const reportEvents = (notice) => parseCorporateEventDocument(noticeText(notice))
  .filter((event) => event.eventType.endsWith("_REPORT"));
const rowOf = (event, date) => ({ identity: getCorporateEventIdentityKey(event), date });

test("a change notice of a chronically late issuer is published when it moves a stored row of that report", () => {
  const notice = gpwLateIssuerAndCorrectionNotices.eekChange500735;
  const events = reportEvents(notice);
  const context = { sourcePublishedAt: notice.publishedAt };
  assert.ok(events.length >= 1 && events.every((event) => event.isScheduleChange && event.previousEventDate === "2026-11-20"));
  // nothing stored for that report: the label is unconfirmed, the notice stays held (unchanged policy)
  assert.ok(assessReportPublicationBatch(events, context).every((decision) => !decision.publish));
  assert.ok(assessReportPublicationBatch(events, { ...context, knownRows: [{ identity: "QUARTERLY_REPORT:Q3:2025", date: "2026-11-20" }] })
    .every((decision) => !decision.publish), "another period on the same day confirms nothing");
  assert.ok(assessReportPublicationBatch(events, { ...context, knownRows: [{ identity: "QUARTERLY_REPORT:Q3:2024", date: "2026-11-27" }] })
    .every((decision) => !decision.publish), "the same report on another day confirms nothing");

  // the notice reads the report twice (a ":CONSOLIDATED" twin next to the plain identity the calendar stores); once the
  // plain reading is confirmed, the twin adds nothing to review
  assert.deepEqual(events.map((event) => getCorporateEventIdentityKey(event)),
    ["QUARTERLY_REPORT:Q3:2024:CONSOLIDATED", "QUARTERLY_REPORT:Q3:2024"]);
  const decisions = assessReportPublicationBatch(events, { ...context, knownRows: [{ identity: "QUARTERLY_REPORT:Q3:2024", date: "2026-11-20" }] });
  assert.equal(decisions.length, 1);
  assert.ok(decisions.every((decision) => decision.publish && decision.changeConfirmedByStoredRow && decision.reasons.length === 0));
  const [moved] = decisions;
  assert.deepEqual([moved.event.eventDate, moved.event.previousEventDate, moved.event.fiscalPeriod, moved.event.fiscalYear,
    moved.event.requiresReview], ["2026-11-30", "2026-11-20", "Q3", 2024, false]);
});

test("an older notice that the stored row already reflects is accepted, one that contradicts the row stays held", () => {
  const notice = gpwLateIssuerAndCorrectionNotices.eekChange496692;
  const events = reportEvents(notice);
  assert.equal(events.length, 10);
  const context = { sourcePublishedAt: notice.publishedAt };
  // the calendar already holds the dates this notice announced: the notice confirms them
  const applied = assessReportPublicationBatch(events, { ...context, knownRows: events.map((event) => rowOf(event, event.eventDate)) });
  assert.ok(applied.every((decision) => decision.publish), "all ten re-dated reports are stored with their new dates");
  // Q3 2024 has meanwhile moved on (to 30 November): this older notice no longer matches its row and cannot roll it back
  const q3 = events.find((event) => event.fiscalPeriod === "Q3" && event.fiscalYear === 2024);
  const knownAfterLaterNotice = events.map((event) => rowOf(event, event === q3 ? "2026-11-30" : event.eventDate));
  const later = assessReportPublicationBatch(events, { ...context, knownRows: knownAfterLaterNotice });
  assert.deepEqual(later.map((decision) => decision.publish), events.map((event) => event !== q3));
});

test("only a change with a complete identity can be confirmed by a stored row; schedules and typos are not affected", () => {
  const context = { sourcePublishedAt: "2026-01-20T10:00:00.000Z" };
  const known = [{ identity: "QUARTERLY_REPORT:Q3:", date: "2026-11-26" }, { identity: "QUARTERLY_REPORT:Q3:2025", date: "2026-11-26" }];
  const noYear = { eventType: "QUARTERLY_REPORT", fiscalPeriod: "Q3", eventDate: "2026-11-26", previousEventDate: "2026-11-19",
    isScheduleChange: true, requiresReview: true, reviewReasons: ["FISCAL_YEAR_NOT_EXPLICIT"] };
  assert.equal(assessReportPublicationBatch([noYear], { ...context, knownRows: known })[0].publish, false);
  // a plain schedule row with a contradictory year is still the typo policy's business, whatever is stored
  const typo = { eventType: "QUARTERLY_REPORT", fiscalPeriod: "Q3", fiscalYear: 2025, eventDate: "2026-11-26",
    requiresReview: true, reviewReasons: ["REPORT_PERIOD_MAY_BE_OVERDUE"] };
  const [decision] = assessReportPublicationBatch([typo], { ...context, knownRows: known });
  assert.deepEqual([decision.publish, decision.yearWithdrawn, decision.changeConfirmedByStoredRow], [true, true, undefined]);
  // another defect than the year keeps a change notice held
  const badDay = { ...noYear, fiscalYear: 2025, eventDate: "2026-02-30", reviewReasons: ["REPORT_PERIOD_MAY_BE_OVERDUE"] };
  assert.equal(assessReportPublicationBatch([badDay], { ...context, knownRows: [{ identity: "QUARTERLY_REPORT:Q3:2025", date: "2026-02-30" }] })[0].publish, false);
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

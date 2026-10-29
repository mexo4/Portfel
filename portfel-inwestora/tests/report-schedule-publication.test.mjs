import test from "node:test";
import assert from "node:assert/strict";
import { assessReportPublicationBatch } from "../src/lib/report-schedule-publication.ts";

const report = (eventDate = "2026-11-20", overrides = {}) => ({
  eventType: "QUARTERLY_REPORT", eventDate, fiscalPeriod: "Q3", fiscalYear: 2026,
  isScheduleChange: false, ...overrides,
});

test("an explicit fiscal period and publication date can pass the read-side policy", () => {
  assert.deepEqual(assessReportPublicationBatch([report()]).map(({ publish, reasons }) => ({ publish, reasons })),
    [{ publish: true, reasons: [] }]);
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

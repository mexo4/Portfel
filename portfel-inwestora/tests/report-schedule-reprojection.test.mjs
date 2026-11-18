import assert from "node:assert/strict";
import test from "node:test";
import { getReportScheduleProjectionStatus, planReportScheduleReprojection } from "../src/lib/report-schedule-reprojection.ts";

const sourceUrl = "https://pap-mediaroom.pl/official-schedule";
const row = (id, identity, urls = [sourceUrl], eventDate = "2026-10-26", eventType = "QUARTERLY_REPORT") => ({
  id, event_type: eventType, event_identity: identity, event_date: eventDate, source_urls: urls,
});
const event = (period, date = "2026-10-26", previousEventDate) => ({
  eventType: "QUARTERLY_REPORT", fiscalPeriod: period, fiscalYear: 2026,
  eventDate: date, previousEventDate, isScheduleChange: Boolean(previousEventDate),
});

test("reprojection removes only the source-owned false Q1 and retains Q3", () => {
  const original = [row("false-q1", "QUARTERLY_REPORT:Q1:2026"), row("true-q3", "QUARTERLY_REPORT:Q3:2026")];
  const plan = planReportScheduleReprojection(original, [event("Q3")], sourceUrl, true);
  assert.deepEqual(plan.deactivateIds, ["false-q1"]);
  assert.deepEqual(plan.retainedIds, ["true-q3"]);
  assert.deepEqual(planReportScheduleReprojection([original[1]], [event("Q3")], sourceUrl, true).deactivateIds, []);
});

test("a date correction retains event identity and ICS UID", () => {
  const plan = planReportScheduleReprojection([row("stable-id", "QUARTERLY_REPORT:Q3:2026")], [event("Q3", "2026-10-28")], sourceUrl, true);
  assert.deepEqual(plan.deactivateIds, []);
  assert.deepEqual(plan.retainedIds, ["stable-id"]);
});

test("a distinct old date is flagged for review, not automatically withdrawn", () => {
  const original = [{ ...row("unverified", "QUARTERLY_REPORT:Q1:2026"), event_date: "2026-04-22" }];
  const plan = planReportScheduleReprojection(original, [event("Q3")], sourceUrl, true);
  assert.deepEqual(plan.deactivateIds, []);
  assert.deepEqual(plan.ambiguousIds, ["unverified"]);
});

test("an explicit date-and-period correction retains the existing projection identity when source ownership is unique", () => {
  const existing = [row("stable-id", "QUARTERLY_REPORT:Q3:2025", [sourceUrl], "2026-11-27")];
  const plan = planReportScheduleReprojection(existing, [event("Q3", "2026-11-16", "2026-11-27")], sourceUrl, true);
  assert.deepEqual(plan.deactivateIds, []);
  assert.deepEqual(plan.retainedIds, ["stable-id"]);
  assert.deepEqual(plan.ambiguousIds, []);
  assert.deepEqual(plan.missingIdentities, []);
});

test("two successive explicit corrections continue to reuse the same event identity", () => {
  const first = planReportScheduleReprojection(
    [row("stable-id", "QUARTERLY_REPORT:Q3:2026", [sourceUrl], "2026-11-27")],
    [event("Q3", "2026-11-16", "2026-11-27")], sourceUrl, true
  );
  assert.deepEqual(first.retainedIds, ["stable-id"]);
  const second = planReportScheduleReprojection(
    [row("stable-id", "QUARTERLY_REPORT:Q3:2026", [sourceUrl], "2026-11-16")],
    [event("Q3", "2026-11-10", "2026-11-16")], sourceUrl, true
  );
  assert.deepEqual(second.deactivateIds, []);
  assert.deepEqual(second.retainedIds, ["stable-id"]);
  assert.deepEqual(second.missingIdentities, []);
});

test("an explicit correction does not guess when multiple same-type projections share the previous date", () => {
  const existing = [
    row("first", "QUARTERLY_REPORT:Q3:2025", [sourceUrl], "2026-11-27"),
    row("second", "QUARTERLY_REPORT:Q3:2024", [sourceUrl], "2026-11-27"),
  ];
  const plan = planReportScheduleReprojection(existing, [event("Q3", "2026-11-16", "2026-11-27")], sourceUrl, true);
  assert.deepEqual(plan.deactivateIds, []);
  assert.deepEqual(plan.ambiguousIds, ["first", "second"]);
  assert.deepEqual(plan.missingIdentities, ["QUARTERLY_REPORT:Q3:2026"]);
});

test("one source-owned incomplete legacy label is retained for in-place identity enrichment", () => {
  const existing = [row("stable-id", "QUARTERLY_REPORT::", [sourceUrl], "2026-11-05")];
  const plan = planReportScheduleReprojection(existing, [event("Q3", "2026-11-05")], sourceUrl, true);
  assert.deepEqual(plan.deactivateIds, []);
  assert.deepEqual(plan.retainedIds, ["stable-id"]);
  assert.deepEqual(plan.missingIdentities, []);
});

test("legacy-label enrichment fails closed for partial sources, collisions and shared provenance", () => {
  const incomplete = row("old", "QUARTERLY_REPORT::", [sourceUrl], "2026-11-05");
  const parsed = [event("Q3", "2026-11-05")];
  assert.deepEqual(planReportScheduleReprojection([incomplete], parsed, sourceUrl, false).deactivateIds, []);
  const shared = { ...incomplete, source_urls: [sourceUrl, "https://issuer.example/other"] };
  assert.deepEqual(planReportScheduleReprojection([shared], parsed, sourceUrl, true).ambiguousIds, ["old"]);
  const colliding = [incomplete, row("other", "QUARTERLY_REPORT:Q1:2026", [sourceUrl], "2026-11-05")];
  const plan = planReportScheduleReprojection(colliding, parsed, sourceUrl, true);
  assert.ok(!plan.retainedIds.includes("old"));
});

test("parser/PDF failure, empty output and another confirming source cannot withdraw an event", () => {
  const existing = [row("only", "QUARTERLY_REPORT:Q1:2026"), row("shared", "QUARTERLY_REPORT:Q1:2026", [sourceUrl, "https://issuer.example/schedule"])];
  assert.deepEqual(planReportScheduleReprojection(existing, [event("Q3")], sourceUrl, false).deactivateIds, []);
  assert.deepEqual(planReportScheduleReprojection(existing, [], sourceUrl, true).deactivateIds, []);
  const plan = planReportScheduleReprojection(existing, [event("Q3")], sourceUrl, true);
  assert.deepEqual(plan.deactivateIds, ["only"]);
  assert.deepEqual(plan.ambiguousIds, ["shared"]);
});

test("incomplete attachments remain retryable without withdrawing valid body projections", () => {
  assert.equal(getReportScheduleProjectionStatus(0, false), "PARSE_ERROR");
  assert.equal(getReportScheduleProjectionStatus(2, false), "PARSE_ERROR");
  assert.equal(getReportScheduleProjectionStatus(0, true), "NO_EVENT");
  assert.equal(getReportScheduleProjectionStatus(2, true), "SUCCESS");
  assert.deepEqual(planReportScheduleReprojection([row("existing", "QUARTERLY_REPORT:Q1:2026")], [event("Q3")], sourceUrl, false).deactivateIds, []);
});

// --- retirement with evidence, quarantine per identity (2026-11-18) ---------------------------------------

const lpp = (id, eventDate, identity = "QUARTERLY_REPORT:Q4:2026", urls = [sourceUrl]) => row(id, identity, urls, eventDate);
const periodBoundary = (date) => ({ date, role: "PERIOD_BOUNDARY" });

test("a stored row whose date the document names only as a period boundary is retired (LPP 31.01.2027)", () => {
  const plan = planReportScheduleReprojection(
    [lpp("lpp-q4", "2027-01-31"), row("lpp-q3", "QUARTERLY_REPORT:Q3:2026", [sourceUrl], "2026-12-03")],
    [event("Q3", "2026-12-03")], sourceUrl, true,
    { nonPublicationDates: [periodBoundary("2027-01-31")] }
  );
  assert.deepEqual(plan.deactivateIds, ["lpp-q4"]);
  assert.equal(plan.retirementReasons["lpp-q4"], "PERIOD_BOUNDARY_NOT_PUBLICATION");
  assert.deepEqual(plan.retainedIds, ["lpp-q3"]);
  assert.deepEqual(plan.ambiguousIds, []);
});

test("without evidence an unreproduced date stays active and is reported as ambiguous", () => {
  const plan = planReportScheduleReprojection(
    [lpp("lpp-q4", "2027-01-31")], [event("Q3", "2026-12-03")], sourceUrl, true,
    { nonPublicationDates: [periodBoundary("2027-02-28")] }
  );
  assert.deepEqual(plan.deactivateIds, []);
  assert.deepEqual(plan.ambiguousIds, ["lpp-q4"]);
});

test("a preliminary-results day is not a publication appointment either", () => {
  const plan = planReportScheduleReprojection(
    [lpp("prelim", "2027-02-05")], [event("Q3", "2026-12-03")], sourceUrl, true,
    { nonPublicationDates: [{ date: "2027-02-05", role: "PRELIMINARY_RESULTS" }] }
  );
  assert.equal(plan.retirementReasons.prelim, "PRELIMINARY_RESULTS_NOT_PUBLICATION");
});

test("evidence never retires a row another source confirms, nor anything after an incomplete read", () => {
  const evidence = { nonPublicationDates: [periodBoundary("2027-01-31")] };
  const shared = planReportScheduleReprojection(
    [lpp("shared", "2027-01-31", "QUARTERLY_REPORT:Q4:2026", [sourceUrl, "https://other.example/official"])],
    [event("Q3", "2026-12-03")], sourceUrl, true, evidence
  );
  assert.deepEqual(shared.deactivateIds, []);
  assert.deepEqual(shared.ambiguousIds, ["shared"]);
  const incomplete = planReportScheduleReprojection(
    [lpp("lpp-q4", "2027-01-31")], [event("Q3", "2026-12-03")], sourceUrl, false, evidence
  );
  assert.deepEqual(incomplete.deactivateIds, []);
  assert.deepEqual(incomplete.retainedIds, ["lpp-q4"]);
});

test("a quarantined event protects only the rows it explains, not the rest of the document", () => {
  const held = [{ eventType: "QUARTERLY_REPORT", fiscalPeriod: "Q3", fiscalYear: 2029, eventDate: "2026-11-19",
    requiresReview: true, reviewReasons: ["PUBLICATION_YEAR_CONFLICTS_WITH_PERIOD"] }];
  const plan = planReportScheduleReprojection(
    [row("explained", "QUARTERLY_REPORT:Q3:2029", [sourceUrl], "2026-11-19"),
      lpp("stale", "2027-01-31"),
      row("fine", "QUARTERLY_REPORT:Q1:2026", [sourceUrl], "2026-10-26")],
    [event("Q1", "2026-10-26")], sourceUrl, true,
    { held, nonPublicationDates: [periodBoundary("2027-01-31")] }
  );
  assert.deepEqual(plan.heldIds, ["explained"]);
  assert.deepEqual(plan.deactivateIds, ["stale"]);
  assert.deepEqual(plan.retainedIds, ["fine"]);
});

test("a mistyped-year row is retired when the same document announces its date for the right identity (IDM)", () => {
  const plan = planReportScheduleReprojection(
    [row("typo", "QUARTERLY_REPORT:Q3:2025", [sourceUrl], "2026-11-18")],
    [event("Q3", "2026-11-18")], sourceUrl, true
  );
  assert.deepEqual(plan.deactivateIds, ["typo"]);
  assert.equal(plan.retirementReasons.typo, "DATE_REPUBLISHED_UNDER_OTHER_IDENTITY");
});

// --- a period end taken for an appointment, whatever created the row ---------------------------------------

import { planPeriodEndRetirements } from "../src/lib/report-schedule-reprojection.ts";

const closesQ4 = { date: "2027-01-31", role: "PERIOD_BOUNDARY",
  closes: { eventType: "QUARTERLY_REPORT", fiscalPeriod: "Q4", fiscalYear: 2026 } };

test("a row that is exactly the closing day of its own period is retired whichever source made it (LPP via PAP)", () => {
  const rows = [
    row("lpp-q4", "QUARTERLY_REPORT:Q4:2026", ["https://pap-mediaroom.pl/lpp-1-2026"], "2027-01-31"),
    row("lpp-q3", "QUARTERLY_REPORT:Q3:2026", [sourceUrl], "2026-12-03"),
    row("same-day-other-period", "QUARTERLY_REPORT:Q1:2027", [sourceUrl], "2027-01-31"),
  ];
  assert.deepEqual(planPeriodEndRetirements(rows, [closesQ4], [event("Q3", "2026-12-03")]), ["lpp-q4"]);
});

test("without a closing statement, or when the document announces that identity that day, nothing is retired", () => {
  const rows = [row("lpp-q4", "QUARTERLY_REPORT:Q4:2026", [sourceUrl], "2027-01-31")];
  assert.deepEqual(planPeriodEndRetirements(rows, [{ date: "2027-01-31", role: "PERIOD_BOUNDARY" }], []), []);
  assert.deepEqual(planPeriodEndRetirements(rows, [closesQ4], [event("Q4", "2027-01-31")]).length, 0);
  assert.deepEqual(planPeriodEndRetirements(rows, [], []), []);
});

// --- a row shared by two copies of one notice (gpw.pl + PAP) ----------------------------------------------

import { planSharedRowRetirements } from "../src/lib/report-schedule-reprojection.ts";

const papUrl = "https://pap-mediaroom.pl/same-notice";
const annualFy = (identityYear, date = "2027-09-30") => ({ eventType: "ANNUAL_REPORT", fiscalPeriod: "FY",
  fiscalYear: identityYear, fiscalYearLabel: `${identityYear - 1}/${identityYear}`, eventDate: date });

test("an incomplete row shared by two copies of one notice is retired when both now publish the complete identity", () => {
  const shared = row("fy", "ANNUAL_REPORT:FY:", [sourceUrl, papUrl], "2027-09-30", "ANNUAL_REPORT");
  const both = new Map([[papUrl, { published: [annualFy(2027)] }]]);
  assert.deepEqual(planSharedRowRetirements([shared], sourceUrl, [annualFy(2027)], both), ["fy"]);
});

test("one source that still supports the row's identity, or that cannot be re-read, keeps it", () => {
  const shared = row("fy", "ANNUAL_REPORT:FY:2027", [sourceUrl, papUrl], "2027-09-30", "ANNUAL_REPORT");
  const supports = new Map([[papUrl, { published: [{ ...annualFy(2027), fiscalYearLabel: undefined }] }]]);
  // this document republishes the date under another label, the other copy still says FY 2027
  const labelled = { ...annualFy(2027), fiscalYear: 2028, fiscalYearLabel: "2027/2028" };
  assert.deepEqual(planSharedRowRetirements([shared], sourceUrl, [labelled], supports), []);
  assert.deepEqual(planSharedRowRetirements([shared], sourceUrl, [labelled], new Map()), []);
  assert.deepEqual(planSharedRowRetirements([shared], sourceUrl, [labelled], new Map([[papUrl, undefined]])), []);
});

test("a shared row is untouched when this document does not announce its date for that report type", () => {
  const shared = row("fy", "ANNUAL_REPORT:FY:", [sourceUrl, papUrl], "2027-09-30", "ANNUAL_REPORT");
  const both = new Map([[papUrl, { published: [] }]]);
  assert.deepEqual(planSharedRowRetirements([shared], sourceUrl, [annualFy(2027, "2027-10-05")], both), []);
});

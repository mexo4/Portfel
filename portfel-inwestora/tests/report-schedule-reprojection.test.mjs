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

import assert from "node:assert/strict";
import test from "node:test";
import { planReportScheduleReprojection } from "../src/lib/report-schedule-reprojection.ts";

const sourceUrl = "https://pap-mediaroom.pl/official-schedule";
const row = (id, identity, urls = [sourceUrl]) => ({
  id, event_identity: identity, event_date: "2026-10-26", source_urls: urls,
});
const event = (period, date = "2026-10-26") => ({
  eventType: "QUARTERLY_REPORT", fiscalPeriod: period, fiscalYear: 2026,
  eventDate: date, isScheduleChange: false,
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

test("parser/PDF failure, empty output and another confirming source cannot withdraw an event", () => {
  const existing = [row("only", "QUARTERLY_REPORT:Q1:2026"), row("shared", "QUARTERLY_REPORT:Q1:2026", [sourceUrl, "https://issuer.example/schedule"])];
  assert.deepEqual(planReportScheduleReprojection(existing, [event("Q3")], sourceUrl, false).deactivateIds, []);
  assert.deepEqual(planReportScheduleReprojection(existing, [], sourceUrl, true).deactivateIds, []);
  const plan = planReportScheduleReprojection(existing, [event("Q3")], sourceUrl, true);
  assert.deepEqual(plan.deactivateIds, ["only"]);
  assert.deepEqual(plan.ambiguousIds, ["shared"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildReportReprojectionActionPreview } from "../scripts/gpw-reprojection-action-plan.mjs";
import { planReportScheduleReprojection } from "../src/lib/report-schedule-reprojection.ts";

const sourceUrl = "https://official.example/schedule";
const report = (period, date, previousEventDate) => ({
  eventType: "QUARTERLY_REPORT", fiscalPeriod: period, fiscalYear: 2026,
  eventDate: date, previousEventDate, isScheduleChange: Boolean(previousEventDate),
  sourceEvidence: "Raport kwartalny: oficjalny termin publikacji.",
});
const existing = (id, period, date, urls = [sourceUrl]) => ({
  id, event_type: "QUARTERLY_REPORT", event_identity: `QUARTERLY_REPORT:${period}:2026`,
  event_date: date, active: true, source_urls: urls,
});
const preview = ({ parsed, rows = [], issuerRows = rows, complete = true, resolved = true }) => {
  const plan = planReportScheduleReprojection(rows, parsed, sourceUrl, complete);
  return buildReportReprojectionActionPreview({
    sourceId: "gpw:123", sourceUrl, publishedAt: "2026-10-01T12:00:00Z",
    parsed, existing: rows, issuerEvents: issuerRows, issuerResolved: resolved,
    parseComplete: complete, plan,
  });
};

test("read-only preview proposes a stable-ID UPDATE for a new publication date", () => {
  const actions = preview({ parsed: [report("Q3", "2026-10-28")],
    rows: [existing("stable-id", "Q3", "2026-10-26")] });
  assert.deepEqual(actions.map((action) => action.action), ["UPDATE"]);
  assert.equal(actions[0].existingId, "stable-id");
  assert.equal(actions[0].before.date, "2026-10-26");
  assert.equal(actions[0].proposedAfter.date, "2026-10-28");
  assert.equal(actions[0].requiresSourcePriorityCheck, true);
  assert.match(actions[0].sourceEvidence, /oficjalny termin/);
});

test("read-only preview distinguishes missing events from already existing issuer projections", () => {
  const event = report("Q1", "2026-05-20");
  assert.deepEqual(preview({ parsed: [event] }).map((action) => action.action), ["INSERT"]);
  const shared = existing("other-source-id", "Q1", "2026-05-20", ["https://other.example/report"]);
  assert.deepEqual(preview({ parsed: [event], issuerRows: [shared] }).map((action) => action.action), ["LINK_SOURCE"]);
});

test("a correction on a new URL preserves the issuer event ID and links its new source", () => {
  const old = existing("stable-id", "Q3", "2026-11-30", ["https://official.example/older"]);
  const actions = preview({ parsed: [report("Q3", "2026-10-28", "2026-11-30")], issuerRows: [old] });
  assert.deepEqual(actions.map((action) => action.action), ["UPDATE", "LINK_SOURCE"]);
  assert.ok(actions.every((action) => action.existingId === "stable-id"));
  assert.equal(actions[0].before.date, "2026-11-30");
  assert.equal(actions[0].proposedAfter.date, "2026-10-28");
  assert.ok(actions.every((action) => action.requiresSourcePriorityCheck === true));
});

test("a changed date on a new URL without explicit correction or complete source stays REVIEW", () => {
  const old = existing("stable-id", "Q3", "2026-11-30", ["https://official.example/older"]);
  const ambiguous = preview({ parsed: [report("Q3", "2026-10-28")], issuerRows: [old] });
  assert.deepEqual(ambiguous.map((action) => action.action), ["REVIEW"]);
  assert.equal(ambiguous[0].reason, "UNLINKED_SOURCE_DATE_CHANGE_REQUIRES_PRIORITY");
  assert.deepEqual(ambiguous[0].suggestedActions, ["UPDATE", "LINK_SOURCE"]);

  const partial = preview({ parsed: [report("Q3", "2026-10-28", "2026-11-30")],
    issuerRows: [old], complete: false });
  assert.ok(partial.some((action) => action.reason === "UNLINKED_SOURCE_DATE_CHANGE_REQUIRES_PRIORITY"));
  assert.ok(!partial.some((action) => action.action === "UPDATE"));
});

test("read-only preview updates one explicitly corrected prior identity without replacing its ID", () => {
  const actions = preview({
    parsed: [report("Q3", "2026-11-16", "2026-11-27")],
    rows: [existing("stable-id", "Q1", "2026-11-27")],
  });
  assert.deepEqual(actions.map((action) => action.action), ["UPDATE"]);
  assert.equal(actions[0].existingId, "stable-id");
  assert.equal(actions[0].reason, "EXPLICIT_CORRECTION_STABLE_ID");
});

test("a shared old projection or incomplete source is REVIEW, never an automatic deletion", () => {
  const shared = existing("shared", "Q1", "2026-10-26", [sourceUrl, "https://other.example/confirmation"]);
  const actions = preview({ parsed: [report("Q3", "2026-10-26")], rows: [shared] });
  assert.ok(actions.some((action) => action.action === "REVIEW"));
  assert.ok(!actions.some((action) => action.action === "DEACTIVATE"));
  const incomplete = preview({ parsed: [report("Q3", "2026-10-26")], rows: [existing("old", "Q1", "2026-10-26")], complete: false });
  assert.ok(incomplete.some((action) => action.reason === "SOURCE_ATTACHMENTS_INCOMPLETE"));
  assert.ok(!incomplete.some((action) => action.action === "DEACTIVATE"));
});

test("an exclusively sourced same-day false duplicate is a DEACTIVATE candidate", () => {
  const actions = preview({ parsed: [report("Q3", "2026-10-26")],
    rows: [existing("false-q1", "Q1", "2026-10-26"), existing("true-q3", "Q3", "2026-10-26")] });
  const deactivations = actions.filter((action) => action.action === "DEACTIVATE");
  assert.deepEqual(deactivations.map((action) => action.existingId), ["false-q1"]);
  assert.equal(deactivations[0].requiresSourcePriorityCheck, true);
});

test("unlinked issuer produces REVIEW rather than a speculative INSERT", () => {
  const actions = preview({ parsed: [report("Q1", "2026-05-20")], resolved: false });
  assert.deepEqual(actions.map((action) => action.action), ["REVIEW"]);
  assert.equal(actions[0].reason, "ISSUER_NOT_RELIABLY_LINKED");
});

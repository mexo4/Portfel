import assert from "node:assert/strict";
import test from "node:test";
import { buildGpwReprojectionManifest } from "../scripts/gpw-reprojection-manifest.mjs";

const gpw = (id) => `https://www.gpw.pl/komunikat?geru_id=${id}`;

test("source-reviewed false period-end projection is a deactivation candidate, never an executable write", () => {
  const id = "558db458-ce75-4ae4-9153-f7ae5a252e90";
  const manifest = buildGpwReprojectionManifest({ findings: [], projections: [],
    calendarAnomalies: [{ code: "INCOMPLETE_REPORT_LABEL", eventId: id, eventDate: "2027-06-30",
      identity: "QUARTERLY_REPORT::", missing: ["period", "fiscal-year"], sourceUrls: [gpw("493765")] }] });
  assert.equal(manifest.actions[0].eventId, id);
  assert.equal(manifest.actions[0].proposedAction, "DEACTIVATE");
  assert.deepEqual(manifest.actions[0].proposedState, { active: false });
  assert.equal(manifest.safeToApply, false);
});

test("a new or differently sourced anomaly fails closed as REVIEW", () => {
  const known = "558db458-ce75-4ae4-9153-f7ae5a252e90";
  const manifest = buildGpwReprojectionManifest({ findings: [], projections: [], calendarAnomalies: [
    { code: "INCOMPLETE_REPORT_LABEL", eventId: known, eventDate: "2027-06-30",
      identity: "QUARTERLY_REPORT::", sourceUrls: [gpw("999999")] },
    { code: "INCOMPLETE_REPORT_LABEL", eventId: "new-event", eventDate: "2027-07-01",
      identity: "ANNUAL_REPORT:FY:", sourceUrls: [gpw("1000000")] },
  ] });
  assert.ok(manifest.actions.every((item) => item.proposedAction === "REVIEW"));
  assert.equal(manifest.status, "INPUT_REVIEW_REQUIRED");
  assert.equal(manifest.safeToApply, false);
});

test("a reviewed collision preserves the precise row and proposes only the corrected old row", () => {
  const keep = "25113cff-c2c7-4060-8908-fa4686cf70df";
  const remove = "aaf7b124-46d3-433d-a611-946a55867196";
  const manifest = buildGpwReprojectionManifest({ findings: [], projections: [], calendarAnomalies: [
    { code: "SAME_ISSUER_DAY_REVIEW", key: "IDM:2026-11-18", rows: [
      { eventId: keep, identity: "QUARTERLY_REPORT:Q3:2026", sourceUrls: [gpw("480817")] },
      { eventId: remove, identity: "QUARTERLY_REPORT:Q3:2025", sourceUrls: [gpw("480804")] },
    ] },
  ] });
  assert.equal(manifest.actions.find((item) => item.eventId === keep)?.proposedAction, "NO_CHANGE");
  assert.equal(manifest.actions.find((item) => item.eventId === remove)?.proposedAction, "DEACTIVATE");
  assert.equal(manifest.safeToApply, false);
});

test("contradictory decisions for one stable ID fail closed instead of choosing an action", () => {
  const id = "cbaa3f37-2ade-4d51-a0ec-80dfb763999f";
  const manifest = buildGpwReprojectionManifest({ findings: [], projections: [], calendarAnomalies: [
    { code: "INCOMPLETE_REPORT_LABEL", eventId: id, eventDate: "2027-01-29",
      identity: "QUARTERLY_REPORT::2026", sourceUrls: [gpw("497077")] },
    { code: "SAME_ISSUER_DAY_REVIEW", key: "GRX:2027-01-29", rows: [
      { eventId: id, identity: "QUARTERLY_REPORT::2026", sourceUrls: [gpw("497077")] },
      { eventId: "different-keep", identity: "QUARTERLY_REPORT:Q2:2026/2027", sourceUrls: [gpw("497077")] },
    ] },
  ] });
  const action = manifest.actions.find((item) => item.eventId === id);
  assert.equal(action?.proposedAction, "REVIEW");
  assert.equal(action?.reason, "CONFLICTING_PROPOSALS");
  assert.equal(manifest.safeToApply, false);
});

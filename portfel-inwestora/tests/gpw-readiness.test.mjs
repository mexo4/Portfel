import assert from "node:assert/strict";
import test from "node:test";
import { assessGpwReadiness } from "../scripts/gpw-readiness.mjs";

const evidence = () => ({
  audit: { qualityGate: { parserRegressionFree: true }, antiTickerPolicy: { status: "PASS" } },
  sources: { coverage: [
    { date: "2026-10-19", status: "COMPLETE" },
    { date: "2026-10-20", status: "INCOMPLETE" },
  ], counts: { partial: 1, pending: 0 }, scope: { futureEventHorizon: {
    from: "2026-10-26", to: "2027-10-26", completeness: "NOT_VERIFIED" } } },
  projections: { findings: [{ code: "STALE_PROJECTION" }] },
  e2e: { status: "POSTGRES_E2E_PASS", nativePostgres: { status: "POSTGRES_E2E_PASS" } },
  strictGate: { status: "NO_GO", stages: { holdout: "HOLDOUT_NOT_VERIFIED" } },
});

test("code can be reviewed while independent data, source coverage and deployment remain unverified", () => {
  const result = assessGpwReadiness(evidence());
  assert.equal(result.codeReview.status, "REVIEWABLE_WITH_LIMITATIONS");
  assert.equal(result.parser.status, "NOT_VERIFIED");
  assert.equal(result.reprojection.status, "NOT_READY");
  assert.equal(result.synchronization.status, "NOT_VERIFIED");
  assert.equal(result.sourceCompleteness.publication.status, "INCOMPLETE");
  assert.equal(result.sourceCompleteness.futureEvents.status, "NOT_PROVEN");
  assert.equal(result.deployment.status, "NOT_READY");
});

test("a complete short publication window never implies future-event or market-wide completeness", () => {
  const input = evidence();
  input.sources.coverage[1].status = "COMPLETE";
  input.sources.counts.partial = 0;
  input.sources.sourcePublicationHorizon = { from: "2026-10-19", to: "2026-10-20", status: "WINDOW_PAGINATED" };
  input.sources.futureEventHorizon = { from: "2026-10-26", to: "2027-10-26", status: "NOT_VERIFIED" };
  const result = assessGpwReadiness(input);
  assert.equal(result.sourceCompleteness.publication.status, "COMPLETE_FOR_EXPLICIT_WINDOW_ONLY");
  assert.equal(result.sourceCompleteness.publication.daysAudited, 2);
  assert.equal(result.sourceCompleteness.publication.to, "2026-10-20");
  assert.equal(result.sourceCompleteness.futureEvents.status, "NOT_PROVEN");
  assert.equal(result.sourceCompleteness.futureEvents.to, "2027-10-26");
  assert.equal(result.deployment.status, "NOT_READY");
});

test("a manifest with unresolved identities cannot authorize reprojection even after HTTP and PostgreSQL tests", () => {
  const input = evidence();
  input.httpE2e = { status: "HTTP_E2E_PASS" };
  input.manifest = { status: "REVIEW_REQUIRED", safeToApply: false, unresolved: 1,
    isolatedReplay: { status: "PASS" } };
  input.isolatedReplay = { status: "ISOLATED_REPLAY_PASS_WITH_REVIEW_BLOCKED", testedActions: 42,
    blockedReviews: 1, http: { api: "PASS", ics: "PASS" } };
  const result = assessGpwReadiness(input);
  assert.equal(result.reprojection.status, "NOT_READY");
  assert.equal(result.reprojection.evidence.unresolved, 1);
  assert.equal(result.reprojection.evidence.replayedActions, 42);
  assert.equal(result.reprojection.evidence.blockedReviews, 1);
});

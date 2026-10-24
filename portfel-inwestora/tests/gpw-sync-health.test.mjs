import assert from "node:assert/strict";
import test from "node:test";
import { assessGpwSync, getGpwBatchStatus } from "../src/lib/gpw-sync-health.ts";

test("a drained bounded batch never asserts full calendar or source coverage", () => {
  const assessment = assessGpwSync({ batch: { errors: 0, pending: 0 } });
  assert.equal(assessment.batchStatus, "BATCH_COMPLETE");
  assert.equal(assessment.source.availability, "UNKNOWN");
  assert.equal(assessment.source.freshness, "UNKNOWN");
  assert.equal(assessment.historicalBackfill.status, "UNKNOWN");
  assert.equal(assessment.overlapRepair, "UNKNOWN");
  assert.equal(assessment.coverage.status, "UNASSESSED");
});

test("bounded batch, backfill, overlap, projections, and coverage are independent dimensions", () => {
  const assessment = assessGpwSync({
    nowMs: Date.parse("2026-10-24T12:00:00.000Z"),
    batch: { errors: 0, pending: 0 },
    source: {
      status: "SUCCESS",
      lastCheckedAt: "2026-10-24T11:55:00.000Z",
      lastSuccessAt: "2026-10-24T11:55:00.000Z",
      refreshTtlMs: 60 * 60 * 1_000,
      backfillComplete: false,
      nextBackfillCursor: 91,
      overlapDue: true,
      overlapComplete: true,
    },
    projections: { pending: 0, errors: 0, unmatched: 2, reviewed: 1 },
  });

  assert.equal(assessment.batchStatus, "BATCH_COMPLETE");
  assert.equal(assessment.source.availability, "AVAILABLE");
  assert.equal(assessment.source.freshness, "FRESH");
  assert.deepEqual(assessment.historicalBackfill, { status: "CONTINUING", nextCursor: 91 });
  assert.equal(assessment.overlapRepair, "COMPLETE");
  assert.equal(assessment.projections.batchStatus, "BATCH_COMPLETE");
  assert.equal(assessment.projections.dataQuality, "REVIEW_REQUIRED");
  assert.equal(assessment.coverage.status, "UNASSESSED");
});

test("source outage, stale state, active lock, and recent-overlap failure remain visible", () => {
  const cases = [
    { source: { status: "TEMPORARILY_UNAVAILABLE", errors: 1 }, expected: ["DEGRADED", "UNKNOWN"] },
    { source: { status: "SUCCESS", isStale: true }, expected: ["AVAILABLE", "STALE"] },
    { source: { status: "SUCCESS", locked: true }, expected: ["LOCKED", "UNKNOWN"] },
  ];
  for (const { source, expected } of cases) {
    const result = assessGpwSync({ source });
    assert.deepEqual([result.source.availability, result.source.freshness], expected);
  }

  assert.equal(assessGpwSync({
    source: { status: "SUCCESS", overlapDue: true, overlapComplete: false },
  }).overlapRepair, "INCOMPLETE");
  assert.equal(assessGpwSync({
    source: { status: "SUCCESS", overlapDue: false, overlapComplete: false },
  }).overlapRepair, "NOT_DUE");
});

test("unmatched and manually reviewed documents are quality findings, not hidden as success", () => {
  for (const projections of [
    { unmatched: 1 },
    { reviewed: 1 },
    { unmatched: 4, reviewed: 3 },
  ]) {
    assert.equal(assessGpwSync({ projections }).projections.dataQuality, "REVIEW_REQUIRED");
  }
  assert.equal(assessGpwSync({ projections: { unmatched: 0, reviewed: 0 } })
    .projections.dataQuality, "NO_REVIEW_ITEMS");
});

test("coverage requires a non-empty independently sourced inventory for an explicit window", () => {
  const assess = (overrides = {}) => assessGpwSync({ coverageEvidence: {
    fromDate: "2026-01-01",
    toDate: "2026-12-31",
    inventorySource: "official-exchange-inventory-2026-10-24",
    inventoryComplete: true,
    expectedSourceIds: ["gpw:1", "gpw:2", "gpw:3"],
    observedSourceIds: ["gpw:1", "gpw:2", "gpw:3"],
    ...overrides,
  } }).coverage;

  assert.deepEqual(assess(), {
    status: "VERIFIED_FOR_WINDOW",
    fromDate: "2026-01-01",
    toDate: "2026-12-31",
    inventorySource: "official-exchange-inventory-2026-10-24",
    expected: 3,
    observed: 3,
    missing: 0,
  });
  assert.equal(assess({ observedSourceIds: ["gpw:1", "gpw:3"] }).status, "PARTIAL");
  assert.equal(assess({ inventoryComplete: false }).status, "PARTIAL");
  assert.equal(assess({ expectedSourceIds: [], observedSourceIds: [] }).status, "PARTIAL");
  assert.equal(assess({ toDate: "2025-01-01" }).status, "UNASSESSED");
  assert.equal(assess({ inventorySource: "  " }).status, "UNASSESSED");
});

test("bounded batch assessment is deterministic and rejects invalid counters as failures", () => {
  for (let errors = 0; errors <= 20; errors += 1) {
    for (let pending = 0; pending <= 50; pending += 1) {
      const expected = errors > 0 ? "BATCH_FAILED" : pending > 0 ? "BATCH_INCOMPLETE" : "BATCH_COMPLETE";
      assert.equal(getGpwBatchStatus({ errors, pending }), expected);
    }
  }
  assert.equal(getGpwBatchStatus({ errors: -1, pending: Number.NaN }), "BATCH_FAILED");
  assert.equal(getGpwBatchStatus({ errors: Number.POSITIVE_INFINITY }), "BATCH_FAILED");
  assert.equal(assessGpwSync({ source: { status: "SUCCESS", errors: Number.NaN } }).source.availability, "DEGRADED");
  assert.equal(assessGpwSync({ projections: { pending: Number.NaN } }).projections.batchStatus, "BATCH_FAILED");
});

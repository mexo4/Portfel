import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGpwHoldout } from "../scripts/gpw-holdout-validation.mjs";

const intake = { selectionSeed: "frozen-v1", documents: [
  { id: "gpw:test-1", sourceBodyHash: "abc" }, { id: "gpw:test-2", sourceBodyHash: "def" },
  ...Array.from({ length: 28 }, (_, index) => ({ id: `gpw:negative-${index}`, sourceBodyHash: `hash-${index}` })),
] };
const review = (reviewerId, firstEvents = []) => ({ reviewerId, reviewedAt: "2026-10-27T12:00:00Z",
  intakeSeed: "frozen-v1", documents: [
    { id: "gpw:test-1", sourceBodyHash: "abc", reviewNote: "Checked official body", expectedEvents: firstEvents },
    { id: "gpw:test-2", sourceBodyHash: "def", reviewNote: "No calendar event", expectedEvents: [] },
    ...intake.documents.slice(2).map((item) => ({ id: item.id, sourceBodyHash: item.sourceBodyHash,
      reviewNote: "Checked official body: no calendar event", expectedEvents: [] })),
  ] });
const event = { eventType: "QUARTERLY_REPORT", eventDate: "2026-11-20", fiscalPeriod: "Q3",
  fiscalYear: 2026, sourceEvidence: "Official report publication sentence" };

test("holdout remains unscored without two independent source annotations", () => {
  assert.equal(evaluateGpwHoldout({ intake, reviewerA: review("A", [event]) }).status, "ANNOTATION_PENDING");
  assert.throws(() => evaluateGpwHoldout({ intake, reviewerA: review("A", [event]),
    reviewerB: review("A", [event]) }), /distinct/);
});

test("conflicting source reviews never produce precision or recall", () => {
  const result = evaluateGpwHoldout({ intake, reviewerA: review("A", [event]), reviewerB: review("B", []),
    parserEvents: [{ documentId: "gpw:test-1", ...event }] });
  assert.equal(result.status, "ANNOTATION_DISAGREEMENT");
  assert.equal(result.metrics, null);
});

test("reviewers disagreeing on status or fiscal year cannot silently reach consensus", () => {
  const result = evaluateGpwHoldout({ intake, reviewerA: review("A", [event]),
    reviewerB: review("B", [{ ...event, fiscalYear: 2025, status: "PROPOSED" }]) });
  assert.equal(result.status, "ANNOTATION_DISAGREEMENT");
  assert.deepEqual(result.disagreements, ["gpw:test-1"]);
});

test("only frozen independent labels score parser predictions per event category", () => {
  const result = evaluateGpwHoldout({ intake, reviewerA: review("A", [event]), reviewerB: review("B", [event]),
    parserEvents: [{ documentId: "gpw:test-1", eventType: "QUARTERLY_REPORT",
      eventDate: "2026-11-20", fiscalPeriod: "Q3", fiscalYear: 2026 },
    { documentId: "gpw:test-2", eventType: "GENERAL_MEETING", eventDate: "2026-12-01" }] });
  assert.equal(result.status, "INDEPENDENT_HOLDOUT_SCORED");
  assert.deepEqual([result.metrics.QUARTERLY_REPORT.tp, result.metrics.QUARTERLY_REPORT.fp,
    result.metrics.QUARTERLY_REPORT.fn, result.metrics.QUARTERLY_REPORT.fieldAccuracy], [1, 0, 0, 1]);
  assert.equal(result.metrics.GENERAL_MEETING.fp, 1);
});

test("stale source hashes and labels without source evidence are rejected", () => {
  const stale = review("A", [event]); stale.documents[0].sourceBodyHash = "changed";
  assert.throws(() => evaluateGpwHoldout({ intake, reviewerA: stale, reviewerB: review("B", [event]) }), /Source changed/);
  const noEvidence = review("A", [{ ...event, sourceEvidence: "" }]);
  assert.throws(() => evaluateGpwHoldout({ intake, reviewerA: noEvidence, reviewerB: review("B", [event]) }), /source quotation/);
});

test("inaccessible official attachments block a complete holdout score", () => {
  const partial = structuredClone(intake);
  partial.documents[0].attachmentReadIncomplete = true;
  const result = evaluateGpwHoldout({ intake: partial, reviewerA: review("A", [event]),
    reviewerB: review("B", [event]), parserEvents: [{ documentId: "gpw:test-1", ...event }] });
  assert.equal(result.status, "SOURCE_PARTIAL_HOLDOUT_BLOCKED");
  assert.equal(result.metrics, null);
  assert.deepEqual(result.incompleteSources, ["gpw:test-1"]);
});

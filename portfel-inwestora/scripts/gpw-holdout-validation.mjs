import assert from "node:assert/strict";

const eventTypes = new Set(["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT",
  "GENERAL_MEETING", "UPCOMING_DIVIDEND"]);
const datePattern = /^20\d{2}-\d{2}-\d{2}$/;
const consensusFields = ["eventType", "eventDate", "fiscalPeriod", "fiscalYear", "fiscalYearLabel",
  "status", "previousEventDate"];
const key = (item) => JSON.stringify(consensusFields.map((field) => item[field] ?? null));

const validateReview = (intake, review) => {
  assert.ok(review?.reviewerId && typeof review.reviewerId === "string");
  assert.ok(review?.reviewedAt && Number.isFinite(Date.parse(review.reviewedAt)));
  assert.equal(review?.intakeSeed, intake.selectionSeed, "Annotation must refer to the frozen intake");
  assert.equal(intake.documents?.length, 30, "The frozen holdout must contain 30 candidates");
  const candidates = new Map(intake.documents.map((item) => [item.id, item]));
  assert.equal(review.documents?.length, intake.documents.length, "Every candidate needs a review, including negatives");
  const labels = new Map();
  for (const item of review.documents) {
    const candidate = candidates.get(item.id);
    assert.ok(candidate, `Unknown candidate: ${item.id}`);
    assert.equal(item.sourceBodyHash, candidate.sourceBodyHash,
      `Source changed after holdout intake: ${item.id}`);
    assert.ok(Array.isArray(item.expectedEvents));
    assert.ok(typeof item.reviewNote === "string" && item.reviewNote.trim().length > 0);
    for (const event of item.expectedEvents) {
      assert.ok(eventTypes.has(event.eventType));
      assert.ok(datePattern.test(event.eventDate));
      assert.ok(typeof event.sourceEvidence === "string" && event.sourceEvidence.trim().length > 0,
        "Independent labels need a source quotation or precise source location");
    }
    assert.ok(!labels.has(item.id), `Duplicate reviewed document: ${item.id}`);
    assert.equal(new Set(item.expectedEvents.map(key)).size, item.expectedEvents.length,
      `Duplicate event labels: ${item.id}`);
    labels.set(item.id, item.expectedEvents);
  }
  return labels;
};

/** Two complete independent human reviews are required. Parser predictions
 * never become labels, and disagreements cannot be silently adjudicated. */
export const evaluateGpwHoldout = ({ intake, reviewerA, reviewerB, parserEvents }) => {
  const incompleteSources = intake.documents.filter((item) => item.attachmentReadIncomplete || !item.sourceBodyHash)
    .map((item) => item.id);
  if (!reviewerA || !reviewerB) return { status: "ANNOTATION_PENDING", metrics: null,
    incompleteSources,
    reason: "Two independent source-based review files are required; incomplete official documents also block full scoring." };
  if (incompleteSources.length) return { status: "SOURCE_PARTIAL_HOLDOUT_BLOCKED", metrics: null,
    incompleteSources, reason: "The frozen holdout includes incomplete source documents; obtain the official attachments and freeze a new intake before scoring." };
  assert.notEqual(reviewerA.reviewerId, reviewerB.reviewerId, "Reviewers must be distinct people");
  const a = validateReview(intake, reviewerA);
  const b = validateReview(intake, reviewerB);
  const disagreements = intake.documents.filter((document) =>
    JSON.stringify(a.get(document.id)?.map(key).sort()) !== JSON.stringify(b.get(document.id)?.map(key).sort()))
    .map((item) => item.id);
  if (disagreements.length) return { status: "ANNOTATION_DISAGREEMENT", metrics: null,
    disagreements, reason: "A separately documented adjudication is needed before scoring." };
  const predicted = new Map();
  for (const item of parserEvents ?? []) {
    if (!a.has(item.documentId)) continue;
    predicted.set(item.documentId, [...(predicted.get(item.documentId) ?? []), item]);
  }
  const categories = [...eventTypes];
  const metrics = Object.fromEntries(categories.map((eventType) => {
    let tp = 0; let fp = 0; let fn = 0; let fieldMatches = 0; let fieldChecks = 0;
    for (const document of intake.documents) {
      const expected = (a.get(document.id) ?? []).filter((item) => item.eventType === eventType);
      const actual = (predicted.get(document.id) ?? []).filter((item) => item.eventType === eventType);
      const remaining = [...actual];
      for (const item of expected) {
        const matchIndex = remaining.findIndex((candidate) => candidate.eventDate === item.eventDate);
        if (matchIndex < 0) { fn += 1; continue; }
        const match = remaining.splice(matchIndex, 1)[0];
        tp += 1;
        for (const field of ["fiscalPeriod", "fiscalYear", "fiscalYearLabel", "status", "previousEventDate"]) {
          if (item[field] === undefined) continue;
          fieldChecks += 1;
          if (String(match[field] ?? "") === String(item[field] ?? "")) fieldMatches += 1;
        }
      }
      fp += remaining.length;
    }
    return [eventType, { tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
      fieldAccuracy: fieldChecks ? fieldMatches / fieldChecks : null,
      fieldChecks }];
  }));
  return { status: "INDEPENDENT_HOLDOUT_SCORED", documents: intake.documents.length,
    reviewerIds: [reviewerA.reviewerId, reviewerB.reviewerId], metrics,
    limitation: "Consensus is not the same as proof of complete source coverage; partial attachments remain independently flagged." };
};

import assert from "node:assert/strict";
import test from "node:test";
import {
  auditGpwDocuments,
  auditGpwProjectionSnapshots,
  auditGpwSourceInventory,
  matchGpwAuditEvents,
} from "../src/lib/gpw-quality-audit.ts";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { gpwReferenceCorpus } from "./fixtures/gpw-reference-corpus-2026-10-24.mjs";
import { meetsIndependentAuditThreshold, validateIndependentHoldout } from "../scripts/gpw-quality-corpus.mjs";

test("GPW quality audit measures the source-annotated corpus without treating it as market coverage", () => {
  const report = auditGpwDocuments(gpwReferenceCorpus, parseCorporateEventDocument);

  assert.equal(report.scope.coverage, "FIXTURE_ONLY");
  assert.equal(report.scope.documents, gpwReferenceCorpus.length);
  assert.equal(report.totals.falsePositives, 0);
  assert.equal(report.totals.falseNegatives, 0);
  assert.equal(report.totals.precision, 1);
  assert.equal(report.totals.recall, 1);
  assert.ok(report.scope.limitations.some((entry) => entry.includes("market coverage")));
});

test("GPW quality audit classifies field mismatches and semantic anomalies by cause", () => {
  const documents = [{
    id: "quality-fixture",
    group: "test",
    issuer: "Fixture S.A.",
    sourceUrl: "https://issuer.example.test/report",
    parserInput: "Raport kwartalny za III kwartał 2026 roku zostanie opublikowany 20 listopada 2026 roku.",
    expectedEvents: [{ eventType: "QUARTERLY_REPORT", eventDate: "2026-11-20", fiscalPeriod: "Q1", fiscalYear: 2026 }],
  }];
  const report = auditGpwDocuments(documents, parseCorporateEventDocument);

  assert.ok(report.findings.some((entry) => entry.code === "WRONG_REPORT_PERIOD" && entry.classification === "PARSER_ERROR"));

  const exactDuplicate = auditGpwDocuments([{ ...documents[0], expectedEvents: [], parserInput: "fixture duplicate source" }], () => ([
    { eventType: "GENERAL_MEETING", eventDate: "2026-11-20", generalMeetingType: "NWZ", isScheduleChange: false },
    { eventType: "GENERAL_MEETING", eventDate: "2026-11-20", generalMeetingType: "NWZ", isScheduleChange: false },
  ]));
  assert.ok(exactDuplicate.findings.some((entry) => entry.code === "DUPLICATE_LOGICAL_EVENT"));
});

test("GPW event matching is deterministic and explains a field mismatch instead of manufacturing omissions", () => {
  const [match] = matchGpwAuditEvents(
    [{ eventType: "QUARTERLY_REPORT", eventDate: "2026-11-20", fiscalPeriod: "Q3", fiscalYear: 2026 }],
    [{ eventType: "QUARTERLY_REPORT", eventDate: "2026-11-20", fiscalPeriod: "Q1", fiscalYear: 2026, isScheduleChange: false }],
  );

  assert.equal(match.status, "FIELD_MISMATCH");
  assert.deepEqual(match.mismatchedFields, ["fiscalPeriod"]);
});

test("GPW projection comparison reports missing and stale rows without prescribing a destructive repair", () => {
  const findings = auditGpwProjectionSnapshots([
    { id: "source-1", documentId: "doc-1", issuer: "Fixture S.A.", identity: "QUARTERLY_REPORT:Q3:2026", eventDate: "2026-11-20" },
    { id: "source-2", documentId: "doc-2", issuer: "Fixture S.A.", identity: "HALF_YEAR_REPORT:H1:2026", eventDate: "2026-09-30", sourceUpdatedAt: "2026-09-01T12:00:00.000Z" },
  ], [
    { id: "projection-2", issuer: "Fixture S.A.", identity: "HALF_YEAR_REPORT:H1:2026", eventDate: "2026-09-25", projectionUpdatedAt: "2026-08-01T12:00:00.000Z" },
  ]);

  assert.equal(findings.filter((entry) => entry.code === "STALE_PROJECTION").length, 3);
  assert.ok(findings.every((entry) => entry.code === "STALE_PROJECTION"));
  assert.ok(findings.every((entry) => entry.component === "PROJECTION"));
});

test("GPW projection comparison matches an official report despite different issuer display names", () => {
  const findings = auditGpwProjectionSnapshots([
    { id: "source", documentId: "gpw:499171", issuer: "AB SPÓŁKA AKCYJNA",
      identity: "HALF_YEAR_REPORT:H1:2026/2027", eventDate: "2027-06-08",
      sourceUrl: "https://www.gpw.pl/komunikat?geru_id=499171&title=New+heading" },
  ], [
    { id: "projection", issuer: "AB S.A.", identity: "HALF_YEAR_REPORT:H1:2026/2027",
      eventDate: "2027-06-08", sourceUrl: "https://www.gpw.pl/komunikat?geru_id=475396",
      sourceUrls: ["https://www.gpw.pl/komunikat?geru_id=475396",
        "https://www.gpw.pl/komunikat?title=Old+heading&geru_id=499171"] },
  ]);
  assert.deepEqual(findings, []);
});

test("GPW projection comparison reports a stale identity, not a missing document, for linked official source", () => {
  const url = "https://www.gpw.pl/komunikat?geru_id=499171";
  const findings = auditGpwProjectionSnapshots([
    { id: "source", issuer: "PLAB00000019", identity: "HALF_YEAR_REPORT:H1:2026/2027",
      eventDate: "2027-06-08", sourceUrl: `${url}&title=New` },
  ], [
    { id: "projection", issuer: "PLAB00000019", identity: "HALF_YEAR_REPORT:H1::UNIT",
      eventDate: "2027-06-08", sourceUrl: `${url}&title=Old` },
  ]);
  assert.ok(findings.some((item) => item.code === "AMBIGUOUS_EVENT_IDENTITY"));
  assert.ok(findings.every((item) => item.code !== "MISSING_SOURCE_DOCUMENT"));
});

test("GPW source inventory makes partial fetches and unparsed documents explicit resync candidates", () => {
  const report = auditGpwSourceInventory([
    { id: "a", issuer: "Fixture A", sourceUrl: "https://issuer.example/a", fetchStatus: "FETCHED", parseStatus: "NOT_ATTEMPTED" },
    { id: "b", issuer: "Fixture B", sourceUrl: "https://issuer.example/b", fetchStatus: "PARTIAL", parseStatus: "PARTIAL" },
    { id: "c", issuer: "Fixture C", fetchStatus: "DISCOVERED", parseStatus: "NOT_ATTEMPTED" },
  ]);

  assert.deepEqual(report.resyncRequiredDocumentIds, ["a", "b", "c"]);
  assert.ok(report.findings.some((entry) => entry.code === "INCOMPLETE_DOCUMENT"));
  assert.ok(report.findings.some((entry) => entry.code === "MISSING_SOURCE_DOCUMENT"));
  assert.ok(report.findings.every((entry) => entry.suggestedAction.length > 0));
});

test("GPW projection comparison detects cache divergence without prescribing a data overwrite", () => {
  const findings = auditGpwProjectionSnapshots([
    { id: "source", issuer: "Fixture", identity: "QUARTERLY_REPORT:Q1:2026", eventDate: "2026-05-20" },
  ], [
    { id: "projection", issuer: "Fixture", identity: "QUARTERLY_REPORT:Q1:2026", eventDate: "2026-05-20" },
  ], [
    { id: "cache", issuer: "Fixture", identity: "QUARTERLY_REPORT:Q1:2026", eventDate: "2026-05-19" },
  ]);

  assert.equal(findings.filter((entry) => entry.code === "CACHE_MISMATCH").length, 1);
  assert.equal(findings.find((entry) => entry.code === "CACHE_MISMATCH")?.component, "CACHE");
});

test("independent holdout rejects parser-derived or single-review evidence", () => {
  const result = validateIndependentHoldout([{
    id: "not-independent", issuer: "Fixture", sourceUrl: "https://issuer.example/test",
    expectedEvents: [], reviewStatus: "PENDING_SECOND_ANNOTATION", reviewers: [{ reviewerId: "one" }],
  }]);
  assert.equal(result.valid.length, 0);
  assert.deepEqual(result.invalid[0]?.reasons.sort(), [
    "evidence", "parserFrozenAt", "reviewStatus", "sourceHash", "twoIndependentReviewers",
  ]);
});

test("full-audit gate requires 100 reference documents and a separate 30-document holdout", () => {
  assert.equal(meetsIndependentAuditThreshold({ referenceDocuments: 99, independentDocuments: 100, invalidHoldoutDocuments: 0 }), false);
  assert.equal(meetsIndependentAuditThreshold({ referenceDocuments: 100, independentDocuments: 29, invalidHoldoutDocuments: 0 }), false);
  assert.equal(meetsIndependentAuditThreshold({ referenceDocuments: 100, independentDocuments: 30, invalidHoldoutDocuments: 1 }), false);
  assert.equal(meetsIndependentAuditThreshold({ referenceDocuments: 100, independentDocuments: 30, invalidHoldoutDocuments: 0 }), true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { assessGpwQualityGate } from "../scripts/gpw-quality-gate.mjs";

const metrics = (expected, { period = false, correction = false } = {}) => ({
  expected, precision: 1, recall: 1, falsePositives: 0, falseNegatives: 0,
  fieldMismatches: 0, exactMatches: expected,
  dateAccuracy: { correct: expected, total: expected },
  periodAccuracy: { correct: period ? expected : 0, total: period ? expected : 0 },
  fiscalYearAccuracy: { correct: period ? expected : 0, total: period ? expected : 0 },
  correctionAccuracy: { correct: correction ? 1 : 0, total: correction ? 1 : 0 },
});

const passingInput = () => ({
  audit: {
    qualityGate: { parserRegressionFree: true, fullIndependentAuditReady: true },
    antiTickerPolicy: { status: "PASS" }, findings: [],
    independentHoldout: { status: "MEASURED", documents: 30, report: {
      findings: [], metricsByCategory: {
        reports: metrics(5, { period: true, correction: true }),
        meetings: metrics(5), dividends: metrics(5),
      },
    } },
  },
  sources: { status: "SOURCE_WINDOW_COMPLETE_NOT_MARKET_COMPLETE",
    coverage: Array.from({ length: 365 }, () => ({ status: "COMPLETE" })),
    counts: { pending: 0, partial: 0 }, findings: [] },
  projections: { status: "SOURCE_WINDOW_PROJECTIONS_MATCH", databaseState: "READ_ONLY_SNAPSHOT_PASS",
    scope: { sourceStatus: "SOURCE_WINDOW_COMPLETE_NOT_MARKET_COMPLETE", publicApi: "PASS", ics: "PASS" },
    findings: [] },
  e2e: { status: "POSTGRES_E2E_PASS" },
});

test("strict gate has an attainable pass only with complete independent evidence", () => {
  assert.equal(assessGpwQualityGate(passingInput()).status, "FULL_AUDIT_PASS");
});

test("correct report type and date do not hide a wrong fiscal period in holdout", () => {
  const input = passingInput();
  input.audit.independentHoldout.report.metricsByCategory.reports.fieldMismatches = 1;
  input.audit.independentHoldout.report.metricsByCategory.reports.exactMatches = 4;
  input.audit.independentHoldout.report.metricsByCategory.reports.periodAccuracy.correct = 4;
  assert.equal(assessGpwQualityGate(input).status, "NO_GO");
  assert.equal(assessGpwQualityGate(input).stages.holdout, "HOLDOUT_NOT_VERIFIED");
});

test("a confirmed holdout finding, unverified empty source day or missing correction annotation prevents pass", () => {
  const input = passingInput();
  input.audit.independentHoldout.report.findings.push({ code: "WRONG_PERIOD", confidence: "CONFIRMED" });
  assert.equal(assessGpwQualityGate(input).status, "NO_GO");
  input.audit.independentHoldout.report.findings = [];
  input.sources.coverage[0].status = "INCOMPLETE";
  assert.equal(assessGpwQualityGate(input).status, "NO_GO");
  input.sources.coverage[0].status = "COMPLETE";
  input.audit.independentHoldout.report.metricsByCategory.reports.correctionAccuracy.total = 0;
  assert.equal(assessGpwQualityGate(input).status, "NO_GO");
});

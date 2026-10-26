import assert from "node:assert/strict";
import test from "node:test";
import { assessGpwPresentationSnapshot, assessGpwQualityGate } from "../scripts/gpw-quality-gate.mjs";
import { expandGpwStoredCalendarEvent } from "../src/lib/public-gpw-calendar.ts";
import { ICAL_CATEGORIES, serializeIcal, toIcalMilestones } from "../src/lib/gpw-ical.ts";

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
    findings: [], presentationSnapshot: { status: "SNAPSHOT_CONTRACT_PASS", scope: { rowsRead: 3 }, findings: [] } },
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

const sourceRow = (id, event_type, event_date, extra = {}) => ({
  id, ticker: "TST", company_name: "Testowa Spółka", event_type, event_date,
  event_time: null, fiscal_period: event_type === "QUARTERLY_REPORT" ? "Q3" : null,
  fiscal_year: event_type === "QUARTERLY_REPORT" ? 2026 : null,
  fiscal_year_label: null, general_meeting_type: event_type === "GENERAL_MEETING" ? "NWZ" : null,
  registration_date: null, dividend_per_share: null, dividend_currency: null,
  record_date: null, payment_date: null, status: "CONFIRMED", active: true,
  updated_at: "2026-10-25T12:00:00.000Z", source_url: `https://www.gpw.pl/komunikat?geru_id=${id}`,
  source_published_at: "2026-10-25T10:00:00.000Z", ...extra,
});

const presentationEvidence = (rows) => {
  const from = "2026-11-01";
  const to = "2026-12-31";
  const publicEvents = rows.flatMap((row) => expandGpwStoredCalendarEvent(row, from, to));
  const milestones = rows.flatMap((row) => toIcalMilestones(row, from, to));
  return { rows, publicEvents, milestones, icalText: serializeIcal(milestones, ICAL_CATEGORIES), from, to };
};

test("read-only presentation snapshot checks real public and ICS converters without claiming live endpoint coverage", () => {
  const rows = [
    sourceRow("report", "QUARTERLY_REPORT", "2026-11-20"),
    sourceRow("meeting", "GENERAL_MEETING", "2026-11-22"),
    sourceRow("dividend", "UPCOMING_DIVIDEND", "2026-11-25",
      { record_date: "2026-11-25", payment_date: "2026-12-01" }),
  ];
  const evidence = presentationEvidence(rows);
  const snapshot = assessGpwPresentationSnapshot(evidence);
  assert.equal(snapshot.status, "SNAPSHOT_CONTRACT_PASS");
  assert.equal(snapshot.scope.rowsRead, 3);
  assert.equal(snapshot.scope.icalMilestones, 4);
  const input = passingInput();
  input.projections.scope.publicApi = "NOT_RUN";
  input.projections.scope.ics = "NOT_RUN";
  input.projections.presentationSnapshot = snapshot;
  assert.equal(assessGpwQualityGate(input).status, "NO_GO",
    "pure snapshot evidence must never impersonate production API/ICS/cache observation");
});

test("presentation snapshot fails for missing public events, missing serialized ICS and uncovered categories", () => {
  const rows = [
    sourceRow("report", "QUARTERLY_REPORT", "2026-11-20"),
    sourceRow("meeting", "GENERAL_MEETING", "2026-11-22"),
    sourceRow("dividend", "UPCOMING_DIVIDEND", "2026-11-25",
      { record_date: "2026-11-25", payment_date: "2026-12-01" }),
  ];
  const evidence = presentationEvidence(rows);
  const bad = assessGpwPresentationSnapshot({ ...evidence,
    publicEvents: evidence.publicEvents.filter((event) => event.id !== "report"),
    icalText: serializeIcal(evidence.milestones.filter((event) => !event.uid.startsWith("meeting:")), ICAL_CATEGORIES),
  });
  assert.equal(bad.status, "SNAPSHOT_CONTRACT_FAIL");
  assert.ok(bad.findings.some((item) => item.code === "PUBLIC_EVENT_MISSING"));
  assert.ok(bad.findings.some((item) => item.code === "ICAL_SERIALIZED_EVENT_MISSING"));
  assert.ok(assessGpwPresentationSnapshot(presentationEvidence(rows.slice(0, 1))).findings
    .some((item) => item.code === "PRESENTATION_SAMPLE_INSUFFICIENT"));
});

test("presentation snapshot exposes a dividend record date absent from the public calendar model", () => {
  const rows = [
    sourceRow("report", "QUARTERLY_REPORT", "2026-11-20"),
    sourceRow("meeting", "GENERAL_MEETING", "2026-11-22"),
    sourceRow("dividend", "UPCOMING_DIVIDEND", "2026-11-24",
      { record_date: "2026-11-25", payment_date: "2026-12-01" }),
  ];
  const result = assessGpwPresentationSnapshot(presentationEvidence(rows));
  assert.equal(result.status, "SNAPSHOT_CONTRACT_FAIL");
  assert.ok(result.findings.some((item) => item.code === "DIVIDEND_RECORD_DATE_NOT_PUBLIC"));
});

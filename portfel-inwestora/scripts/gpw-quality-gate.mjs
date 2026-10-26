const minimumPrecision = 0.95;
const minimumRecall = 0.95;

/** A fail-closed release decision. A fixture PASS is deliberately insufficient. */
export const assessGpwQualityGate = ({ audit, sources, projections, e2e }) => {
  const reasons = [];
  const coverageDays = sources?.coverage?.length ?? 0;
  const regressionPass = audit?.qualityGate?.parserRegressionFree === true && audit?.antiTickerPolicy?.status === "PASS";
  const holdout = audit?.independentHoldout?.report;
  const holdoutVerified = audit?.qualityGate?.fullIndependentAuditReady === true &&
    audit?.independentHoldout?.status === "MEASURED" &&
    audit?.independentHoldout?.documents >= 30;
  const sourceComplete = sources?.status === "SOURCE_WINDOW_COMPLETE_NOT_MARKET_COMPLETE" &&
    coverageDays >= 365 && sources?.coverage?.every((day) => day.status === "COMPLETE") &&
    sources?.counts?.pending === 0 && sources?.counts?.partial === 0;
  const postgresPass = e2e?.status === "POSTGRES_E2E_PASS";
  const projectionPass = projections?.status === "SOURCE_WINDOW_PROJECTIONS_MATCH" &&
    projections?.databaseState === "READ_ONLY_SNAPSHOT_PASS" &&
    projections?.scope?.sourceStatus === "SOURCE_WINDOW_COMPLETE_NOT_MARKET_COMPLETE" &&
    projections?.scope?.publicApi === "PASS" && projections?.scope?.ics === "PASS";
  const categories = ["reports", "meetings", "dividends"];
  const metricsPass = holdoutVerified && categories.every((category) => {
    const item = holdout?.metricsByCategory?.[category];
    return item?.expected >= 5 && item?.precision >= minimumPrecision && item?.recall >= minimumRecall &&
      item?.falsePositives === 0 && item?.falseNegatives === 0 && item?.fieldMismatches === 0 &&
      item?.exactMatches === item?.expected && item?.dateAccuracy?.correct === item?.dateAccuracy?.total;
  });
  const reportFieldsPass = (holdout?.metricsByCategory?.reports?.periodAccuracy?.total ?? 0) >= 5 &&
    holdout.metricsByCategory.reports.periodAccuracy.correct === holdout.metricsByCategory.reports.periodAccuracy.total &&
    (holdout?.metricsByCategory?.reports?.fiscalYearAccuracy?.total ?? 0) >= 5 &&
    holdout.metricsByCategory.reports.fiscalYearAccuracy.correct === holdout.metricsByCategory.reports.fiscalYearAccuracy.total &&
    (holdout?.metricsByCategory?.reports?.correctionAccuracy?.total ?? 0) >= 1 &&
    holdout.metricsByCategory.reports.correctionAccuracy.correct === holdout.metricsByCategory.reports.correctionAccuracy.total;
  const holdoutFindingsPass = Array.isArray(holdout?.findings) && holdout.findings.length === 0;
  const unresolvedCritical = (audit?.findings ?? []).some((item) => item.confidence === "CONFIRMED") ||
    (sources?.findings ?? []).some((item) => item.code === "EXTRACTION_FAILED" || item.code === "PARSER_MISSED_EVENT") ||
    (projections?.findings ?? []).length > 0;

  if (!regressionPass) reasons.push("PASS_REGRESSION_ONLY unavailable: parser or anti-ticker regression suite failed/missing.");
  if (!holdoutVerified) reasons.push("HOLDOUT_NOT_VERIFIED: 100 source-annotated references and 30 independently double-reviewed holdout documents are required.");
  if (!metricsPass || !reportFieldsPass || !holdoutFindingsPass) reasons.push("Independent holdout must have no false positives, false negatives, field mismatches or findings; report periods, years and corrections require explicit exact checks.");
  if (!sourceComplete) reasons.push(`SOURCE_AUDIT_INCOMPLETE: need 365 completely paginated official-source publication days; observed ${coverageDays}.`);
  if (!postgresPass) reasons.push("POSTGRES_E2E_NOT_RUN: required isolated native PostgreSQL contract suite did not pass.");
  if (!projectionPass) reasons.push("Source/projection/API/ICS read-only comparison is incomplete or has findings.");
  if (unresolvedCritical) reasons.push("Unresolved critical source, parser or projection findings remain.");
  return {
    status: reasons.length ? "NO_GO" : "FULL_AUDIT_PASS",
    reasons,
    stages: {
      regression: regressionPass ? "PASS_REGRESSION_ONLY" : "FAIL",
      sources: sourceComplete ? "SOURCE_WINDOW_PASS" : "SOURCE_AUDIT_INCOMPLETE",
      holdout: holdoutVerified && metricsPass && reportFieldsPass && holdoutFindingsPass ? "HOLDOUT_PASS" : "HOLDOUT_NOT_VERIFIED",
      postgres: postgresPass ? "POSTGRES_E2E_PASS" : "POSTGRES_E2E_NOT_RUN",
      projections: projectionPass ? "PROJECTION_API_ICS_PASS" : "PROJECTION_API_ICS_INCOMPLETE",
    },
    thresholds: { referenceDocuments: 100, holdoutDocuments: 30, minimumSourceDays: 365,
      categoryExpectedEvents: 5, precision: minimumPrecision, recall: minimumRecall },
  };
};

const minimumPrecision = 0.95;
const minimumRecall = 0.95;

/** Compare a read-only database snapshot with the pure public-calendar and
 * iCalendar converters. This is a serialization contract, NOT an observation
 * of a deployed endpoint or its cache. */
export const assessGpwPresentationSnapshot = ({ rows, publicEvents, milestones, icalText, from, to, truncated = false }) => {
  const findings = [];
  const inWindow = (date) => typeof date === "string" && date >= from && date <= to;
  const publicKey = (id, kind, date) => `${id}|${kind}|${date}`;
  const icalKey = (uid, date) => `${uid}|${date}`;
  const expectedPublic = new Set();
  const expectedIcal = new Set();
  const counts = { reports: 0, meetings: 0, dividends: 0 };
  if (truncated) findings.push({ code: "PRESENTATION_SNAPSHOT_TRUNCATED", reason: "The read-only row limit was reached." });
  for (const row of rows) {
    const category = row.event_type === "GENERAL_MEETING" ? "meetings"
      : row.event_type === "UPCOMING_DIVIDEND" ? "dividends" : "reports";
    counts[category] += 1;
    if (category === "dividends") {
      if (inWindow(row.event_date)) {
        const kind = row.payment_date === row.event_date && row.record_date !== row.event_date
          ? "DIVIDEND_PAYMENT" : "UPCOMING_DIVIDEND";
        expectedPublic.add(publicKey(row.id, kind, row.event_date));
      }
      if (row.payment_date && row.payment_date !== row.event_date && inWindow(row.payment_date)) {
        expectedPublic.add(publicKey(`${row.id}:payment`, "DIVIDEND_PAYMENT", row.payment_date));
      }
      if (inWindow(row.record_date)) {
        expectedIcal.add(icalKey(`${row.id}:record@mexo.com.pl`, row.record_date));
        if (row.record_date !== row.event_date) findings.push({ code: "DIVIDEND_RECORD_DATE_NOT_PUBLIC", eventId: row.id,
          reason: "The public calendar model does not expose this source-backed record date as a separate milestone." });
      }
      if (inWindow(row.payment_date)) expectedIcal.add(icalKey(`${row.id}:payment@mexo.com.pl`, row.payment_date));
      if (!row.record_date && !row.payment_date && inWindow(row.event_date)) {
        expectedIcal.add(icalKey(`${row.id}:dividend-announcement@mexo.com.pl`, row.event_date));
      }
    } else if (inWindow(row.event_date)) {
      expectedPublic.add(publicKey(row.id, row.event_type, row.event_date));
      expectedIcal.add(icalKey(`${row.id}:${category === "meetings" ? "meeting" : "report"}@mexo.com.pl`, row.event_date));
    }
  }
  const actualPublic = publicEvents.map((event) => publicKey(event.id, event.kind, event.date));
  const actualIcal = milestones.map((event) => icalKey(event.uid, event.date));
  const compareSet = (expected, actual, missingCode, extraCode) => {
    const seen = new Set();
    for (const value of actual) {
      if (seen.has(value)) findings.push({ code: "PRESENTATION_DUPLICATE", value });
      seen.add(value);
      if (!expected.has(value)) findings.push({ code: extraCode, value });
    }
    for (const value of expected) if (!seen.has(value)) findings.push({ code: missingCode, value });
  };
  compareSet(expectedPublic, actualPublic, "PUBLIC_EVENT_MISSING", "PUBLIC_EVENT_UNEXPECTED");
  compareSet(expectedIcal, actualIcal, "ICAL_MILESTONE_MISSING", "ICAL_MILESTONE_UNEXPECTED");

  const unfolded = typeof icalText === "string" ? icalText.replace(/\r\n[ \t]/g, "") : "";
  if (!unfolded.startsWith("BEGIN:VCALENDAR\r\n") || !unfolded.endsWith("END:VCALENDAR\r\n")) {
    findings.push({ code: "ICAL_SERIALIZATION_INVALID", reason: "Missing calendar envelope." });
  }
  const serialized = [];
  for (const block of unfolded.matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)\r\nEND:VEVENT/g)) {
    const uid = block[1].match(/^UID:(.*)$/m)?.[1]?.replace(/\r$/, "");
    const date = block[1].match(/^DTSTART;VALUE=DATE:(\d{8})\r?$/m)?.[1];
    if (!uid || !date) {
      findings.push({ code: "ICAL_SERIALIZATION_INVALID", reason: "VEVENT lacks UID or DTSTART." });
      continue;
    }
    serialized.push(icalKey(uid, `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`));
  }
  compareSet(expectedIcal, serialized, "ICAL_SERIALIZED_EVENT_MISSING", "ICAL_SERIALIZED_EVENT_UNEXPECTED");
  if (Object.values(counts).some((count) => count === 0)) findings.push({ code: "PRESENTATION_SAMPLE_INSUFFICIENT",
    reason: "The snapshot must contain a report, meeting and dividend row." });
  return { status: findings.length ? "SNAPSHOT_CONTRACT_FAIL" : "SNAPSHOT_CONTRACT_PASS",
    scope: { from, to, rowsRead: rows.length, categories: counts, publicEvents: publicEvents.length,
      icalMilestones: milestones.length, serializedEvents: serialized.length,
      limitation: "Pure conversion of a read-only snapshot; deployed API, ICS endpoint and cache were not observed." },
    findings };
};

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
  const presentationSnapshotPass = projections?.presentationSnapshot?.status === "SNAPSHOT_CONTRACT_PASS" &&
    projections.presentationSnapshot.scope?.rowsRead > 0 && projections.presentationSnapshot.findings?.length === 0;
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
  if (!presentationSnapshotPass) reasons.push("Read-only public-calendar/ICS serialization snapshot was not verified.");
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
      presentationSnapshot: presentationSnapshotPass ? "SNAPSHOT_CONTRACT_PASS" : "SNAPSHOT_CONTRACT_NOT_VERIFIED",
      projections: projectionPass ? "PROJECTION_API_ICS_PASS" : "PROJECTION_API_ICS_INCOMPLETE",
    },
    thresholds: { referenceDocuments: 100, holdoutDocuments: 30, minimumSourceDays: 365,
      categoryExpectedEvents: 5, precision: minimumPrecision, recall: minimumRecall },
  };
};

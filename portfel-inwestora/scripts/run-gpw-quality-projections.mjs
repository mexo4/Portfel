import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { auditGpwProjectionSnapshots } from "../src/lib/gpw-quality-audit.ts";
import { getAuditOutputDirectory, getOption, printArtifactSummary, renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const outputDir = getAuditOutputDirectory();
const sourceFile = getOption("sources") ?? path.join(outputDir, "sources.json");
const sources = JSON.parse(await readFile(sourceFile, "utf8"));
if (!Array.isArray(sources.sourceEvents) || !Array.isArray(sources.documents)) {
  throw new Error("The source audit artifact has no source events/documents.");
}
const databaseUrl = process.env.MEXO_GPW_AUDIT_READONLY_DATABASE_URL;
let status = "NOT_RUN";
let databaseState = "NOT_CONFIGURED";
let projections = [];
let ingestion = [];
let findings = [];
let calendarAnomalies = [];
let calendarEventsRead = 0;

if (databaseUrl) {
  const caBase64 = process.env.POSTGRES_CA_CERT_BASE64;
  const caPath = process.env.POSTGRES_CA_CERT_PATH;
  const ca = caBase64 ? Buffer.from(caBase64, "base64").toString("utf8")
    : caPath ? await readFile(caPath, "utf8") : undefined;
  // pg-connection-string lets sslmode=require replace the explicit ssl.ca
  // object. Remove only that query parameter in memory when a verified CA is
  // supplied; never log or persist the resulting credential-bearing URI.
  const verifiedUrl = new URL(databaseUrl);
  if (ca) verifiedUrl.searchParams.delete("sslmode");
  const client = new pg.Client({
    connectionString: verifiedUrl.toString(),
    ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
    application_name: "mexo-gpw-readonly-audit",
    connectionTimeoutMillis: 10_000,
  });
  let phase = "CONNECT";
  try {
    await client.connect();
    phase = "READ_ONLY_TRANSACTION";
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const mode = await client.query("SELECT current_setting('transaction_read_only') AS read_only");
    if (mode.rows[0]?.read_only !== "on") throw new Error("READ_ONLY_NOT_ENFORCED");
    const sourceUrls = [...new Set(sources.documents.map((item) => item.sourceUrl).filter(Boolean))];
    const sourceIds = [...new Set(sources.documents.map((item) => item.id).filter(Boolean))];
    phase = "READ_ONLY_SELECT";
    const projectionRows = await client.query(`SELECT event.id, event.event_identity AS identity, event.event_date::text AS "eventDate",
          event.updated_at AS "projectionUpdatedAt", source.source_url AS "sourceUrl",
          COALESCE(instrument.isin, instrument.company_name) AS issuer
        FROM corporate_events AS event
        JOIN corporate_event_instruments AS instrument ON instrument.id = event.instrument_id
        JOIN corporate_event_sources AS source ON source.corporate_event_id = event.id
        WHERE event.active = TRUE AND source.source_url = ANY($1::text[])`, [sourceUrls]);
    const ingestionRows = await client.query(`SELECT source_id AS id, source_url AS "sourceUrl", issuer_name AS issuer,
          report_schedule_projection_status AS "reportScheduleStatus",
          corporate_events_projection_status AS "meetingStatus",
          dividend_projection_status AS "dividendStatus"
        FROM espi_reports WHERE source_id = ANY($1::text[])`, [sourceIds]);
    const calendarRows = await client.query(`SELECT event.id, event.event_type AS "eventType", event.event_date::text AS "eventDate",
          event.event_identity AS identity, event.fiscal_period AS "fiscalPeriod",
          event.fiscal_year AS "fiscalYear", event.fiscal_year_label AS "fiscalYearLabel",
          event.status, instrument.ticker, instrument.company_name AS issuer,
          source.source_url AS "sourceUrl"
        FROM corporate_events AS event
        JOIN corporate_event_instruments AS instrument ON instrument.id = event.instrument_id
        LEFT JOIN corporate_event_sources AS source ON source.corporate_event_id = event.id
        WHERE event.active = TRUE
          AND event.event_type IN ('QUARTERLY_REPORT', 'HALF_YEAR_REPORT', 'ANNUAL_REPORT')
          AND event.event_date >= $1 AND event.event_date <= $2
        ORDER BY event.event_date, instrument.ticker, event.id`,
        [sources.scope.dates[0], new Date(Date.parse(`${sources.scope.dates.at(-1)}T12:00:00Z`) + 365 * 86_400_000).toISOString().slice(0, 10)]);
    // One event may cite several official documents. Collapse JOIN rows by the
    // stable event ID before semantic comparison; provenance multiplicity is
    // not a duplicate calendar event.
    projections = [...new Map(projectionRows.rows.map((row) => [row.id, row])).values()];
    ingestion = ingestionRows.rows;
    const byEventId = new Map();
    for (const row of calendarRows.rows) {
      const existing = byEventId.get(row.id);
      if (existing) {
        if (row.sourceUrl) existing.sourceUrls.push(row.sourceUrl);
      } else {
        byEventId.set(row.id, { ...row, sourceUrls: row.sourceUrl ? [row.sourceUrl] : [] });
      }
    }
    const events = [...byEventId.values()];
    calendarEventsRead = events.length;
    const byCompanyDay = new Map();
    for (const event of events) {
      const key = `${event.ticker}:${event.eventDate}`;
      byCompanyDay.set(key, [...(byCompanyDay.get(key) ?? []), event]);
      if (!event.fiscalPeriod || (!event.fiscalYear && !event.fiscalYearLabel)) {
        calendarAnomalies.push({ code: "INCOMPLETE_REPORT_LABEL", confidence: "REVIEW", ticker: event.ticker,
          issuer: event.issuer, eventDate: event.eventDate, eventId: event.id, identity: event.identity,
          missing: [!event.fiscalPeriod ? "period" : null,
            !event.fiscalYear && !event.fiscalYearLabel ? "fiscal-year" : null].filter(Boolean),
          sourceUrls: event.sourceUrls });
      }
    }
    for (const [key, items] of byCompanyDay) {
      if (items.length < 2) continue;
      calendarAnomalies.push({ code: "SAME_ISSUER_DAY_REVIEW", confidence: "REVIEW", key,
        rows: items.map((item) => ({ eventId: item.id, identity: item.identity,
          eventType: item.eventType, fiscalPeriod: item.fiscalPeriod,
          fiscalYear: item.fiscalYear, fiscalYearLabel: item.fiscalYearLabel, sourceUrls: item.sourceUrls })),
        note: "A shared issuer/date alone is not a duplicate and never authorizes deletion." });
    }
    await client.query("COMMIT");
    databaseState = "READ_ONLY_SNAPSHOT_PASS";
    const ingestedIds = new Set(ingestion.map((item) => item.id));
    for (const document of sources.documents) {
      if (document.fetchStatus !== "FETCHED" && document.fetchStatus !== "PARTIAL") continue;
      if (!ingestedIds.has(document.id)) findings.push({
        code: "SOURCE_NOT_INGESTED", confidence: "REVIEW", documentId: document.id,
        sourceUrl: document.sourceUrl, reason: "Official report was fetched in the audit window but has no espi_reports row.",
      });
    }
    // Source parser hypotheses are not independently annotated. Even when the
    // deterministic comparison reports a gap, this remains REVIEW until the
    // document and all attachments are independently checked.
    findings.push(...auditGpwProjectionSnapshots(sources.sourceEvents, projections).map((item) => ({
      ...item, confidence: "REVIEW", reason: item.message,
      evidence: sources.sourceEvents.find((source) => source.documentId === item.documentId &&
        source.identity === item.eventIdentity)?.evidence,
    })));
    status = findings.length || calendarAnomalies.length ? "PROJECTION_REVIEW_REQUIRED" : "SOURCE_WINDOW_PROJECTIONS_MATCH";
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve the first failure */ }
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code.replace(/[^A-Z0-9_]/gi, "") : "UNKNOWN";
    databaseState = `READ_ONLY_SNAPSHOT_FAILED:${phase}:${code}`;
    status = "NOT_RUN";
  } finally {
    await client.end().catch(() => undefined);
  }
}

const report = {
  schemaVersion: 1, status, databaseState,
  scope: { sourceStatus: sources.status, documents: sources.documents.length,
    sourceEvents: sources.sourceEvents.length, projectionRows: projections.length,
    ingestedReports: ingestion.length, publicApi: "NOT_RUN", ics: "NOT_RUN",
    calendarEventsRead, calendarAnomalies: calendarAnomalies.length,
    limitation: "Public production calendar/API GETs can enqueue writes. This command deliberately does not call them; API/ICS contract tests must run against an isolated PostgreSQL instance." },
  findings, projections, ingestion, calendarAnomalies,
};
const artifacts = await writeGpwQualityArtifacts({ outputDir, basename: "projections", report,
  markdown: renderGenericMarkdown("GPW source → projection comparison (read-only)", [
    { heading: "Status", body: `- ${status}\n- Database: ${databaseState}\n- Source events: ${report.scope.sourceEvents}; projection rows: ${projections.length}; ingested reports: ${ingestion.length}` },
    { heading: "Findings", body: findings.length ? findings.map((item) => `- ${item.code} ${item.documentId ?? ""} ${item.sourceUrl ?? ""} — ${item.reason}`).join("\n") : "- None in the supplied bounded source window." },
    { heading: "Calendar-wide labels/collisions", body: `- ${calendarEventsRead} active report events read; ${calendarAnomalies.length} review items.\n- Same-day records are never auto-deleted; source links and identities are in projections.json.` },
    { heading: "Safety / limits", body: `- ${report.scope.limitation}\n- No application DB helper, migration, synchronization function, or write query is called. Every query runs inside BEGIN READ ONLY.\n- Unannotated parser outputs remain REVIEW evidence, not CONFIRMED source truth.` },
  ]),
});
printArtifactSummary({ name: "gpw:audit:projections", status, artifacts,
  summary: { databaseState, sourceEvents: report.scope.sourceEvents, projectionRows: projections.length,
    findings: findings.length, calendarAnomalies: calendarAnomalies.length } });

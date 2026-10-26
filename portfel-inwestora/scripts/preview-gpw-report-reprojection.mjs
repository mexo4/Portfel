/** Read-only, bounded preview. Never imports application DB initialization. */
import { readFileSync } from "node:fs";
import pg from "pg";
import nextEnv from "@next/env";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { planReportScheduleReprojection } from "../src/lib/report-schedule-reprojection.ts";
import { readOfficialMeetingPdfWithCoverage } from "../src/lib/server/general-meeting-pdf.ts";
import { buildReportReprojectionActionPreview } from "./gpw-reprojection-action-plan.mjs";

if (!process.argv.includes("--dry-run")) {
  throw new Error("Only --dry-run is supported. This command never changes the database.");
}
if (process.argv.includes("--isolated-replay")) {
  throw new Error("Isolated PostgreSQL replay is not implemented; this command only produces a read-only plan.");
}
nextEnv.loadEnvConfig(process.env.MEXO_LOCAL_ENV_DIR || process.cwd());
const rawLimit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? 50);
if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
  throw new Error("--limit must be an integer from 1 to 100.");
}
const cursor = process.argv.find((arg) => arg.startsWith("--cursor="))?.slice(9);
const sourceIds = process.argv.find((arg) => arg.startsWith("--source-ids="))?.slice(13)
  .split(",").map((id) => id.trim()).filter(Boolean) ?? [];
if (sourceIds.length > 30 || sourceIds.some((id) => !/^gpw:\d+$/.test(id))) {
  throw new Error("--source-ids accepts at most 30 comma-separated GPW source IDs.");
}
const tickers = process.argv.find((arg) => arg.startsWith("--tickers="))?.slice(10)
  .split(",").map((ticker) => ticker.trim().toUpperCase()).filter(Boolean) ?? [];
if (tickers.length > 10 || tickers.some((ticker) => !/^[A-Z0-9]{1,12}$/.test(ticker))) {
  throw new Error("--tickers accepts at most 10 exact GPW ticker symbols.");
}
if (!tickers.length && !sourceIds.length) {
  throw new Error("Specify exact --tickers or --source-ids; an unbounded source snapshot is not permitted.");
}
const [cursorPublishedAt, cursorSourceId] = cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) : [null, null];
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (its value is never logged).");
if (process.argv.includes("--require-aiven") &&
  !new URL(url).hostname.toLowerCase().endsWith(".aivencloud.com")) {
  throw new Error("The source URL is not an Aiven hostname. No query was executed.");
}
const certificate = process.env.POSTGRES_CA_CERT_BASE64
  ? Buffer.from(process.env.POSTGRES_CA_CERT_BASE64, "base64").toString("utf8")
  : process.env.POSTGRES_CA_CERT_PATH
    ? readFileSync(process.env.POSTGRES_CA_CERT_PATH, "utf8")
    : undefined;
if (certificate && !certificate.includes("-----BEGIN CERTIFICATE-----")) throw new Error("Invalid CA certificate.");
const connectionString = certificate ? (() => {
  const parsed = new URL(url);
  parsed.searchParams.delete("sslmode");
  return parsed.toString();
})() : url;
const client = new pg.Client({
  connectionString,
  ...(certificate ? { ssl: { ca: certificate, rejectUnauthorized: true } } : {}),
  connectionTimeoutMillis: 10_000,
});

const reportTypes = new Set(["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT"]);
let connected = false;
try {
  await client.connect();
  connected = true;
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '15s'");
  const readOnly = (await client.query("SHOW transaction_read_only")).rows[0]?.transaction_read_only;
  if (readOnly !== "on") throw new Error("Source transaction is not read-only.");
  const issuers = tickers.length ? (await client.query(`
    SELECT id, ticker, company_name, canonical_key FROM corporate_event_instruments
    WHERE market = 'GPW' AND UPPER(ticker) = ANY($1::text[]) LIMIT 11
  `, [tickers])).rows : [];
  const issuerIds = issuers.map((issuer) => issuer.id);
  const reportRows = (await client.query(`
    SELECT report.id, report.source_id, report.source_title, report.title, report.body_text,
           report.published_at, report.source_url, report.issuer_id,
           report.source_ticker, report.report_schedule_projection_status,
           report.report_schedule_projection_version
    FROM espi_reports AS report
    WHERE report.source = 'PAP_ESPI' AND report.market IS DISTINCT FROM 'NEWCONNECT'
      AND (report.source_title ILIKE '%termin%raport%' OR report.title ILIKE '%termin%raport%'
        OR report.source_title ILIKE '%raport%termin%' OR report.title ILIKE '%raport%termin%'
        OR report.source_title ILIKE '%harmonogram%raport%' OR report.title ILIKE '%harmonogram%raport%'
        OR report.source_title ILIKE '%kalendarz%raport%' OR report.title ILIKE '%kalendarz%raport%'
        OR report.source_title ILIKE '%dat%publikacj%raport%' OR report.title ILIKE '%dat%publikacj%raport%'
        OR report.source_title ILIKE '%dat%przekazywan%raport%' OR report.title ILIKE '%dat%przekazywan%raport%'
        OR report.source_title ILIKE '%termin%przekazywan%raport%' OR report.title ILIKE '%termin%przekazywan%raport%'
        OR report.body_text ~* '(raport|sprawozdan|financial statement).{0,180}(zostanie|będzie|bedzie|will).{0,60}(opublikowan|przekazan|publish).{0,120}[0-9]{1,2}.{0,40}20[0-9]{2}')
      AND ($1::text IS NULL OR (report.published_at, report.source_id) < ($1::text, $2::text))
      AND ($4::text[] IS NULL OR report.source_id = ANY($4::text[]))
      AND ($5::text[] IS NULL OR report.issuer_id = ANY($5::text[])
        OR UPPER(report.source_ticker) = ANY($6::text[]))
    ORDER BY report.published_at DESC, report.source_id DESC LIMIT $3
  `, [cursorPublishedAt, cursorSourceId, rawLimit + 1, sourceIds.length ? sourceIds : null,
    tickers.length ? issuerIds : null, tickers.length ? tickers : null])).rows;
  const hasMore = reportRows.length > rawLimit;
  const reports = reportRows.slice(0, rawLimit);
  const ids = reports.map((row) => row.id);
  const urls = reports.map((row) => row.source_url);
  const attachments = ids.length ? (await client.query(`
    SELECT espi_report_id, source_url FROM espi_report_attachments
    WHERE espi_report_id = ANY($1::text[])
      AND (media_type = 'application/pdf' OR name ~* '\\.pdf$')
    ORDER BY espi_report_id, name LIMIT 1001
  `, [ids])).rows : [];
  if (attachments.length > 1000) throw new Error("Attachment snapshot exceeds the 1000-row safety bound.");
  const old = urls.length ? (await client.query(`
    SELECT target.source_url AS report_source_url, event.id, event.instrument_id,
           event.event_type, event.event_identity, event.event_date,
           event.fiscal_period, event.fiscal_year, event.fiscal_year_label, event.status, event.active,
           ARRAY_AGG(DISTINCT provenance.source_url) AS source_urls
    FROM corporate_events AS event
    JOIN corporate_event_sources AS target ON target.corporate_event_id = event.id
    JOIN corporate_event_sources AS provenance ON provenance.corporate_event_id = event.id
    WHERE target.source_url = ANY($1::text[]) AND event.active = TRUE
      AND event.event_type IN ('QUARTERLY_REPORT', 'HALF_YEAR_REPORT', 'ANNUAL_REPORT')
    GROUP BY target.source_url, event.id LIMIT 1001
  `, [urls])).rows : [];
  if (old.length > 1000) throw new Error("Existing projection snapshot exceeds the 1000-row safety bound.");
  const allIssuerIds = [...new Set([...issuerIds, ...reports.map((report) => report.issuer_id).filter(Boolean)])];
  const issuerEvents = allIssuerIds.length ? (await client.query(`
    SELECT id, instrument_id, event_type, event_identity, event_date, active
    FROM corporate_events WHERE instrument_id = ANY($1::text[]) AND active = TRUE
      AND event_type IN ('QUARTERLY_REPORT', 'HALF_YEAR_REPORT', 'ANNUAL_REPORT')
    ORDER BY instrument_id, event_identity LIMIT 501
  `, [allIssuerIds])).rows : [];
  if (issuerEvents.length > 500) {
    throw new Error("Issuer event snapshot exceeds the 500-row safety bound; narrow the scope.");
  }
  const oldIds = [...new Set(old.map((row) => row.id))];
  const historyCounts = oldIds.length ? (await client.query(`
    SELECT corporate_event_id, COUNT(*)::int AS count
    FROM corporate_event_history WHERE corporate_event_id = ANY($1::text[])
    GROUP BY corporate_event_id
  `, [oldIds])).rows : [];
  await client.query("COMMIT");
  const historyByEventId = new Map(historyCounts.map((row) => [row.corporate_event_id, row.count]));
  const plans = [];
  let fetchedAttachments = 0;
  let missingAttachments = 0;
  let truncatedAttachments = 0;
  let uninspectedAttachments = 0;
  for (const report of reports) {
    const parsed = new Map();
    for (const event of parseCorporateEventDocument(`${report.source_title}\n${report.title}\n${report.body_text}`)) {
      if (reportTypes.has(event.eventType)) parsed.set(`${event.eventType}:${event.fiscalPeriod}:${event.fiscalYearLabel ?? event.fiscalYear}:${event.eventDate}`, event);
    }
    const reportAttachments = attachments.filter((item) => item.espi_report_id === report.id);
    let parseComplete = reportAttachments.length <= 3;
    uninspectedAttachments += Math.max(0, reportAttachments.length - 3);
    for (const attachment of reportAttachments.slice(0, 3)) {
      try {
        const pdf = await readOfficialMeetingPdfWithCoverage(attachment.source_url);
        if (!pdf?.text) { parseComplete = false; missingAttachments += 1; continue; }
        if (pdf.truncated) { parseComplete = false; truncatedAttachments += 1; }
        fetchedAttachments += 1;
        for (const event of parseCorporateEventDocument(`${report.source_title}\n${pdf.text}`)) {
          if (reportTypes.has(event.eventType)) parsed.set(`${event.eventType}:${event.fiscalPeriod}:${event.fiscalYearLabel ?? event.fiscalYear}:${event.eventDate}`, event);
        }
      } catch { parseComplete = false; missingAttachments += 1; }
    }
    const parsedEvents = [...parsed.values()];
    const reviewEvents = parsedEvents.filter((event) => event.requiresReview);
    const oldForReport = old.filter((row) => row.report_source_url === report.source_url);
    const plan = planReportScheduleReprojection(
      oldForReport,
      parsedEvents, report.source_url, parseComplete && reviewEvents.length === 0
    );
    const actions = buildReportReprojectionActionPreview({
      sourceId: report.source_id, sourceUrl: report.source_url,
      publishedAt: report.published_at, parsed: parsedEvents, existing: oldForReport,
      issuerEvents: issuerEvents.filter((row) => row.instrument_id === report.issuer_id),
      issuerResolved: Boolean(report.issuer_id), parseComplete, plan,
    });
    plans.push({ sourceId: report.source_id, publishedAt: report.published_at,
      sourceUrl: report.source_url, issuerId: report.issuer_id,
      projectionVersion: report.report_schedule_projection_version, projectionStatus: report.report_schedule_projection_status,
      before: oldForReport.map((row) => ({ id: row.id, identity: row.event_identity,
        date: row.event_date, type: row.event_type, status: row.status,
        sourceUrls: row.source_urls, historyEntries: historyByEventId.get(row.id) ?? 0 })),
      parsed: parsedEvents.map((event) => ({ type: event.eventType, period: event.fiscalPeriod,
        fiscalYear: event.fiscalYearLabel ?? event.fiscalYear, date: event.eventDate })),
      parseComplete, attachmentCount: reportAttachments.length,
      reviewReasons: [...new Set(reviewEvents.flatMap((event) => event.reviewReasons ?? []))],
      plan, candidateActions: actions });
  }
  const last = reports.at(-1);
  console.log(JSON.stringify({ dryRun: true, sourceTransactionReadOnly: true,
    sourceHostPolicy: process.argv.includes("--require-aiven") ? "AIVEN_SUFFIX_VERIFIED" : "NOT_ENFORCED",
    sourceScope: { requestedTickers: tickers, requestedSourceIds: sourceIds,
      foundIssuers: issuers.map(({ id, ticker, company_name }) => ({ id, ticker, companyName: company_name })),
      unmatchedTickers: tickers.filter((ticker) => !issuers.some((issuer) => issuer.ticker.toUpperCase() === ticker)),
      fetchedReports: reports.length, hasMore, fetchedAttachments, missingAttachments,
      truncatedAttachments, uninspectedAttachments,
      nextCursor: hasMore && last
        ? Buffer.from(JSON.stringify([last.published_at, last.source_id])).toString("base64url") : null },
    plans,
    actualReplay: { status: "NOT_RUN", reason: "No isolated PostgreSQL snapshot replay was executed." },
    actualAfter: { status: "NOT_RUN" },
    idempotency: { status: "NOT_RUN", reason: "Requires two real replays on an isolated PostgreSQL clone." },
    history: { status: "UNCHANGED", note: "Only existing history counts were read; no new history was written." },
    cache: { status: "NOT_INVALIDATED", note: "Read-only planning cannot verify cache invalidation or public API/ICS after reprojection." },
    productionWrites: 0,
  }, null, 2));
} finally {
  if (connected) {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

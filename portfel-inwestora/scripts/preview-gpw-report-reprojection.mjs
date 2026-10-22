/** Read-only, bounded preview. Never imports application DB initialization. */
import { readFileSync } from "node:fs";
import pg from "pg";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { planReportScheduleReprojection } from "../src/lib/report-schedule-reprojection.ts";
import { readOfficialMeetingPdf } from "../src/lib/server/general-meeting-pdf.ts";

if (!process.argv.includes("--dry-run")) {
  throw new Error("Only --dry-run is supported. This command never changes the database.");
}
const rawLimit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) ?? 50);
if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
  throw new Error("--limit must be an integer from 1 to 100.");
}
const cursor = process.argv.find((arg) => arg.startsWith("--cursor="))?.slice(9);
const [cursorPublishedAt, cursorSourceId] = cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) : [null, null];
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (its value is never logged).");
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
  await client.query("BEGIN READ ONLY");
  const reports = (await client.query(`
    SELECT report.id, report.source_id, report.source_title, report.title, report.body_text,
           report.published_at, report.source_url, report.issuer_id,
           report.report_schedule_projection_status, report.report_schedule_projection_version
    FROM espi_reports AS report
    WHERE report.source = 'PAP_ESPI' AND report.market IS DISTINCT FROM 'NEWCONNECT'
      AND (report.source_title ILIKE '%termin%raport%' OR report.title ILIKE '%termin%raport%'
        OR report.source_title ILIKE '%harmonogram%raport%' OR report.title ILIKE '%harmonogram%raport%'
        OR report.source_title ILIKE '%kalendarz%raport%' OR report.title ILIKE '%kalendarz%raport%'
        OR report.source_title ILIKE '%dat%publikacj%raport%' OR report.title ILIKE '%dat%publikacj%raport%'
        OR report.source_title ILIKE '%dat%przekazywan%raport%' OR report.title ILIKE '%dat%przekazywan%raport%'
        OR report.source_title ILIKE '%termin%przekazywan%raport%' OR report.title ILIKE '%termin%przekazywan%raport%')
      AND ($1::text IS NULL OR (report.published_at, report.source_id) < ($1::text, $2::text))
    ORDER BY report.published_at DESC, report.source_id DESC LIMIT $3
  `, [cursorPublishedAt, cursorSourceId, rawLimit])).rows;
  const ids = reports.map((row) => row.id);
  const urls = reports.map((row) => row.source_url);
  const attachments = ids.length ? (await client.query(`
    SELECT espi_report_id, source_url FROM espi_report_attachments
    WHERE espi_report_id = ANY($1::text[])
      AND (media_type = 'application/pdf' OR name ~* '\\.pdf$')
    ORDER BY espi_report_id, name
  `, [ids])).rows : [];
  const old = urls.length ? (await client.query(`
    SELECT target.source_url AS report_source_url, event.id, event.event_identity, event.event_date,
           ARRAY_AGG(DISTINCT provenance.source_url) AS source_urls
    FROM corporate_events AS event
    JOIN corporate_event_sources AS target ON target.corporate_event_id = event.id
    JOIN corporate_event_sources AS provenance ON provenance.corporate_event_id = event.id
    WHERE target.source_url = ANY($1::text[]) AND event.active = TRUE
      AND event.event_type IN ('QUARTERLY_REPORT', 'HALF_YEAR_REPORT', 'ANNUAL_REPORT')
    GROUP BY target.source_url, event.id, event.event_identity, event.event_date
  `, [urls])).rows : [];
  await client.query("COMMIT");
  const plans = [];
  for (const report of reports) {
    const parsed = new Map();
    for (const event of parseCorporateEventDocument(`${report.source_title}\n${report.title}\n${report.body_text}`)) {
      if (reportTypes.has(event.eventType)) parsed.set(`${event.eventType}:${event.fiscalPeriod}:${event.fiscalYearLabel ?? event.fiscalYear}:${event.eventDate}`, event);
    }
    const reportAttachments = attachments.filter((item) => item.espi_report_id === report.id);
    let parseComplete = reportAttachments.length <= 3;
    for (const attachment of reportAttachments.slice(0, 3)) {
      try {
        const text = await readOfficialMeetingPdf(attachment.source_url);
        if (!text) { parseComplete = false; continue; }
        for (const event of parseCorporateEventDocument(`${report.source_title}\n${text}`)) {
          if (reportTypes.has(event.eventType)) parsed.set(`${event.eventType}:${event.fiscalPeriod}:${event.fiscalYearLabel ?? event.fiscalYear}:${event.eventDate}`, event);
        }
      } catch { parseComplete = false; }
    }
    const plan = planReportScheduleReprojection(
      old.filter((row) => row.report_source_url === report.source_url),
      [...parsed.values()], report.source_url, parseComplete
    );
    plans.push({ sourceId: report.source_id, publishedAt: report.published_at,
      projectionVersion: report.report_schedule_projection_version, projectionStatus: report.report_schedule_projection_status,
      parsed: [...parsed.values()].map((event) => ({ type: event.eventType, period: event.fiscalPeriod,
        fiscalYear: event.fiscalYearLabel ?? event.fiscalYear, date: event.eventDate })),
      parseComplete, plan });
  }
  const last = reports.at(-1);
  console.log(JSON.stringify({ dryRun: true, fetched: reports.length, plans,
    nextCursor: last ? Buffer.from(JSON.stringify([last.published_at, last.source_id])).toString("base64url") : null }, null, 2));
} finally {
  if (connected) {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

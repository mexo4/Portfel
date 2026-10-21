import { readFileSync } from "node:fs";
import { Pool } from "pg";
import nextEnv from "@next/env";

// This diagnostic never initializes application schema, fetches a source or writes data.
nextEnv.loadEnvConfig(process.cwd());
const month = process.argv.find((arg) => /^--month=20\d{2}-(?:0[1-9]|1[0-2])$/.test(arg))?.slice(8);
if (!month) throw new Error("Użycie: node scripts/audit-public-gpw-calendar.mjs --month=2026-12");
const from = `${month}-01`;
const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 1)).toISOString().slice(0, 10);
const connectionString = new URL(process.env.DATABASE_URL);
const certificate = process.env.POSTGRES_CA_CERT_BASE64
  ? Buffer.from(process.env.POSTGRES_CA_CERT_BASE64, "base64").toString("utf8")
  : process.env.POSTGRES_CA_CERT_PATH ? readFileSync(process.env.POSTGRES_CA_CERT_PATH, "utf8") : null;
if (certificate) connectionString.searchParams.delete("sslmode");
const pool = new Pool({ connectionString: connectionString.toString(),
  ...(certificate ? { ssl: { ca: certificate, rejectUnauthorized: true } } : {}), max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  const events = await client.query(`
    SELECT event.event_type, event.status, event.active, issuer.ticker,
      event.event_date, event.payment_date,
      EXISTS (SELECT 1 FROM corporate_event_sources AS source
              WHERE source.corporate_event_id = event.id AND source.source_url LIKE 'https://%') AS has_https_source,
      (SELECT COUNT(*) FROM corporate_event_sources AS source
       WHERE source.corporate_event_id = event.id)::int AS source_count
    FROM corporate_events AS event
    JOIN corporate_event_instruments AS issuer ON issuer.id = event.instrument_id
    WHERE issuer.market = 'GPW' AND (
      (event.event_date >= $1 AND event.event_date < $2)
      OR (event.event_type = 'UPCOMING_DIVIDEND' AND event.payment_date >= $1 AND event.payment_date < $2)
    ) ORDER BY event.event_date, issuer.ticker`, [from, to]);
  const sourceState = await client.query(`
    SELECT source, status, last_checked_at, last_success_at, next_backfill_page, backfill_complete
    FROM espi_sync_state WHERE source IN ('PAP_ESPI', 'GPW_WZA', 'GPW_DIVIDENDS', 'GPW_REPORT_SCHEDULES')
    ORDER BY source`);
  const projectionColumns = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'espi_reports' AND column_name IN (
      'report_schedule_projection_status', 'corporate_events_projection_status', 'dividend_projection_status')`);
  const columns = new Set(projectionColumns.rows.map((row) => row.column_name));
  const candidates = columns.has("report_schedule_projection_status") ? await client.query(`
    SELECT COALESCE(report_schedule_projection_status, 'PENDING') AS status, COUNT(*)::int AS count
    FROM espi_reports WHERE source = 'PAP_ESPI' AND market <> 'NEWCONNECT'
      AND (source_title ILIKE '%termin%raport%' OR title ILIKE '%termin%raport%'
        OR source_title ILIKE '%raport%termin%' OR title ILIKE '%raport%termin%'
        OR source_title ILIKE '%harmonogram%raport%' OR title ILIKE '%harmonogram%raport%'
        OR source_title ILIKE '%kalendarz%raport%' OR title ILIKE '%kalendarz%raport%')
    GROUP BY COALESCE(report_schedule_projection_status, 'PENDING') ORDER BY status`) : { rows: [] };
  const categories = events.rows.reduce((counts, event) => {
    const category = event.event_type === "GENERAL_MEETING" ? "meetings" :
      event.event_type === "UPCOMING_DIVIDEND" ? "dividends" : "reports";
    counts[category] += 1;
    return counts;
  }, { reports: 0, meetings: 0, dividends: 0 });
  const excluded = events.rows.filter((event) => !event.active || event.status === "CANCELLED" || !event.has_https_source);
  console.log(JSON.stringify({ mode: "read-only", month, storedEvents: events.rows.length,
    categories, publicEligibleRows: events.rows.length - excluded.length,
    excluded: excluded.map(({ ticker, event_type, event_date, status, active, has_https_source, source_count }) =>
      ({ ticker, event_type, event_date, status, active, has_https_source, source_count })),
    events: events.rows.map(({ ticker, event_type, event_date, payment_date, status, has_https_source }) =>
      ({ ticker, event_type, event_date, payment_date, status, has_https_source })),
    reportProjectionStatuses: candidates.rows,
    sourceSyncState: sourceState.rows,
    note: "Liczby pobranych dokumentów per uruchomienie znajdują się w logach REPORT SCHEDULE SOURCE SYNC / WZA SOURCE SYNC / DIVIDEND SOURCE SYNC; historyczny licznik HTTP nie był zapisywany w bazie."
  }, null, 2));
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Audyt odczytu nie powiódł się", error instanceof Error ? error.name : "unknown");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

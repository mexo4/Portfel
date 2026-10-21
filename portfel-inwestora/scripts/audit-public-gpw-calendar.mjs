import { readFileSync } from "node:fs";
import { Pool } from "pg";
import nextEnv from "@next/env";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";

// This diagnostic never initializes application schema, fetches a source or writes data.
nextEnv.loadEnvConfig(process.env.MEXO_LOCAL_ENV_DIR || process.cwd());
const month = process.argv.find((arg) => /^--month=20\d{2}-(?:0[1-9]|1[0-2])$/.test(arg))?.slice(8);
const inspect = process.argv.find((arg) => arg.startsWith("--inspect="))?.slice(10).split(",").map((value) => value.trim()).filter(Boolean) ?? [];
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
  const catalog = inspect.length ? await client.query(`
    SELECT payload_json FROM market_cache WHERE "key" = 'gpw-catalog-v2' LIMIT 1`) : { rows: [] };
  const catalogMatches = catalog.rows[0]?.payload_json
    ? (JSON.parse(catalog.rows[0].payload_json).items ?? []).filter((item) =>
        inspect.some((term) => `${item.symbol} ${item.name} ${item.isin ?? ""}`.toLocaleLowerCase("pl-PL")
          .includes(term.toLocaleLowerCase("pl-PL"))))
    : [];
  const publishedReports = await client.query(`
    SELECT COUNT(*)::int AS fetched,
      COUNT(*) FILTER (WHERE issuer_id IS NULL)::int AS unmatched_issuer,
      COUNT(*) FILTER (WHERE is_correction)::int AS corrections,
      COUNT(*) FILTER (WHERE corporate_events_projection_status = 'PARSE_ERROR'
        OR dividend_projection_status = 'PARSE_ERROR'
        OR report_schedule_projection_status = 'PARSE_ERROR')::int AS parser_errors,
      COUNT(*) FILTER (WHERE corporate_events_projection_status = 'NO_EVENT')::int AS meeting_no_event,
      COUNT(*) FILTER (WHERE dividend_projection_status = 'NO_EVENT')::int AS dividend_no_event,
      COUNT(*) FILTER (WHERE report_schedule_projection_status = 'NO_EVENT')::int AS report_no_event
    FROM espi_reports WHERE source = 'PAP_ESPI' AND market <> 'NEWCONNECT'
      AND published_at >= $1 AND published_at < $2`, [from, to]);
  const eventQuality = await client.query(`
    SELECT COUNT(*) FILTER (WHERE source_count = 0)::int AS missing_sources,
      COUNT(*) FILTER (WHERE active AND status <> 'CANCELLED')::int AS visible,
      COUNT(*) FILTER (WHERE NOT active OR status = 'CANCELLED')::int AS hidden,
      COUNT(*) FILTER (WHERE status = 'CHANGED')::int AS changed,
      COUNT(*) FILTER (WHERE same_day_count > 1)::int AS same_day_rows
    FROM (
      SELECT event.id, event.active, event.status,
        (SELECT COUNT(*) FROM corporate_event_sources WHERE corporate_event_id = event.id) AS source_count,
        COUNT(*) OVER (PARTITION BY event.instrument_id, event.event_type, event.event_date) AS same_day_count
      FROM corporate_events AS event
      JOIN corporate_event_instruments AS issuer ON issuer.id = event.instrument_id
      WHERE issuer.market = 'GPW' AND ((event.event_date >= $1 AND event.event_date < $2)
        OR (event.event_type = 'UPCOMING_DIVIDEND' AND event.payment_date >= $1 AND event.payment_date < $2))
    ) AS month_events`, [from, to]);
  const inspectedReports = inspect.length ? await client.query(`
    SELECT source_id, issuer_name, source_ticker, source_isin, market,
      published_at, source_title, title, source_url, issuer_id,
      corporate_events_projection_status AS meeting_status,
      dividend_projection_status AS dividend_status,
      report_schedule_projection_status AS report_status,
      LEFT(body_text, 8000) AS body_excerpt
    FROM espi_reports
    WHERE source = 'PAP_ESPI' AND market <> 'NEWCONNECT'
      AND EXISTS (SELECT 1 FROM unnest($1::text[]) AS term
        WHERE issuer_name ILIKE '%' || term || '%'
          OR source_title ILIKE '%' || term || '%')
    ORDER BY published_at DESC LIMIT 120`, [inspect]) : { rows: [] };
  const inspectedEvents = inspect.length ? await client.query(`
    SELECT issuer.ticker, issuer.company_name, issuer.market, event.event_type,
      event.event_date, event.event_time, event.record_date, event.payment_date,
      event.dividend_per_share, event.dividend_installment, event.event_identity,
      event.status, event.active, source.source_url
    FROM corporate_events AS event
    JOIN corporate_event_instruments AS issuer ON issuer.id = event.instrument_id
    LEFT JOIN LATERAL (SELECT source_url FROM corporate_event_sources
      WHERE corporate_event_id = event.id ORDER BY source_priority DESC LIMIT 1) AS source ON TRUE
    WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) AS term
      WHERE issuer.company_name ILIKE '%' || term || '%'
         OR issuer.ticker ILIKE '%' || term || '%')
    ORDER BY event.event_date DESC LIMIT 120`, [inspect]) : { rows: [] };
  const inspectedEventSources = inspect.length ? await client.query(`
    SELECT issuer.ticker, event.event_date, event.status, source.source_type,
      source.source_published_at, source.source_title, source.source_url
    FROM corporate_event_sources AS source
    JOIN corporate_events AS event ON event.id = source.corporate_event_id
    JOIN corporate_event_instruments AS issuer ON issuer.id = event.instrument_id
    WHERE EXISTS (SELECT 1 FROM unnest($1::text[]) AS term
      WHERE issuer.company_name ILIKE '%' || term || '%'
         OR issuer.ticker ILIKE '%' || term || '%')
    ORDER BY event.event_date DESC, source.source_published_at DESC LIMIT 160`, [inspect]) : { rows: [] };
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
    publishedReports: publishedReports.rows[0],
    eventQuality: eventQuality.rows[0],
    inspectedReports: inspectedReports.rows,
    catalogMatches,
    parsedInspectedReports: inspectedReports.rows.map((report) => ({ sourceId: report.source_id,
      events: parseCorporateEventDocument(`${report.source_title}\n${report.title}\n${report.body_excerpt}`) })),
    inspectedEvents: inspectedEvents.rows,
    inspectedEventSources: inspectedEventSources.rows,
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

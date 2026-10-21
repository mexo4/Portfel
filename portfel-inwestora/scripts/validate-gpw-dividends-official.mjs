import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const refreshSource = process.argv.includes("--refresh-source");
const reprocess = process.argv.includes("--reprocess");
const [{ query }, corporateEvents, espi] = await Promise.all([
  import("../src/lib/server/db.ts"),
  import("../src/lib/server/corporate-events.ts"),
  import("../src/lib/server/espi.ts"),
]);

const getWarsawDate = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const addYear = (date) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCFullYear(value.getUTCFullYear() + 1);
  return value.toISOString().slice(0, 10);
};

const today = getWarsawDate();
const toDate = addYear(today);
const twoYearsAgo = new Date(Date.now() - 730 * 24 * 60 * 60 * 1_000).toISOString();
let sourceSync;
let projectionSync;

// Read-only is the safe default. Both write paths require an explicit flag,
// so an operator cannot accidentally re-crawl or re-project production data.
if (refreshSource) sourceSync = await espi.synchronizeGpwDividendReports({ force: true });
if (reprocess) {
  projectionSync = await corporateEvents.synchronizeGlobalDividends({
    force: true,
    refreshSource: false,
  });
}

const [sourceState, diagnostics, events, statusRows] = await Promise.all([
  corporateEvents.getGlobalDividendSourceState(),
  corporateEvents.getDividendProjectionDiagnostics(),
  corporateEvents.getGlobalDividends({ fromDate: today, toDate }),
  query(`
    SELECT COALESCE(dividend_projection_status, 'PENDING') AS status, COUNT(*) AS count
    FROM espi_reports
    WHERE source = 'PAP_ESPI'
      AND source_id NOT LIKE 'newconnect:%'
      AND market <> 'NEWCONNECT'
      AND published_at >= $1
      AND (
        category = 'DIVIDEND'
        OR source_title ILIKE '%dywidend%'
        OR title ILIKE '%dywidend%'
        OR source_title ILIKE '%zaliczk%'
        OR title ILIKE '%zaliczk%'
        OR source_title ILIKE '%podzia%zysku%'
        OR title ILIKE '%podzia%zysku%'
        OR body_text ~* '(dzie[nń] dywidendy|ustalenia uprawnionych|wypłat[ay] dywidendy)'
      )
    GROUP BY COALESCE(dividend_projection_status, 'PENDING')
    ORDER BY status
  `, [twoYearsAgo]),
]);

console.log(JSON.stringify({
  mode: refreshSource || reprocess ? "explicit-write" : "read-only",
  source: "official GPW ESPI public feed",
  fromDate: today,
  toDate,
  sourceState: {
    status: sourceState.status,
    lastCheckedAt: sourceState.lastCheckedAt,
    lastSuccessAt: sourceState.lastSuccessAt,
    backfillComplete: sourceState.backfillComplete,
    nextBackfillDay: sourceState.nextBackfillPage,
  },
  sourceSync,
  projectionSync,
  diagnostics,
  projectionStatuses: statusRows.map((row) => ({
    status: row.status,
    count: Number(row.count),
  })),
  futureEvents: {
    count: events.length,
    missingRecordDate: events.filter((event) => !event.recordDate).length,
    missingPaymentDate: events.filter((event) => !event.paymentDate).length,
    missingAmount: events.filter((event) => typeof event.dividendPerShare !== "number").length,
    items: events.map((event) => ({
      ticker: event.ticker,
      recordDate: event.recordDate,
      paymentDate: event.paymentDate,
      amount: event.dividendPerShare,
      currency: event.dividendCurrency,
      status: event.status,
      sources: event.sources?.length ?? (event.source ? 1 : 0),
    })),
  },
}, null, 2));

process.exit(0);

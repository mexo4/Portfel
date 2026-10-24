import { createHash, randomUUID } from "node:crypto";
import {
  ESPI_CATEGORY_LABELS,
  type EspiAttachment,
  type EspiCategory,
  type EspiFeedResponse,
  type EspiMarket,
  type EspiReport,
  type EspiReportSummary,
  type EspiReportType,
  type EspiSourceStatus,
  type EspiSyncMeta,
  type EspiTrackingSource,
  classifyEspiCategory,
  classifyEspiReportType,
  isEspiCategory,
  isEspiReportType,
  parsePapEspiList,
  parsePapEspiReport,
  parseGpwEspiList,
  parseGpwEspiReport,
  toWarsawIso,
  type PapEspiListCandidate,
  type ParsedPapEspiReport,
} from "@/lib/espi";
import { parseCorporateEventDocument } from "@/lib/corporate-events";
import { ensurePortfolioCoreModel, getPortfolioInstrumentId } from "@/lib/operation-engine";
import { normalizePortfolioBook } from "@/lib/portfolio-state";
import {
  findGpwCatalogEntry,
  findGpwCatalogEntryByExactName,
  findGpwIssuerCardByIsin,
  findGpwCatalogEntryByIsin,
} from "@/lib/server/gpw-catalog";
import { execute, query, queryOne, withTransaction } from "@/lib/server/db";
import { fetchWithSystemTrust } from "@/lib/server/system-trust-fetch";
import { getUserWatchlist } from "@/lib/server/watchlist";
import { getGpwTickerCore, isGpwSymbol } from "@/lib/ticker";
import type { WatchlistItem } from "@/lib/watchlist";
import type { InvestmentPortfolio, PortfolioInstrument } from "@/types/portfolio";

const PAP_SOURCE = "PAP_ESPI" as const;
const GPW_WZA_SOURCE = "GPW_WZA" as const;
const GPW_DIVIDEND_SOURCE = "GPW_DIVIDENDS" as const;
const GPW_REPORT_SCHEDULE_SOURCE = "GPW_REPORT_SCHEDULES" as const;
export const getEspiSourcePriority = (sourceId: string) => {
  if (sourceId.startsWith("gpw:")) return 0;
  if (sourceId.startsWith("newconnect:")) return 1;
  return 2;
};
export const PAP_ESPI_FEED_URL = "https://pap-mediaroom.pl/zrodlo/ESPI";
export const GPW_ESPI_FEED_URL = "https://www.gpw.pl/espi-ebi-reports";
const GPW_ESPI_SEARCH_URL = "https://www.gpw.pl/ajaxindex.php";
const NEWCONNECT_ESPI_BASE_URL = "https://newconnect.pl";
const NEWCONNECT_ESPI_SEARCH_URL = `${NEWCONNECT_ESPI_BASE_URL}/ajaxindex.php`;
const ESPI_REFRESH_TTL_MS = 10 * 60 * 1_000;
const GPW_WZA_REFRESH_TTL_MS = 60 * 60 * 1_000;
const GPW_DIVIDEND_REFRESH_TTL_MS = 60 * 60 * 1_000;
const GPW_REPORT_SCHEDULE_REFRESH_TTL_MS = 60 * 60 * 1_000;
const ESPI_OVERLAP_TTL_MS = 24 * 60 * 60 * 1_000;
const ESPI_SOURCE_TIMEOUT_MS = 15_000;
const ESPI_LOCK_TTL_MS = 3 * 60 * 1_000;
const ESPI_DEFAULT_LIMIT = 20;
const ESPI_MAX_LIMIT = 50;
const INITIAL_BACKFILL_PAGES = 2;
// V1 keeps a useful recent window (roughly 120 PAP feed entries), rather than
// attempting a multi-year archive import on first use. New publications are
// always ingested from page zero.
const ESPI_BACKFILL_PAGE_LIMIT = 12;
const ESPI_OVERLAP_DAYS = 4;
// The official exchange endpoints paginate their newest reports. Walk the
// pages until the requested rolling repair horizon is reached. A repeated
// page is treated as an exhausted/degraded pagination stream, so this never
// relies on an arbitrary first-N-pages limit.
const ESPI_OFFICIAL_REPAIR_DAYS = 370;
const GPW_DIVIDEND_RECENT_DAYS = 7;
const GPW_DIVIDEND_BACKFILL_DAYS_PER_SYNC = 21;
const GPW_DIVIDEND_MAX_ROWS_PER_DAY = 2_000;
const ESPI_FETCH_ATTEMPTS = 2;
const ARTICLE_CONCURRENCY = 4;
const ISSUER_METADATA_VERSION = 3;
const ISSUER_RETRY_AFTER_DAYS = 7;
const ISSUER_RECONCILIATION_BATCH_SIZE = 100;

type EspiSyncStateRow = {
  status: EspiSourceStatus;
  last_checked_at: string | null;
  last_success_at: string | null;
  last_overlap_at: string | null;
  next_backfill_page: number;
  backfill_complete: boolean;
  lock_token: string | null;
  lock_expires_at: string | null;
};

type EspiReportRow = {
  id: string;
  issuer_name: string;
  issuer_ticker: string | null;
  issuer_canonical_key: string | null;
  market: EspiMarket;
  source_ticker: string | null;
  source_isin: string | null;
  report_number: string | null;
  report_type: EspiReportType;
  published_at: string;
  title: string;
  body_text: string;
  legal_basis: string | null;
  category: EspiCategory;
  source_id: string;
  source_url: string;
  is_correction: boolean;
  correction_target_report_number: string | null;
  correction_of_report_id: string | null;
  attachments_count: number | string;
};

type StoredPortfolioRow = { portfolio_json: string };

export type TrackedGpwInstrument = {
  canonicalKey: string;
  ticker: string;
  name: string;
  isin?: string;
  mexoInstrumentId?: string;
  held: boolean;
  watched: boolean;
};
export type TrackedEspiInstrument = TrackedGpwInstrument;

export type EspiFeedFilters = {
  scope: "mine" | "all" | "watchlist" | "portfolio";
  market: Exclude<EspiMarket, "UNKNOWN">;
  cursor?: string;
  limit?: number;
  query?: string;
  company?: string;
  ticker?: string;
  category?: EspiCategory;
  reportType?: EspiReportType;
  dateFrom?: string;
  dateTo?: string;
};

export type EspiSynchronizationResult = {
  status: EspiSourceStatus;
  insertedOrUpdated: number;
  skippedExisting: number;
  parsed: number;
  pagesRead: number;
  locked: boolean;
  errors?: number;
  nextBackfillPage?: number;
  backfillComplete?: boolean;
  overlapComplete?: boolean;
};

export type StoredEspiCorporateEventReport = {
  sourceId: string;
  title: string;
  body: string;
  publishedAt: string;
  sourceUrl: string;
};

const isDiagnosticsEnabled = () => process.env.ESPI_DIAGNOSTICS === "true";
const diagnose = (payload: Record<string, unknown>) => {
  if (isDiagnosticsEnabled()) console.info("espi", payload);
};

const normalizeIso = (value: string | Date) =>
  value instanceof Date ? value.toISOString() : value;

const isFresh = (value: string | null, ttlMs = ESPI_REFRESH_TTL_MS) => {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) && Date.now() - timestamp < ttlMs;
};

export const classifyEspiHttpStatus = (status: number): EspiSourceStatus => {
  if (status === 401 || status === 403) return "ACCESS_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 408 || status === 429 || status >= 500) return "TEMPORARILY_UNAVAILABLE";
  return "PARSE_ERROR";
};

const wait = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));

const fetchOfficialHtml = async (url: string, init: RequestInit = {}) => {
  let lastStatus: EspiSourceStatus = "TEMPORARILY_UNAVAILABLE";
  for (let attempt = 0; attempt < ESPI_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithSystemTrust(url, {
        ...init,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mexo/1.0 (+https://mexo.com.pl; public ESPI feed)",
        ...init.headers,
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(ESPI_SOURCE_TIMEOUT_MS),
      });
      if (response.ok) {
        return { status: "SUCCESS" as const, document: await response.text() };
      }
      lastStatus = classifyEspiHttpStatus(response.status);
      if (lastStatus !== "TEMPORARILY_UNAVAILABLE" || attempt + 1 >= ESPI_FETCH_ATTEMPTS) {
        return { status: lastStatus, document: "" };
      }
    } catch {
      lastStatus = "TEMPORARILY_UNAVAILABLE";
      if (attempt + 1 >= ESPI_FETCH_ATTEMPTS) {
        return { status: lastStatus, document: "" };
      }
    }
    await wait(200 * (attempt + 1));
  }
  return { status: lastStatus, document: "" };
};

const fetchPapHtml = (url: string) => fetchOfficialHtml(url);

const getGpwSearchBody = ({
  offset = 0,
  date,
  page = "espi-ebi-reports",
}: {
  offset?: number;
  date?: string;
  page?: "espi-ebi-reports" | "spolki-komunikaty-spolek";
} = {}) => {
  const body = new URLSearchParams({
    action: "GPWEspiReportUnion",
    start: "ajaxSearch",
    page,
    format: "html",
    lang: "PL",
    letter: "",
    offset: String(offset),
    limit: "50",
    searchText: "",
    date: date ?? "",
  });
  body.append("categoryRaports[]", "ESPI");
  for (const reportType of ["RB", "P", "Q", "O", "R"]) {
    body.append("typeRaports[]", reportType);
  }
  return body;
};

const fetchGpwList = ({ offset = 0, date }: { offset?: number; date?: string } = {}) =>
  fetchOfficialHtml(GPW_ESPI_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: getGpwSearchBody({ offset, date }).toString(),
  });

const fetchNewConnectList = ({ offset = 0, date }: { offset?: number; date?: string } = {}) => {
  const body = getGpwSearchBody({ offset, date, page: "spolki-komunikaty-spolek" });
  // The NewConnect union endpoint expects both market channels to be present;
  // parseNewConnectEspiList still accepts only rows explicitly marked ESPI.
  body.append("categoryRaports[]", "EBI");
  return fetchOfficialHtml(NEWCONNECT_ESPI_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: body.toString(),
  });
};

const parseNewConnectEspiList = (document: string) => parseGpwEspiList(document, {
  baseUrl: NEWCONNECT_ESPI_BASE_URL,
  sourcePrefix: "newconnect",
  sourceKind: "NEWCONNECT",
});

const toGpwDate = (isoDate: string) => {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}-${month}-${year}` : isoDate;
};

const getWarsawDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const addDays = (isoDate: string, days: number) => {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getFeedPageUrl = (page: number) =>
  page > 0 ? `${PAP_ESPI_FEED_URL}?page=${page}` : PAP_ESPI_FEED_URL;

export const getEspiSyncState = async (
  source: string = PAP_SOURCE,
  refreshTtlMs = ESPI_REFRESH_TTL_MS
): Promise<EspiSyncMeta & { nextBackfillPage: number; backfillComplete: boolean; lastOverlapAt?: string }> => {
  const row = await queryOne<EspiSyncStateRow>(
    `
      SELECT status, last_checked_at, last_success_at, last_overlap_at, next_backfill_page,
             backfill_complete, lock_token, lock_expires_at
      FROM espi_sync_state
      WHERE source = $1
    `,
    [source]
  );
  const isRefreshing = Boolean(row?.lock_token && row.lock_expires_at && Date.parse(row.lock_expires_at) > Date.now());
  return {
    status: row?.status ?? "NOT_SYNCED",
    lastCheckedAt: row?.last_checked_at ? normalizeIso(row.last_checked_at) : undefined,
    lastSuccessAt: row?.last_success_at ? normalizeIso(row.last_success_at) : undefined,
    isStale: !isFresh(row?.last_checked_at ?? null, refreshTtlMs),
    isRefreshing,
    nextBackfillPage: row?.next_backfill_page ?? 1,
    backfillComplete: row?.backfill_complete ?? false,
    lastOverlapAt: row?.last_overlap_at ? normalizeIso(row.last_overlap_at) : undefined,
  };
};

const acquireSyncLock = async (source: string = PAP_SOURCE) => {
  const token = randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ESPI_LOCK_TTL_MS).toISOString();
  const row = await queryOne<{ lock_token: string }>(
    `
      INSERT INTO espi_sync_state (
        source, status, next_backfill_page, backfill_complete,
        lock_token, lock_expires_at, created_at, updated_at
      )
      VALUES ($1, 'NOT_FOUND', 1, FALSE, $2, $3, $4, $4)
      ON CONFLICT (source) DO UPDATE SET
        lock_token = EXCLUDED.lock_token,
        lock_expires_at = EXCLUDED.lock_expires_at,
        updated_at = EXCLUDED.updated_at
      WHERE espi_sync_state.lock_expires_at IS NULL
         OR espi_sync_state.lock_expires_at < $4
      RETURNING lock_token
    `,
    [source, token, expiresAt, now]
  );
  return row?.lock_token === token ? token : null;
};

const releaseSyncLock = async ({
  token,
  source = PAP_SOURCE,
  status,
  errorCode,
  nextBackfillPage,
  backfillComplete,
  lastOverlapAt,
}: {
  token: string;
  source?: string;
  status: EspiSourceStatus;
  errorCode?: string;
  nextBackfillPage?: number;
  backfillComplete?: boolean;
  lastOverlapAt?: string;
}) => {
  const now = new Date().toISOString();
  await execute(
    `
      UPDATE espi_sync_state
      SET status = $1,
          last_checked_at = $2,
          last_success_at = CASE WHEN $1 = 'SUCCESS' THEN $2 ELSE last_success_at END,
          last_error_code = $3,
          next_backfill_page = COALESCE($4, next_backfill_page),
          backfill_complete = COALESCE($5, backfill_complete),
          last_overlap_at = COALESCE($6, last_overlap_at),
          lock_token = NULL,
          lock_expires_at = NULL,
          updated_at = $2
      WHERE source = $7 AND lock_token = $8
    `,
    [status, now, errorCode ?? null, nextBackfillPage ?? null, backfillComplete ?? null, lastOverlapAt ?? null, source, token]
  );
};

const mapWithConcurrency = async <T, R>(
  values: T[],
  concurrency: number,
  callback: (value: T) => Promise<R>
) => {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await callback(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
};

const isReliableTicker = (value: string | undefined | null) =>
  Boolean(value && /^[A-Z0-9]{1,8}$/.test(value.trim().toUpperCase()));

const findExistingIssuer = async (isin?: string, ticker?: string) =>
  queryOne<{
    id: string;
    canonical_key: string;
    ticker: string;
    company_name: string;
    isin: string | null;
    market: EspiMarket;
  }>(
    `
      SELECT id, canonical_key, ticker, company_name, isin, market
      FROM corporate_event_instruments
      WHERE market = 'GPW'
        AND (($1::text IS NOT NULL AND isin = $1) OR ($2::text IS NOT NULL AND ticker = $2))
      ORDER BY CASE WHEN $1::text IS NOT NULL AND isin = $1 THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
    `,
    [isin ?? null, ticker ?? null]
  );

const findExistingIssuerForMarket = async (market: EspiMarket, isin?: string, ticker?: string) =>
  queryOne<{
    id: string;
    canonical_key: string;
    ticker: string;
    company_name: string;
    isin: string | null;
    market: EspiMarket;
  }>(
    `
      SELECT id, canonical_key, ticker, company_name, isin, market
      FROM corporate_event_instruments
      WHERE market = $1
        AND (($2::text IS NOT NULL AND isin = $2) OR ($3::text IS NOT NULL AND ticker = $3))
      ORDER BY CASE WHEN $2::text IS NOT NULL AND isin = $2 THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
    `,
    [market, isin ?? null, ticker ?? null]
  );

const resolveGpwIssuer = async (
  report: Pick<ParsedPapEspiReport, "issuerName" | "sourceIsin" | "sourceTicker">
) => {
  const sourceIsin = report.sourceIsin?.trim().toUpperCase();
  const sourceTicker = report.sourceTicker?.trim().toUpperCase();
  const existing = await findExistingIssuer(
    sourceIsin,
    // Never let a reused ticker override a different, explicit issuer ISIN.
    !sourceIsin && isReliableTicker(sourceTicker) ? sourceTicker : undefined
  );
  if (existing) return existing;

  const catalogEntry = sourceIsin
    ? await findGpwCatalogEntryByIsin(sourceIsin) ?? await findGpwIssuerCardByIsin(sourceIsin)
    : isReliableTicker(sourceTicker)
      ? await findGpwCatalogEntry(sourceTicker!)
      : await findGpwCatalogEntryByExactName(report.issuerName);
  if (!catalogEntry) return null;

  const ticker = getGpwTickerCore(catalogEntry.symbol);
  const canonicalKey = `gpw:ticker:${ticker}`;
  const now = new Date().toISOString();
  const id = `corporate-event-instrument:${canonicalKey}`;
  return queryOne<{
    id: string;
    canonical_key: string;
    ticker: string;
    company_name: string;
    isin: string | null;
    market: EspiMarket;
  }>(
    `
      INSERT INTO corporate_event_instruments (
        id, canonical_key, market, isin, ticker, company_name, created_at, updated_at
      )
      VALUES ($1, $2, 'GPW', $3, $4, $5, $6, $6)
      ON CONFLICT (canonical_key) DO UPDATE SET
        isin = COALESCE(corporate_event_instruments.isin, EXCLUDED.isin),
        ticker = EXCLUDED.ticker,
        company_name = EXCLUDED.company_name,
        updated_at = EXCLUDED.updated_at
      RETURNING id, canonical_key, ticker, company_name, isin, market
    `,
    [id, canonicalKey, catalogEntry.isin ?? sourceIsin ?? null, ticker, catalogEntry.name, now]
  );
};

/** Retry a previously cached public report against an exact official GPW
 * ISIN/card without re-fetching its full ESPI body or touching user data. */
export const resolveStoredGpwIssuer = async (report: {
  id: string;
  issuerName: string;
  sourceIsin: string | null;
  sourceTicker: string | null;
}) => {
  const issuer = await resolveGpwIssuer({
    issuerName: report.issuerName,
    sourceIsin: report.sourceIsin ?? undefined,
    sourceTicker: report.sourceTicker ?? undefined,
  });
  if (!issuer) return null;
  await execute(
    `UPDATE espi_reports SET issuer_id = $1, market = 'GPW',
       issuer_metadata_version = $2, issuer_metadata_checked_at = $3, updated_at = $3
     WHERE id = $4 AND issuer_id IS NULL AND market <> 'NEWCONNECT'`,
    [issuer.id, ISSUER_METADATA_VERSION, new Date().toISOString(), report.id]
  );
  return queryOne<{
    id: string; canonical_key: string; ticker: string; company_name: string;
    isin: string | null; market: EspiMarket;
  }>(
    `SELECT instrument.id, instrument.canonical_key, instrument.ticker,
            instrument.company_name, instrument.isin, instrument.market
     FROM espi_reports AS report JOIN corporate_event_instruments AS instrument
       ON instrument.id = report.issuer_id
     WHERE report.id = $1 AND instrument.market = 'GPW'`,
    [report.id]
  );
};

const resolveEspiIssuer = async (report: Pick<ParsedPapEspiReport, "issuerName" | "sourceIsin" | "sourceTicker" | "market">) => {
  const sourceIsin = report.sourceIsin?.trim().toUpperCase();
  const sourceTicker = report.sourceTicker?.trim().toUpperCase();
  if (report.market === "GPW") return resolveGpwIssuer(report);

  const exact = report.market !== "UNKNOWN"
    ? await findExistingIssuerForMarket(
      report.market,
      sourceIsin,
      isReliableTicker(sourceTicker) ? sourceTicker : undefined
    )
    : null;
  if (exact) return exact;

  // PAP may omit market metadata. Preserve the historical GPW resolver as a
  // strict catalog/ISIN/ticker fallback, but never infer NewConnect from a
  // ticker suffix or a fuzzy company name.
  if (report.market === "UNKNOWN") return resolveGpwIssuer(report);
  if (report.market !== "NEWCONNECT") return null;

  const ticker = isReliableTicker(sourceTicker) ? sourceTicker : undefined;
  const canonicalKey = sourceIsin
    ? `newconnect:isin:${sourceIsin}`
    : ticker
      ? `newconnect:ticker:${ticker}`
      : null;
  if (!canonicalKey) return null;
  const now = new Date().toISOString();
  const id = `corporate-event-instrument:${canonicalKey}`;
  return queryOne<{
    id: string;
    canonical_key: string;
    ticker: string;
    company_name: string;
    isin: string | null;
    market: EspiMarket;
  }>(
    `
      INSERT INTO corporate_event_instruments (
        id, canonical_key, market, isin, ticker, company_name, created_at, updated_at
      )
      VALUES ($1, $2, 'NEWCONNECT', $3, $4, $5, $6, $6)
      ON CONFLICT (canonical_key) DO UPDATE SET
        isin = COALESCE(corporate_event_instruments.isin, EXCLUDED.isin),
        ticker = COALESCE(NULLIF(EXCLUDED.ticker, ''), corporate_event_instruments.ticker),
        company_name = COALESCE(NULLIF(EXCLUDED.company_name, ''), corporate_event_instruments.company_name),
        updated_at = EXCLUDED.updated_at
      RETURNING id, canonical_key, ticker, company_name, isin, market
    `,
    [id, canonicalKey, sourceIsin ?? null, ticker ?? "", report.issuerName, now]
  );
};

const upsertEspiReport = async (report: ParsedPapEspiReport) => {
  const issuer = await resolveEspiIssuer(report);
  const storedMarket: EspiMarket = report.market === "UNKNOWN"
    ? issuer?.market ?? "UNKNOWN"
    : report.market;
  const existing = await queryOne<{ id: string; source_id: string }>(
    `
      SELECT id, source_id
      FROM espi_reports
      WHERE (source = $1 AND source_id = $2)
         OR source_url = $3
         OR (
           $4::text IS NOT NULL
           AND source_isin = $4
           AND report_number IS NOT DISTINCT FROM $5
           AND report_type = $6
           AND is_correction = $7
         )
         OR (
           $8::text IS NOT NULL
           AND issuer_id = $8
           AND report_number IS NOT DISTINCT FROM $5
           AND report_type = $6
           AND is_correction = $7
         )
      ORDER BY
        CASE WHEN source = $1 AND source_id = $2 THEN 0 ELSE 1 END,
        CASE
          WHEN source_id LIKE 'gpw:%' THEN 0
          WHEN source_id LIKE 'newconnect:%' THEN 1
          ELSE 2
        END,
        published_at DESC
      LIMIT 1
    `,
    [
      PAP_SOURCE,
      report.sourceId,
      report.sourceUrl,
      report.sourceIsin ?? null,
      report.reportNumber ?? null,
      report.reportType,
      report.isCorrection,
      issuer?.id ?? null,
    ]
  );
  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();
  const shouldRefreshStoredReport =
    !existing ||
    existing.source_id === report.sourceId ||
    getEspiSourcePriority(report.sourceId) < getEspiSourcePriority(existing.source_id);

  await withTransaction(async (transaction) => {
    if (existing && shouldRefreshStoredReport) {
      await transaction.execute(
        `
          UPDATE espi_reports
          SET source_id = $1, issuer_id = COALESCE($2, issuer_id), issuer_name = $3,
              market = $4, source_ticker = $5, source_isin = $6, report_number = $7,
              report_type = $8, published_at = $9, source_title = $10, title = $11,
              body_text = $12, legal_basis = $13, category = $14, source_url = $15,
              is_correction = $16, correction_target_report_number = $17,
              source_checked_at = $18, updated_at = $18,
              corporate_events_projection_status = CASE
                WHEN source_title IS DISTINCT FROM $10
                  OR title IS DISTINCT FROM $11
                  OR body_text IS DISTINCT FROM $12
                  OR issuer_id IS DISTINCT FROM COALESCE($2, issuer_id)
                  OR market IS DISTINCT FROM $4
                THEN NULL ELSE corporate_events_projection_status END,
              corporate_events_projection_version = CASE
                WHEN source_title IS DISTINCT FROM $10
                  OR title IS DISTINCT FROM $11
                  OR body_text IS DISTINCT FROM $12
                  OR issuer_id IS DISTINCT FROM COALESCE($2, issuer_id)
                  OR market IS DISTINCT FROM $4
                THEN NULL ELSE corporate_events_projection_version END,
              dividend_projection_status = CASE
                WHEN source_title IS DISTINCT FROM $10
                  OR title IS DISTINCT FROM $11
                  OR body_text IS DISTINCT FROM $12
                  OR issuer_id IS DISTINCT FROM COALESCE($2, issuer_id)
                  OR market IS DISTINCT FROM $4
                THEN NULL ELSE dividend_projection_status END,
              dividend_projection_version = CASE
                WHEN source_title IS DISTINCT FROM $10
                  OR title IS DISTINCT FROM $11
                  OR body_text IS DISTINCT FROM $12
                  OR issuer_id IS DISTINCT FROM COALESCE($2, issuer_id)
                  OR market IS DISTINCT FROM $4
                THEN NULL ELSE dividend_projection_version END,
              report_schedule_projection_status = CASE
                WHEN source_title IS DISTINCT FROM $10 OR title IS DISTINCT FROM $11
                  OR body_text IS DISTINCT FROM $12 OR issuer_id IS DISTINCT FROM COALESCE($2, issuer_id)
                  OR market IS DISTINCT FROM $4
                THEN NULL ELSE report_schedule_projection_status END,
              report_schedule_projection_version = CASE
                WHEN source_title IS DISTINCT FROM $10 OR title IS DISTINCT FROM $11
                  OR body_text IS DISTINCT FROM $12 OR issuer_id IS DISTINCT FROM COALESCE($2, issuer_id)
                  OR market IS DISTINCT FROM $4
                THEN NULL ELSE report_schedule_projection_version END
          WHERE id = $19
        `,
        [
          report.sourceId, issuer?.id ?? null, report.issuerName, storedMarket,
          report.sourceTicker ?? null, report.sourceIsin ?? null, report.reportNumber ?? null,
          report.reportType, report.publishedAt, report.sourceTitle, report.title, report.body,
          report.legalBasis ?? null, report.category, report.sourceUrl, report.isCorrection,
          report.correctionTargetReportNumber ?? null, now, id,
        ]
      );
    } else if (existing) {
      // Preserve the richer official GPW/NewConnect publication when a lower
      // priority PAP copy confirms the same formal report. Missing identity
      // metadata may still be completed and attachments are merged below.
      await transaction.execute(
        `
          UPDATE espi_reports
          SET issuer_id = COALESCE(issuer_id, $1),
              market = CASE WHEN market = 'UNKNOWN' THEN $2 ELSE market END,
              source_ticker = COALESCE(source_ticker, $3),
              source_isin = COALESCE(source_isin, $4),
              source_checked_at = $5,
              updated_at = $5
          WHERE id = $6
        `,
        [issuer?.id ?? null, storedMarket, report.sourceTicker ?? null, report.sourceIsin ?? null, now, id]
      );
    } else {
      await transaction.execute(
        `
          INSERT INTO espi_reports (
            id, source, source_id, issuer_id, issuer_name, source_ticker, source_isin,
            market, report_number, report_type, published_at, source_title, title, body_text,
            legal_basis, category, source_url, is_correction,
            correction_target_report_number, source_checked_at, discovered_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                  $12, $13, $14, $15, $16, $17, $18, $19, $20, $20, $20)
        `,
        [
          id, PAP_SOURCE, report.sourceId, issuer?.id ?? null, report.issuerName,
          report.sourceTicker ?? null, report.sourceIsin ?? null, storedMarket,
          report.reportNumber ?? null, report.reportType, report.publishedAt, report.sourceTitle,
          report.title, report.body, report.legalBasis ?? null, report.category, report.sourceUrl,
          report.isCorrection, report.correctionTargetReportNumber ?? null, now,
        ]
      );
    }

    for (const attachment of report.attachments) {
      await transaction.execute(
        `
          INSERT INTO espi_report_attachments (
            id, espi_report_id, name, media_type, size_label, source_url, discovered_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          ON CONFLICT (espi_report_id, source_url) DO UPDATE SET
            name = EXCLUDED.name,
            media_type = EXCLUDED.media_type,
            size_label = EXCLUDED.size_label,
            updated_at = EXCLUDED.updated_at
        `,
        [randomUUID(), id, attachment.name, attachment.mediaType ?? null, attachment.sizeLabel ?? null, attachment.sourceUrl, now]
      );
    }
  });

  return { id, issuerId: issuer?.id ?? null, created: !existing };
};

const linkCorrection = async (reportId: string, report: ParsedPapEspiReport, issuerId: string | null) => {
  if (!report.isCorrection || !report.correctionTargetReportNumber) return;
  const original = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM espi_reports
      WHERE id <> $1
        AND report_number = $2
        AND published_at <= $3
        AND (
          ($4::text IS NOT NULL AND issuer_id = $4)
          OR ($5::text IS NOT NULL AND source_isin = $5)
        )
      ORDER BY published_at DESC
      LIMIT 1
    `,
    [reportId, report.correctionTargetReportNumber, report.publishedAt, issuerId, report.sourceIsin ?? null]
  );
  if (original) {
    await execute(
      "UPDATE espi_reports SET correction_of_report_id = $1, updated_at = $2 WHERE id = $3",
      [original.id, new Date().toISOString(), reportId]
    );
  }
};

const getStoredSourceState = async (candidates: PapEspiListCandidate[]) => {
  if (candidates.length === 0) return { storedIds: new Set<string>(), sourceCheckedAt: new Map<string, string | null>() };
  const rows = await query<{
    source_id: string;
    source_checked_at: string | null;
    source_isin: string | null;
    report_number: string | null;
    report_type: EspiReportType;
    published_at: string;
    is_correction: boolean;
  }>(
    `
      SELECT source_id, source_checked_at, source_isin, report_number, report_type, published_at, is_correction
      FROM espi_reports
      WHERE source = $1
        AND (
          source_id = ANY($2::text[])
          OR (
            source_isin = ANY($3::text[])
            AND published_at >= $4
            AND published_at <= $5
          )
        )
    `,
    [
      PAP_SOURCE,
      candidates.map((candidate) => candidate.sourceId),
      candidates.flatMap((candidate) => candidate.sourceIsin ? [candidate.sourceIsin] : []),
      candidates.map((candidate) => candidate.sourcePublishedAt).filter(Boolean).sort()[0] ?? "1970-01-01T00:00:00.000Z",
      candidates.map((candidate) => candidate.sourcePublishedAt).filter(Boolean).sort().at(-1) ?? "2999-12-31T23:59:59.999Z",
    ]
  );
  const stored = new Set(rows.map((row) => row.source_id));
  const sourceCheckedAt = new Map(rows.map((row) => [row.source_id, row.source_checked_at]));
  for (const candidate of candidates) {
    if (!candidate.sourceIsin || !candidate.sourcePublishedAt || !candidate.reportType) continue;
    const naturalMatch = rows.some((row) => {
      if (
        row.source_isin !== candidate.sourceIsin ||
        row.report_number !== (candidate.reportNumber ?? null) ||
        row.report_type !== candidate.reportType ||
        row.is_correction !== /korekt/i.test(candidate.sourceTitle)
      ) {
        return false;
      }

      // A formal report number is unique for an issuer and year. GPW and PAP
      // may publish the same report a minute apart, so the source timestamp is
      // only needed as a fallback when no report number exists.
      return Boolean(candidate.reportNumber) ||
        normalizeIso(row.published_at).slice(0, 16) === candidate.sourcePublishedAt!.slice(0, 16);
    });
    if (naturalMatch) stored.add(candidate.sourceId);
  }
  return { storedIds: stored, sourceCheckedAt };
};

/**
 * Read the already-normalized central ESPI cache for Corporate Events.
 *
 * This deliberately does not fetch PAP itself. The caller can use the shared
 * synchronizePapEspi TTL/lock before reading, so WZA discovery never creates a
 * second per-user or per-issuer crawler. The title predicate keeps large report
 * bodies out of the DB-to-runtime payload unless the report can actually be a
 * general-meeting notice; the deterministic Corporate Events parser remains
 * the final authority on whether the notice creates an event.
 */
export const getStoredEspiReportsForCorporateEvents = async ({
  instrumentId,
  limit = 80,
}: {
  instrumentId: string;
  limit?: number;
}): Promise<StoredEspiCorporateEventReport[]> => {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  const publishedAfter = new Date(Date.now() - 730 * 24 * 60 * 60 * 1_000).toISOString();
  const rows = await query<{
    source_id: string;
    source_title: string;
    title: string;
    body_text: string;
    published_at: string;
    source_url: string;
  }>(
    `
      SELECT source_id, source_title, title, body_text, published_at, source_url
      FROM espi_reports
      WHERE source = $1
        AND issuer_id = $2
        AND published_at >= $3
        AND (
          category = 'GENERAL_MEETING'
          OR
          source_title ILIKE '%waln%zgromadz%'
          OR title ILIKE '%waln%zgromadz%'
          OR source_title ~* '(^|[^[:alnum:]])(ZWZ|NWZ)([^[:alnum:]]|$)'
          OR title ~* '(^|[^[:alnum:]])(ZWZ|NWZ)([^[:alnum:]]|$)'
        )
      ORDER BY published_at DESC, source_id DESC
      LIMIT $4
    `,
    [PAP_SOURCE, instrumentId, publishedAfter, boundedLimit]
  );

  return rows.map((row) => ({
    sourceId: row.source_id,
    title: row.source_title || row.title,
    body: row.body_text,
    publishedAt: normalizeIso(row.published_at),
    sourceUrl: row.source_url,
  }));
};

const reconcileStoredEspiMetadata = async () => {
  const rows = await query<{
    id: string;
    source_id: string;
    issuer_id: string | null;
    source_title: string;
    body_text: string;
    report_number: string | null;
    report_type: EspiReportType;
    category: EspiCategory;
    source_isin: string | null;
    source_ticker: string | null;
    issuer_name: string;
    market: EspiMarket;
    issuer_market: EspiMarket | null;
    issuer_metadata_version: number | null;
    issuer_metadata_checked_at: string | null;
  }>(
    `
      SELECT report.id, report.source_id, report.issuer_id, report.source_title, report.body_text,
             report.report_number, report.report_type, report.category,
             report.source_isin, report.source_ticker, report.issuer_name, report.market,
             report.issuer_metadata_version, report.issuer_metadata_checked_at,
             issuer.market AS issuer_market
      FROM espi_reports AS report
      LEFT JOIN corporate_event_instruments AS issuer ON issuer.id = report.issuer_id
      WHERE report.source = $1
        AND (
          report.issuer_metadata_version IS DISTINCT FROM $2
          OR (
            report.issuer_id IS NULL
            AND (report.issuer_metadata_checked_at IS NULL OR report.issuer_metadata_checked_at < $3)
          )
        )
      ORDER BY report.published_at ASC, report.id ASC
      LIMIT $4
    `,
    [
      PAP_SOURCE,
      ISSUER_METADATA_VERSION,
      new Date(Date.now() - ISSUER_RETRY_AFTER_DAYS * 24 * 60 * 60 * 1_000).toISOString(),
      ISSUER_RECONCILIATION_BATCH_SIZE,
    ]
  );
  let changed = 0;
  let errors = 0;
  for (const row of rows) {
    try {
      const classifiedReportType = classifyEspiReportType(row.source_title);
      const reportType = classifiedReportType === "OTHER" && row.report_number
        ? "CURRENT"
        : classifiedReportType;
      const category = classifyEspiCategory({
        title: row.source_title,
        body: row.body_text,
        reportType,
      });
      const issuer = row.issuer_id
        ? null
        : await resolveEspiIssuer({
            sourceIsin: row.source_isin ?? undefined,
            sourceTicker: row.source_ticker ?? undefined,
            issuerName: row.issuer_name,
            market: row.market,
          });
      const inferredMarket: EspiMarket = row.market === "UNKNOWN"
        ? issuer?.market ?? row.issuer_market ?? (row.source_id.startsWith("newconnect:") ? "NEWCONNECT" : "UNKNOWN")
        : row.market;
      const now = new Date().toISOString();
      await execute(
        `
          UPDATE espi_reports
          SET report_type = $1,
              category = $2,
              issuer_id = COALESCE(issuer_id, $3),
              market = $4,
              issuer_metadata_version = $5,
              issuer_metadata_checked_at = $6,
              corporate_events_projection_status = NULL,
              corporate_events_projection_version = NULL,
              updated_at = $6
          WHERE id = $7
        `,
        [
          reportType,
          category,
          issuer?.id ?? null,
          inferredMarket,
          ISSUER_METADATA_VERSION,
          now,
          row.id,
        ]
      );
      changed += 1;
    } catch (error) {
      errors += 1;
      diagnose({
        provider: PAP_SOURCE,
        phase: "metadata-reconcile",
        sourceId: row.source_id,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return { changed, errors, attempted: rows.length, hasMore: rows.length === ISSUER_RECONCILIATION_BATCH_SIZE };
};

const reconcileCorrectionLinks = async () => {
  await execute(
    `
      WITH matches AS (
        SELECT correction.id AS correction_id,
               (
                 SELECT candidate.id
                 FROM espi_reports candidate
                 WHERE candidate.id <> correction.id
                   AND candidate.report_number = correction.correction_target_report_number
                   AND candidate.published_at <= correction.published_at
                   AND (
                     (correction.issuer_id IS NOT NULL AND candidate.issuer_id = correction.issuer_id)
                     OR (correction.source_isin IS NOT NULL AND candidate.source_isin = correction.source_isin)
                   )
                 ORDER BY candidate.published_at DESC
                 LIMIT 1
               ) AS original_id
        FROM espi_reports correction
        WHERE correction.source = $2
          AND correction.is_correction = TRUE
          AND correction.correction_of_report_id IS NULL
          AND correction.correction_target_report_number IS NOT NULL
      )
      UPDATE espi_reports correction
      SET correction_of_report_id = matches.original_id,
          updated_at = $1
      FROM matches
      WHERE correction.id = matches.correction_id
        AND matches.original_id IS NOT NULL
    `,
    [new Date().toISOString(), PAP_SOURCE]
  );
};

export const synchronizePapEspi = async ({
  force = false,
  backfillPages,
  backfillFrom,
}: {
  force?: boolean;
  backfillPages?: number;
  backfillFrom?: string;
} = {}): Promise<EspiSynchronizationResult> => {
  const startedAt = Date.now();
  const state = await getEspiSyncState();
  if (!force && !state.isStale) {
    console.info("[ESPI SYNC] fetched=0 new=0 duplicates=0 saved=0 errors=0");
    return { status: state.status === "NOT_SYNCED" ? "NOT_FOUND" : state.status, insertedOrUpdated: 0, skippedExisting: 0, parsed: 0, pagesRead: 0, locked: false, errors: 0, nextBackfillPage: state.nextBackfillPage, backfillComplete: state.backfillComplete };
  }
  const token = await acquireSyncLock();
  if (!token) {
    console.info("[ESPI SYNC] fetched=0 new=0 duplicates=0 saved=0 errors=0");
    return { status: state.status === "NOT_SYNCED" ? "NOT_FOUND" : state.status, insertedOrUpdated: 0, skippedExisting: 0, parsed: 0, pagesRead: 0, locked: true, errors: 0, nextBackfillPage: state.nextBackfillPage, backfillComplete: state.backfillComplete };
  }

  let status: EspiSourceStatus = "SUCCESS";
  let pagesRead = 0;
  let skippedExisting = 0;
  let errors = 0;
  let parseErrors = 0;
  let titleFallbacks = 0;
  let sourceFailure: EspiSourceStatus | null = null;
  let nextBackfillPage = state.nextBackfillPage;
  let backfillComplete = state.backfillComplete;
  let lastOverlapAt: string | undefined;
  try {
    const candidates: PapEspiListCandidate[] = [];
    const officialSources = [
      { sourcePrefix: "gpw", fetchList: fetchGpwList, parseList: parseGpwEspiList },
      { sourcePrefix: "newconnect", fetchList: fetchNewConnectList, parseList: parseNewConnectEspiList },
    ];
    const mainResponses = await Promise.all(officialSources.map((source) => source.fetchList()));
    const officialSourcesAvailable = mainResponses.some((response) => response.status === "SUCCESS");
    const availableOfficialSources = officialSources.filter((_, index) => mainResponses[index]?.status === "SUCCESS");

    for (let index = 0; index < officialSources.length; index += 1) {
      const response = mainResponses[index]!;
      if (response.status !== "SUCCESS") {
        errors += 1;
        sourceFailure ??= response.status;
        continue;
      }
      pagesRead += 1;
      const parsed = officialSources[index]!.parseList(response.document);
      candidates.push(...parsed.candidates);
      titleFallbacks += parsed.titleFallbacks ?? 0;
      if (parsed.malformedRows > 0) {
        errors += parsed.malformedRows;
        parseErrors += parsed.malformedRows;
      }
    }

    // PAP's public ESPI channel is a supplement to the exchange union feed,
    // not only a last-resort fallback. This repairs occasional missed market
    // rows while the source URL/issuer/report identity deduplicates both feeds.
    const papLatest = await fetchPapHtml(PAP_ESPI_FEED_URL);
    if (papLatest.status === "SUCCESS") {
      pagesRead += 1;
      candidates.push(...parsePapEspiList(papLatest.document).candidates);
    } else {
      errors += 1;
      sourceFailure ??= papLatest.status;
      if (!officialSourcesAvailable) {
        status = papLatest.status;
        throw new Error(`ESPI_LIST_${status}`);
      }
    }

    const today = getWarsawDate();
    const requestedFrom = /^20\d{2}-\d{2}-\d{2}$/.test(backfillFrom ?? "")
      ? backfillFrom!
      : undefined;
    const boundedEarliest = addDays(today, -14);
    const overlapFrom = requestedFrom && requestedFrom > boundedEarliest
      ? requestedFrom
      : requestedFrom
        ? boundedEarliest
        : addDays(today, -(ESPI_OVERLAP_DAYS - 1));
    const overlapDue = force || Boolean(requestedFrom) || !isFresh(state.lastOverlapAt ?? null, ESPI_OVERLAP_TTL_MS);
    let overlapSucceeded = errors === 0;

    if (officialSourcesAvailable && overlapDue) {
      // Date-specific GPW filtering is useful but has historically omitted an
      // occasional non-session day. Page overlap is therefore the completeness
      // guard: it walks until reaching the full WZA repair horizon, instead of
      // the old fixed first three pages.
      const officialRepairFrom = addDays(today, -ESPI_OFFICIAL_REPAIR_DAYS);
      for (const source of availableOfficialSources) {
        const seenPageIds = new Set(candidates
          .filter((candidate) => candidate.sourceId.startsWith(`${source.sourcePrefix}:`))
          .map((candidate) => candidate.sourceId));
        const seenPageSignatures = new Set<string>();
        for (let offset = 50; ; offset += 50) {
          const response = await source.fetchList({ offset });
          if (response.status !== "SUCCESS") {
            errors += 1;
            sourceFailure ??= response.status;
            overlapSucceeded = false;
            break;
          }
          pagesRead += 1;
          const pageSignature = createHash("sha256").update(response.document).digest("hex");
          if (seenPageSignatures.has(pageSignature)) {
            errors += 1;
            sourceFailure ??= "TEMPORARILY_UNAVAILABLE";
            overlapSucceeded = false;
            diagnose({ provider: source.sourcePrefix, phase: "pagination", status: "REPEATED_PAGE", offset });
            break;
          }
          seenPageSignatures.add(pageSignature);
          const parsedPage = source.parseList(response.document);
          const pageCandidates = parsedPage.candidates;
          titleFallbacks += parsedPage.titleFallbacks ?? 0;
          if (parsedPage.malformedRows > 0) {
            errors += parsedPage.malformedRows;
            parseErrors += parsedPage.malformedRows;
            overlapSucceeded = false;
          }
          candidates.push(...pageCandidates);
          if (parsedPage.eligibleRows === 0) break;
          const introducedNewCandidate = pageCandidates.some((candidate) => {
            if (seenPageIds.has(candidate.sourceId)) return false;
            seenPageIds.add(candidate.sourceId);
            return true;
          });
          if (!introducedNewCandidate && pageCandidates.length > 0) {
            errors += 1;
            sourceFailure ??= "TEMPORARILY_UNAVAILABLE";
            overlapSucceeded = false;
            diagnose({ provider: source.sourcePrefix, phase: "pagination", status: "REPEATED_PAGE", offset });
            break;
          }
          const oldest = pageCandidates
            .map((candidate) => candidate.sourcePublishedAt?.slice(0, 10))
            .filter((value): value is string => Boolean(value))
            .sort()[0];
          if (
            parsedPage.eligibleRows < 50 ||
            (oldest && oldest < officialRepairFrom)
          ) break;
        }
        for (let date = overlapFrom; date <= today; date = addDays(date, 1)) {
          const seenDateIds = new Set<string>();
          const seenDatePageSignatures = new Set<string>();
          for (let offset = 0; ; offset += 50) {
            const response = await source.fetchList({ date: toGpwDate(date), offset });
            if (response.status !== "SUCCESS") {
              errors += 1;
              sourceFailure ??= response.status;
              overlapSucceeded = false;
              break;
            }
            pagesRead += 1;
            const pageSignature = createHash("sha256").update(response.document).digest("hex");
            if (seenDatePageSignatures.has(pageSignature)) {
              errors += 1;
              sourceFailure ??= "TEMPORARILY_UNAVAILABLE";
              overlapSucceeded = false;
              diagnose({ provider: source.sourcePrefix, phase: "date-pagination", status: "REPEATED_PAGE", date, offset });
              break;
            }
            seenDatePageSignatures.add(pageSignature);
            const parsedPage = source.parseList(response.document);
            titleFallbacks += parsedPage.titleFallbacks ?? 0;
            if (parsedPage.malformedRows > 0) {
              errors += parsedPage.malformedRows;
              parseErrors += parsedPage.malformedRows;
              overlapSucceeded = false;
            }
            candidates.push(...parsedPage.candidates);
            if (parsedPage.eligibleRows === 0) break;
            const introducedNewCandidate = parsedPage.candidates.some((candidate) => {
              if (seenDateIds.has(candidate.sourceId)) return false;
              seenDateIds.add(candidate.sourceId);
              return true;
            });
            if (!introducedNewCandidate && parsedPage.candidates.length > 0) {
              errors += 1;
              sourceFailure ??= "TEMPORARILY_UNAVAILABLE";
              overlapSucceeded = false;
              diagnose({ provider: source.sourcePrefix, phase: "date-pagination", status: "REPEATED_PAGE", date, offset });
              break;
            }
            if (parsedPage.eligibleRows < 50) break;
          }
        }
      }
      if (overlapSucceeded) lastOverlapAt = new Date().toISOString();
    }

    // Preserve the bounded PAP archive bootstrap for installations which have
    // not finished it yet. It is secondary to GPW and never replaces the
    // rolling official-date overlap used for gap repair.
    const requestedBackfill = Math.min(
      Math.max(
        backfillPages ?? (state.lastSuccessAt ? (state.backfillComplete ? 0 : 1) : INITIAL_BACKFILL_PAGES),
        0
      ),
      4
    );
    const pages: number[] = [];
    if (!backfillComplete) {
      for (let index = 0; index < requestedBackfill; index += 1) {
        const page = nextBackfillPage + index;
        if (page >= ESPI_BACKFILL_PAGE_LIMIT) {
          backfillComplete = true;
          break;
        }
        pages.push(page);
      }
    }

    for (const page of Array.from(new Set(pages))) {
      const response = await fetchPapHtml(getFeedPageUrl(page));
      if (response.status !== "SUCCESS") {
        errors += 1;
        sourceFailure ??= response.status;
        break;
      }
      pagesRead += 1;
      const parsedPage = parsePapEspiList(response.document);
      candidates.push(...parsedPage.candidates);
      if (page > 0) {
        nextBackfillPage = page + 1;
        if (
          !parsedPage.hasNextPage ||
          parsedPage.candidates.length === 0 ||
          nextBackfillPage >= ESPI_BACKFILL_PAGE_LIMIT
        ) backfillComplete = true;
      }
    }

    const uniqueCandidates = Array.from(new Map(candidates.map((item) => [item.sourceId, item])).values());
    const storedState = await getStoredSourceState(uniqueCandidates);
    const detailRefreshBoundary = addDays(today, -90);
    const pending = uniqueCandidates.filter((candidate) => {
      if (!storedState.storedIds.has(candidate.sourceId)) return true;
      // Re-read only recent exact source documents at most once per day. This
      // detects source-side corrections/attachment edits without re-downloading
      // the entire archive on every feed request. Cross-source duplicates are
      // not fetched because their source id has no exact stored check record.
      if (!storedState.sourceCheckedAt.has(candidate.sourceId)) return false;
      const publishedDay = candidate.sourcePublishedAt?.slice(0, 10);
      if (!publishedDay || publishedDay < detailRefreshBoundary) return false;
      return !isFresh(storedState.sourceCheckedAt.get(candidate.sourceId) ?? null, 24 * 60 * 60 * 1_000);
    });
    skippedExisting = uniqueCandidates.length - pending.length;
    const fetched = await mapWithConcurrency(pending, ARTICLE_CONCURRENCY, async (candidate) => {
      try {
        const response = await fetchOfficialHtml(candidate.sourceUrl);
        if (response.status !== "SUCCESS") return { status: response.status, report: null };
        const report = candidate.sourceKind === "GPW" || candidate.sourceKind === "NEWCONNECT"
          ? parseGpwEspiReport(response.document, candidate)
          : parsePapEspiReport(response.document, candidate);
        return { status: report ? "SUCCESS" as const : "PARSE_ERROR" as const, report };
      } catch {
        return { status: "PARSE_ERROR" as const, report: null };
      }
    });
    const parsedReports = fetched.flatMap((entry) => entry.report ? [entry.report] : []);
    for (const entry of fetched) {
      if (entry.status === "SUCCESS" && entry.report) continue;
      errors += 1;
      if (entry.status === "PARSE_ERROR") parseErrors += 1;
      else sourceFailure ??= entry.status;
    }
    const storedReports: Array<{ report: ParsedPapEspiReport; id: string; issuerId: string | null; created: boolean }> = [];
    for (const report of parsedReports) {
      try {
        const stored = await upsertEspiReport(report);
        storedReports.push({ report, ...stored });
      } catch (error) {
        errors += 1;
        diagnose({ provider: PAP_SOURCE, phase: "store", sourceId: report.sourceId, error: error instanceof Error ? error.name : "unknown" });
      }
    }
    for (const stored of storedReports) {
      try {
        await linkCorrection(stored.id, stored.report, stored.issuerId);
      } catch (error) {
        errors += 1;
        sourceFailure ??= "TEMPORARILY_UNAVAILABLE";
        diagnose({ provider: PAP_SOURCE, phase: "correction-link", sourceId: stored.report.sourceId, error: error instanceof Error ? error.name : "unknown" });
      }
    }
    let metadataChanges = 0;
    try {
      const reconciliation = await reconcileStoredEspiMetadata();
      metadataChanges = reconciliation.changed;
      errors += reconciliation.errors;
      if (reconciliation.errors > 0) sourceFailure ??= "TEMPORARILY_UNAVAILABLE";
      if (reconciliation.hasMore) diagnose({ provider: PAP_SOURCE, phase: "metadata-reconcile", status: "CONTINUING", attempted: reconciliation.attempted });
    } catch (error) {
      errors += 1;
      sourceFailure ??= "TEMPORARILY_UNAVAILABLE";
      diagnose({ provider: PAP_SOURCE, phase: "metadata-reconcile", error: error instanceof Error ? error.name : "unknown" });
    }
    try {
      await reconcileCorrectionLinks();
    } catch (error) {
      errors += 1;
      sourceFailure ??= "TEMPORARILY_UNAVAILABLE";
      diagnose({ provider: PAP_SOURCE, phase: "correction-reconcile", error: error instanceof Error ? error.name : "unknown" });
    }

    if (errors > 0 && status === "SUCCESS") {
      status = parseErrors > 0 ? "PARSE_ERROR" : sourceFailure ?? "TEMPORARILY_UNAVAILABLE";
    }

    if (pending.length > 0 && storedReports.length === 0) {
      status = fetched.find((entry) => entry.status !== "SUCCESS")?.status ?? "PARSE_ERROR";
    }

    await releaseSyncLock({ token, status, nextBackfillPage, backfillComplete, lastOverlapAt });
    diagnose({
      provider: PAP_SOURCE,
      status,
      pagesRead,
      candidates: uniqueCandidates.length,
      parsed: parsedReports.length,
      skippedExisting,
      metadataChanges,
      errors,
      parseErrors,
      titleFallbacks,
      overlapComplete: overlapDue ? Boolean(lastOverlapAt) : undefined,
      durationMs: Date.now() - startedAt,
    });
    const created = storedReports.filter((entry) => entry.created).length;
    const duplicates = skippedExisting + storedReports.length - created;
    console.info(`[ESPI SYNC] fetched=${uniqueCandidates.length} new=${created} duplicates=${duplicates} saved=${storedReports.length} titleFallbacks=${titleFallbacks} errors=${errors}`);
    return {
      status,
      insertedOrUpdated: storedReports.length,
      skippedExisting,
      parsed: parsedReports.length,
      pagesRead,
      locked: false,
      errors,
      nextBackfillPage,
      backfillComplete,
      overlapComplete: overlapDue ? Boolean(lastOverlapAt) : undefined,
    };
  } catch (error) {
    await releaseSyncLock({
      token,
      status,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN",
      nextBackfillPage,
      backfillComplete,
    });
    diagnose({
      provider: PAP_SOURCE,
      status,
      pagesRead,
      skippedExisting,
      durationMs: Date.now() - startedAt,
    });
    console.info(`[ESPI SYNC] fetched=0 new=0 duplicates=${skippedExisting} saved=0 errors=${Math.max(errors, 1)}`);
    return { status, insertedOrUpdated: 0, skippedExisting, parsed: 0, pagesRead, locked: false, errors: Math.max(errors, 1), nextBackfillPage, backfillComplete };
  }
};

const isPotentialGpwGeneralMeetingCandidate = (candidate: PapEspiListCandidate) => {
  const text = `${candidate.sourceTitle} ${candidate.title ?? ""}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[łŁ]/g, (character) => character === "Ł" ? "L" : "l")
    .toLocaleLowerCase("pl-PL");
  return /waln\w*\s+zgromadzen|\b(?:wza|zwz|nwz|agm|egm)\b|zwo(?:l|l)an\w*\s+(?:nadzwyczajn\w*\s+)?waln/iu.test(text);
};

export type GpwGeneralMeetingSourceSyncResult = {
  status: EspiSourceStatus;
  pagesRead: number;
  candidates: number;
  fetched: number;
  parsed: number;
  saved: number;
  duplicates: number;
  errors: number;
  locked: boolean;
};

let gpwGeneralMeetingSyncInFlight: Promise<GpwGeneralMeetingSourceSyncResult> | null = null;

export const getGpwGeneralMeetingSyncState = () =>
  getEspiSyncState(GPW_WZA_SOURCE, GPW_WZA_REFRESH_TTL_MS);

/**
 * Fast, shared WZA lane: page the official GPW union only over the 12-month
 * publication horizon and fetch details only for plausible meeting notices.
 * Full ESPI history synchronization remains independent and continues to fill
 * the ESPI feed without blocking the global meeting calendar.
 */
export const synchronizeGpwGeneralMeetingReports = ({ force = false }: { force?: boolean } = {}): Promise<GpwGeneralMeetingSourceSyncResult> => {
  if (gpwGeneralMeetingSyncInFlight) return gpwGeneralMeetingSyncInFlight;

  gpwGeneralMeetingSyncInFlight = (async (): Promise<GpwGeneralMeetingSourceSyncResult> => {
    const state = await getGpwGeneralMeetingSyncState();
    if (!force && !state.isStale) {
      return {
        status: state.status === "NOT_SYNCED" ? "NOT_FOUND" : state.status,
        pagesRead: 0,
        candidates: 0,
        fetched: 0,
        parsed: 0,
        saved: 0,
        duplicates: 0,
        errors: 0,
        locked: false,
      };
    }

    const token = await acquireSyncLock(GPW_WZA_SOURCE);
    if (!token) {
      return {
        status: state.status === "NOT_SYNCED" ? "NOT_FOUND" : state.status,
        pagesRead: 0,
        candidates: 0,
        fetched: 0,
        parsed: 0,
        saved: 0,
        duplicates: 0,
        errors: 0,
        locked: true,
      };
    }

    let status: EspiSourceStatus = "SUCCESS";
    let pagesRead = 0;
    let errors = 0;
    let overlapComplete = false;
    let lastOverlapAt: string | undefined;
    const startedAt = Date.now();

    try {
      const today = getWarsawDate();
      const repairBoundary = addDays(today, -ESPI_OFFICIAL_REPAIR_DAYS);
      const priorOverlapDate = state.lastOverlapAt?.slice(0, 10);
      const rollingBoundary = priorOverlapDate ? addDays(priorOverlapDate, -ESPI_OVERLAP_DAYS) : repairBoundary;
      const stopBeforeDate = rollingBoundary < repairBoundary ? repairBoundary : rollingBoundary;
      const candidates: PapEspiListCandidate[] = [];
      const pageSignatures = new Set<string>();
      const seenIds = new Set<string>();

      for (let offset = 0; offset < 4_000; offset += 50) {
        const response = await fetchGpwList({ offset });
        if (response.status !== "SUCCESS") {
          errors += 1;
          status = response.status;
          break;
        }
        pagesRead += 1;
        const signature = createHash("sha256").update(response.document).digest("hex");
        if (pageSignatures.has(signature)) {
          errors += 1;
          status = "TEMPORARILY_UNAVAILABLE";
          diagnose({ provider: GPW_WZA_SOURCE, phase: "pagination", status: "REPEATED_PAGE", offset });
          break;
        }
        pageSignatures.add(signature);

        const parsedPage = parseGpwEspiList(response.document);
        if (parsedPage.malformedRows > 0) errors += parsedPage.malformedRows;
        const pageCandidates = parsedPage.candidates;
        for (const candidate of pageCandidates) {
          if (!seenIds.has(candidate.sourceId)) {
            seenIds.add(candidate.sourceId);
            if (isPotentialGpwGeneralMeetingCandidate(candidate)) candidates.push(candidate);
          }
        }

        if (parsedPage.eligibleRows === 0) {
          overlapComplete = true;
          break;
        }
        const oldest = pageCandidates
          .map((candidate) => candidate.sourcePublishedAt?.slice(0, 10))
          .filter((value): value is string => Boolean(value))
          .sort()[0];
        if (parsedPage.eligibleRows < 50 || (oldest && oldest < stopBeforeDate)) {
          overlapComplete = true;
          break;
        }
      }

      const uniqueCandidates = Array.from(new Map(candidates.map((candidate) => [candidate.sourceId, candidate])).values());
      const storedState = await getStoredSourceState(uniqueCandidates);
      const detailRefreshBoundary = addDays(today, -90);
      const pending = uniqueCandidates.filter((candidate) => {
        if (!storedState.storedIds.has(candidate.sourceId)) return true;
        if (!storedState.sourceCheckedAt.has(candidate.sourceId)) return false;
        const publishedDay = candidate.sourcePublishedAt?.slice(0, 10);
        return Boolean(publishedDay && publishedDay >= detailRefreshBoundary &&
          !isFresh(storedState.sourceCheckedAt.get(candidate.sourceId) ?? null, 24 * 60 * 60 * 1_000));
      });

      const fetched = await mapWithConcurrency(pending, ARTICLE_CONCURRENCY, async (candidate) => {
        const response = await fetchOfficialHtml(candidate.sourceUrl);
        if (response.status !== "SUCCESS") return { candidate, status: response.status, report: null };
        const report = parseGpwEspiReport(response.document, candidate);
        if (!report) return { candidate, status: "PARSE_ERROR" as const, report: null };
        const events = parseCorporateEventDocument(`${report.sourceTitle}\n${report.title}\n${report.body}`)
          .filter((event) => event.eventType === "GENERAL_MEETING");
        return { candidate, status: "SUCCESS" as const, report: events.length ? report : null };
      });

      let parsed = 0;
      let saved = 0;
      let duplicates = 0;
      for (const item of fetched) {
        if (item.status !== "SUCCESS") {
          errors += 1;
          if (item.status !== "PARSE_ERROR") status = item.status;
          else if (status === "SUCCESS") status = "PARSE_ERROR";
          diagnose({ provider: GPW_WZA_SOURCE, sourceId: item.candidate.sourceId, status: item.status });
          continue;
        }
        if (!item.report) continue;
        parsed += 1;
        try {
          const stored = await upsertEspiReport(item.report);
          await linkCorrection(stored.id, item.report, stored.issuerId);
          saved += 1;
          if (!stored.created) duplicates += 1;
        } catch (error) {
          errors += 1;
          status = "TEMPORARILY_UNAVAILABLE";
          diagnose({
            provider: GPW_WZA_SOURCE,
            phase: "store",
            sourceId: item.candidate.sourceId,
            error: error instanceof Error ? error.name : "unknown",
          });
        }
      }

      if (errors > 0 && status === "SUCCESS") status = "PARSE_ERROR";
      if (overlapComplete && errors === 0) lastOverlapAt = new Date().toISOString();
      await releaseSyncLock({
        token,
        source: GPW_WZA_SOURCE,
        status,
        errorCode: errors ? `WZA_SYNC_ERRORS_${errors}` : undefined,
        lastOverlapAt,
      });
      console.info(`[WZA SOURCE SYNC] pages=${pagesRead} candidates=${uniqueCandidates.length} fetched=${pending.length} parsed=${parsed} saved=${saved} duplicates=${duplicates} errors=${errors} durationMs=${Date.now() - startedAt}`);
      return {
        status,
        pagesRead,
        candidates: uniqueCandidates.length,
        fetched: pending.length,
        parsed,
        saved,
        duplicates,
        errors,
        locked: false,
      };
    } catch (error) {
      await releaseSyncLock({
        token,
        source: GPW_WZA_SOURCE,
        status: "TEMPORARILY_UNAVAILABLE",
        errorCode: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN",
      });
      diagnose({ provider: GPW_WZA_SOURCE, error: error instanceof Error ? error.name : "unknown" });
      return {
        status: "TEMPORARILY_UNAVAILABLE",
        pagesRead,
        candidates: 0,
        fetched: 0,
        parsed: 0,
        saved: 0,
        duplicates: 0,
        errors: Math.max(errors, 1),
        locked: false,
      };
    }
  })().finally(() => {
    gpwGeneralMeetingSyncInFlight = null;
  });

  return gpwGeneralMeetingSyncInFlight;
};

/** Only official schedule/correction notices, never inferred publication dates. */
export const isPotentialGpwReportScheduleCandidate = (candidate: PapEspiListCandidate) => {
  const title = `${candidate.sourceTitle} ${candidate.title ?? ""}`
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[łŁ]/g, (character) => character === "Ł" ? "L" : "l")
    .toLocaleLowerCase("pl-PL");
  return /(?:termin\w*|harmonogram\w*|kalendarz\w*|dat\w*|zmian\w*)[\s\S]{0,100}raport\w*\s+(?:okresow\w*|finansow\w*|roczn\w*|polroczn\w*|kwartaln\w*)|raport\w*\s+(?:okresow\w*|finansow\w*)[\s\S]{0,100}(?:termin\w*|harmonogram\w*|kalendarz\w*|publikacj\w*)/iu.test(title);
};

let gpwReportScheduleSyncInFlight: Promise<GpwGeneralMeetingSourceSyncResult> | null = null;

export const getGpwReportScheduleSyncState = () =>
  getEspiSyncState(GPW_REPORT_SCHEDULE_SOURCE, GPW_REPORT_SCHEDULE_REFRESH_TTL_MS);

/** A bounded, shared GPW source lane. A persisted date cursor repairs old schedules gradually. */
export const synchronizeGpwReportScheduleReports = ({ force = false }: { force?: boolean } = {}): Promise<GpwGeneralMeetingSourceSyncResult> => {
  if (gpwReportScheduleSyncInFlight) return gpwReportScheduleSyncInFlight;
  gpwReportScheduleSyncInFlight = (async () => {
    const state = await getGpwReportScheduleSyncState();
    const empty = { status: state.status === "NOT_SYNCED" ? "NOT_FOUND" as const : state.status,
      pagesRead: 0, candidates: 0, fetched: 0, parsed: 0, saved: 0, duplicates: 0, errors: 0, locked: false };
    if (!force && !state.isStale) return empty;
    const token = await acquireSyncLock(GPW_REPORT_SCHEDULE_SOURCE);
    if (!token) return { ...empty, locked: true };

    const startedAt = Date.now();
    let status: EspiSourceStatus = "SUCCESS";
    let pagesRead = 0;
    let errors = 0;
    let nextBackfillDay = Math.max(3, state.nextBackfillPage);
    let backfillComplete = state.backfillComplete;
    try {
      const today = getWarsawDate();
      const candidates = new Map<string, PapEspiListCandidate>();
      const collectDate = async (day: string) => {
        const signatures = new Set<string>();
        for (let offset = 0; offset < 2_000; offset += 50) {
          const response = await fetchGpwList({ date: toGpwDate(day), offset });
          if (response.status !== "SUCCESS") {
            status = response.status;
            errors += 1;
            diagnose({ provider: GPW_REPORT_SCHEDULE_SOURCE, date: day, offset, status });
            return false;
          }
          pagesRead += 1;
          const signature = createHash("sha256").update(response.document).digest("hex");
          if (signatures.has(signature)) {
            status = "PARSE_ERROR";
            errors += 1;
            diagnose({ provider: GPW_REPORT_SCHEDULE_SOURCE, date: day, offset, status: "REPEATED_PAGE" });
            return false;
          }
          signatures.add(signature);
          const page = parseGpwEspiList(response.document);
          if (page.malformedRows) errors += page.malformedRows;
          for (const candidate of page.candidates) {
            if (isPotentialGpwReportScheduleCandidate(candidate)) candidates.set(candidate.sourceId, candidate);
          }
          if (page.eligibleRows < 50) return true;
        }
        status = "PARSE_ERROR";
        errors += 1;
        diagnose({ provider: GPW_REPORT_SCHEDULE_SOURCE, date: day, status: "ROW_LIMIT" });
        return false;
      };

      // The newest three days are always overlapped, including weekends.
      for (let day = 0; day < 3; day += 1) await collectDate(addDays(today, -day));
      // Only advance the repair cursor after a complete date, so failures retry.
      for (let count = 0; count < 21; count += 1) {
        if (nextBackfillDay >= ESPI_OFFICIAL_REPAIR_DAYS) {
          backfillComplete = true;
          nextBackfillDay = 3;
        }
        if (!await collectDate(addDays(today, -nextBackfillDay))) break;
        nextBackfillDay += 1;
      }

      const uniqueCandidates = [...candidates.values()];
      const stored = await getStoredSourceState(uniqueCandidates);
      const pending = uniqueCandidates.filter((candidate) => !stored.storedIds.has(candidate.sourceId) ||
        Boolean(candidate.sourcePublishedAt && candidate.sourcePublishedAt.slice(0, 10) >= addDays(today, -30) &&
          stored.sourceCheckedAt.has(candidate.sourceId) &&
          !isFresh(stored.sourceCheckedAt.get(candidate.sourceId) ?? null, 24 * 60 * 60 * 1_000)));
      const fetched = await mapWithConcurrency(pending, ARTICLE_CONCURRENCY, async (candidate) => {
        const response = await fetchOfficialHtml(candidate.sourceUrl);
        if (response.status !== "SUCCESS") return { candidate, status: response.status, report: null };
        const report = parseGpwEspiReport(response.document, candidate);
        return { candidate, status: report ? "SUCCESS" as const : "PARSE_ERROR" as const, report };
      });
      let parsed = 0;
      let saved = 0;
      let duplicates = 0;
      for (const item of fetched) {
        if (item.status !== "SUCCESS" || !item.report) {
          errors += 1;
          status = item.status;
          diagnose({ provider: GPW_REPORT_SCHEDULE_SOURCE, sourceId: item.candidate.sourceId, status: item.status });
          continue;
        }
        parsed += 1;
        try {
          const result = await upsertEspiReport(item.report);
          await linkCorrection(result.id, item.report, result.issuerId);
          saved += 1;
          if (!result.created) duplicates += 1;
        } catch (error) {
          errors += 1;
          status = "TEMPORARILY_UNAVAILABLE";
          diagnose({ provider: GPW_REPORT_SCHEDULE_SOURCE, sourceId: item.candidate.sourceId,
            phase: "store", error: error instanceof Error ? error.name : "unknown" });
        }
      }
      if (errors && status === "SUCCESS") status = "PARSE_ERROR";
      await releaseSyncLock({ token, source: GPW_REPORT_SCHEDULE_SOURCE, status,
        nextBackfillPage: nextBackfillDay, backfillComplete });
      console.info(`[REPORT SCHEDULE SOURCE SYNC] pages=${pagesRead} candidates=${uniqueCandidates.length} fetched=${pending.length} parsed=${parsed} saved=${saved} duplicates=${duplicates} errors=${errors} backfillDay=${nextBackfillDay}/${ESPI_OFFICIAL_REPAIR_DAYS} durationMs=${Date.now() - startedAt}`);
      return { status, pagesRead, candidates: uniqueCandidates.length, fetched: pending.length,
        parsed, saved, duplicates, errors, locked: false };
    } catch (error) {
      await releaseSyncLock({ token, source: GPW_REPORT_SCHEDULE_SOURCE,
        status: "TEMPORARILY_UNAVAILABLE", errorCode: error instanceof Error ? error.name : "UNKNOWN" });
      diagnose({ provider: GPW_REPORT_SCHEDULE_SOURCE, error: error instanceof Error ? error.name : "unknown" });
      return { ...empty, status: "TEMPORARILY_UNAVAILABLE" as const, pagesRead, errors: Math.max(errors, 1) };
    }
  })().finally(() => { gpwReportScheduleSyncInFlight = null; });
  return gpwReportScheduleSyncInFlight;
};

const isPotentialGpwDividendCandidate = (candidate: PapEspiListCandidate) => {
  const text = `${candidate.sourceTitle} ${candidate.title ?? ""}`
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[łŁ]/g, (character) => character === "Ł" ? "L" : "l")
    .toLocaleLowerCase("pl-PL");

  return /dywidend|zaliczk\w*\s+(?:na\s+poczet\s+)?(?:przewidywanej\s+)?dywidend|podzial\w*\s+(?:zysku|wyniku\s+finansowego)|zysk\w*\s+za\s+rok|przeznaczen\w*\s+(?:zysku|wyniku\s+finansowego)|uchwal\w*\s+(?:podjet\w*\s+)?na\s+(?:zwyczajnym\s+)?walnym\s+zgromadzeniu|tresc\s+uchwal\w*\s+podjet/iu.test(text);
};

export type GpwDividendSourceSyncResult = GpwGeneralMeetingSourceSyncResult;

let gpwDividendSyncInFlight: Promise<GpwDividendSourceSyncResult> | null = null;

export const getGpwDividendSyncState = () =>
  getEspiSyncState(GPW_DIVIDEND_SOURCE, GPW_DIVIDEND_REFRESH_TTL_MS);

/**
 * Focused, shared dividend lane backed by the official GPW ESPI publication
 * stream. It walks the rolling repair horizon, but downloads report details
 * only for plausible dividend/profit-allocation notices. Market data is saved
 * once globally and later filtered for a user; it is never synchronized per
 * portfolio.
 */
export const synchronizeGpwDividendReports = ({ force = false }: { force?: boolean } = {}): Promise<GpwDividendSourceSyncResult> => {
  if (gpwDividendSyncInFlight) return gpwDividendSyncInFlight;

  gpwDividendSyncInFlight = (async (): Promise<GpwDividendSourceSyncResult> => {
    const state = await getGpwDividendSyncState();
    if (!force && !state.isStale) {
      return {
        status: state.status === "NOT_SYNCED" ? "NOT_FOUND" : state.status,
        pagesRead: 0,
        candidates: 0,
        fetched: 0,
        parsed: 0,
        saved: 0,
        duplicates: 0,
        errors: 0,
        locked: false,
      };
    }

    const token = await acquireSyncLock(GPW_DIVIDEND_SOURCE);
    if (!token) {
      return {
        status: state.status === "NOT_SYNCED" ? "NOT_FOUND" : state.status,
        pagesRead: 0,
        candidates: 0,
        fetched: 0,
        parsed: 0,
        saved: 0,
        duplicates: 0,
        errors: 0,
        locked: true,
      };
    }

    let status: EspiSourceStatus = "SUCCESS";
    let pagesRead = 0;
    let errors = 0;
    let overlapComplete = false;
    let lastOverlapAt: string | undefined;
    let nextBackfillDay = Math.max(GPW_DIVIDEND_RECENT_DAYS, state.nextBackfillPage);
    let backfillComplete = state.backfillComplete;
    const startedAt = Date.now();

    try {
      const today = getWarsawDate();
      const candidates: PapEspiListCandidate[] = [];
      const seenIds = new Set<string>();

      const collectDate = async (isoDate: string) => {
        const pageSignatures = new Set<string>();
        for (let offset = 0; offset < GPW_DIVIDEND_MAX_ROWS_PER_DAY; offset += 50) {
          const response = await fetchGpwList({ offset, date: toGpwDate(isoDate) });
          if (response.status !== "SUCCESS") {
            errors += 1;
            status = response.status;
            diagnose({ provider: GPW_DIVIDEND_SOURCE, phase: "dated-page", date: isoDate, offset, status: response.status });
            return false;
          }
          pagesRead += 1;
          const signature = createHash("sha256").update(response.document).digest("hex");
          if (pageSignatures.has(signature)) {
            errors += 1;
            status = "TEMPORARILY_UNAVAILABLE";
            diagnose({ provider: GPW_DIVIDEND_SOURCE, phase: "dated-pagination", date: isoDate, status: "REPEATED_PAGE", offset });
            return false;
          }
          pageSignatures.add(signature);

          const parsedPage = parseGpwEspiList(response.document);
          if (parsedPage.malformedRows > 0) errors += parsedPage.malformedRows;
          for (const candidate of parsedPage.candidates) {
            if (seenIds.has(candidate.sourceId)) continue;
            seenIds.add(candidate.sourceId);
            if (isPotentialGpwDividendCandidate(candidate)) candidates.push(candidate);
          }
          if (parsedPage.eligibleRows < 50) return true;
        }
        errors += 1;
        status = "PARSE_ERROR";
        diagnose({ provider: GPW_DIVIDEND_SOURCE, phase: "dated-pagination", date: isoDate, status: "ROW_LIMIT" });
        return false;
      };

      // Always repair the newest publications so a report cannot fall into a
      // gap between hourly runs. The exact-date endpoint makes the overlap
      // bounded and deterministic instead of repeatedly walking page zero.
      overlapComplete = true;
      for (let day = 0; day < GPW_DIVIDEND_RECENT_DAYS; day += 1) {
        if (!await collectDate(addDays(today, -day))) overlapComplete = false;
      }

      // The same persisted cursor performs a rotating 12-month repair pass.
      // Once a complete pass has been reached it wraps and continues to audit
      // older dates without downloading the whole archive on every request.
      for (let index = 0; index < GPW_DIVIDEND_BACKFILL_DAYS_PER_SYNC; index += 1) {
        if (nextBackfillDay >= ESPI_OFFICIAL_REPAIR_DAYS) {
          backfillComplete = true;
          nextBackfillDay = GPW_DIVIDEND_RECENT_DAYS;
        }
        const day = nextBackfillDay;
        const completed = await collectDate(addDays(today, -day));
        if (!completed) break;
        nextBackfillDay = day + 1;
      }
      if (nextBackfillDay >= ESPI_OFFICIAL_REPAIR_DAYS) {
        backfillComplete = true;
        nextBackfillDay = GPW_DIVIDEND_RECENT_DAYS;
      }

      const uniqueCandidates = Array.from(new Map(candidates.map((candidate) => [candidate.sourceId, candidate])).values());
      const storedState = await getStoredSourceState(uniqueCandidates);
      const detailRefreshBoundary = addDays(today, -90);
      const pending = uniqueCandidates.filter((candidate) => {
        if (!storedState.storedIds.has(candidate.sourceId)) return true;
        if (!storedState.sourceCheckedAt.has(candidate.sourceId)) return false;
        const publishedDay = candidate.sourcePublishedAt?.slice(0, 10);
        return Boolean(publishedDay && publishedDay >= detailRefreshBoundary &&
          !isFresh(storedState.sourceCheckedAt.get(candidate.sourceId) ?? null, 24 * 60 * 60 * 1_000));
      });

      const fetched = await mapWithConcurrency(pending, ARTICLE_CONCURRENCY, async (candidate) => {
        const response = await fetchOfficialHtml(candidate.sourceUrl);
        if (response.status !== "SUCCESS") return { candidate, status: response.status, report: null };
        const report = parseGpwEspiReport(response.document, candidate);
        if (!report) return { candidate, status: "PARSE_ERROR" as const, report: null };
        // Preserve every plausible official report. Parser improvements can
        // then safely re-project old NO_EVENT rows without re-fetching the
        // source or losing evidence that was not understood at ingestion time.
        return { candidate, status: "SUCCESS" as const, report };
      });

      let parsed = 0;
      let saved = 0;
      let duplicates = 0;
      for (const item of fetched) {
        if (item.status !== "SUCCESS") {
          errors += 1;
          if (item.status !== "PARSE_ERROR") status = item.status;
          else if (status === "SUCCESS") status = "PARSE_ERROR";
          diagnose({ provider: GPW_DIVIDEND_SOURCE, sourceId: item.candidate.sourceId, status: item.status });
          continue;
        }
        if (!item.report) continue;
        parsed += 1;
        try {
          const stored = await upsertEspiReport(item.report);
          await linkCorrection(stored.id, item.report, stored.issuerId);
          saved += 1;
          if (!stored.created) duplicates += 1;
        } catch (error) {
          errors += 1;
          status = "TEMPORARILY_UNAVAILABLE";
          diagnose({
            provider: GPW_DIVIDEND_SOURCE,
            phase: "store",
            sourceId: item.candidate.sourceId,
            error: error instanceof Error ? error.name : "unknown",
          });
        }
      }

      if (errors > 0 && status === "SUCCESS") status = "PARSE_ERROR";
      if (overlapComplete && errors === 0) lastOverlapAt = new Date().toISOString();
      await releaseSyncLock({
        token,
        source: GPW_DIVIDEND_SOURCE,
        status,
        errorCode: errors ? `DIVIDEND_SYNC_ERRORS_${errors}` : undefined,
        nextBackfillPage: nextBackfillDay,
        backfillComplete,
        lastOverlapAt,
      });
      console.info(`[DIVIDEND SOURCE SYNC] pages=${pagesRead} candidates=${uniqueCandidates.length} fetched=${pending.length} parsed=${parsed} saved=${saved} duplicates=${duplicates} errors=${errors} recentComplete=${overlapComplete} backfillDay=${nextBackfillDay}/${ESPI_OFFICIAL_REPAIR_DAYS} backfillComplete=${backfillComplete} durationMs=${Date.now() - startedAt}`);
      return {
        status,
        pagesRead,
        candidates: uniqueCandidates.length,
        fetched: pending.length,
        parsed,
        saved,
        duplicates,
        errors,
        locked: false,
      };
    } catch (error) {
      await releaseSyncLock({
        token,
        source: GPW_DIVIDEND_SOURCE,
        status: "TEMPORARILY_UNAVAILABLE",
        errorCode: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN",
      });
      diagnose({ provider: GPW_DIVIDEND_SOURCE, error: error instanceof Error ? error.name : "unknown" });
      return {
        status: "TEMPORARILY_UNAVAILABLE",
        pagesRead,
        candidates: 0,
        fetched: 0,
        parsed: 0,
        saved: 0,
        duplicates: 0,
        errors: Math.max(errors, 1),
        locked: false,
      };
    }
  })().finally(() => {
    gpwDividendSyncInFlight = null;
  });

  return gpwDividendSyncInFlight;
};

export const getPortfolioTrackedInputs = (portfolios: InvestmentPortfolio[]) =>
  portfolios.flatMap((portfolio) => {
    const normalized = ensurePortfolioCoreModel(portfolio);
    const instruments = new Map((normalized.instruments ?? []).map((instrument) => [instrument.id, instrument]));
    return normalized.assets.flatMap((asset) => {
      if (asset.quantity <= 1e-8 || asset.kind !== "stock" || asset.marketCurrency !== "PLN" || !isGpwSymbol(asset.symbol)) return [];
      const instrumentId = getPortfolioInstrumentId(normalized.id, asset);
      const instrument = instruments.get(instrumentId);
      return [{
        canonicalKey: `gpw:ticker:${getGpwTickerCore(asset.symbol)}`,
        ticker: getGpwTickerCore(asset.symbol),
        name: instrument?.name ?? asset.name,
        isin: instrument?.isin,
        mexoInstrumentId: instrumentId,
      }];
    });
  });

export const buildTrackedGpwInstruments = (
  portfolios: InvestmentPortfolio[],
  watchlist: Array<Pick<WatchlistItem, "id" | "symbol" | "name" | "isin" | "coreInstrumentId">>
) => {
  const tracked = new Map<string, TrackedGpwInstrument>();
  for (const input of getPortfolioTrackedInputs(portfolios)) {
    const current = tracked.get(input.canonicalKey);
    tracked.set(input.canonicalKey, {
      ...current,
      ...input,
      isin: input.isin ?? current?.isin,
      mexoInstrumentId: input.mexoInstrumentId ?? current?.mexoInstrumentId,
      held: true,
      watched: current?.watched ?? false,
    });
  }
  for (const item of watchlist) {
    const ticker = getGpwTickerCore(item.symbol);
    const key = `gpw:ticker:${ticker}`;
    const current = tracked.get(key);
    tracked.set(key, {
      canonicalKey: key,
      ticker,
      name: current?.name ?? item.name,
      isin: current?.isin ?? item.isin,
      mexoInstrumentId: current?.mexoInstrumentId ?? item.coreInstrumentId,
      held: current?.held ?? false,
      watched: true,
    });
  }
  return Array.from(tracked.values());
};

export const getUserTrackedGpwInstruments = async (userId: string): Promise<TrackedGpwInstrument[]> => {
  const [stored, watchlist] = await Promise.all([
    queryOne<StoredPortfolioRow>("SELECT portfolio_json FROM users WHERE id = $1", [userId]),
    getUserWatchlist(userId),
  ]);
  let portfolios: InvestmentPortfolio[] = [];
  try {
    portfolios = stored?.portfolio_json
      ? normalizePortfolioBook(JSON.parse(stored.portfolio_json)).portfolios
      : [];
  } catch {
    portfolios = [];
  }

  return buildTrackedGpwInstruments(portfolios, watchlist);
};

/**
 * Resolve tracking for a market without guessing from a ticker suffix. GPW
 * keeps the legacy, catalog-backed resolver above. NewConnect is matched only
 * against the issuer mappings already persisted from the official source and
 * exact ISIN/ticker metadata present in the user's portfolio/watchlist.
 */
export const getUserTrackedEspiInstruments = async (
  userId: string,
  market: Exclude<EspiMarket, "UNKNOWN">
): Promise<TrackedEspiInstrument[]> => {
  if (market === "GPW") return getUserTrackedGpwInstruments(userId);
  const [stored, watchlist] = await Promise.all([
    queryOne<StoredPortfolioRow>("SELECT portfolio_json FROM users WHERE id = $1", [userId]),
    getUserWatchlist(userId),
  ]);
  const heldRefs: Array<{ isin?: string; ticker?: string; instrumentId?: string; name?: string }> = [];
  try {
    const portfolios = stored?.portfolio_json
      ? normalizePortfolioBook(JSON.parse(stored.portfolio_json)).portfolios
      : [];
    for (const portfolio of portfolios) {
      const normalized = ensurePortfolioCoreModel(portfolio);
      const instruments = new Map((normalized.instruments ?? []).map((instrument) => [instrument.id, instrument]));
      for (const asset of normalized.assets) {
        if (asset.kind !== "stock" || asset.quantity <= 1e-8) continue;
        const instrumentId = getPortfolioInstrumentId(normalized.id, asset);
        const instrument = instruments.get(instrumentId);
        const isin = instrument?.isin?.trim().toUpperCase();
        const ticker = instrument?.symbol?.trim().toUpperCase() || asset.symbol?.trim().toUpperCase();
        if (isin || ticker) heldRefs.push({ isin, ticker, instrumentId, name: instrument?.name ?? asset.name });
      }
    }
  } catch {
    // A malformed legacy portfolio must not make the public-market feed fail.
  }
  const watchedRefs = watchlist.map((item) => ({
    isin: item.isin?.trim().toUpperCase(),
    ticker: item.symbol?.trim().toUpperCase(),
    instrumentId: item.coreInstrumentId,
    name: item.name,
  }));
  const refs = [...heldRefs, ...watchedRefs];
  if (refs.length === 0) return [];
  const isins = Array.from(new Set(refs.flatMap((ref) => ref.isin ? [ref.isin] : [])));
  const tickers = Array.from(new Set(refs.flatMap((ref) => ref.ticker ? [ref.ticker] : [])));
  if (isins.length === 0 && tickers.length === 0) return [];
  const rows = await query<{
    canonical_key: string;
    ticker: string;
    company_name: string;
    isin: string | null;
  }>(
    `
      SELECT canonical_key, ticker, company_name, isin
      FROM corporate_event_instruments
      WHERE market = $1
        AND (($2::text[] <> '{}'::text[] AND UPPER(COALESCE(isin, '')) = ANY($2::text[]))
          OR ($3::text[] <> '{}'::text[] AND UPPER(COALESCE(ticker, '')) = ANY($3::text[])))
    `,
    [market, isins, tickers]
  );
  return rows.map((row) => {
    const matchingHeld = heldRefs.find((ref) =>
      (row.isin && ref.isin === row.isin.toUpperCase()) || row.ticker.toUpperCase() === ref.ticker
    );
    const matchingWatched = watchedRefs.find((ref) =>
      (row.isin && ref.isin === row.isin.toUpperCase()) || row.ticker.toUpperCase() === ref.ticker
    );
    return {
      canonicalKey: row.canonical_key,
      ticker: row.ticker.toUpperCase(),
      name: row.company_name,
      isin: row.isin ?? undefined,
      mexoInstrumentId: matchingHeld?.instrumentId ?? matchingWatched?.instrumentId,
      held: Boolean(matchingHeld),
      watched: Boolean(matchingWatched),
    };
  });
};

const getTrackingSource = (tracked: TrackedGpwInstrument): EspiTrackingSource =>
  tracked.held && tracked.watched
    ? "PORTFOLIO_AND_WATCHLIST"
    : tracked.held
      ? "PORTFOLIO"
      : "WATCHLIST";

const findTracking = (row: Pick<EspiReportRow, "issuer_canonical_key" | "source_isin" | "source_ticker">, tracked: TrackedEspiInstrument[]) => {
  const sourceTicker = isReliableTicker(row.source_ticker) ? row.source_ticker!.toUpperCase() : null;
  return tracked.find((item) =>
    (row.issuer_canonical_key && item.canonicalKey === row.issuer_canonical_key) ||
    (row.source_isin && item.isin?.toUpperCase() === row.source_isin.toUpperCase()) ||
    (sourceTicker && item.ticker === sourceTicker)
  );
};

const encodeCursor = (row: Pick<EspiReportRow, "published_at" | "id">) =>
  Buffer.from(JSON.stringify({ publishedAt: normalizeIso(row.published_at), id: row.id }), "utf8").toString("base64url");

const decodeCursor = (value: string | undefined) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { publishedAt?: unknown; id?: unknown };
    return typeof parsed.publishedAt === "string" && typeof parsed.id === "string" && Number.isFinite(Date.parse(parsed.publishedAt))
      ? { publishedAt: parsed.publishedAt, id: parsed.id }
      : null;
  } catch {
    return null;
  }
};

const toExcerpt = (body: string, title: string) => {
  const value = (body || title).replace(/\s+/g, " ").trim();
  return value.length > 260 ? `${value.slice(0, 257).trimEnd()}…` : value;
};

const mapSummary = (row: EspiReportRow, tracked: TrackedEspiInstrument[]): EspiReportSummary => {
  const tracking = findTracking(row, tracked);
  return {
    id: row.id,
    issuerName: row.issuer_name,
    ticker: row.issuer_ticker ?? (isReliableTicker(row.source_ticker) ? row.source_ticker! : undefined),
    market: row.market,
    mexoInstrumentId: tracking?.mexoInstrumentId,
    reportNumber: row.report_number ?? undefined,
    reportType: row.report_type,
    publishedAt: normalizeIso(row.published_at),
    title: row.title,
    excerpt: toExcerpt(row.body_text, row.title),
    category: row.category,
    source: PAP_SOURCE,
    sourceUrl: row.source_url,
    attachmentsCount: Number(row.attachments_count),
    isCorrection: row.is_correction,
    correctionTargetReportNumber: row.correction_target_report_number ?? undefined,
    correctionOfReportId: row.correction_of_report_id ?? undefined,
    trackingSource: tracking ? getTrackingSource(tracking) : undefined,
  };
};

const nextDay = (date: string) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};

const toWarsawDayBoundary = (date: string) => {
  const [year, month, day] = date.split("-");
  return year && month && day ? toWarsawIso(`${day}.${month}.${year}, 00:00`) : undefined;
};

export const getEspiFeed = async ({
  userId,
  filters,
}: {
  userId: string;
  filters: EspiFeedFilters;
}): Promise<EspiFeedResponse> => {
  const tracked = await getUserTrackedEspiInstruments(userId, filters.market);
  const scopedTracked = filters.scope === "watchlist"
    ? tracked.filter((item) => item.watched)
    : filters.scope === "portfolio"
      ? tracked.filter((item) => item.held)
      : filters.scope === "mine"
        ? tracked.filter((item) => item.held || item.watched)
        : tracked;
  if (filters.scope !== "all" && scopedTracked.length === 0) {
    return { items: [], hasMore: false, sync: await getEspiSyncState() };
  }

  const clauses = [
    "report.source = 'PAP_ESPI'",
    `NOT EXISTS (
      SELECT 1
      FROM espi_reports preferred
      WHERE preferred.id <> report.id
        AND preferred.source = report.source
        AND (
          preferred.issuer_id = report.issuer_id
          OR (
            report.issuer_id IS NULL
            AND preferred.issuer_id IS NULL
            AND report.source_isin IS NOT NULL
            AND UPPER(preferred.source_isin) = UPPER(report.source_isin)
          )
        )
        AND preferred.report_type = report.report_type
        AND preferred.is_correction = report.is_correction
        AND (
          (
            report.report_number IS NOT NULL
            AND preferred.report_number = report.report_number
          )
          OR (
            report.report_number IS NULL
            AND preferred.report_number IS NULL
            AND LEFT(preferred.published_at, 16) = LEFT(report.published_at, 16)
            AND LOWER(preferred.title) = LOWER(report.title)
          )
        )
        AND (
          CASE
            WHEN preferred.source_id LIKE 'gpw:%' THEN 0
            WHEN preferred.source_id LIKE 'newconnect:%' THEN 1
            ELSE 2
          END
          <
          CASE
            WHEN report.source_id LIKE 'gpw:%' THEN 0
            WHEN report.source_id LIKE 'newconnect:%' THEN 1
            ELSE 2
          END
          OR (
            CASE
              WHEN preferred.source_id LIKE 'gpw:%' THEN 0
              WHEN preferred.source_id LIKE 'newconnect:%' THEN 1
              ELSE 2
            END
            =
            CASE
              WHEN report.source_id LIKE 'gpw:%' THEN 0
              WHEN report.source_id LIKE 'newconnect:%' THEN 1
              ELSE 2
            END
            AND preferred.id < report.id
          )
        )
    )`,
  ];
  const parameters: Array<string | number | string[]> = [];
  const add = (value: string | number | string[]) => {
    parameters.push(value);
    return `$${parameters.length}`;
  };

  clauses.push(`report.market = ${add(filters.market)}`);
  if (filters.scope !== "all") {
    const keys = scopedTracked.map((item) => item.canonicalKey);
    const isins = scopedTracked.flatMap((item) => item.isin ? [item.isin.toUpperCase()] : []);
    const tickers = scopedTracked.map((item) => item.ticker.toUpperCase());
    const keysParam = add(keys);
    const isinsParam = add(isins);
    const tickersParam = add(tickers);
    clauses.push(`(
      issuer.canonical_key = ANY(${keysParam}::text[])
      OR UPPER(COALESCE(report.source_isin, '')) = ANY(${isinsParam}::text[])
      OR UPPER(COALESCE(report.source_ticker, '')) = ANY(${tickersParam}::text[])
    )`);
  }
  const generalQuery = filters.query?.trim().slice(0, 120);
  if (generalQuery) {
    const like = add(`%${generalQuery}%`);
    const fts = add(generalQuery);
    clauses.push(`(
      report.issuer_name ILIKE ${like}
      OR COALESCE(issuer.ticker, report.source_ticker, '') ILIKE ${like}
      OR COALESCE(report.report_number, '') ILIKE ${like}
      OR to_tsvector(
        'simple'::regconfig,
        COALESCE(report.issuer_name, '') || ' ' || COALESCE(report.source_ticker, '') || ' ' ||
        COALESCE(report.report_number, '') || ' ' || COALESCE(report.title, '') || ' ' || COALESCE(report.body_text, '')
      ) @@ websearch_to_tsquery('simple'::regconfig, ${fts})
    )`);
  }
  if (filters.company?.trim()) clauses.push(`report.issuer_name ILIKE ${add(`%${filters.company.trim().slice(0, 100)}%`)}`);
  if (filters.ticker?.trim()) {
    const ticker = filters.market === "GPW"
      ? getGpwTickerCore(filters.ticker).slice(0, 8)
      : filters.ticker.trim().toUpperCase().slice(0, 16);
    clauses.push(`UPPER(COALESCE(issuer.ticker, report.source_ticker, '')) = ${add(ticker)}`);
  }
  if (filters.category) clauses.push(`report.category = ${add(filters.category)}`);
  if (filters.reportType) clauses.push(`report.report_type = ${add(filters.reportType)}`);
  if (filters.dateFrom) {
    const boundary = toWarsawDayBoundary(filters.dateFrom);
    if (boundary) clauses.push(`report.published_at >= ${add(boundary)}`);
  }
  if (filters.dateTo) {
    const boundary = toWarsawDayBoundary(nextDay(filters.dateTo));
    if (boundary) clauses.push(`report.published_at < ${add(boundary)}`);
  }
  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    const published = add(cursor.publishedAt);
    const id = add(cursor.id);
    clauses.push(`(report.published_at < ${published} OR (report.published_at = ${published} AND report.id < ${id}))`);
  }
  const limit = Math.min(Math.max(filters.limit ?? ESPI_DEFAULT_LIMIT, 1), ESPI_MAX_LIMIT);
  const limitParam = add(limit + 1);
  const rows = await query<EspiReportRow>(
    `
      SELECT report.id, report.issuer_name, issuer.ticker AS issuer_ticker,
             issuer.canonical_key AS issuer_canonical_key,
             report.market, report.source_ticker, report.source_isin, report.report_number,
             report.report_type, report.published_at, report.title, report.body_text,
             report.legal_basis, report.category, report.source_id, report.source_url,
             report.is_correction, report.correction_target_report_number, report.correction_of_report_id,
             (SELECT COUNT(*) FROM espi_report_attachments attachment WHERE attachment.espi_report_id = report.id) AS attachments_count
      FROM espi_reports report
      LEFT JOIN corporate_event_instruments issuer ON issuer.id = report.issuer_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY report.published_at DESC, report.id DESC
      LIMIT ${limitParam}
    `,
    parameters
  );
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit);
  return {
    items: selected.map((row) => mapSummary(row, scopedTracked)),
    hasMore,
    nextCursor: hasMore && selected.length ? encodeCursor(selected.at(-1)!) : undefined,
    sync: await getEspiSyncState(),
  };
};

export const getEspiReport = async ({ userId, reportId }: { userId: string; reportId: string }): Promise<EspiReport | null> => {
  const row = await queryOne<EspiReportRow>(
      `
        SELECT report.id, report.issuer_name, issuer.ticker AS issuer_ticker,
               issuer.canonical_key AS issuer_canonical_key,
               report.market, report.source_ticker, report.source_isin, report.report_number,
               report.report_type, report.published_at, report.title, report.body_text,
               report.legal_basis, report.category, report.source_id, report.source_url,
               report.is_correction, report.correction_target_report_number, report.correction_of_report_id,
               (SELECT COUNT(*) FROM espi_report_attachments attachment WHERE attachment.espi_report_id = report.id) AS attachments_count
        FROM espi_reports report
        LEFT JOIN corporate_event_instruments issuer ON issuer.id = report.issuer_id
        WHERE report.id = $1 AND report.source = 'PAP_ESPI'
      `,
      [reportId]
    );
  if (!row) return null;
  const tracked = await getUserTrackedEspiInstruments(
    userId,
    row.market === "NEWCONNECT" ? "NEWCONNECT" : "GPW"
  );
  const attachments = await query<{
    id: string;
    name: string;
    media_type: string | null;
    size_label: string | null;
    source_url: string;
  }>(
    `
      SELECT id, name, media_type, size_label, source_url
      FROM espi_report_attachments
      WHERE espi_report_id = $1
      ORDER BY name ASC
    `,
    [reportId]
  );
  return {
    ...mapSummary(row, tracked),
    body: row.body_text,
    legalBasis: row.legal_basis ?? undefined,
    sourceId: row.source_id,
    sourceIsin: row.source_isin ?? undefined,
    attachments: attachments.map((attachment): EspiAttachment => ({
      id: attachment.id,
      name: attachment.name,
      mediaType: attachment.media_type ?? undefined,
      sizeLabel: attachment.size_label ?? undefined,
      sourceUrl: attachment.source_url,
    })),
  };
};

export const validateEspiFeedFilters = (searchParams: URLSearchParams): EspiFeedFilters => {
  const category = searchParams.get("category");
  const reportType = searchParams.get("reportType");
  const datePattern = /^20\d{2}-\d{2}-\d{2}$/;
  const requestedLimit = Number(searchParams.get("limit") ?? ESPI_DEFAULT_LIMIT);
  const requestedMarket = searchParams.get("market");
  const market: Exclude<EspiMarket, "UNKNOWN"> = requestedMarket === "NEWCONNECT" ? "NEWCONNECT" : "GPW";
  const requestedScope = searchParams.get("scope");
  return {
    scope: requestedScope === "all" || requestedScope === "watchlist" || requestedScope === "portfolio"
      ? requestedScope
      : "mine",
    market,
    cursor: searchParams.get("cursor")?.trim() || undefined,
    limit: Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), ESPI_MAX_LIMIT)
      : ESPI_DEFAULT_LIMIT,
    query: searchParams.get("query")?.trim() || undefined,
    company: searchParams.get("company")?.trim() || undefined,
    ticker: searchParams.get("ticker")?.trim() || undefined,
    category: isEspiCategory(category) ? category : undefined,
    reportType: isEspiReportType(reportType) ? reportType : undefined,
    dateFrom: datePattern.test(searchParams.get("dateFrom") ?? "") ? searchParams.get("dateFrom")! : undefined,
    dateTo: datePattern.test(searchParams.get("dateTo") ?? "") ? searchParams.get("dateTo")! : undefined,
  };
};

export const getEspiCategoryLabel = (category: EspiCategory) => ESPI_CATEGORY_LABELS[category];

// Type-only guard proving the global issuer model can map to the current Mexo instrument shape.
export const isGpwPortfolioInstrument = (instrument: PortfolioInstrument) =>
  instrument.assetKind === "stock" && instrument.marketCurrency === "PLN" && isGpwSymbol(instrument.symbol);

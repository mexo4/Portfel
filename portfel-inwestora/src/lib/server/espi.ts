import { randomUUID } from "node:crypto";
import {
  ESPI_CATEGORY_LABELS,
  type EspiAttachment,
  type EspiCategory,
  type EspiFeedResponse,
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
  toWarsawIso,
  type PapEspiListCandidate,
  type ParsedPapEspiReport,
} from "@/lib/espi";
import { ensurePortfolioCoreModel, getPortfolioInstrumentId } from "@/lib/operation-engine";
import { normalizePortfolioBook } from "@/lib/portfolio-state";
import {
  findGpwCatalogEntry,
  findGpwCatalogEntryByExactName,
  findGpwCatalogEntryByIsin,
} from "@/lib/server/gpw-catalog";
import { execute, query, queryOne, withTransaction } from "@/lib/server/db";
import { fetchWithSystemTrust } from "@/lib/server/system-trust-fetch";
import { getUserWatchlist } from "@/lib/server/watchlist";
import { getGpwTickerCore, isGpwSymbol } from "@/lib/ticker";
import type { WatchlistItem } from "@/lib/watchlist";
import type { InvestmentPortfolio, PortfolioInstrument } from "@/types/portfolio";

const PAP_SOURCE = "PAP_ESPI" as const;
const PAP_FEED_URL = "https://pap-mediaroom.pl/zrodlo/ESPI";
const ESPI_REFRESH_TTL_MS = 10 * 60 * 1_000;
const ESPI_SOURCE_TIMEOUT_MS = 15_000;
const ESPI_LOCK_TTL_MS = 3 * 60 * 1_000;
const ESPI_DEFAULT_LIMIT = 20;
const ESPI_MAX_LIMIT = 50;
const INITIAL_BACKFILL_PAGES = 2;
// V1 keeps a useful recent window (roughly 120 PAP feed entries), rather than
// attempting a multi-year archive import on first use. New publications are
// always ingested from page zero.
const ESPI_BACKFILL_PAGE_LIMIT = 12;
const ARTICLE_CONCURRENCY = 4;

type EspiSyncStateRow = {
  status: EspiSourceStatus;
  last_checked_at: string | null;
  last_success_at: string | null;
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

export type EspiFeedFilters = {
  scope: "mine" | "all";
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

const fetchPapHtml = async (url: string) => {
  try {
    const response = await fetchWithSystemTrust(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mexo/1.0 (+https://mexo.com.pl; public ESPI feed)",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(ESPI_SOURCE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { status: classifyEspiHttpStatus(response.status), document: "" };
    }
    return { status: "SUCCESS" as const, document: await response.text() };
  } catch {
    return { status: "TEMPORARILY_UNAVAILABLE" as const, document: "" };
  }
};

const getFeedPageUrl = (page: number) => page > 0 ? `${PAP_FEED_URL}?page=${page}` : PAP_FEED_URL;

export const getEspiSyncState = async (): Promise<EspiSyncMeta & { nextBackfillPage: number; backfillComplete: boolean }> => {
  const row = await queryOne<EspiSyncStateRow>(
    `
      SELECT status, last_checked_at, last_success_at, next_backfill_page,
             backfill_complete, lock_token, lock_expires_at
      FROM espi_sync_state
      WHERE source = $1
    `,
    [PAP_SOURCE]
  );
  const isRefreshing = Boolean(row?.lock_token && row.lock_expires_at && Date.parse(row.lock_expires_at) > Date.now());
  return {
    status: row?.status ?? "NOT_SYNCED",
    lastCheckedAt: row?.last_checked_at ? normalizeIso(row.last_checked_at) : undefined,
    lastSuccessAt: row?.last_success_at ? normalizeIso(row.last_success_at) : undefined,
    isStale: !isFresh(row?.last_checked_at ?? null),
    isRefreshing,
    nextBackfillPage: row?.next_backfill_page ?? 1,
    backfillComplete: row?.backfill_complete ?? false,
  };
};

const acquireSyncLock = async () => {
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
    [PAP_SOURCE, token, expiresAt, now]
  );
  return row?.lock_token === token ? token : null;
};

const releaseSyncLock = async ({
  token,
  status,
  errorCode,
  nextBackfillPage,
  backfillComplete,
}: {
  token: string;
  status: EspiSourceStatus;
  errorCode?: string;
  nextBackfillPage?: number;
  backfillComplete?: boolean;
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
          lock_token = NULL,
          lock_expires_at = NULL,
          updated_at = $2
      WHERE source = $6 AND lock_token = $7
    `,
    [status, now, errorCode ?? null, nextBackfillPage ?? null, backfillComplete ?? null, PAP_SOURCE, token]
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
  }>(
    `
      SELECT id, canonical_key, ticker, company_name, isin
      FROM corporate_event_instruments
      WHERE market = 'GPW'
        AND (($1::text IS NOT NULL AND isin = $1) OR ($2::text IS NOT NULL AND ticker = $2))
      ORDER BY CASE WHEN $1::text IS NOT NULL AND isin = $1 THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
    `,
    [isin ?? null, ticker ?? null]
  );

const resolveGpwIssuer = async (
  report: Pick<ParsedPapEspiReport, "issuerName" | "sourceIsin" | "sourceTicker">
) => {
  const sourceIsin = report.sourceIsin?.trim().toUpperCase();
  const sourceTicker = report.sourceTicker?.trim().toUpperCase();
  const existing = await findExistingIssuer(
    sourceIsin,
    isReliableTicker(sourceTicker) ? sourceTicker : undefined
  );
  if (existing) return existing;

  const catalogEntry = sourceIsin
    ? await findGpwCatalogEntryByIsin(sourceIsin)
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
      RETURNING id, canonical_key, ticker, company_name, isin
    `,
    [id, canonicalKey, catalogEntry.isin ?? sourceIsin ?? null, ticker, catalogEntry.name, now]
  );
};

const upsertEspiReport = async (report: ParsedPapEspiReport) => {
  const issuer = await resolveGpwIssuer(report);
  const existing = await queryOne<{ id: string }>(
    `
      SELECT id
      FROM espi_reports
      WHERE (source = $1 AND source_id = $2) OR source_url = $3
      ORDER BY CASE WHEN source = $1 AND source_id = $2 THEN 0 ELSE 1 END
      LIMIT 1
    `,
    [PAP_SOURCE, report.sourceId, report.sourceUrl]
  );
  const now = new Date().toISOString();
  const id = existing?.id ?? randomUUID();

  await withTransaction(async (transaction) => {
    if (existing) {
      await transaction.execute(
        `
          UPDATE espi_reports
          SET source_id = $1, issuer_id = COALESCE($2, issuer_id), issuer_name = $3,
              source_ticker = $4, source_isin = $5, report_number = $6,
              report_type = $7, published_at = $8, source_title = $9, title = $10,
              body_text = $11, legal_basis = $12, category = $13, source_url = $14,
              is_correction = $15, correction_target_report_number = $16, updated_at = $17
          WHERE id = $18
        `,
        [
          report.sourceId, issuer?.id ?? null, report.issuerName, report.sourceTicker ?? null,
          report.sourceIsin ?? null, report.reportNumber ?? null, report.reportType,
          report.publishedAt, report.sourceTitle, report.title, report.body,
          report.legalBasis ?? null, report.category, report.sourceUrl, report.isCorrection,
          report.correctionTargetReportNumber ?? null, now, id,
        ]
      );
    } else {
      await transaction.execute(
        `
          INSERT INTO espi_reports (
            id, source, source_id, issuer_id, issuer_name, source_ticker, source_isin,
            report_number, report_type, published_at, source_title, title, body_text,
            legal_basis, category, source_url, is_correction,
            correction_target_report_number, discovered_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                  $11, $12, $13, $14, $15, $16, $17, $18, $19, $19)
        `,
        [
          id, PAP_SOURCE, report.sourceId, issuer?.id ?? null, report.issuerName,
          report.sourceTicker ?? null, report.sourceIsin ?? null, report.reportNumber ?? null,
          report.reportType, report.publishedAt, report.sourceTitle, report.title, report.body,
          report.legalBasis ?? null, report.category, report.sourceUrl, report.isCorrection,
          report.correctionTargetReportNumber ?? null, now,
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

  return { id, issuerId: issuer?.id ?? null };
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

const getStoredSourceIds = async (candidates: PapEspiListCandidate[]) => {
  if (candidates.length === 0) return new Set<string>();
  const rows = await query<{ source_id: string }>(
    "SELECT source_id FROM espi_reports WHERE source = $1 AND source_id = ANY($2::text[])",
    [PAP_SOURCE, candidates.map((candidate) => candidate.sourceId)]
  );
  return new Set(rows.map((row) => row.source_id));
};

const reconcileStoredEspiMetadata = async () => {
  const rows = await query<{
    id: string;
    issuer_id: string | null;
    source_title: string;
    body_text: string;
    report_number: string | null;
    report_type: EspiReportType;
    category: EspiCategory;
    source_isin: string | null;
    source_ticker: string | null;
    issuer_name: string;
  }>(
    `
      SELECT id, issuer_id, source_title, body_text, report_number, report_type, category,
             source_isin, source_ticker, issuer_name
      FROM espi_reports
      WHERE source = $1
      ORDER BY published_at DESC
      LIMIT 500
    `,
    [PAP_SOURCE]
  );
  let changed = 0;
  for (const row of rows) {
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
      : await resolveGpwIssuer({
          sourceIsin: row.source_isin ?? undefined,
          sourceTicker: row.source_ticker ?? undefined,
          issuerName: row.issuer_name,
        });
    if (reportType === row.report_type && category === row.category && !issuer) continue;
    await execute(
      `
        UPDATE espi_reports
        SET report_type = $1,
            category = $2,
            issuer_id = COALESCE(issuer_id, $3),
            updated_at = $4
        WHERE id = $5
      `,
      [reportType, category, issuer?.id ?? null, new Date().toISOString(), row.id]
    );
    changed += 1;
  }
  return changed;
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
}: {
  force?: boolean;
  backfillPages?: number;
} = {}): Promise<EspiSynchronizationResult> => {
  const startedAt = Date.now();
  const state = await getEspiSyncState();
  if (!force && !state.isStale) {
    return { status: state.status === "NOT_SYNCED" ? "NOT_FOUND" : state.status, insertedOrUpdated: 0, skippedExisting: 0, parsed: 0, pagesRead: 0, locked: false };
  }
  const token = await acquireSyncLock();
  if (!token) {
    return { status: state.status === "NOT_SYNCED" ? "NOT_FOUND" : state.status, insertedOrUpdated: 0, skippedExisting: 0, parsed: 0, pagesRead: 0, locked: true };
  }

  let status: EspiSourceStatus = "SUCCESS";
  let pagesRead = 0;
  let skippedExisting = 0;
  let nextBackfillPage = state.nextBackfillPage;
  let backfillComplete = state.backfillComplete;
  try {
    const requestedBackfill = Math.min(
      Math.max(
        backfillPages ?? (state.lastSuccessAt ? (state.backfillComplete ? 0 : 1) : INITIAL_BACKFILL_PAGES),
        0
      ),
      4
    );
    const pages = [0];
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

    const candidates: PapEspiListCandidate[] = [];
    for (const page of Array.from(new Set(pages))) {
      const response = await fetchPapHtml(getFeedPageUrl(page));
      if (response.status !== "SUCCESS") {
        if (page === 0) {
          status = response.status;
          throw new Error(`PAP_LIST_${response.status}`);
        }
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
    const storedIds = await getStoredSourceIds(uniqueCandidates);
    const pending = uniqueCandidates.filter((candidate) => !storedIds.has(candidate.sourceId));
    skippedExisting = uniqueCandidates.length - pending.length;
    const fetched = await mapWithConcurrency(pending, ARTICLE_CONCURRENCY, async (candidate) => {
      const response = await fetchPapHtml(candidate.sourceUrl);
      if (response.status !== "SUCCESS") return { status: response.status, report: null };
      return { status: "SUCCESS" as const, report: parsePapEspiReport(response.document, candidate) };
    });
    const parsedReports = fetched.flatMap((entry) => entry.report ? [entry.report] : []);
    const storedReports: Array<{ report: ParsedPapEspiReport; id: string; issuerId: string | null }> = [];
    for (const report of parsedReports) {
      const stored = await upsertEspiReport(report);
      storedReports.push({ report, ...stored });
    }
    for (const stored of storedReports) {
      await linkCorrection(stored.id, stored.report, stored.issuerId);
    }
    const metadataChanges = await reconcileStoredEspiMetadata();
    await reconcileCorrectionLinks();

    if (pending.length > 0 && parsedReports.length === 0) {
      const failure = fetched.find((entry) => entry.status !== "SUCCESS")?.status;
      status = failure ?? "PARSE_ERROR";
      throw new Error(`PAP_ARTICLES_${status}`);
    }

    await releaseSyncLock({ token, status: "SUCCESS", nextBackfillPage, backfillComplete });
    diagnose({
      provider: PAP_SOURCE,
      status: "SUCCESS",
      pagesRead,
      candidates: uniqueCandidates.length,
      parsed: parsedReports.length,
      skippedExisting,
      metadataChanges,
      durationMs: Date.now() - startedAt,
    });
    return {
      status: "SUCCESS",
      insertedOrUpdated: storedReports.length,
      skippedExisting,
      parsed: parsedReports.length,
      pagesRead,
      locked: false,
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
    return { status, insertedOrUpdated: 0, skippedExisting, parsed: 0, pagesRead, locked: false };
  }
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

const getTrackingSource = (tracked: TrackedGpwInstrument): EspiTrackingSource =>
  tracked.held && tracked.watched
    ? "PORTFOLIO_AND_WATCHLIST"
    : tracked.held
      ? "PORTFOLIO"
      : "WATCHLIST";

const findTracking = (row: Pick<EspiReportRow, "issuer_canonical_key" | "source_isin" | "source_ticker">, tracked: TrackedGpwInstrument[]) => {
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

const mapSummary = (row: EspiReportRow, tracked: TrackedGpwInstrument[]): EspiReportSummary => {
  const tracking = findTracking(row, tracked);
  return {
    id: row.id,
    issuerName: row.issuer_name,
    ticker: row.issuer_ticker ?? (isReliableTicker(row.source_ticker) ? row.source_ticker! : undefined),
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
  const tracked = await getUserTrackedGpwInstruments(userId);
  if (filters.scope === "mine" && tracked.length === 0) {
    return { items: [], hasMore: false, sync: await getEspiSyncState() };
  }

  const clauses = ["report.source = 'PAP_ESPI'", "issuer.id IS NOT NULL"];
  const parameters: Array<string | number | string[]> = [];
  const add = (value: string | number | string[]) => {
    parameters.push(value);
    return `$${parameters.length}`;
  };

  if (filters.scope === "mine") {
    const keys = tracked.map((item) => item.canonicalKey);
    const isins = tracked.flatMap((item) => item.isin ? [item.isin.toUpperCase()] : []);
    const tickers = tracked.map((item) => item.ticker);
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
    const ticker = getGpwTickerCore(filters.ticker).slice(0, 8);
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
             report.source_ticker, report.source_isin, report.report_number,
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
    items: selected.map((row) => mapSummary(row, tracked)),
    hasMore,
    nextCursor: hasMore && selected.length ? encodeCursor(selected.at(-1)!) : undefined,
    sync: await getEspiSyncState(),
  };
};

export const getEspiReport = async ({ userId, reportId }: { userId: string; reportId: string }): Promise<EspiReport | null> => {
  const [row, tracked] = await Promise.all([
    queryOne<EspiReportRow>(
      `
        SELECT report.id, report.issuer_name, issuer.ticker AS issuer_ticker,
               issuer.canonical_key AS issuer_canonical_key,
               report.source_ticker, report.source_isin, report.report_number,
               report.report_type, report.published_at, report.title, report.body_text,
               report.legal_basis, report.category, report.source_id, report.source_url,
               report.is_correction, report.correction_target_report_number, report.correction_of_report_id,
               (SELECT COUNT(*) FROM espi_report_attachments attachment WHERE attachment.espi_report_id = report.id) AS attachments_count
        FROM espi_reports report
        LEFT JOIN corporate_event_instruments issuer ON issuer.id = report.issuer_id
        WHERE report.id = $1 AND report.source = 'PAP_ESPI' AND issuer.id IS NOT NULL
      `,
      [reportId]
    ),
    getUserTrackedGpwInstruments(userId),
  ]);
  if (!row) return null;
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
  return {
    scope: searchParams.get("scope") === "all" ? "all" : "mine",
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

import { randomUUID } from "node:crypto";
import {
  type CorporateEvent,
  type CorporateEventSourceReference,
  type CorporateEventSourceStatus,
  type CorporateEventSourceType,
  type CorporateEventStatus,
  type CorporateEventType,
  type CorporateEventsResponse,
  isCorporateEventSourceUnavailable,
  parseCorporateEventDocument,
  type ParsedCorporateEvent,
} from "@/lib/corporate-events";
import { getGpwTickerCore, isGpwSymbol, normalizeGpwSymbol } from "@/lib/ticker";
import { query, queryOne, withTransaction, type DatabaseTransaction } from "@/lib/server/db";
import type { PortfolioInstrument } from "@/types/portfolio";

const EVENT_REFRESH_TTL_MS = 24 * 60 * 60 * 1_000;
const UNAVAILABLE_RETRY_TTL_MS = 60 * 60 * 1_000;
const SOURCE_TIMEOUT_MS = 12_000;

type GpwCorporateEventInstrumentInput = Pick<
  PortfolioInstrument,
  "id" | "symbol" | "name" | "isin" | "assetKind" | "marketCurrency"
>;

type CanonicalInstrument = {
  id: string;
  canonical_key: string;
  ticker: string;
  company_name: string;
  isin: string | null;
  last_checked_at: string | null;
  last_source_status: CorporateEventSourceStatus | null;
};

type EventRow = {
  id: string;
  instrument_id: string;
  ticker: string;
  company_name: string;
  event_type: CorporateEventType;
  event_date: string;
  event_time: string | null;
  fiscal_period: string | null;
  fiscal_year: number | null;
  status: CorporateEventStatus;
  active: boolean;
  source_published_at: string | null;
  discovered_at: string;
  updated_at: string;
  source_type: CorporateEventSourceType | null;
  source_url: string | null;
  source_source_published_at: string | null;
};

type ExistingEventRow = Pick<
  EventRow,
  | "id"
  | "event_date"
  | "status"
  | "source_published_at"
  | "source_type"
  | "updated_at"
> & {
  source_priority: number;
};

type IssuerSource = {
  type: CorporateEventSourceType;
  url: string;
};

type ProviderResult = {
  status: CorporateEventSourceStatus;
  source?: CorporateEventSourceReference;
  events: ParsedCorporateEvent[];
  durationMs?: number;
};

export type CorporateEventProvider = {
  id: string;
  fetchEvents: (instrument: CanonicalInstrument) => Promise<ProviderResult>;
};

const GPW_ISSUER_SOURCE_REGISTRY: Record<string, IssuerSource[]> = {
  DNP: [
    {
      type: "ISSUER_CURRENT_REPORT",
      url: "https://grupadino.pl/raport-biezacy-nr-1-2026-terminy-publikacji-raportow-okresowych-dino-polska-s-a-w-2026-r/",
    },
  ],
  PKN: [
    {
      type: "ISSUER_CURRENT_REPORT",
      url: "https://www.orlen.pl/pl/relacje-inwestorskie/raporty-i-publikacje/raporty-biezace/2025/04/Raport-biezacy-nr-68-2025",
    },
  ],
  LPP: [
    {
      type: "ISSUER_IR",
      url: "https://www.lpp.com/relacje-inwestorskie/raporty/raporty-okresowe/",
    },
  ],
  CDR: [
    {
      type: "ISSUER_CURRENT_REPORT",
      url: "https://www.cdprojekt.com/pl/inwestorzy/raporty-gieldowe/raport-biezacy-nr-1-2026/",
    },
  ],
  DIA: [
    {
      type: "ISSUER_CURRENT_REPORT",
      url: "https://grupadiagnostyka.pl/raporty-biezace/terminy-publikacji-raportow-okresowych-diagnostyka-s-a-w-2026-r/",
    },
  ],
};

const sourcePriority = (sourceType: CorporateEventSourceType, isChange: boolean) => {
  if (isChange) return 400;
  if (sourceType === "ISSUER_CURRENT_REPORT") return 300;
  if (sourceType === "ISSUER_IR") return 200;
  return 100;
};

const isDiagnosticsEnabled = () => process.env.CORPORATE_EVENTS_DIAGNOSTICS === "true";

const diagnose = (payload: Record<string, unknown>) => {
  if (isDiagnosticsEnabled()) {
    console.info("corporate-events", payload);
  }
};

export const classifyCorporateEventHttpStatus = (status: number): CorporateEventSourceStatus => {
  if (status === 403 || status === 401) return "ACCESS_DENIED";
  if (status === 404) return "NOT_FOUND";
  if (status === 429 || status >= 500) return "TEMPORARILY_UNAVAILABLE";
  return "PARSE_ERROR";
};

const extractSourcePublishedAt = (text: string) => {
  const candidate = text.match(
    /(?:data publikacji|opublikowano|data)\s*:?\s*([^\n]{0,48})/i
  )?.[1];
  const event = candidate ? parseCorporateEventDocument(`Raport roczny ${candidate}`)[0] : undefined;
  return event?.eventDate ? `${event.eventDate}T00:00:00.000Z` : undefined;
};

export class GpwIssuerIrCorporateEventProvider implements CorporateEventProvider {
  id = "gpw-issuer-ir";

  async fetchEvents(instrument: CanonicalInstrument): Promise<ProviderResult> {
    const source = GPW_ISSUER_SOURCE_REGISTRY[instrument.ticker]?.[0];

    if (!source) {
      return { status: "NOT_FOUND", events: [] };
    }

    const startedAt = Date.now();
    let response: Response;

    try {
      response = await fetch(source.url, {
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      diagnose({
        instrumentId: instrument.id,
        provider: this.id,
        source: source.type,
        status: timedOut ? "TEMPORARILY_UNAVAILABLE" : "TEMPORARILY_UNAVAILABLE",
        errorType: error instanceof Error ? error.name : "unknown",
        durationMs: Date.now() - startedAt,
      });
      return {
        status: "TEMPORARILY_UNAVAILABLE",
        events: [],
        source: { sourceType: source.type, sourceUrl: source.url },
        durationMs: Date.now() - startedAt,
      };
    }

    if (!response.ok) {
      const status = classifyCorporateEventHttpStatus(response.status);
      diagnose({
        instrumentId: instrument.id,
        provider: this.id,
        source: source.type,
        status,
        httpStatus: response.status,
        durationMs: Date.now() - startedAt,
      });
      return {
        status,
        events: [],
        source: { sourceType: source.type, sourceUrl: source.url },
        durationMs: Date.now() - startedAt,
      };
    }

    const document = await response.text();
    const events = parseCorporateEventDocument(document);
    const sourcePublishedAt = extractSourcePublishedAt(document);
    const status: CorporateEventSourceStatus = events.length > 0 ? "SUCCESS" : "PARSE_ERROR";

    diagnose({
      instrumentId: instrument.id,
      provider: this.id,
      source: source.type,
      status,
      foundEventsCount: events.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      status,
      events,
      source: {
        sourceType: source.type,
        sourceUrl: source.url,
        sourcePublishedAt,
      },
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * PAP/ESPI intentionally has no broad crawler in v1. It is an explicit,
 * URL-based official-source adapter for a discovered PAP/ESPI report, so it
 * cannot bypass access controls or turn a search engine into a source.
 */
export class PapEspiCorporateEventProvider implements CorporateEventProvider {
  id = "pap-espi";
  private readonly sourceByTicker: Record<string, string>;

  constructor(sourceByTicker: Record<string, string> = {}) {
    this.sourceByTicker = sourceByTicker;
  }

  async fetchEvents(instrument: CanonicalInstrument): Promise<ProviderResult> {
    const url = this.sourceByTicker[instrument.ticker];
    if (!url) return { status: "NOT_FOUND", events: [] };

    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          status: classifyCorporateEventHttpStatus(response.status),
          events: [],
          source: { sourceType: "PAP_ESPI", sourceUrl: url },
          durationMs: Date.now() - startedAt,
        };
      }

      const document = await response.text();
      const events = parseCorporateEventDocument(document);
      const status: CorporateEventSourceStatus = events.length > 0 ? "SUCCESS" : "PARSE_ERROR";
      diagnose({
        instrumentId: instrument.id,
        provider: this.id,
        source: "PAP_ESPI",
        status,
        foundEventsCount: events.length,
        durationMs: Date.now() - startedAt,
      });
      return {
        status,
        events,
        source: {
          sourceType: "PAP_ESPI",
          sourceUrl: url,
          sourcePublishedAt: extractSourcePublishedAt(document),
        },
        durationMs: Date.now() - startedAt,
      };
    } catch {
      return {
        status: "TEMPORARILY_UNAVAILABLE",
        events: [],
        source: { sourceType: "PAP_ESPI", sourceUrl: url },
        durationMs: Date.now() - startedAt,
      };
    }
  }
}

const defaultProviders: CorporateEventProvider[] = [
  new GpwIssuerIrCorporateEventProvider(),
  new PapEspiCorporateEventProvider(),
];

const refreshInFlight = new Map<string, Promise<void>>();

export const getGpwCorporateEventCanonicalKey = (instrument: GpwCorporateEventInstrumentInput) => {
  const isin = instrument.isin?.trim().toUpperCase();
  if (isin) return `gpw:isin:${isin}`;
  return `gpw:ticker:${getGpwTickerCore(instrument.symbol)}`;
};

export const isGpwCorporateEventInstrument = (instrument: GpwCorporateEventInstrumentInput) =>
  instrument.assetKind === "stock" &&
  instrument.marketCurrency === "PLN" &&
  isGpwSymbol(instrument.symbol);

const getCanonicalInstrument = async (input: GpwCorporateEventInstrumentInput) => {
  const canonicalKey = getGpwCorporateEventCanonicalKey(input);
  const ticker = getGpwTickerCore(input.symbol);
  const now = new Date().toISOString();
  const id = `corporate-event-instrument:${canonicalKey}`;

  await query(
    `
      INSERT INTO corporate_event_instruments (
        id, canonical_key, market, isin, ticker, company_name, created_at, updated_at
      )
      VALUES ($1, $2, 'GPW', $3, $4, $5, $6, $6)
      ON CONFLICT (canonical_key) DO UPDATE
      SET company_name = EXCLUDED.company_name,
          ticker = EXCLUDED.ticker,
          isin = COALESCE(corporate_event_instruments.isin, EXCLUDED.isin),
          updated_at = EXCLUDED.updated_at
    `,
    [id, canonicalKey, input.isin?.trim().toUpperCase() || null, ticker, input.name, now]
  );

  return queryOne<CanonicalInstrument>(
    `
      SELECT id, canonical_key, ticker, company_name, isin, last_checked_at, last_source_status
      FROM corporate_event_instruments
      WHERE canonical_key = $1
    `,
    [canonicalKey]
  );
};

const isFreshCheck = (instrument: CanonicalInstrument) => {
  const checkedAt = instrument.last_checked_at ? Date.parse(instrument.last_checked_at) : Number.NaN;
  if (!Number.isFinite(checkedAt)) return false;
  const ttl = instrument.last_source_status && isCorporateEventSourceUnavailable(instrument.last_source_status)
    ? UNAVAILABLE_RETRY_TTL_MS
    : EVENT_REFRESH_TTL_MS;
  return Date.now() - checkedAt < ttl;
};

const toSourcePriority = (source: CorporateEventSourceReference, parsed: ParsedCorporateEvent) =>
  sourcePriority(source.sourceType, parsed.isScheduleChange);

const sourceTimestamp = (value: string | undefined | null) => {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const shouldApplyEvent = (
  existing: ExistingEventRow | undefined,
  source: CorporateEventSourceReference,
  parsed: ParsedCorporateEvent
) => {
  if (!existing) return true;
  const incomingPriority = toSourcePriority(source, parsed);
  const incomingTimestamp = sourceTimestamp(source.sourcePublishedAt);
  const existingTimestamp = sourceTimestamp(existing.source_published_at);
  const incomingIsChange = parsed.isScheduleChange;
  const existingIsChange = existing.status === "CHANGED";

  if (incomingIsChange) {
    // A change notice supersedes a schedule, but one undated change must not
    // randomly overwrite another changed date. We only replace a prior change
    // when the source establishes that it is at least as recent.
    return !existingIsChange ||
      (incomingTimestamp > 0 && incomingTimestamp >= existingTimestamp);
  }

  if (existingIsChange && incomingTimestamp < existingTimestamp) return false;
  return incomingTimestamp >= existingTimestamp && incomingPriority >= existing.source_priority;
};

const upsertParsedEvents = async (
  transaction: DatabaseTransaction,
  instrument: CanonicalInstrument,
  result: ProviderResult
) => {
  if (!result.source || result.events.length === 0) return;

  for (const parsed of result.events) {
    const existing = (
      await transaction.query<ExistingEventRow>(
        `
          SELECT id, event_date, status, source_published_at, source_priority, source_type, updated_at
          FROM corporate_events
          WHERE instrument_id = $1
            AND event_type = $2
            AND COALESCE(fiscal_period, '') = COALESCE($3, '')
            AND COALESCE(fiscal_year, 0) = COALESCE($4, 0)
            AND active = TRUE
          FOR UPDATE
        `,
        [instrument.id, parsed.eventType, parsed.fiscalPeriod ?? null, parsed.fiscalYear ?? null]
      )
    )[0];
    const now = new Date().toISOString();
    const eventId = existing?.id ?? randomUUID();
    const apply = shouldApplyEvent(existing, result.source, parsed);
    const sourceId = randomUUID();

    if (!existing) {
      await transaction.execute(
        `
          INSERT INTO corporate_events (
            id, instrument_id, event_type, event_date, event_time, fiscal_period, fiscal_year,
            status, active, source_published_at, source_type, source_priority, discovered_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $10, $11, $12, $12)
        `,
        [
          eventId,
          instrument.id,
          parsed.eventType,
          parsed.eventDate,
          parsed.eventTime ?? null,
          parsed.fiscalPeriod ?? null,
          parsed.fiscalYear ?? null,
          parsed.isScheduleChange ? "CHANGED" : "CONFIRMED",
          result.source.sourcePublishedAt ?? null,
          result.source.sourceType,
          toSourcePriority(result.source, parsed),
          now,
        ]
      );
    } else if (apply) {
      await transaction.execute(
        `
          UPDATE corporate_events
          SET event_date = $1,
              event_time = $2,
              status = $3,
              source_published_at = $4,
              source_type = $5,
              source_priority = $6,
              updated_at = $7
          WHERE id = $8
        `,
        [
          parsed.eventDate,
          parsed.eventTime ?? null,
          parsed.isScheduleChange ? "CHANGED" : "CONFIRMED",
          result.source.sourcePublishedAt ?? null,
          result.source.sourceType,
          toSourcePriority(result.source, parsed),
          now,
          eventId,
        ]
      );
    }

    await transaction.execute(
      `
        INSERT INTO corporate_event_sources (
          id, corporate_event_id, source_type, source_url, source_published_at, source_priority, discovered_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (corporate_event_id, source_url) DO UPDATE
        SET source_published_at = COALESCE(EXCLUDED.source_published_at, corporate_event_sources.source_published_at),
            source_priority = GREATEST(corporate_event_sources.source_priority, EXCLUDED.source_priority)
      `,
      [
        sourceId,
        eventId,
        result.source.sourceType,
        result.source.sourceUrl,
        result.source.sourcePublishedAt ?? null,
        toSourcePriority(result.source, parsed),
        now,
      ]
    );

    if (existing && apply && existing.event_date !== parsed.eventDate) {
      await transaction.execute(
        `
          INSERT INTO corporate_event_history (
            id, corporate_event_id, previous_event_date, next_event_date, source_url, detected_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [randomUUID(), eventId, existing.event_date, parsed.eventDate, result.source.sourceUrl, now]
      );
    }
  }
};

const recordSourceCheck = async (
  transaction: DatabaseTransaction,
  instrumentId: string,
  result: ProviderResult,
  checkedAt: string
) => {
  if (!result.source) return;

  await transaction.execute(
    `
      INSERT INTO corporate_event_source_checks (
        id, instrument_id, source_type, source_url, last_checked_at, last_status, last_duration_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (instrument_id, source_url) DO UPDATE
      SET source_type = EXCLUDED.source_type,
          last_checked_at = EXCLUDED.last_checked_at,
          last_status = EXCLUDED.last_status,
          last_duration_ms = EXCLUDED.last_duration_ms
    `,
    [
      randomUUID(),
      instrumentId,
      result.source.sourceType,
      result.source.sourceUrl,
      checkedAt,
      result.status,
      result.durationMs ? Math.round(result.durationMs) : null,
    ]
  );
};

const refreshCanonicalInstrument = async (
  instrument: CanonicalInstrument,
  providers: CorporateEventProvider[] = defaultProviders
) => {
  const current = refreshInFlight.get(instrument.id);
  if (current) return current;

  const refresh = (async () => {
    const startedAt = Date.now();
    const results = await Promise.all(providers.map((provider) => provider.fetchEvents(instrument)));
    const successful = results.filter((result) => result.status === "SUCCESS");
    const latestStatus = successful.length > 0
      ? "SUCCESS"
      : results.find((result) => result.status === "ACCESS_DENIED")?.status ??
        results.find((result) => result.status === "TEMPORARILY_UNAVAILABLE")?.status ??
        results.find((result) => result.status === "PARSE_ERROR")?.status ??
        "NOT_FOUND";
    const now = new Date().toISOString();

    await withTransaction(async (transaction) => {
      await transaction.query<{ locked: number }>(
        "SELECT pg_advisory_xact_lock(hashtext($1)) AS locked",
        [`corporate-events:${instrument.canonical_key}`]
      );

      for (const result of successful) {
        await upsertParsedEvents(transaction, instrument, result);
      }

      for (const result of results) {
        await recordSourceCheck(transaction, instrument.id, result, now);
      }

      await transaction.execute(
        `
          UPDATE corporate_event_instruments
          SET last_checked_at = $1, last_source_status = $2, updated_at = $1
          WHERE id = $3
        `,
        [now, latestStatus, instrument.id]
      );
    });

    diagnose({
      instrumentId: instrument.id,
      provider: "aggregate",
      sourceStatus: latestStatus,
      foundEventsCount: successful.reduce((count, result) => count + result.events.length, 0),
      lastCheckedAt: now,
      durationMs: Date.now() - startedAt,
    });
  })().finally(() => {
    refreshInFlight.delete(instrument.id);
  });

  refreshInFlight.set(instrument.id, refresh);
  return refresh;
};

const toCorporateEvent = (row: EventRow): CorporateEvent => ({
  id: row.id,
  instrumentId: row.instrument_id,
  ticker: row.ticker,
  companyName: row.company_name,
  eventType: row.event_type,
  eventDate: row.event_date,
  eventTime: row.event_time ?? undefined,
  fiscalPeriod: row.fiscal_period ?? undefined,
  fiscalYear: row.fiscal_year ?? undefined,
  status: row.status,
  active: row.active,
  sourcePublishedAt: row.source_published_at ?? undefined,
  discoveredAt: row.discovered_at,
  updatedAt: row.updated_at,
  source:
    row.source_type && row.source_url
      ? {
          sourceType: row.source_type,
          sourceUrl: row.source_url,
          sourcePublishedAt: row.source_source_published_at ?? undefined,
        }
      : undefined,
});

const getStoredEvents = async (instrumentIds: string[], fromDate: string, toDate: string) => {
  if (instrumentIds.length === 0) return [];
  const rows = await query<EventRow>(
    `
      SELECT event.id, event.instrument_id, instrument.ticker, instrument.company_name,
             event.event_type, event.event_date, event.event_time, event.fiscal_period,
             event.fiscal_year, event.status, event.active, event.source_published_at,
             event.discovered_at, event.updated_at,
             source.source_type, source.source_url,
             source.source_published_at AS source_source_published_at
      FROM corporate_events AS event
      INNER JOIN corporate_event_instruments AS instrument ON instrument.id = event.instrument_id
      LEFT JOIN LATERAL (
        SELECT source_type, source_url, source_published_at
        FROM corporate_event_sources
        WHERE corporate_event_id = event.id
        ORDER BY source_priority DESC, source_published_at DESC NULLS LAST, discovered_at DESC
        LIMIT 1
      ) AS source ON TRUE
      WHERE event.instrument_id = ANY($1::text[])
        AND event.active = TRUE
        AND event.event_date >= $2
        AND event.event_date <= $3
      ORDER BY event.event_date ASC, instrument.company_name ASC
    `,
    [instrumentIds, fromDate, toDate]
  );
  return rows.map(toCorporateEvent);
};

export const getCorporateEventsForGpwPortfolio = async ({
  instruments,
  fromDate,
  toDate,
  forceRefresh = false,
}: {
  instruments: GpwCorporateEventInstrumentInput[];
  fromDate: string;
  toDate: string;
  forceRefresh?: boolean;
}): Promise<CorporateEventsResponse> => {
  const gpwInstruments = instruments.filter(isGpwCorporateEventInstrument);
  if (gpwInstruments.length === 0) {
    return { events: [], sourceStates: [], scope: "NO_GPW_INSTRUMENTS" };
  }

  const canonicalInstruments = (
    await Promise.all(gpwInstruments.map(getCanonicalInstrument))
  ).filter((instrument): instrument is CanonicalInstrument => Boolean(instrument));
  const uniqueCanonical = Array.from(
    new Map(canonicalInstruments.map((instrument) => [instrument.id, instrument])).values()
  );

  const refreshes = uniqueCanonical
    .filter((instrument) => forceRefresh || !isFreshCheck(instrument))
    .map((instrument) => refreshCanonicalInstrument(instrument));
  const initialInstruments = uniqueCanonical.filter((instrument) => !instrument.last_checked_at);

  // First discovery is awaited so a new GPW holding can receive events in the
  // first API response. Existing data is returned stale-while-revalidate.
  if (initialInstruments.length > 0) {
    await Promise.all(
      initialInstruments.map((instrument) => refreshCanonicalInstrument(instrument))
    );
  } else {
    for (const refresh of refreshes) {
      void refresh;
    }
  }

  const refreshedCanonical = await Promise.all(
    uniqueCanonical.map((instrument) =>
      queryOne<CanonicalInstrument>(
        `
          SELECT id, canonical_key, ticker, company_name, isin, last_checked_at, last_source_status
          FROM corporate_event_instruments
          WHERE id = $1
        `,
        [instrument.id]
      )
    )
  );

  return {
    events: await getStoredEvents(
      uniqueCanonical.map((instrument) => instrument.id),
      fromDate,
      toDate
    ),
    sourceStates: refreshedCanonical
      .filter((instrument): instrument is CanonicalInstrument => Boolean(instrument))
      .map((instrument) => ({
        instrumentId: instrument.id,
        ticker: instrument.ticker,
        status: instrument.last_source_status ?? "NOT_FOUND",
        lastCheckedAt: instrument.last_checked_at ?? undefined,
      })),
    scope: "OK",
  };
};

export const getGpwCorporateEventInputs = (
  portfolioInstruments: PortfolioInstrument[],
  heldInstrumentIds: Set<string>
) =>
  portfolioInstruments.filter(
    (instrument) => heldInstrumentIds.has(instrument.id) && isGpwCorporateEventInstrument(instrument)
  );

export const normalizeCorporateEventGpwSymbol = (symbol: string) => normalizeGpwSymbol(symbol);

import { randomUUID } from "node:crypto";
import {
  type CorporateEvent,
  type CorporateEventSourceReference,
  type CorporateEventSourceStatus,
  type CorporateEventSourceType,
  type CorporateEventStatus,
  type CorporateEventType,
  type CorporateEventsResponse,
  getCorporateEventIdentityKey,
  isCorporateEventSourceUnavailable,
  parseCorporateEventDocument,
  type ParsedCorporateEvent,
} from "@/lib/corporate-events";
import { getGpwTickerCore, isGpwSymbol, normalizeGpwSymbol } from "@/lib/ticker";
import { query, queryOne, withTransaction, type DatabaseTransaction } from "@/lib/server/db";
import { findGpwCatalogEntry } from "@/lib/server/gpw-catalog";
import { getMarketCachePayload, setMarketCachePayload } from "@/lib/server/market-cache";
import { fetchWithSystemTrust } from "@/lib/server/system-trust-fetch";
import { normalizeText, uniqueBy } from "@/lib/utils";
import type { PortfolioInstrument } from "@/types/portfolio";

const EVENT_REFRESH_TTL_MS = 24 * 60 * 60 * 1_000;
const UNAVAILABLE_RETRY_TTL_MS = 60 * 60 * 1_000;
const SOURCE_TIMEOUT_MS = 12_000;
const PAP_DISCOVERY_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const PAP_TAXONOMY_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const PAP_MAX_ISSUER_PAGES = 6;
const PAP_BASE_URL = "https://pap-mediaroom.pl";

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
  dividend_per_share: number | null;
  dividend_currency: string | null;
  ex_dividend_date: string | null;
  record_date: string | null;
  payment_date: string | null;
  dividend_installment: number | null;
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
  KPL: [
    {
      type: "ISSUER_IR",
      url: "https://relacjeinwestorskie.kinopolska.pl/kalendarium/",
    },
  ],
  KTY: [
    {
      type: "ISSUER_CURRENT_REPORT",
      url: "https://grupakety.com/raporty_biezace/uchwala-zwyczajnego-walnego-zgromadzenia-grupy-kety-s-a-w-sprawie-wyplaty-dywidendy-7/",
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

export type PapEspiSearchCandidate = {
  title: string;
  url: string;
  sourcePublishedAt?: string;
};

type PapDiscoveryResult = {
  status: CorporateEventSourceStatus;
  candidates: PapEspiSearchCandidate[];
};

type PapDiscoveryCategory = "report-change" | "report-schedule" | "dividend";

const decodePapText = (value: string) =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();

const toPapSourcePublishedAt = (value: string) => {
  const match = value.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})(?:,?\s*(\d{1,2}):(\d{2}))?/);
  if (!match) return undefined;
  const [, day, month, year, hour = "00", minute = "00"] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:00.000Z`;
};

/** Parse the public PAP search/taxonomy list without depending on page CSS. */
export const parsePapEspiSearchCandidates = (document: string): PapEspiSearchCandidate[] => {
  const segments = document.split(/(?=<div\s+role="article")/gi).slice(1);

  return uniqueBy(
    segments.flatMap((segment) => {
      if (!/<li\s+class="source">[\s\S]*?>\s*ESPI\s*<\/a>/i.test(segment)) return [];
      const path = segment.match(/<div\s+role="article"\s+about="([^"]+)"/i)?.[1];
      const title = segment.match(
        /<span[^>]*class="[^"]*field--name-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i
      )?.[1];
      const published = segment.match(/<li\s+class="date">([\s\S]*?)<\/li>/i)?.[1];
      if (!path || !title) return [];

      return [{
        title: decodePapText(title),
        url: new URL(path, PAP_BASE_URL).toString(),
        sourcePublishedAt: published
          ? toPapSourcePublishedAt(decodePapText(published))
          : undefined,
      }];
    }),
    (candidate) => candidate.url
  );
};

const isPapCandidateForCategory = (
  candidate: PapEspiSearchCandidate,
  category: PapDiscoveryCategory
) => {
  const title = normalizeText(candidate.title);
  const isChange = /zmian.{0,48}(?:termin|harmonogram).{0,80}raport|zmian.{0,30}terminu publikacji raport/i.test(title);
  const isSchedule = /termin.{0,60}(?:publik|przekazyw).{0,60}raport|harmonogram.{0,70}raport/i.test(title);

  if (category === "report-change") return isChange;
  if (category === "report-schedule") return isSchedule && !isChange;
  return /dywidend/i.test(title);
};

const fetchPapDocument = async (url: string) => {
  try {
    const response = await fetchWithSystemTrust(url, {
      headers: { Accept: "text/html,application/xhtml+xml" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    return response.ok
      ? { status: "SUCCESS" as const, document: await response.text() }
      : { status: classifyCorporateEventHttpStatus(response.status), document: "" };
  } catch {
    return { status: "TEMPORARILY_UNAVAILABLE" as const, document: "" };
  }
};

const extractPapIssuerTaxonomyUrl = (document: string, instrument: CanonicalInstrument) => {
  const isin = instrument.isin?.toUpperCase();
  const companyTokens = normalizeText(instrument.company_name)
    .split(" ")
    .filter((word) => word.length >= 4 && !["grupa", "polska", "spolka", "akcyjna", "holding"].includes(word));

  for (const anchor of document.matchAll(/<a\s+[^>]*href="([^"]*\/taxonomy\/term\/\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decodePapText(anchor[2] ?? "");
    const normalizedLabel = normalizeText(label);
    if (
      (isin && label.toUpperCase().includes(isin)) ||
      (!isin && companyTokens.some((token) => normalizedLabel.includes(token)))
    ) {
      return new URL(anchor[1] ?? "", PAP_BASE_URL).toString();
    }
  }

  return null;
};

const papDiscoveryInFlight = new Map<string, Promise<PapDiscoveryResult>>();

const discoverPapTaxonomyUrl = async (instrument: CanonicalInstrument) => {
  const identity = instrument.isin ?? instrument.ticker;
  const cacheKey = `pap-espi:taxonomy:${identity}`;
  const cached = await getMarketCachePayload<{ url?: string }>(
    cacheKey,
    PAP_TAXONOMY_CACHE_TTL_MS
  );
  if (cached?.url) return { status: "SUCCESS" as const, url: cached.url };

  for (const queryValue of [instrument.isin, instrument.company_name].filter(Boolean) as string[]) {
    const search = await fetchPapDocument(
      `${PAP_BASE_URL}/szukaj/${encodeURIComponent(queryValue)}`
    );
    if (search.status !== "SUCCESS") {
      if (search.status !== "NOT_FOUND") return { status: search.status, url: null };
      continue;
    }

    for (const candidate of parsePapEspiSearchCandidates(search.document).slice(0, 4)) {
      const article = await fetchPapDocument(candidate.url);
      if (article.status !== "SUCCESS") continue;
      const taxonomyUrl = extractPapIssuerTaxonomyUrl(article.document, instrument);
      if (!taxonomyUrl) continue;
      await setMarketCachePayload(cacheKey, { url: taxonomyUrl });
      return { status: "SUCCESS" as const, url: taxonomyUrl };
    }
  }

  return { status: "NOT_FOUND" as const, url: null };
};

const discoverPapCandidates = async (instrument: CanonicalInstrument): Promise<PapDiscoveryResult> => {
  const current = papDiscoveryInFlight.get(instrument.id);
  if (current) return current;

  const discovery: Promise<PapDiscoveryResult> = (async () => {
    const taxonomy = await discoverPapTaxonomyUrl(instrument);
    if (!taxonomy.url) return { status: taxonomy.status, candidates: [] };

    const cacheKey = `pap-espi:candidates:${instrument.isin ?? instrument.ticker}`;
    const cached = await getMarketCachePayload<PapEspiSearchCandidate[]>(
      cacheKey,
      PAP_DISCOVERY_CACHE_TTL_MS
    );
    const pageZero = await fetchPapDocument(taxonomy.url);
    if (pageZero.status !== "SUCCESS") {
      return cached?.length
        ? { status: "SUCCESS" as const, candidates: cached }
        : { status: pageZero.status, candidates: [] };
    }

    let candidates = parsePapEspiSearchCandidates(pageZero.document);
    const cachedSchedule = cached?.some((candidate) =>
      isPapCandidateForCategory(candidate, "report-schedule")
    );

    if (!cachedSchedule && !candidates.some((candidate) =>
      isPapCandidateForCategory(candidate, "report-schedule")
    )) {
      for (let page = 1; page < PAP_MAX_ISSUER_PAGES; page += 1) {
        const separator = taxonomy.url.includes("?") ? "&" : "?";
        const response = await fetchPapDocument(`${taxonomy.url}${separator}page=${page}`);
        if (response.status !== "SUCCESS") break;
        const pageCandidates = parsePapEspiSearchCandidates(response.document);
        if (pageCandidates.length === 0) break;
        candidates.push(...pageCandidates);
        if (pageCandidates.some((candidate) =>
          isPapCandidateForCategory(candidate, "report-schedule")
        )) break;
      }
    }

    candidates = uniqueBy([...candidates, ...(cached ?? [])], (candidate) => candidate.url)
      .filter((candidate) =>
        (["report-change", "report-schedule", "dividend"] as const).some((category) =>
          isPapCandidateForCategory(candidate, category)
        )
      )
      .sort((left, right) =>
        (right.sourcePublishedAt ?? "").localeCompare(left.sourcePublishedAt ?? "")
      );
    await setMarketCachePayload(cacheKey, candidates);
    return {
      status: candidates.length > 0 ? "SUCCESS" as const : "NOT_FOUND" as const,
      candidates,
    };
  })().finally(() => papDiscoveryInFlight.delete(instrument.id));

  papDiscoveryInFlight.set(instrument.id, discovery);
  return discovery;
};

const isPapDocumentForInstrument = (document: string, instrument: CanonicalInstrument) => {
  if (instrument.isin) return document.toUpperCase().includes(instrument.isin.toUpperCase());
  const normalizedDocument = normalizeText(document);
  const tokens = normalizeText(instrument.company_name)
    .split(" ")
    .filter((word) => word.length >= 4 && !["grupa", "polska", "spolka", "akcyjna", "holding"].includes(word));
  return tokens.length > 0
    ? tokens.some((token) => normalizedDocument.includes(token))
    : normalizedDocument.includes(normalizeText(instrument.ticker));
};

export class PapEspiDiscoveryCorporateEventProvider implements CorporateEventProvider {
  readonly id: string;
  private readonly category: PapDiscoveryCategory;

  constructor(category: PapDiscoveryCategory) {
    this.category = category;
    this.id = `pap-espi-discovery-${category}`;
  }

  async fetchEvents(instrument: CanonicalInstrument): Promise<ProviderResult> {
    const startedAt = Date.now();
    const discovery = await discoverPapCandidates(instrument);
    if (discovery.status !== "SUCCESS") {
      return { status: discovery.status, events: [], durationMs: Date.now() - startedAt };
    }

    const candidates = discovery.candidates.filter((candidate) =>
      isPapCandidateForCategory(candidate, this.category)
    );
    let lastFailure: ProviderResult | null = null;

    for (const candidate of candidates.slice(0, 4)) {
      const response = await fetchPapDocument(candidate.url);
      if (response.status !== "SUCCESS") {
        lastFailure = {
          status: response.status,
          events: [],
          source: { sourceType: "PAP_ESPI", sourceUrl: candidate.url },
          durationMs: Date.now() - startedAt,
        };
        continue;
      }
      if (!isPapDocumentForInstrument(response.document, instrument)) continue;

      const events = parseCorporateEventDocument(response.document).filter((event) =>
        this.category === "dividend"
          ? event.eventType === "UPCOMING_DIVIDEND"
          : event.eventType !== "UPCOMING_DIVIDEND" &&
            (this.category !== "report-change" || event.isScheduleChange)
      );
      if (events.length === 0) continue;

      return {
        status: "SUCCESS",
        events,
        source: {
          sourceType: "PAP_ESPI",
          sourceUrl: candidate.url,
          sourcePublishedAt: candidate.sourcePublishedAt,
        },
        durationMs: Date.now() - startedAt,
      };
    }

    return lastFailure ?? { status: "NOT_FOUND", events: [], durationMs: Date.now() - startedAt };
  }
}

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
      response = await fetchWithSystemTrust(source.url, {
        headers: { Accept: "text/html,application/xhtml+xml" },
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
      const response = await fetchWithSystemTrust(url, {
        headers: { Accept: "text/html,application/xhtml+xml" },
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
  new PapEspiDiscoveryCorporateEventProvider("report-change"),
  new PapEspiDiscoveryCorporateEventProvider("report-schedule"),
  new PapEspiDiscoveryCorporateEventProvider("dividend"),
];

const refreshInFlight = new Map<string, Promise<void>>();

export const getGpwCorporateEventCanonicalKey = (instrument: GpwCorporateEventInstrumentInput) => {
  // A GPW ticker is market-scoped by the eligibility check and is therefore a
  // stable bridge between legacy/imported instruments that differ only in
  // optional ISIN metadata. Never use a company name to join instruments.
  return `gpw:ticker:${getGpwTickerCore(instrument.symbol)}`;
};

export const isGpwCorporateEventInstrument = (instrument: GpwCorporateEventInstrumentInput) =>
  instrument.assetKind === "stock" &&
  instrument.marketCurrency === "PLN" &&
  isGpwSymbol(instrument.symbol);

const getCanonicalInstrument = async (input: GpwCorporateEventInstrumentInput) => {
  const canonicalKey = getGpwCorporateEventCanonicalKey(input);
  const ticker = getGpwTickerCore(input.symbol);
  const catalogEntry = input.isin ? null : await findGpwCatalogEntry(input.symbol);
  const resolvedIsin = input.isin?.trim().toUpperCase() || catalogEntry?.isin || null;
  const now = new Date().toISOString();
  const id = `corporate-event-instrument:${canonicalKey}`;

  // Prefer a current ticker-keyed record, but reuse an older ISIN-keyed
  // record for the same exchange ticker instead of creating a second refresh
  // target. This is the bounded, market-scoped migration bridge for already
  // stored Corporate Events; it never merges by issuer name.
  const existing = await queryOne<CanonicalInstrument>(
    `
      SELECT id, canonical_key, ticker, company_name, isin, last_checked_at, last_source_status
      FROM corporate_event_instruments
      WHERE market = 'GPW' AND ticker = $1
      ORDER BY CASE WHEN canonical_key = $2 THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1
    `,
    [ticker, canonicalKey]
  );

  if (existing) {
    await query(
      `
        UPDATE corporate_event_instruments
        SET company_name = $1,
            isin = COALESCE(isin, $2),
            updated_at = $3
        WHERE id = $4
      `,
      [input.name, resolvedIsin, now, existing.id]
    );

    return queryOne<CanonicalInstrument>(
      `
        SELECT id, canonical_key, ticker, company_name, isin, last_checked_at, last_source_status
        FROM corporate_event_instruments
        WHERE id = $1
      `,
      [existing.id]
    );
  }

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
    [id, canonicalKey, resolvedIsin, ticker, input.name, now]
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

const getParsedEventStatus = (parsed: ParsedCorporateEvent): CorporateEventStatus =>
  parsed.eventType === "UPCOMING_DIVIDEND"
    ? parsed.dividendStatus ?? "UNKNOWN"
    : parsed.isScheduleChange
      ? "CHANGED"
      : "CONFIRMED";

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
  if (existing.status === "CONFIRMED" && getParsedEventStatus(parsed) === "PROPOSED") {
    return false;
  }
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
    const eventIdentity = getCorporateEventIdentityKey(parsed);
    let existing = (
      await transaction.query<ExistingEventRow>(
        `
          SELECT id, event_date, status, source_published_at, source_priority, source_type, updated_at
          FROM corporate_events
          WHERE instrument_id = $1
            AND event_type = $2
            AND event_identity = $3
            AND active = TRUE
          FOR UPDATE
        `,
        [instrument.id, parsed.eventType, eventIdentity]
      )
    )[0];
    if (!existing && parsed.eventType === "UPCOMING_DIVIDEND") {
      const calendarYear = (
        parsed.recordDate ?? parsed.exDividendDate ?? parsed.paymentDate ?? parsed.eventDate
      ).slice(0, 4);
      existing = (
        await transaction.query<ExistingEventRow>(
          `
            SELECT event.id, event.event_date, event.status, event.source_published_at,
                   event.source_priority, event.source_type, event.updated_at
            FROM corporate_events AS event
            INNER JOIN corporate_event_sources AS source
              ON source.corporate_event_id = event.id
            WHERE event.instrument_id = $1
              AND event.event_type = 'UPCOMING_DIVIDEND'
              AND event.active = TRUE
              AND source.source_url = $2
              AND event.dividend_installment IS NOT DISTINCT FROM $3
              AND LEFT(COALESCE(event.record_date, event.ex_dividend_date, event.payment_date, event.event_date), 4) = $4
            ORDER BY event.updated_at DESC
            LIMIT 1
            FOR UPDATE OF event
          `,
          [instrument.id, result.source.sourceUrl, parsed.dividendInstallment ?? null, calendarYear]
        )
      )[0];
    }
    const now = new Date().toISOString();
    const eventId = existing?.id ?? randomUUID();
    const apply = shouldApplyEvent(existing, result.source, parsed);
    const sourceId = randomUUID();

    if (!existing) {
      await transaction.execute(
        `
          INSERT INTO corporate_events (
            id, instrument_id, event_type, event_date, event_time, fiscal_period, fiscal_year,
            event_identity, dividend_per_share, dividend_currency, ex_dividend_date, record_date,
            payment_date, dividend_installment, status, active, source_published_at, source_type,
            source_priority, discovered_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, TRUE, $16, $17, $18, $19, $19)
        `,
        [
          eventId,
          instrument.id,
          parsed.eventType,
          parsed.eventDate,
          parsed.eventTime ?? null,
          parsed.fiscalPeriod ?? null,
          parsed.fiscalYear ?? null,
          eventIdentity,
          parsed.dividendPerShare ?? null,
          parsed.dividendCurrency ?? null,
          parsed.exDividendDate ?? null,
          parsed.recordDate ?? null,
          parsed.paymentDate ?? null,
          parsed.dividendInstallment ?? null,
          getParsedEventStatus(parsed),
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
              fiscal_period = $3,
              fiscal_year = $4,
              event_identity = $5,
              dividend_per_share = $6,
              dividend_currency = $7,
              ex_dividend_date = $8,
              record_date = $9,
              payment_date = $10,
              dividend_installment = $11,
              status = $12,
              source_published_at = $13,
              source_type = $14,
              source_priority = $15,
              updated_at = $16
          WHERE id = $17
        `,
        [
          parsed.eventDate,
          parsed.eventTime ?? null,
          parsed.fiscalPeriod ?? null,
          parsed.fiscalYear ?? null,
          eventIdentity,
          parsed.dividendPerShare ?? null,
          parsed.dividendCurrency ?? null,
          parsed.exDividendDate ?? null,
          parsed.recordDate ?? null,
          parsed.paymentDate ?? null,
          parsed.dividendInstallment ?? null,
          getParsedEventStatus(parsed),
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
  dividendPerShare: row.dividend_per_share ?? undefined,
  dividendCurrency: row.dividend_currency ?? undefined,
  exDividendDate: row.ex_dividend_date ?? undefined,
  recordDate: row.record_date ?? undefined,
  paymentDate: row.payment_date ?? undefined,
  dividendInstallment: row.dividend_installment ?? undefined,
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

const getStoredEvents = async (
  instrumentIds: string[],
  fromDate: string,
  toDate: string,
  eventTypes?: CorporateEventType[]
) => {
  if (instrumentIds.length === 0) return [];
  const rows = await query<EventRow>(
    `
      SELECT event.id, event.instrument_id, instrument.ticker, instrument.company_name,
             event.event_type, event.event_date, event.event_time, event.fiscal_period,
             event.fiscal_year, event.dividend_per_share, event.dividend_currency,
             event.ex_dividend_date, event.record_date, event.payment_date,
             event.dividend_installment, event.status, event.active, event.source_published_at,
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
        AND ($4::text[] IS NULL OR event.event_type = ANY($4::text[]))
        AND (
          (event.event_date >= $2 AND event.event_date <= $3)
          OR (
            event.event_type = 'UPCOMING_DIVIDEND'
            AND event.payment_date >= $2
            AND event.payment_date <= $3
          )
        )
      ORDER BY event.event_date ASC, instrument.company_name ASC
    `,
    [instrumentIds, fromDate, toDate, eventTypes ?? null]
  );
  return rows.map(toCorporateEvent);
};

export const getCorporateEventsForGpwPortfolio = async ({
  instruments,
  fromDate,
  toDate,
  forceRefresh = false,
  eventTypes,
}: {
  instruments: GpwCorporateEventInstrumentInput[];
  fromDate: string;
  toDate: string;
  forceRefresh?: boolean;
  eventTypes?: CorporateEventType[];
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
      toDate,
      eventTypes
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

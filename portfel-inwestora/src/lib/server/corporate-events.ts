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
  getDividendAmendmentEvidence,
  getStatutoryMeetingRegistrationDate,
  isNonBindingDividendDraftNotice,
  isCorporateEventSourceUnavailable,
  parseCorporateEventDocument,
  type ParsedCorporateEvent,
} from "@/lib/corporate-events";
import { getGpwTickerCore, isGpwSymbol, normalizeGpwSymbol } from "@/lib/ticker";
import { execute, query, queryOne, withTransaction, type DatabaseTransaction } from "@/lib/server/db";
import {
  getGpwDividendSyncState,
  getStoredEspiReportsForCorporateEvents,
  getGpwGeneralMeetingSyncState,
  getGpwReportScheduleSyncState,
  PAP_ESPI_FEED_URL,
  synchronizeGpwDividendReports,
  synchronizeGpwGeneralMeetingReports,
  synchronizeGpwReportScheduleReports,
  resolveStoredGpwIssuer,
  type GpwGeneralMeetingSourceSyncResult,
  type StoredEspiCorporateEventReport,
} from "@/lib/server/espi";
import { findGpwCatalogEntry } from "@/lib/server/gpw-catalog";
import { getMarketCachePayload, setMarketCachePayload } from "@/lib/server/market-cache";
import { fetchWithSystemTrust } from "@/lib/server/system-trust-fetch";
import { readOfficialMeetingPdf } from "@/lib/server/general-meeting-pdf";
import { normalizeText, uniqueBy } from "@/lib/utils";
import { planReportScheduleReprojection, type StoredReportProjection } from "@/lib/report-schedule-reprojection";
import {
  isDividendReportSuperseded,
  planDividendFinalResolution,
  planDividendRejectedAmendment,
  planDividendSourceReprojection,
  type StoredDividendProjection,
} from "@/lib/dividend-reprojection";
import type { PortfolioInstrument } from "@/types/portfolio";

const EVENT_REFRESH_TTL_MS = 24 * 60 * 60 * 1_000;
const UNAVAILABLE_RETRY_TTL_MS = 60 * 60 * 1_000;
const SOURCE_TIMEOUT_MS = 12_000;
const PAP_DISCOVERY_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1_000;
const PAP_TAXONOMY_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const PAP_MAX_ISSUER_PAGES = 6;
const PAP_BASE_URL = "https://pap-mediaroom.pl";

export type GpwCorporateEventInstrumentInput = Pick<
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
  fiscal_year_label: string | null;
  period_start: string | null;
  period_end: string | null;
  general_meeting_type: "ZWZ" | "NWZ" | null;
  registration_date: string | null;
  registration_date_source: "OFFICIAL" | null;
  dividend_per_share: number | null;
  dividend_total_per_share: number | null;
  dividend_advance_per_share: number | null;
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
  source_title: string | null;
  sources_json: CorporateEventSourceReference[] | string | null;
};

type ExistingEventRow = Pick<
  EventRow,
  | "id"
  | "event_date"
  | "record_date"
  | "status"
  | "source_published_at"
  | "source_type"
  | "updated_at"
  | "active"
  | "general_meeting_type"
> & {
  source_priority: number;
  event_identity: string;
};

type IssuerSource = {
  type: CorporateEventSourceType;
  url: string;
};

type ProviderEventBatch = {
  source: CorporateEventSourceReference;
  events: ParsedCorporateEvent[];
};

type ProviderResult = {
  status: CorporateEventSourceStatus;
  source?: CorporateEventSourceReference;
  events: ParsedCorporateEvent[];
  batches?: ProviderEventBatch[];
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
      type: "ISSUER_CURRENT_REPORT",
      url: "https://www.lpp.com/raporty/rb-01-2026-terminy-publikacji-raportow-okresowych-w-2026-roku/",
    },
    {
      type: "ISSUER_CURRENT_REPORT",
      url: "https://www.lpp.com/raporty/rb-16-2026-informacja-na-temat-dywidendy/",
    },
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
    {
      type: "ISSUER_CURRENT_REPORT",
      url: "https://grupakety.com/raporty_biezace/rejestracja-akcji-serii-l-w-depozycie-papierow-wartosciowych-i-podwyzszenie-kapitalu-zakladowego-spolki-oraz-aktualizacja-informacji-o-liczbie-akcji-objetych-uchwalona-przez-zwyczajne-walne-zgromadzen/",
    },
  ],
};

const sourcePriority = (
  sourceType: CorporateEventSourceType,
  isChange: boolean,
  isCancellation = false
) => {
  // A formal cancellation must win over an earlier convening or reschedule.
  // Publication timestamps still protect the record from an older notice.
  if (isCancellation) return 500;
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
  const structuredCandidate = text.match(
    /(?:"datePublished"\s*:\s*"|property=["']article:published_time["'][^>]*content=["'])([^"']+)/i
  )?.[1];
  const structuredTimestamp = structuredCandidate ? Date.parse(structuredCandidate) : Number.NaN;
  if (Number.isFinite(structuredTimestamp)) return new Date(structuredTimestamp).toISOString();

  const readableText = text
    .replace(/<(?:br|\/p|\/div|\/li|\/time)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ");
  const candidate = readableText.match(
    /(?:data publikacji|opublikowano)\s*:?\s*([^\n]{0,64})/i
  )?.[1] ?? readableText.match(/(?:^|\n)\s*data\s*:?\s*([^\n]{0,48})/i)?.[1];
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
  readonly id: string;
  private readonly sourceIndex: number;

  constructor(sourceIndex = 0) {
    this.sourceIndex = sourceIndex;
    this.id = `gpw-issuer-ir-${sourceIndex}`;
  }

  async fetchEvents(instrument: CanonicalInstrument): Promise<ProviderResult> {
    const source = GPW_ISSUER_SOURCE_REGISTRY[instrument.ticker]?.[this.sourceIndex];

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

/**
 * WZA uses a dedicated, shared GPW list lane. It persists only official report
 * details whose parsed content is a general-meeting notice, so the calendar
 * doesn't wait for the full ESPI archive to fetch unrelated report bodies.
 */
export class StoredPapEspiGeneralMeetingProvider implements CorporateEventProvider {
  id = "stored-pap-espi-general-meeting";

  async fetchEvents(instrument: CanonicalInstrument): Promise<ProviderResult> {
    const startedAt = Date.now();
    let synchronization: GpwGeneralMeetingSourceSyncResult;
    let reports: StoredEspiCorporateEventReport[];

    try {
      synchronization = await synchronizeGpwGeneralMeetingReports();
      reports = await getStoredEspiReportsForCorporateEvents({ instrumentId: instrument.id });
    } catch {
      return {
        status: "TEMPORARILY_UNAVAILABLE",
        events: [],
        source: { sourceType: "PAP_ESPI", sourceUrl: PAP_ESPI_FEED_URL },
        durationMs: Date.now() - startedAt,
      };
    }

    const batches = reports
      // Apply the public notices chronologically. Source timestamps provide a
      // second deterministic guard against a stale report winning later.
      .sort((left, right) => left.publishedAt.localeCompare(right.publishedAt))
      .flatMap((report): ProviderEventBatch[] => {
        const events = parseCorporateEventDocument(`${report.title}\n${report.body}`)
          .filter((event) => event.eventType === "GENERAL_MEETING");
        return events.length === 0
          ? []
          : [{
              events,
              source: {
                sourceType: "PAP_ESPI",
                sourceUrl: report.sourceUrl,
                sourcePublishedAt: report.publishedAt,
              },
            }];
      });

    if (batches.length > 0) {
      return {
        status: "SUCCESS",
        events: batches.flatMap((batch) => batch.events),
        batches,
        source: { sourceType: "PAP_ESPI", sourceUrl: PAP_ESPI_FEED_URL },
        durationMs: Date.now() - startedAt,
      };
    }

    return {
      status: isCorporateEventSourceUnavailable(synchronization.status)
        ? synchronization.status
        : "NOT_FOUND",
      events: [],
      source: { sourceType: "PAP_ESPI", sourceUrl: PAP_ESPI_FEED_URL },
      durationMs: Date.now() - startedAt,
    };
  }
}

const defaultProviders: CorporateEventProvider[] = [
  new GpwIssuerIrCorporateEventProvider(0),
  new GpwIssuerIrCorporateEventProvider(1),
  new PapEspiDiscoveryCorporateEventProvider("report-change"),
  new PapEspiDiscoveryCorporateEventProvider("report-schedule"),
  new PapEspiDiscoveryCorporateEventProvider("dividend"),
  new StoredPapEspiGeneralMeetingProvider(),
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

const getGeneralMeetingBootstrapInstrumentIds = async (instrumentIds: string[]) => {
  if (instrumentIds.length === 0) return new Set<string>();

  const rows = await query<{ instrument_id: string }>(
    `
      SELECT instrument_id
      FROM corporate_event_source_checks
      WHERE instrument_id = ANY($1::text[])
        AND source_type = 'PAP_ESPI'
        AND source_url = $2
    `,
    [instrumentIds, PAP_ESPI_FEED_URL]
  );

  return new Set(rows.map((row) => row.instrument_id));
};

const toSourcePriority = (source: CorporateEventSourceReference, parsed: ParsedCorporateEvent) =>
  sourcePriority(source.sourceType, parsed.isScheduleChange, parsed.isCancellation);

const getParsedEventStatus = (parsed: ParsedCorporateEvent): CorporateEventStatus =>
  parsed.isCancellation
    ? "CANCELLED"
    : parsed.eventType === "UPCOMING_DIVIDEND"
    ? parsed.dividendStatus ?? "UNKNOWN"
    : parsed.isScheduleChange
      ? "CHANGED"
      : "CONFIRMED";

const isParsedEventActive = (parsed: ParsedCorporateEvent) => !parsed.isCancellation;

const sourceTimestamp = (value: string | undefined | null) => {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const shouldApplyEvent = (
  existing: ExistingEventRow | undefined,
  source: CorporateEventSourceReference,
  parsed: ParsedCorporateEvent,
  sameSourceReprojection = false
) => {
  if (!existing) return true;
  const incomingTimestamp = sourceTimestamp(source.sourcePublishedAt);
  const existingTimestamp = sourceTimestamp(existing.source_published_at);

  if (parsed.isCancellation) {
    // Official cancellation is the terminal state for this publication
    // sequence. When both reports are dated, an older cancellation cannot
    // override a newer reconvening/change.
    return incomingTimestamp === 0 || existingTimestamp === 0 || incomingTimestamp >= existingTimestamp;
  }
  if (existing.status === "CANCELLED") {
    // A later formal notice may legitimately convene the meeting again, but a
    // stale schedule discovered during backfill must never resurrect it.
    return incomingTimestamp > 0 && (
      incomingTimestamp > existingTimestamp ||
      (sameSourceReprojection && incomingTimestamp === existingTimestamp)
    );
  }
  if (existing.status === "CONFIRMED" && getParsedEventStatus(parsed) === "PROPOSED") {
    return false;
  }
  const incomingPriority = toSourcePriority(source, parsed);
  const incomingIsChange = parsed.isScheduleChange;
  const existingIsChange = existing.status === "CHANGED";

  if (incomingIsChange) {
    // A change notice supersedes a schedule, but one undated change must not
    // randomly overwrite another changed date. We only replace a prior change
    // when the source establishes that it is at least as recent.
    return !existingIsChange ||
      (incomingTimestamp > 0 && incomingTimestamp >= existingTimestamp);
  }

  if (existingIsChange) {
    return incomingTimestamp > 0 && incomingTimestamp >= existingTimestamp;
  }
  if (
    (parsed.eventType === "QUARTERLY_REPORT" || parsed.eventType === "HALF_YEAR_REPORT" || parsed.eventType === "ANNUAL_REPORT") &&
    existing.source_type === "ISSUER_IR" && source.sourceType === "PAP_ESPI" &&
    incomingTimestamp > existingTimestamp
  ) {
    // A dated formal issuer communication syndicated by PAP beats an older,
    // generic IR page even when that page has a higher base adapter priority.
    return true;
  }
  if (
    incomingPriority > existing.source_priority &&
    (incomingTimestamp === 0 || existingTimestamp === 0)
  ) {
    return true;
  }
  return incomingTimestamp >= existingTimestamp && incomingPriority >= existing.source_priority;
};

const upsertParsedEvents = async (
  transaction: DatabaseTransaction,
  instrument: CanonicalInstrument,
  batch: ProviderEventBatch
) => {
  if (batch.events.length === 0) return { created: 0, duplicates: 0, saved: 0 };

  let created = 0;
  let duplicates = 0;
  let saved = 0;

  for (const parsed of batch.events) {
    const eventIdentity = getCorporateEventIdentityKey(parsed);
    let existing: ExistingEventRow | undefined = (
      await transaction.query<ExistingEventRow>(
        `
          SELECT id, event_date, record_date, status, source_published_at, source_priority,
                 source_type, updated_at, active, general_meeting_type, event_identity
          FROM corporate_events
          WHERE instrument_id = $1
            AND event_type = $2
            AND event_identity = $3
            AND ($2 IN ('GENERAL_MEETING', 'UPCOMING_DIVIDEND') OR active = TRUE)
          ORDER BY active DESC, updated_at DESC
          LIMIT 1
          FOR UPDATE
        `,
        [instrument.id, parsed.eventType, eventIdentity]
      )
    )[0];
    if (!existing && (parsed.eventType === "QUARTERLY_REPORT" || parsed.eventType === "HALF_YEAR_REPORT" || parsed.eventType === "ANNUAL_REPORT") &&
      parsed.fiscalYearLabel?.includes("/") && parsed.fiscalYear) {
      // Older projections used only the last numeric year. Reuse their row ID
      // (and therefore ICS UID) only when this very source owned the legacy row.
      const legacyIdentity = [parsed.eventType, parsed.fiscalPeriod ?? "", parsed.fiscalYear].join(":");
      existing = (
        await transaction.query<ExistingEventRow>(
          `SELECT event.id, event.event_date, event.record_date, event.status, event.source_published_at,
                  event.source_priority, event.source_type, event.updated_at,
                  event.active, event.general_meeting_type, event.event_identity
           FROM corporate_events AS event
           JOIN corporate_event_sources AS provenance ON provenance.corporate_event_id = event.id
           WHERE event.instrument_id = $1 AND event.event_type = $2
             AND event.event_identity = $3 AND event.active = TRUE
             AND provenance.source_url = $4
           ORDER BY event.updated_at DESC LIMIT 1 FOR UPDATE OF event`,
          [instrument.id, parsed.eventType, legacyIdentity, batch.source.sourceUrl]
        )
      )[0];
    }
    if (!existing && parsed.eventType === "UPCOMING_DIVIDEND") {
      const calendarYear = (
        parsed.recordDate ?? parsed.exDividendDate ?? parsed.paymentDate ?? parsed.eventDate
      ).slice(0, 4);
      existing = (
        await transaction.query<ExistingEventRow>(
          `
            SELECT event.id, event.event_date, event.record_date, event.status, event.source_published_at,
                   event.source_priority, event.source_type, event.updated_at,
                   event.active, event.general_meeting_type, event.event_identity
            FROM corporate_events AS event
            INNER JOIN corporate_event_sources AS source
              ON source.corporate_event_id = event.id
            WHERE event.instrument_id = $1
              AND event.event_type = 'UPCOMING_DIVIDEND'
              AND event.active = TRUE
              AND event.dividend_installment IS NOT DISTINCT FROM $2
              AND LEFT(COALESCE(event.record_date, event.ex_dividend_date, event.payment_date, event.event_date), 4) = $3
              AND (event.record_date IS NOT DISTINCT FROM $4 OR event.payment_date IS NOT DISTINCT FROM $5)
            ORDER BY event.updated_at DESC
            LIMIT 1
            FOR UPDATE OF event
          `,
          [instrument.id, parsed.dividendInstallment ?? null, calendarYear, parsed.recordDate ?? null, parsed.paymentDate ?? null]
        )
      )[0];
    }
    if (!existing && parsed.eventType === "GENERAL_MEETING") {
      const candidates = await transaction.query<ExistingEventRow>(
        `
          SELECT id, event_date, record_date, status, source_published_at, source_priority,
                 source_type, updated_at, active, general_meeting_type, event_identity
          FROM corporate_events
          WHERE instrument_id = $1
            AND event_type = 'GENERAL_MEETING'
            AND event_date = ANY($2::text[])
            AND (
              $3::text IS NULL
              OR general_meeting_type = $3
              OR general_meeting_type IS NULL
            )
          ORDER BY
            CASE WHEN general_meeting_type = $3 THEN 0 ELSE 1 END,
            active DESC,
            updated_at DESC
          LIMIT 2
          FOR UPDATE
        `,
        [
          instrument.id,
          Array.from(new Set(
            [parsed.previousEventDate, parsed.eventDate]
              .filter((date): date is string => Boolean(date))
          )),
          parsed.generalMeetingType ?? null,
        ]
      );
      // Without a meeting type, a shared date may be ambiguous. Do not merge
      // two independent meetings merely because their dates coincide.
      existing = parsed.generalMeetingType || candidates.length === 1
        ? candidates[0]
        : undefined;
    }
    const effectiveEventDate = parsed.eventType === "UPCOMING_DIVIDEND" &&
      !parsed.recordDate && existing?.record_date ? existing.record_date : parsed.eventDate;
    const now = new Date().toISOString();
    const eventId = existing?.id ?? randomUUID();
    const sameSourceReprojection = existing?.status === "CANCELLED" && (
      await transaction.query<{ source_url: string }>(
        `SELECT source_url FROM corporate_event_sources
         WHERE corporate_event_id = $1 AND source_url = $2 LIMIT 1`,
        [eventId, batch.source.sourceUrl]
      )
    ).length > 0;
    const apply = shouldApplyEvent(existing, batch.source, parsed, sameSourceReprojection);
    const sourceId = randomUUID();

    if (!existing) {
      created += 1;
      await transaction.execute(
        `
          INSERT INTO corporate_events (
            id, instrument_id, event_type, event_date, event_time, fiscal_period, fiscal_year,
            event_identity, general_meeting_type, registration_date,
            dividend_per_share, dividend_total_per_share, dividend_advance_per_share,
            dividend_currency, ex_dividend_date, record_date, payment_date, dividend_installment, status, active, source_published_at, source_type,
            source_priority, discovered_at, updated_at, registration_date_source
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $24, $25)
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
          parsed.generalMeetingType ?? null,
          parsed.registrationDate ?? null,
          parsed.dividendPerShare ?? null,
          parsed.dividendTotalPerShare ?? null,
          parsed.dividendAdvancePerShare ?? null,
          parsed.dividendCurrency ?? null,
          parsed.exDividendDate ?? null,
          parsed.recordDate ?? null,
          parsed.paymentDate ?? null,
          parsed.dividendInstallment ?? null,
          getParsedEventStatus(parsed),
          isParsedEventActive(parsed),
          batch.source.sourcePublishedAt ?? null,
          batch.source.sourceType,
          toSourcePriority(batch.source, parsed),
          now,
          parsed.registrationDate ? "OFFICIAL" : null,
        ]
      );
    } else if (apply) {
      duplicates += 1;
      await transaction.execute(
        `
          UPDATE corporate_events
          SET event_date = CASE WHEN event_type = 'UPCOMING_DIVIDEND'
              AND $13::text IS NULL AND record_date IS NOT NULL THEN record_date ELSE $1 END,
              event_time = COALESCE($2, event_time),
              fiscal_period = COALESCE($3, fiscal_period),
              fiscal_year = COALESCE($4, fiscal_year),
              event_identity = $5,
              general_meeting_type = COALESCE($6, general_meeting_type),
              registration_date = CASE
                WHEN $7::text IS NOT NULL THEN $7
                WHEN event_date IS DISTINCT FROM $1 THEN NULL
                WHEN registration_date_source = 'OFFICIAL' THEN registration_date
                ELSE NULL
              END,
              registration_date_source = CASE
                WHEN $7::text IS NOT NULL THEN 'OFFICIAL'
                WHEN event_date IS DISTINCT FROM $1 THEN NULL
                WHEN registration_date_source = 'OFFICIAL' THEN 'OFFICIAL'
                ELSE NULL
              END,
              dividend_per_share = COALESCE($8, dividend_per_share),
              dividend_total_per_share = COALESCE($9, dividend_total_per_share),
              dividend_advance_per_share = COALESCE($10, dividend_advance_per_share),
              dividend_currency = COALESCE($11, dividend_currency),
              ex_dividend_date = COALESCE($12, ex_dividend_date),
              record_date = COALESCE($13, record_date),
              payment_date = COALESCE($14, payment_date),
              dividend_installment = COALESCE($15, dividend_installment),
              status = $16,
              active = $17,
              source_published_at = $18,
              source_type = $19,
              source_priority = $20,
              updated_at = $21
          WHERE id = $22
        `,
        [
          parsed.eventDate,
          parsed.eventTime ?? null,
          parsed.fiscalPeriod ?? null,
          parsed.fiscalYear ?? null,
          parsed.fiscalYearLabel?.includes("/") ? eventIdentity : existing.event_identity || eventIdentity,
          parsed.generalMeetingType ?? null,
          parsed.registrationDate ?? null,
          parsed.dividendPerShare ?? null,
          parsed.dividendTotalPerShare ?? null,
          parsed.dividendAdvancePerShare ?? null,
          parsed.dividendCurrency ?? null,
          parsed.exDividendDate ?? null,
          parsed.recordDate ?? null,
          parsed.paymentDate ?? null,
          parsed.dividendInstallment ?? null,
          getParsedEventStatus(parsed),
          isParsedEventActive(parsed),
          batch.source.sourcePublishedAt ?? null,
          batch.source.sourceType,
          toSourcePriority(batch.source, parsed),
          now,
          eventId,
        ]
      );
    } else {
      duplicates += 1;
    }

    if (apply && (parsed.eventType === "QUARTERLY_REPORT" || parsed.eventType === "HALF_YEAR_REPORT" || parsed.eventType === "ANNUAL_REPORT")) {
      await transaction.execute(
        `UPDATE corporate_events SET fiscal_year_label = COALESCE($2, fiscal_year_label),
                 period_start = COALESCE($3, period_start), period_end = COALESCE($4, period_end)
         WHERE id = $1 AND (fiscal_year_label IS DISTINCT FROM COALESCE($2, fiscal_year_label)
           OR period_start IS DISTINCT FROM COALESCE($3, period_start)
           OR period_end IS DISTINCT FROM COALESCE($4, period_end))`,
        [eventId, parsed.fiscalYearLabel ?? null, parsed.periodStart ?? null, parsed.periodEnd ?? null]
      );
    }

    await transaction.execute(
      `
        INSERT INTO corporate_event_sources (
          id, corporate_event_id, source_type, source_url, source_published_at, source_priority,
          source_title, confirms_amount, confirms_record_date, confirms_payment_date,
          confirms_status, discovered_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (corporate_event_id, source_url) DO UPDATE
        SET source_published_at = COALESCE(EXCLUDED.source_published_at, corporate_event_sources.source_published_at),
            source_priority = GREATEST(corporate_event_sources.source_priority, EXCLUDED.source_priority),
            source_title = COALESCE(EXCLUDED.source_title, corporate_event_sources.source_title),
            confirms_amount = corporate_event_sources.confirms_amount OR EXCLUDED.confirms_amount,
            confirms_record_date = corporate_event_sources.confirms_record_date OR EXCLUDED.confirms_record_date,
            confirms_payment_date = corporate_event_sources.confirms_payment_date OR EXCLUDED.confirms_payment_date,
            confirms_status = corporate_event_sources.confirms_status OR EXCLUDED.confirms_status
      `,
      [
        sourceId,
        eventId,
        batch.source.sourceType,
        batch.source.sourceUrl,
        batch.source.sourcePublishedAt ?? null,
        toSourcePriority(batch.source, parsed),
        batch.source.sourceTitle ?? null,
        parsed.dividendPerShare !== undefined,
        parsed.recordDate !== undefined,
        parsed.paymentDate !== undefined,
        getParsedEventStatus(parsed) !== "UNKNOWN",
        now,
      ]
    );

    if (existing && apply && existing.event_date !== effectiveEventDate) {
      await transaction.execute(
        `
          INSERT INTO corporate_event_history (
            id, corporate_event_id, previous_event_date, next_event_date, source_url, detected_at
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [randomUUID(), eventId, existing.event_date, effectiveEventDate, batch.source.sourceUrl, now]
      );
    }
    saved += 1;
  }

  const completeInstallmentGroups = new Map<number, string[]>();
  for (const parsed of batch.events) {
    if (
      parsed.eventType !== "UPCOMING_DIVIDEND" ||
      parsed.dividendInstallment === undefined ||
      parsed.fiscalYear === undefined
    ) continue;
    completeInstallmentGroups.set(parsed.fiscalYear, [
      ...(completeInstallmentGroups.get(parsed.fiscalYear) ?? []),
      getCorporateEventIdentityKey(parsed),
    ]);
  }
  for (const [fiscalYear, identities] of completeInstallmentGroups) {
    const expectedIdentities = Array.from(new Set(identities));
    if (expectedIdentities.length < 2) continue;
    await transaction.execute(
      `
        UPDATE corporate_events
        SET active = FALSE, updated_at = $1
        WHERE instrument_id = $2
          AND event_type = 'UPCOMING_DIVIDEND'
          AND fiscal_year = $3
          AND active = TRUE
          AND event_identity = $4
      `,
      [new Date().toISOString(), instrument.id, fiscalYear, `dividend:${fiscalYear}:single`]
    );
  }
  return { created, duplicates, saved };
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
        const batches = result.batches ?? (
          result.source
            ? [{ source: result.source, events: result.events }]
            : []
        );
        for (const batch of batches) {
          await upsertParsedEvents(transaction, instrument, batch);
        }
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

const getEventSources = (row: EventRow): CorporateEventSourceReference[] => {
  const value = typeof row.sources_json === "string"
    ? JSON.parse(row.sources_json) as CorporateEventSourceReference[]
    : row.sources_json;
  return Array.isArray(value)
    ? value.map((source) => ({
        sourceType: source.sourceType,
        sourceUrl: source.sourceUrl,
        sourcePublishedAt: source.sourcePublishedAt ?? undefined,
        sourceTitle: source.sourceTitle ?? undefined,
      }))
    : [];
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
  fiscalYearLabel: row.fiscal_year_label ?? undefined,
  periodStart: row.period_start ?? undefined,
  periodEnd: row.period_end ?? undefined,
  generalMeetingType: row.general_meeting_type ?? undefined,
  registrationDate: row.event_type === "GENERAL_MEETING"
    ? row.registration_date_source === "OFFICIAL" && row.registration_date
      ? row.registration_date
      : getStatutoryMeetingRegistrationDate(row.event_date)
    : undefined,
  registrationDateSource: row.event_type === "GENERAL_MEETING"
    ? row.registration_date_source === "OFFICIAL" && row.registration_date
      ? "OFFICIAL"
      : getStatutoryMeetingRegistrationDate(row.event_date)
        ? "STATUTORY_CALCULATION"
        : "UNKNOWN"
    : undefined,
  registrationDateConflict: row.event_type === "GENERAL_MEETING" && row.registration_date_source === "OFFICIAL" && !!row.registration_date
    ? row.registration_date !== getStatutoryMeetingRegistrationDate(row.event_date)
    : undefined,
  dividendPerShare: row.dividend_per_share ?? undefined,
  dividendTotalPerShare: row.dividend_total_per_share ?? undefined,
  dividendAdvancePerShare: row.dividend_advance_per_share ?? undefined,
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
          sourceTitle: row.source_title ?? undefined,
        }
      : undefined,
  sources: getEventSources(row),
});

const getStoredEvents = async (
  instrumentIds: string[] | null,
  fromDate: string,
  toDate: string,
  eventTypes?: CorporateEventType[]
) => {
  if (instrumentIds && instrumentIds.length === 0) return [];
  const rows = await query<EventRow>(
    `
      SELECT event.id, event.instrument_id, instrument.ticker, instrument.company_name,
             event.event_type, event.event_date, event.event_time, event.fiscal_period,
             event.fiscal_year, event.fiscal_year_label, event.period_start, event.period_end,
             event.general_meeting_type, event.registration_date,
             event.registration_date_source,
             event.dividend_per_share, event.dividend_total_per_share,
             event.dividend_advance_per_share, event.dividend_currency,
             event.ex_dividend_date, event.record_date, event.payment_date,
             event.dividend_installment, event.status, event.active, event.source_published_at,
             event.discovered_at, event.updated_at,
             source.source_type, source.source_url, source.source_title,
             source.source_published_at AS source_source_published_at,
             source_list.sources_json
      FROM corporate_events AS event
      INNER JOIN corporate_event_instruments AS instrument ON instrument.id = event.instrument_id
      LEFT JOIN LATERAL (
        SELECT source_type, source_url, source_published_at, source_title
        FROM corporate_event_sources
        WHERE corporate_event_id = event.id
          AND NOT (
            event.event_type = 'GENERAL_MEETING'
            AND source_url ~* '[?&]title=(opinia|stanowisko)'
          )
        ORDER BY
          (confirms_amount::int + confirms_record_date::int + confirms_payment_date::int + confirms_status::int) DESC,
          CASE WHEN event.event_type IN ('QUARTERLY_REPORT', 'HALF_YEAR_REPORT', 'ANNUAL_REPORT')
            THEN source_published_at END DESC NULLS LAST,
          source_priority DESC, source_published_at DESC NULLS LAST, discovered_at DESC
        LIMIT 1
      ) AS source ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'sourceType', ranked.source_type,
            'sourceUrl', ranked.source_url,
            'sourcePublishedAt', ranked.source_published_at,
            'sourceTitle', ranked.source_title
          )
          ORDER BY ranked.evidence_count DESC, ranked.source_priority DESC,
                   ranked.source_published_at DESC NULLS LAST, ranked.discovered_at DESC
        ) AS sources_json
        FROM (
          SELECT source_type, source_url, source_published_at, source_title,
                 source_priority, discovered_at,
                 confirms_amount::int + confirms_record_date::int +
                 confirms_payment_date::int + confirms_status::int AS evidence_count
          FROM corporate_event_sources
          WHERE corporate_event_id = event.id
        ) AS ranked
      ) AS source_list ON TRUE
      WHERE ($1::text[] IS NULL OR event.instrument_id = ANY($1::text[]))
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

type GlobalGeneralMeetingReportRow = {
  id: string;
  source_id: string;
  issuer_id: string | null;
  issuer_name: string;
  source_isin: string | null;
  source_ticker: string | null;
  source_title: string;
  title: string;
  body_text: string;
  published_at: string;
  source_url: string;
  projection_status: string | null;
  canonical_key: string | null;
  ticker: string | null;
  company_name: string | null;
  isin: string | null;
  last_checked_at: string | null;
  last_source_status: CorporateEventSourceStatus | null;
};

const getProjectionInstrument = async (report: GlobalGeneralMeetingReportRow): Promise<CanonicalInstrument | null> => {
  if (report.issuer_id && report.canonical_key && report.ticker && report.company_name) {
    return { id: report.issuer_id, canonical_key: report.canonical_key, ticker: report.ticker,
      company_name: report.company_name, isin: report.isin,
      last_checked_at: report.last_checked_at, last_source_status: report.last_source_status };
  }
  const issuer = await resolveStoredGpwIssuer({ id: report.id, issuerName: report.issuer_name,
    sourceIsin: report.source_isin, sourceTicker: report.source_ticker });
  return issuer ? { id: issuer.id, canonical_key: issuer.canonical_key, ticker: issuer.ticker,
    company_name: issuer.company_name, isin: issuer.isin,
    last_checked_at: null, last_source_status: null } : null;
};

export type GlobalGeneralMeetingSyncResult = {
  fetched: number;
  created: number;
  duplicates: number;
  saved: number;
  unmatched: number;
  errors: number;
  pending: number;
};

// Re-evaluate previously successful documents after fixing wrapped PDF rows.
const REPORT_SCHEDULE_PROJECTION_VERSION = 5;
const REPORT_SCHEDULE_BATCH_SIZE = 100;
const REPORT_SCHEDULE_UNMATCHED_RETRY_MS = 7 * 24 * 60 * 60 * 1_000;
const REPORT_SCHEDULE_CANDIDATE_SQL = `(
  report.source_title ILIKE '%termin%raport%' OR report.title ILIKE '%termin%raport%'
  OR report.source_title ILIKE '%raport%termin%' OR report.title ILIKE '%raport%termin%'
  OR report.source_title ILIKE '%harmonogram%raport%' OR report.title ILIKE '%harmonogram%raport%'
  OR report.source_title ILIKE '%kalendarz%raport%' OR report.title ILIKE '%kalendarz%raport%'
  OR report.source_title ILIKE '%dat%publikacj%raport%' OR report.title ILIKE '%dat%publikacj%raport%'
  OR report.source_title ILIKE '%dat%przekazywan%raport%' OR report.title ILIKE '%dat%przekazywan%raport%'
  OR report.source_title ILIKE '%termin%przekazywan%raport%' OR report.title ILIKE '%termin%przekazywan%raport%'
)`;

let globalReportScheduleSyncInFlight: Promise<GlobalGeneralMeetingSyncResult> | null = null;

const updateReportScheduleProjectionStatus = (
  reportId: string,
  status: "SUCCESS" | "NO_EVENT" | "UNMATCHED" | "PARSE_ERROR"
) => execute(
  `UPDATE espi_reports
   SET report_schedule_projection_status = $1,
       report_schedule_projected_at = $2,
       report_schedule_projection_version = $3
   WHERE id = $4`,
  [status, new Date().toISOString(), REPORT_SCHEDULE_PROJECTION_VERSION, reportId]
);

/** Projects official annual schedules once globally; private holdings never affect ingestion. */
export const synchronizeGlobalReportSchedules = ({ force = false, refreshSource = true }: {
  force?: boolean;
  refreshSource?: boolean;
} = {}): Promise<GlobalGeneralMeetingSyncResult> => {
  if (globalReportScheduleSyncInFlight) return globalReportScheduleSyncInFlight;
  globalReportScheduleSyncInFlight = (async () => {
    if (refreshSource) await synchronizeGpwReportScheduleReports();
    const publishedAfter = new Date(Date.now() - 730 * 24 * 60 * 60 * 1_000).toISOString();
    const unmatchedRetryBefore = new Date(Date.now() - REPORT_SCHEDULE_UNMATCHED_RETRY_MS).toISOString();
    const candidateWhere = `
      report.source = 'PAP_ESPI' AND report.published_at >= $1
      AND report.source_id NOT LIKE 'newconnect:%' AND report.market IS DISTINCT FROM 'NEWCONNECT'
      AND (instrument.market = 'GPW' OR (instrument.id IS NULL AND report.market IN ('GPW', 'UNKNOWN')))
      AND ${REPORT_SCHEDULE_CANDIDATE_SQL}`;
    const pendingWhere = `(
      report.report_schedule_projection_version IS DISTINCT FROM $2
      OR report.report_schedule_projection_status = 'PARSE_ERROR'
      OR (report.report_schedule_projection_status = 'UNMATCHED'
          AND report.report_schedule_projected_at < $3)
      OR $5::boolean
    )`;
    const reports = await query<GlobalGeneralMeetingReportRow>(
      `SELECT report.id, report.source_id, report.issuer_id, report.issuer_name,
              report.source_isin, report.source_ticker, report.source_title,
              report.title, report.body_text, report.published_at, report.source_url,
              report.report_schedule_projection_status AS projection_status,
              instrument.canonical_key, instrument.ticker, instrument.company_name,
              instrument.isin, instrument.last_checked_at, instrument.last_source_status
       FROM espi_reports AS report
       LEFT JOIN corporate_event_instruments AS instrument ON instrument.id = report.issuer_id
       WHERE ${candidateWhere} AND ${pendingWhere}
       ORDER BY report.published_at DESC, report.source_id DESC LIMIT $4`,
      [publishedAfter, REPORT_SCHEDULE_PROJECTION_VERSION, unmatchedRetryBefore, REPORT_SCHEDULE_BATCH_SIZE, force]
    );
    const attachmentRows = reports.length ? await query<{ espi_report_id: string; name: string; source_url: string }>(
      `SELECT espi_report_id, name, source_url FROM espi_report_attachments
       WHERE espi_report_id = ANY($1::text[])
         AND (media_type = 'application/pdf' OR name ~* '\\.pdf$')
       ORDER BY espi_report_id,
         CASE WHEN name ~* '(termin|harmonogram|raport|kalendarz)' THEN 0 ELSE 1 END, name`,
      [reports.map((report) => report.id)]
    ) : [];
    const attachmentsByReport = new Map<string, typeof attachmentRows>();
    for (const attachment of attachmentRows) {
      const list = attachmentsByReport.get(attachment.espi_report_id) ?? [];
      list.push(attachment);
      attachmentsByReport.set(attachment.espi_report_id, list);
    }
    let created = 0;
    let duplicates = 0;
    let saved = 0;
    let unmatched = 0;
    let errors = 0;
    for (const report of reports) {
      try {
        const instrument = await getProjectionInstrument(report);
        if (!instrument) {
          unmatched += 1;
          await updateReportScheduleProjectionStatus(report.id, "UNMATCHED");
          diagnose({ provider: "global-espi-report-schedule", sourceId: report.source_id, status: "UNMATCHED" });
          continue;
        }
        const parsed = parseCorporateEventDocument(`${report.source_title}\n${report.title}\n${report.body_text}`)
          .filter((event) => event.eventType === "QUARTERLY_REPORT" || event.eventType === "HALF_YEAR_REPORT" || event.eventType === "ANNUAL_REPORT");
        const events = new Map(parsed.map((event) => [
          [getCorporateEventIdentityKey(event), event.eventDate].join(":"), event,
        ]));
        const reportAttachments = attachmentsByReport.get(report.id) ?? [];
        let parseComplete = reportAttachments.length <= 3;
        for (const attachment of reportAttachments.slice(0, 3)) {
          try {
            const text = await readOfficialMeetingPdf(attachment.source_url);
            if (!text) { parseComplete = false; continue; }
            for (const event of parseCorporateEventDocument(`${report.source_title}\n${text}`)) {
              if (event.eventType !== "QUARTERLY_REPORT" && event.eventType !== "HALF_YEAR_REPORT" && event.eventType !== "ANNUAL_REPORT") continue;
              events.set([getCorporateEventIdentityKey(event), event.eventDate].join(":"), event);
            }
          } catch (error) {
            parseComplete = false;
            diagnose({ provider: "global-espi-report-schedule", sourceId: report.source_id,
              phase: "attachment", error: error instanceof Error ? error.name : "unknown" });
          }
        }
        if (events.size === 0) {
          await updateReportScheduleProjectionStatus(report.id, "NO_EVENT");
          continue;
        }
        const result = await withTransaction(async (transaction) => {
          await transaction.query<{ locked: number }>(
            "SELECT pg_advisory_xact_lock(hashtext($1)) AS locked",
            [`corporate-events:${instrument.canonical_key}`]
          );
          const oldProjections = await transaction.query<StoredReportProjection>(
            `SELECT event.id, event.event_identity, event.event_date,
                    ARRAY_AGG(DISTINCT provenance.source_url) AS source_urls
             FROM corporate_events AS event
             JOIN corporate_event_sources AS target ON target.corporate_event_id = event.id AND target.source_url = $2
             JOIN corporate_event_sources AS provenance ON provenance.corporate_event_id = event.id
             WHERE event.instrument_id = $1 AND event.active = TRUE
               AND event.event_type IN ('QUARTERLY_REPORT', 'HALF_YEAR_REPORT', 'ANNUAL_REPORT')
             GROUP BY event.id, event.event_identity, event.event_date`,
            [instrument.id, report.source_url]
          );
          const projectionPlan = planReportScheduleReprojection(
            oldProjections, [...events.values()], report.source_url, parseComplete
          );
          const upsert = await upsertParsedEvents(transaction, instrument, {
            events: [...events.values()],
            source: { sourceType: "ISSUER_CURRENT_REPORT", sourceUrl: report.source_url,
              sourcePublishedAt: report.published_at, sourceTitle: report.source_title || report.title },
          });
          if (projectionPlan.deactivateIds.length > 0) {
            await transaction.execute(
              `UPDATE corporate_events SET active = FALSE, status = 'CANCELLED', updated_at = $2
               WHERE id = ANY($1::text[]) AND active = TRUE`,
              [projectionPlan.deactivateIds, new Date().toISOString()]
            );
          }
          if (projectionPlan.ambiguousIds.length > 0 || !parseComplete) {
            diagnose({ provider: "global-espi-report-schedule", sourceId: report.source_id,
              phase: "reprojection-review", ambiguous: projectionPlan.ambiguousIds.length,
              parseComplete });
          }
          await transaction.execute(
            `UPDATE espi_reports SET report_schedule_projection_status = 'SUCCESS',
              report_schedule_projected_at = $1, report_schedule_projection_version = $2 WHERE id = $3`,
            [new Date().toISOString(), REPORT_SCHEDULE_PROJECTION_VERSION, report.id]
          );
          return upsert;
        });
        created += result.created;
        duplicates += result.duplicates;
        saved += result.saved;
      } catch (error) {
        errors += 1;
        try { await updateReportScheduleProjectionStatus(report.id, "PARSE_ERROR"); }
        catch { errors += 1; }
        diagnose({ provider: "global-espi-report-schedule", sourceId: report.source_id,
          status: "PARSE_ERROR", error: error instanceof Error ? error.name : "unknown" });
      }
    }
    const count = await queryOne<{ count: number | string }>(
      `SELECT COUNT(*) AS count FROM espi_reports AS report
       LEFT JOIN corporate_event_instruments AS instrument ON instrument.id = report.issuer_id
       WHERE ${candidateWhere} AND ${pendingWhere}`,
      [publishedAfter, REPORT_SCHEDULE_PROJECTION_VERSION, unmatchedRetryBefore, REPORT_SCHEDULE_BATCH_SIZE, false]
    );
    const pending = Number(count?.count ?? 0);
    console.info(`[REPORT SCHEDULE SYNC] fetched=${reports.length} new=${created} duplicates=${duplicates} saved=${saved} unmatched=${unmatched} pending=${pending} errors=${errors}`);
    return { fetched: reports.length, created, duplicates, saved, unmatched, errors, pending };
  })().finally(() => { globalReportScheduleSyncInFlight = null; });
  return globalReportScheduleSyncInFlight;
};

export const getGlobalReportScheduleSourceState = getGpwReportScheduleSyncState;

/** Shared GPW report board. User scope is applied only at read time. */
export const getGlobalReportSchedules = async ({
  fromDate,
  toDate,
  canonicalKeys,
}: {
  fromDate: string;
  toDate: string;
  canonicalKeys?: string[];
}) => {
  if (canonicalKeys && canonicalKeys.length === 0) return [];
  const instruments = canonicalKeys
    ? await query<{ id: string }>(
      "SELECT id FROM corporate_event_instruments WHERE market = 'GPW' AND canonical_key = ANY($1::text[])",
      [canonicalKeys]
    )
    : await query<{ id: string }>(
      "SELECT id FROM corporate_event_instruments WHERE market = 'GPW'"
    );
  if (!instruments.length) return [];
  return getStoredEvents(instruments.map(({ id }) => id), fromDate, toDate,
    ["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT"]);
};

// Re-evaluate old publications after correcting false cancellations and time parsing.
const GENERAL_MEETING_PROJECTION_VERSION = 5;
// A batch is deliberately small enough to keep the authenticated calendar API
// responsive; the versioned queue continues on the next poll until empty.
const GENERAL_MEETING_PROJECTION_BATCH_SIZE = 100;
const GENERAL_MEETING_UNMATCHED_RETRY_MS = 7 * 24 * 60 * 60 * 1_000;

let globalGeneralMeetingSyncInFlight: Promise<GlobalGeneralMeetingSyncResult> | null = null;

const updateGeneralMeetingProjectionStatus = (
  reportId: string,
  status: "SUCCESS" | "NO_EVENT" | "UNMATCHED" | "PARSE_ERROR"
) => execute(
  `
    UPDATE espi_reports
    SET corporate_events_projection_status = $1,
        corporate_events_projected_at = $2,
        corporate_events_projection_version = $3
    WHERE id = $4
  `,
  [status, new Date().toISOString(), GENERAL_MEETING_PROJECTION_VERSION, reportId]
);

/**
 * Projects the shared ESPI cache into shared WZA events. The projection is
 * deliberately global: portfolio/watchlist membership is applied only when
 * reading, never while ingesting public market data.
 */
export const synchronizeGlobalGeneralMeetings = ({
  force = false,
  refreshSource = true,
}: {
  force?: boolean;
  refreshSource?: boolean;
} = {}) => {
  if (globalGeneralMeetingSyncInFlight) return globalGeneralMeetingSyncInFlight;

  globalGeneralMeetingSyncInFlight = (async () => {
    if (refreshSource) await synchronizeGpwGeneralMeetingReports();
    const publishedAfter = new Date(Date.now() - 730 * 24 * 60 * 60 * 1_000).toISOString();
    const unmatchedRetryBefore = new Date(Date.now() - GENERAL_MEETING_UNMATCHED_RETRY_MS).toISOString();
    const reports = await query<GlobalGeneralMeetingReportRow>(
      `
        SELECT report.id, report.source_id, report.issuer_id, report.issuer_name,
               report.source_isin, report.source_ticker, report.source_title,
               report.title, report.body_text, report.published_at, report.source_url,
               report.corporate_events_projection_status AS projection_status,
               instrument.canonical_key, instrument.ticker, instrument.company_name,
               instrument.isin, instrument.last_checked_at, instrument.last_source_status
        FROM espi_reports AS report
        LEFT JOIN corporate_event_instruments AS instrument ON instrument.id = report.issuer_id
        WHERE report.source = 'PAP_ESPI'
          AND report.published_at >= $1
          AND report.source_id NOT LIKE 'newconnect:%'
          AND report.market <> 'NEWCONNECT'
          AND (instrument.market = 'GPW' OR (instrument.id IS NULL AND report.market IN ('GPW', 'UNKNOWN')))
          AND (
            report.category = 'GENERAL_MEETING'
            OR report.source_title ILIKE '%waln%zgromadz%'
            OR report.title ILIKE '%waln%zgromadz%'
            OR report.source_title ~* '(^|[^[:alnum:]])(WZA|ZWZ|NWZ|AGM|EGM)([^[:alnum:]]|$)'
            OR report.title ~* '(^|[^[:alnum:]])(WZA|ZWZ|NWZ|AGM|EGM)([^[:alnum:]]|$)'
          )
          AND (
            report.corporate_events_projection_version IS DISTINCT FROM $2
            OR report.corporate_events_projection_status = 'PARSE_ERROR'
            OR (
              report.corporate_events_projection_status = 'UNMATCHED'
              AND report.corporate_events_projected_at < $3
            )
            OR $5::boolean
          )
        ORDER BY report.published_at DESC, report.source_id DESC
        LIMIT $4
      `,
      [publishedAfter, GENERAL_MEETING_PROJECTION_VERSION, unmatchedRetryBefore, GENERAL_MEETING_PROJECTION_BATCH_SIZE, force]
    );
    const attachmentRows = reports.length
      ? await query<{ espi_report_id: string; name: string; source_url: string }>(
          `SELECT espi_report_id, name, source_url FROM espi_report_attachments
           WHERE espi_report_id = ANY($1::text[])
             AND (media_type = 'application/pdf' OR name ~* '\\.pdf$' OR source_url ~* '\\.pdf($|[?])')
           ORDER BY espi_report_id,
             CASE WHEN name ~* '(ogłoszen|ogloszen|zwołan|zwolan|uczestnictw)' THEN 0 ELSE 1 END,
             name`,
          [reports.map((report) => report.id)]
        )
      : [];
    const attachmentsByReport = new Map<string, typeof attachmentRows>();
    for (const attachment of attachmentRows) {
      const current = attachmentsByReport.get(attachment.espi_report_id) ?? [];
      if (current.length < 2) current.push(attachment);
      attachmentsByReport.set(attachment.espi_report_id, current);
    }

    let created = 0;
    let duplicates = 0;
    let saved = 0;
    let unmatched = 0;
    let errors = 0;

    for (const report of reports) {
      try {
        const instrument = await getProjectionInstrument(report);
        if (!instrument) {
          unmatched += 1;
          await updateGeneralMeetingProjectionStatus(report.id, "UNMATCHED");
          diagnose({ provider: "global-espi-wza", sourceId: report.source_id, status: "UNMATCHED" });
          continue;
        }

        const events = parseCorporateEventDocument(`${report.source_title}\n${report.title}\n${report.body_text}`)
          .filter((event) => event.eventType === "GENERAL_MEETING");
        if (events.length === 0 || events.some((event) => !event.registrationDate)) {
          for (const attachment of attachmentsByReport.get(report.id) ?? []) {
            try {
              const text = await readOfficialMeetingPdf(attachment.source_url);
              if (!text) continue;
              const pdfEvents = parseCorporateEventDocument(text)
                .filter((event) => event.eventType === "GENERAL_MEETING");
              if (events.length === 0) {
                events.push(...pdfEvents);
              }
              for (const event of events) {
                const matching = pdfEvents.find((candidate) => candidate.eventDate === event.eventDate &&
                  (!candidate.generalMeetingType || !event.generalMeetingType || candidate.generalMeetingType === event.generalMeetingType));
                if (matching?.registrationDate) event.registrationDate = matching.registrationDate;
              }
              if (events.length > 0 && events.every((event) => event.registrationDate)) break;
            } catch (attachmentError) {
              diagnose({ provider: "global-espi-wza", sourceId: report.source_id,
                phase: "attachment", error: attachmentError instanceof Error ? attachmentError.name : "unknown" });
            }
          }
        }
        if (events.length === 0) {
          await updateGeneralMeetingProjectionStatus(report.id, "NO_EVENT");
          continue;
        }

        const result = await withTransaction(async (transaction) => {
          await transaction.query<{ locked: number }>(
            "SELECT pg_advisory_xact_lock(hashtext($1)) AS locked",
            [`corporate-events:${instrument.canonical_key}`]
          );
          const upsert = await upsertParsedEvents(transaction, instrument, {
            events,
            source: {
              sourceType: "PAP_ESPI",
              sourceUrl: report.source_url,
              sourcePublishedAt: report.published_at,
            },
          });
          await transaction.execute(
            `
              UPDATE espi_reports
              SET corporate_events_projection_status = 'SUCCESS',
                  corporate_events_projected_at = $1,
                  corporate_events_projection_version = $2
              WHERE id = $3
            `,
            [new Date().toISOString(), GENERAL_MEETING_PROJECTION_VERSION, report.id]
          );
          return upsert;
        });
        created += result.created;
        duplicates += result.duplicates;
        saved += result.saved;
      } catch (error) {
        errors += 1;
        try {
          await updateGeneralMeetingProjectionStatus(report.id, "PARSE_ERROR");
        } catch (statusError) {
          errors += 1;
          diagnose({
            provider: "global-espi-wza",
            sourceId: report.source_id,
            phase: "status-update",
            error: statusError instanceof Error ? statusError.name : "unknown",
          });
        }
        diagnose({
          provider: "global-espi-wza",
          sourceId: report.source_id,
          status: "PARSE_ERROR",
          error: error instanceof Error ? error.name : "unknown",
          message: error instanceof Error ? error.message.slice(0, 160) : undefined,
        });
      }
    }

    const pendingResult = await queryOne<{ count: number | string }>(
      `
        SELECT COUNT(*) AS count
        FROM espi_reports AS report
        LEFT JOIN corporate_event_instruments AS instrument ON instrument.id = report.issuer_id
        WHERE report.source = 'PAP_ESPI'
          AND report.published_at >= $1
          AND report.source_id NOT LIKE 'newconnect:%'
          AND report.market <> 'NEWCONNECT'
          AND (instrument.market = 'GPW' OR (instrument.id IS NULL AND report.market IN ('GPW', 'UNKNOWN')))
          AND (
            report.category = 'GENERAL_MEETING'
            OR report.source_title ILIKE '%waln%zgromadz%'
            OR report.title ILIKE '%waln%zgromadz%'
            OR report.source_title ~* '(^|[^[:alnum:]])(WZA|ZWZ|NWZ|AGM|EGM)([^[:alnum:]]|$)'
            OR report.title ~* '(^|[^[:alnum:]])(WZA|ZWZ|NWZ|AGM|EGM)([^[:alnum:]]|$)'
          )
          AND (
            report.corporate_events_projection_version IS DISTINCT FROM $2
            OR report.corporate_events_projection_status = 'PARSE_ERROR'
            OR (
              report.corporate_events_projection_status = 'UNMATCHED'
              AND report.corporate_events_projected_at < $3
            )
          )
      `,
      [publishedAfter, GENERAL_MEETING_PROJECTION_VERSION, unmatchedRetryBefore]
    );
    const pending = Number(pendingResult?.count ?? 0);
    console.info(`[WZA SYNC] fetched=${reports.length} new=${created} duplicates=${duplicates} saved=${saved} unmatched=${unmatched} pending=${pending} errors=${errors}`);
    return { fetched: reports.length, created, duplicates, saved, unmatched, errors, pending };
  })().finally(() => {
    globalGeneralMeetingSyncInFlight = null;
  });

  return globalGeneralMeetingSyncInFlight;
};

export const getGlobalGeneralMeetings = async ({
  fromDate,
  toDate,
  canonicalKeys,
}: {
  fromDate: string;
  toDate: string;
  canonicalKeys?: string[];
}) => {
  if (canonicalKeys && canonicalKeys.length === 0) return [];
  // The public WZA board is intentionally the Main Market GPW board. Scope is
  // only an optional user-side filter; an unrestricted request must not leak
  // NewConnect events into the GPW view.
  const instruments = canonicalKeys
    ? await query<{ id: string }>(
      "SELECT id FROM corporate_event_instruments WHERE market = 'GPW' AND canonical_key = ANY($1::text[])",
      [canonicalKeys]
    )
    : await query<{ id: string }>(
      "SELECT id FROM corporate_event_instruments WHERE market = 'GPW'"
    );
  const instrumentIds = instruments.map((instrument) => instrument.id);
  if (instrumentIds.length === 0) return [];
  return getStoredEvents(instrumentIds, fromDate, toDate, ["GENERAL_MEETING"]);
};

export const getGlobalGeneralMeetingSourceState = getGpwGeneralMeetingSyncState;

export type GlobalDividendSyncResult = GlobalGeneralMeetingSyncResult;

const DIVIDEND_PROJECTION_VERSION = 8;
const DIVIDEND_PROJECTION_BATCH_SIZE = 100;
const DIVIDEND_UNMATCHED_RETRY_MS = 7 * 24 * 60 * 60 * 1_000;
const DIVIDEND_REPROJECTION_MAX_EVENTS = 100;
const DIVIDEND_REPORT_CANDIDATE_SQL = `
  (
    report.category = 'DIVIDEND'
    OR report.source_title ILIKE '%dywidend%'
    OR report.title ILIKE '%dywidend%'
    OR report.source_title ILIKE '%zaliczk%'
    OR report.title ILIKE '%zaliczk%'
    OR report.source_title ILIKE '%podzia%zysku%'
    OR report.title ILIKE '%podzia%zysku%'
    OR report.source_title ILIKE '%wyniku finansowego%'
    OR report.title ILIKE '%wyniku finansowego%'
    OR report.body_text ~* '(dzie[nń] dywidendy|ustalenia praw[a]? do dywidendy|ustalenia uprawnionych|wypłat[ay] dywidendy|zaliczk[a-ząćęłńóśźż ]{0,80}dywidend)'
  )
`;

export type DividendProjectionDiagnostics = {
  candidateReports: number;
  recognized: number;
  noEvent: number;
  unmatched: number;
  errors: number;
  pending: number;
};

let globalDividendSyncInFlight: Promise<GlobalDividendSyncResult> | null = null;

const updateDividendProjectionStatus = (
  reportId: string,
  status: "SUCCESS" | "NO_EVENT" | "UNMATCHED" | "PARSE_ERROR"
) => execute(
  `
    UPDATE espi_reports
    SET dividend_projection_status = $1,
        dividend_projected_at = $2,
        dividend_projection_version = $3
    WHERE id = $4
  `,
  [status, new Date().toISOString(), DIVIDEND_PROJECTION_VERSION, reportId]
);

const getDividendReprojectionCandidates = async (
  transaction: DatabaseTransaction,
  instrumentId: string,
  sourceUrl: string,
  recordDates: string[]
) => transaction.query<StoredDividendProjection>(
  `SELECT event.id, event.event_identity, event.event_date, event.record_date,
          event.payment_date, event.dividend_installment, event.dividend_per_share,
          event.status, event.source_published_at,
          ARRAY_AGG(DISTINCT provenance.source_url) AS source_urls
   FROM corporate_events AS event
   JOIN corporate_event_sources AS provenance ON provenance.corporate_event_id = event.id
   WHERE event.instrument_id = $1 AND event.event_type = 'UPCOMING_DIVIDEND'
     AND event.active = TRUE
     AND (event.id IN (SELECT corporate_event_id FROM corporate_event_sources WHERE source_url = $2)
          OR event.record_date = ANY($3::text[]))
   GROUP BY event.id
   ORDER BY event.event_date DESC, event.id
   LIMIT $4`,
  [instrumentId, sourceUrl, recordDates, DIVIDEND_REPROJECTION_MAX_EVENTS]
);

const deactivateDividendProjection = async (
  transaction: DatabaseTransaction,
  ids: string[],
  reason: string,
  sourceUrl: string
) => {
  for (const id of ids.slice(0, DIVIDEND_REPROJECTION_MAX_EVENTS)) {
    const changedAt = new Date().toISOString();
    await transaction.execute(
      `INSERT INTO corporate_event_projection_changes
         (id, corporate_event_id, previous_row, reason, source_url, changed_at)
       SELECT $1, event.id, to_jsonb(event), $3, $4, $5
       FROM corporate_events AS event WHERE event.id = $2 AND event.active = TRUE`,
      [randomUUID(), id, reason, sourceUrl, changedAt]
    );
    await transaction.execute(
      `UPDATE corporate_events SET active = FALSE, status = 'CANCELLED', updated_at = $2
       WHERE id = $1 AND active = TRUE`,
      [id, changedAt]
    );
  }
};

/**
 * Projects official, shared GPW ESPI publications into the same normalized
 * corporate-events store used elsewhere in Mexo. Membership in a portfolio or
 * watchlist is deliberately applied only while reading the calendar.
 */
export const synchronizeGlobalDividends = ({
  force = false,
  refreshSource = true,
}: {
  force?: boolean;
  refreshSource?: boolean;
} = {}) => {
  if (globalDividendSyncInFlight) return globalDividendSyncInFlight;

  globalDividendSyncInFlight = (async () => {
    if (refreshSource) await synchronizeGpwDividendReports();
    const publishedAfter = new Date(Date.now() - 730 * 24 * 60 * 60 * 1_000).toISOString();
    const unmatchedRetryBefore = new Date(Date.now() - DIVIDEND_UNMATCHED_RETRY_MS).toISOString();
    const reports = await query<GlobalGeneralMeetingReportRow>(
      `
        SELECT report.id, report.source_id, report.issuer_id, report.issuer_name,
               report.source_isin, report.source_ticker, report.source_title,
               report.title, report.body_text, report.published_at, report.source_url,
               report.dividend_projection_status AS projection_status,
               instrument.canonical_key, instrument.ticker, instrument.company_name,
               instrument.isin, instrument.last_checked_at, instrument.last_source_status
        FROM espi_reports AS report
        LEFT JOIN corporate_event_instruments AS instrument ON instrument.id = report.issuer_id
        WHERE report.source = 'PAP_ESPI'
          AND report.published_at >= $1
          AND report.source_id NOT LIKE 'newconnect:%'
          AND report.market <> 'NEWCONNECT'
          AND (instrument.market = 'GPW' OR (instrument.id IS NULL AND report.market IN ('GPW', 'UNKNOWN')))
          AND ${DIVIDEND_REPORT_CANDIDATE_SQL}
          AND (
            report.dividend_projection_version IS DISTINCT FROM $2
            OR report.dividend_projection_status = 'PARSE_ERROR'
            OR (
              report.dividend_projection_status = 'UNMATCHED'
              AND report.dividend_projected_at < $3
            )
            OR $5::boolean
          )
        ORDER BY report.published_at DESC, report.source_id DESC
        LIMIT $4
      `,
      [publishedAfter, DIVIDEND_PROJECTION_VERSION, unmatchedRetryBefore, DIVIDEND_PROJECTION_BATCH_SIZE, force]
    );
    const dividendAttachments = reports.length
      ? await query<{ espi_report_id: string; name: string; source_url: string }>(
          `SELECT espi_report_id, name, source_url FROM espi_report_attachments
           WHERE espi_report_id = ANY($1::text[])
             AND (media_type = 'application/pdf' OR name ~* '\\.pdf$')
           ORDER BY espi_report_id,
             CASE WHEN name ~* '(dywidend|zaliczk|uchwał|uchwal)' THEN 0 ELSE 1 END, name`,
          [reports.map((report) => report.id)]
        ) : [];
    const dividendAttachmentsByReport = new Map<string, typeof dividendAttachments>();
    for (const attachment of dividendAttachments) {
      const current = dividendAttachmentsByReport.get(attachment.espi_report_id) ?? [];
      if (current.length < 2) current.push(attachment);
      dividendAttachmentsByReport.set(attachment.espi_report_id, current);
    }

    let created = 0;
    let duplicates = 0;
    let saved = 0;
    let unmatched = 0;
    let errors = 0;

    for (const report of reports) {
      try {
        const instrument = await getProjectionInstrument(report);
        if (!instrument) {
          unmatched += 1;
          await updateDividendProjectionStatus(report.id, "UNMATCHED");
          diagnose({ provider: "global-espi-dividends", sourceId: report.source_id, status: "UNMATCHED" });
          continue;
        }

        const reportText = `${report.source_title}\n${report.title}\n${report.body_text}`;
        const nonBindingDraft = isNonBindingDividendDraftNotice(reportText);
        let events = parseCorporateEventDocument(reportText)
          .filter((event) => event.eventType === "UPCOMING_DIVIDEND");
        let parseComplete = true;
        if (events.length === 0) {
          for (const attachment of dividendAttachmentsByReport.get(report.id) ?? []) {
            try {
              const text = await readOfficialMeetingPdf(attachment.source_url);
              if (!text) {
                parseComplete = false;
                diagnose({ provider: "global-espi-dividends", sourceId: report.source_id,
                  phase: "attachment-unavailable" });
                continue;
              }
              events = parseCorporateEventDocument(`${report.source_title}\n${text}`)
                .filter((event) => event.eventType === "UPCOMING_DIVIDEND");
              if (events.length) break;
            } catch (attachmentError) {
              parseComplete = false;
              diagnose({ provider: "global-espi-dividends", sourceId: report.source_id,
                phase: "attachment", error: attachmentError instanceof Error ? attachmentError.name : "unknown" });
            }
          }
        }
        if (events.length === 0) {
          // The public body establishes a proposal, not an adopted resolution.
          // If its PDF is unavailable, only independent later official proof
          // can justify retiring exclusively attributed stale projections.
          if (nonBindingDraft) {
            await withTransaction(async (transaction) => {
              await transaction.query<{ locked: number }>(
                "SELECT pg_advisory_xact_lock(hashtext($1)) AS locked",
                [`corporate-events:${instrument.canonical_key}`]
              );
              const old = await getDividendReprojectionCandidates(transaction, instrument.id, report.source_url, []);
              const publicationTimestamp = Date.parse(report.published_at);
              const later = !Number.isFinite(publicationTimestamp) ? [] : await transaction.query<{
                source_title: string; title: string; body_text: string;
              }>(
                `SELECT source_title, title, body_text FROM espi_reports
                 WHERE source = 'PAP_ESPI' AND issuer_id = $1 AND source_url <> $2
                   AND published_at > $3 AND published_at < $4
                   AND (source_title ILIKE '%dywidend%' OR title ILIKE '%dywidend%')
                 ORDER BY published_at ASC LIMIT 25`,
                [report.issuer_id, report.source_url, report.published_at,
                  new Date(publicationTimestamp + 180 * 24 * 60 * 60 * 1_000).toISOString()]
              );
              const corroboratingEvents = later.flatMap((item) =>
                parseCorporateEventDocument(`${item.source_title}\n${item.title}\n${item.body_text}`));
              const plan = planDividendRejectedAmendment(old, getDividendAmendmentEvidence(reportText),
                report.source_url, corroboratingEvents);
              await deactivateDividendProjection(transaction, plan.deactivateIds,
                "CORROBORATED_NON_BINDING_AMENDMENT", report.source_url);
              if (plan.ambiguousIds.length) diagnose({ provider: "global-espi-dividends", sourceId: report.source_id,
                phase: "reprojection-review", ambiguous: plan.ambiguousIds.length });
            });
          }
          if (!parseComplete) {
            await updateDividendProjectionStatus(report.id, "PARSE_ERROR");
            errors += 1;
            continue;
          }
          await updateDividendProjectionStatus(report.id, "NO_EVENT");
          continue;
        }

        const result = await withTransaction(async (transaction) => {
          await transaction.query<{ locked: number }>(
            "SELECT pg_advisory_xact_lock(hashtext($1)) AS locked",
            [`corporate-events:${instrument.canonical_key}`]
          );
          const old = await getDividendReprojectionCandidates(transaction, instrument.id, report.source_url,
            events.map((event) => event.recordDate).filter((date): date is string => Boolean(date)));
          const sourced = old.filter((event) => event.source_urls.includes(report.source_url));
          const sourcePlan = planDividendSourceReprojection(sourced, events, report.source_url, parseComplete, nonBindingDraft);
          const superseded = isDividendReportSuperseded(old, events, report.published_at);
          const finalPlan = planDividendFinalResolution(old, events, report.published_at);
          const upsert = superseded ? { created: 0, duplicates: events.length, saved: 0 } : await upsertParsedEvents(transaction, instrument, {
            events,
            source: {
              sourceType: report.source_url.includes("gpw.pl/komunikat")
                ? "ISSUER_CURRENT_REPORT"
                : "PAP_ESPI",
              sourceUrl: report.source_url,
              sourcePublishedAt: report.published_at,
              sourceTitle: report.source_title || report.title,
            },
          });
          await deactivateDividendProjection(transaction, sourcePlan.deactivateIds,
            "SAME_SOURCE_REPARSE", report.source_url);
          await deactivateDividendProjection(transaction, finalPlan.deactivateIds.filter((id) =>
            !sourcePlan.deactivateIds.includes(id)), "FINAL_DIVIDEND_RESOLUTION", report.source_url);
          if (sourcePlan.ambiguousIds.length) diagnose({ provider: "global-espi-dividends", sourceId: report.source_id,
            phase: "reprojection-review", ambiguous: sourcePlan.ambiguousIds.length });
          await transaction.execute(
            `
              UPDATE espi_reports
              SET dividend_projection_status = 'SUCCESS',
                  dividend_projected_at = $1,
                  dividend_projection_version = $2
              WHERE id = $3
            `,
            [new Date().toISOString(), DIVIDEND_PROJECTION_VERSION, report.id]
          );
          return upsert;
        });
        created += result.created;
        duplicates += result.duplicates;
        saved += result.saved;
      } catch (error) {
        errors += 1;
        try {
          await updateDividendProjectionStatus(report.id, "PARSE_ERROR");
        } catch (statusError) {
          errors += 1;
          diagnose({
            provider: "global-espi-dividends",
            sourceId: report.source_id,
            phase: "status-update",
            error: statusError instanceof Error ? statusError.name : "unknown",
          });
        }
        diagnose({
          provider: "global-espi-dividends",
          sourceId: report.source_id,
          status: "PARSE_ERROR",
          error: error instanceof Error ? error.name : "unknown",
          message: error instanceof Error ? error.message.slice(0, 160) : undefined,
        });
      }
    }

    const pendingResult = await queryOne<{ count: number | string }>(
      `
        SELECT COUNT(*) AS count
        FROM espi_reports AS report
        LEFT JOIN corporate_event_instruments AS instrument ON instrument.id = report.issuer_id
        WHERE report.source = 'PAP_ESPI'
          AND report.published_at >= $1
          AND report.source_id NOT LIKE 'newconnect:%'
          AND report.market <> 'NEWCONNECT'
          AND (instrument.market = 'GPW' OR (instrument.id IS NULL AND report.market IN ('GPW', 'UNKNOWN')))
          AND ${DIVIDEND_REPORT_CANDIDATE_SQL}
          AND (
            report.dividend_projection_version IS DISTINCT FROM $2
            OR report.dividend_projection_status = 'PARSE_ERROR'
            OR (
              report.dividend_projection_status = 'UNMATCHED'
              AND report.dividend_projected_at < $3
            )
          )
      `,
      [publishedAfter, DIVIDEND_PROJECTION_VERSION, unmatchedRetryBefore]
    );
    const pending = Number(pendingResult?.count ?? 0);
    console.info(`[DIVIDEND SYNC] fetched=${reports.length} new=${created} duplicates=${duplicates} saved=${saved} unmatched=${unmatched} pending=${pending} errors=${errors}`);
    return { fetched: reports.length, created, duplicates, saved, unmatched, errors, pending };
  })().finally(() => {
    globalDividendSyncInFlight = null;
  });

  return globalDividendSyncInFlight;
};

export const getDividendProjectionDiagnostics = async (): Promise<DividendProjectionDiagnostics> => {
  const publishedAfter = new Date(Date.now() - 730 * 24 * 60 * 60 * 1_000).toISOString();
  const unmatchedRetryBefore = new Date(Date.now() - DIVIDEND_UNMATCHED_RETRY_MS).toISOString();
  const row = await queryOne<Record<keyof DividendProjectionDiagnostics, number | string>>(
    `
      SELECT
        COUNT(*) AS "candidateReports",
        COUNT(*) FILTER (WHERE report.dividend_projection_status = 'SUCCESS') AS recognized,
        COUNT(*) FILTER (WHERE report.dividend_projection_status = 'NO_EVENT') AS "noEvent",
        COUNT(*) FILTER (WHERE report.dividend_projection_status = 'UNMATCHED') AS unmatched,
        COUNT(*) FILTER (WHERE report.dividend_projection_status = 'PARSE_ERROR') AS errors,
        COUNT(*) FILTER (
          WHERE report.dividend_projection_version IS DISTINCT FROM $2
             OR report.dividend_projection_status IS NULL
             OR report.dividend_projection_status = 'PARSE_ERROR'
             OR (
               report.dividend_projection_status = 'UNMATCHED'
               AND report.dividend_projected_at < $3
             )
        ) AS pending
      FROM espi_reports AS report
      LEFT JOIN corporate_event_instruments AS instrument ON instrument.id = report.issuer_id
      WHERE report.source = 'PAP_ESPI'
        AND report.published_at >= $1
        AND report.source_id NOT LIKE 'newconnect:%'
        AND report.market <> 'NEWCONNECT'
        AND (instrument.market = 'GPW' OR (instrument.id IS NULL AND report.market IN ('GPW', 'UNKNOWN')))
        AND ${DIVIDEND_REPORT_CANDIDATE_SQL}
    `,
    [publishedAfter, DIVIDEND_PROJECTION_VERSION, unmatchedRetryBefore]
  );
  return {
    candidateReports: Number(row?.candidateReports ?? 0),
    recognized: Number(row?.recognized ?? 0),
    noEvent: Number(row?.noEvent ?? 0),
    unmatched: Number(row?.unmatched ?? 0),
    errors: Number(row?.errors ?? 0),
    pending: Number(row?.pending ?? 0),
  };
};

export const getGlobalDividends = async ({
  fromDate,
  toDate,
  canonicalKeys,
}: {
  fromDate: string;
  toDate: string;
  canonicalKeys?: string[];
}) => {
  if (canonicalKeys && canonicalKeys.length === 0) return [];
  const instruments = canonicalKeys
    ? await query<{ id: string }>(
      "SELECT id FROM corporate_event_instruments WHERE market = 'GPW' AND canonical_key = ANY($1::text[])",
      [canonicalKeys]
    )
    : await query<{ id: string }>(
      "SELECT id FROM corporate_event_instruments WHERE market = 'GPW'"
    );
  const instrumentIds = instruments.map((instrument) => instrument.id);
  if (instrumentIds.length === 0) return [];
  return getStoredEvents(instrumentIds, fromDate, toDate, ["UPCOMING_DIVIDEND"]);
};

export const getGlobalDividendSourceState = getGpwDividendSyncState;

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

  // `last_checked_at` predates individual provider adapters. After adding WZA,
  // an otherwise fresh instrument must still run the new central ESPI adapter
  // once; otherwise the UI can remain empty until the aggregate 24 h TTL ends.
  const generalMeetingBootstrapIds = await getGeneralMeetingBootstrapInstrumentIds(
    uniqueCanonical.map((instrument) => instrument.id)
  );
  const refreshCandidates = uniqueCanonical.filter(
    (instrument) =>
      forceRefresh ||
      !isFreshCheck(instrument) ||
      !generalMeetingBootstrapIds.has(instrument.id)
  );
  const awaitedRefreshIds = new Set(
    forceRefresh
      ? uniqueCanonical.map((instrument) => instrument.id)
      : uniqueCanonical
          .filter(
            (instrument) =>
              !instrument.last_checked_at ||
              !generalMeetingBootstrapIds.has(instrument.id)
          )
          .map((instrument) => instrument.id)
  );
  const awaitedRefreshes: Promise<void>[] = [];

  // First discovery is awaited so a new GPW holding can receive events in the
  // first API response. The first check by a newly introduced provider is also
  // awaited. Existing fully-initialized data remains stale-while-revalidate.
  for (const instrument of refreshCandidates) {
    const refresh = refreshCanonicalInstrument(instrument);
    if (awaitedRefreshIds.has(instrument.id)) {
      awaitedRefreshes.push(refresh);
    } else {
      void refresh;
    }
  }
  await Promise.all(awaitedRefreshes);

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

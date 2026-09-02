import {
  searchEodhdEtfPriceCandidates,
  searchEodhdEtfs,
  type EodhdEtfPriceCandidate,
} from "@/lib/server/eodhd";
import { getMarketCachePayload, setMarketCachePayload } from "@/lib/server/market-cache";
import { getGpwTickerCore, isGpwSymbol, normalizeSymbol } from "@/lib/ticker";
import { TICKER_ALIAS_MAP, type TickerAliasResolution } from "@/lib/ticker-aliases";
import { normalizeText, toCurrencyCode, uniqueBy } from "@/lib/utils";
import type {
  CurrencyCode,
  EtfListing,
  EtfSearchGroup,
  InstrumentIdentity,
} from "@/types/portfolio";

const OPENFIGI_API_ROOT = "https://api.openfigi.com/v3";
const OPENFIGI_SEARCH_CACHE_TTL_MS = 5 * 60 * 1_000;
const OPENFIGI_REQUEST_TIMEOUT_MS = 7_000;
const OPENFIGI_MAX_RESULTS = 200;
const SEARCH_RATE_WINDOW_MS = 60_000;
const SEARCH_RATE_LIMIT = 12;

type JsonRecord = Record<string, unknown>;
type FetchLike = typeof fetch;
type OpenFigiPath = "/filter" | "/mapping";

/**
 * The Workers runtime uses its verified Web Fetch implementation. Local
 * development uses the system CA store through the existing Node dev command.
 */
const fetchOpenFigiWithSystemTrust: FetchLike = (input, init) => fetch(input, init);

type OpenFigiFilterResponse = {
  data?: unknown[];
};

type OpenFigiMappingItem = {
  data?: unknown[];
  warning?: unknown;
};

export type OpenFigiSearchFailureCode =
  | "configuration"
  | "rate_limit"
  | "invalid_request"
  | "invalid_credentials"
  | "provider_unavailable"
  | "timeout"
  | "network"
  | "invalid_response";

export class OpenFigiSearchError extends Error {
  readonly code: OpenFigiSearchFailureCode;

  constructor(code: OpenFigiSearchFailureCode) {
    super(code);
    this.name = "OpenFigiSearchError";
    this.code = code;
  }
}

export type InstrumentSearchProvider = {
  searchEtfs: (query: string) => Promise<EtfSearchGroup[]>;
};

type OpenFigiDiagnostics = {
  rawQuery: string;
  normalizedQuery: string;
  endpoint: string;
  method: "POST";
  httpStatus?: number;
  responseBodyPresent?: boolean;
  errorClassification?: OpenFigiSearchFailureCode;
  rawResultCount?: number;
  normalizedListingCount?: number;
  exchangeTradedProductCount?: number;
  fallbackListingCount?: number;
  finalGroupCount?: number;
  rateLimitRemaining?: string | null;
};

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const field = (source: JsonRecord, ...keys: string[]) => {
  for (const key of keys) {
    const value = text(source[key]);

    if (value) {
      return value;
    }
  }

  return "";
};

const normaliseFigi = (value: string) => normalizeSymbol(value);

/**
 * Keeps user-visible punctuation intact.  This value is used both in the
 * OpenFIGI body and in the ETF-only cache key, so `S&P 500` cannot be damaged
 * by URL or cache normalization.
 */
export const normalizeEtfSearchQuery = (query: string) => query.trim().replace(/\s+/g, " ");

const getSecurityType = (record: JsonRecord) => field(record, "securityType");
const getSecurityType2 = (record: JsonRecord) => field(record, "securityType2");

const isExchangeTradedProduct = (record: JsonRecord) =>
  normalizeSymbol(getSecurityType(record)) === "ETP";

/**
 * OpenFIGI's ETP class is broader than ETF.  We only reject products that the
 * provider itself explicitly identifies as an ETN, ETC or certificate.  An
 * ambiguous ETP remains selectable instead of being filtered by its name.
 */
const isExplicitlyNonEtfEtp = (record: JsonRecord) => {
  const providerClassifications = [
    getSecurityType(record),
    getSecurityType2(record),
    field(record, "marketSector"),
  ].map((value) => normalizeText(value));

  return providerClassifications.some((classification) =>
    [
      "etn",
      "exchange traded note",
      "etc",
      "exchange traded commodity",
      "certificate",
      "certificates",
      "structured product",
      "structured products",
    ].includes(classification)
  );
};

const isEligibleEtfResult = (record: JsonRecord) =>
  isExchangeTradedProduct(record) && !isExplicitlyNonEtfEtp(record);

const toCurrency = (value: string): CurrencyCode | undefined => {
  const normalized = normalizeSymbol(value);
  return /^[A-Z]{3}$/.test(normalized) ? toCurrencyCode(normalized) : undefined;
};

/**
 * OpenFIGI's `exchCode` is a Bloomberg exchange code, not a label intended
 * for investors.  Keep this intentionally small: a wrong human-readable
 * venue is worse than an explicit "needs confirmation" state.  Codes outside
 * this verified set remain visible, but never masquerade as a known exchange.
 */
const VERIFIED_ETF_VENUE_LABELS: Record<string, string> = {
  CJ: "Pure Trading",
  CT: "Toronto Stock Exchange",
  FP: "Euronext Paris",
  GR: "Xetra",
  GY: "Frankfurt",
  HK: "Hong Kong Stock Exchange",
  IM: "Borsa Italiana",
  LN: "London Stock Exchange",
  NA: "Euronext Amsterdam",
  SW: "SIX Swiss Exchange",
  US: "Rynek USA",
};

const getEtfVenueLabel = (exchangeCode: string, mic: string) => {
  const confirmedVenue = VERIFIED_ETF_VENUE_LABELS[exchangeCode];
  const venue = confirmedVenue ?? "Rynek do potwierdzenia";

  return mic ? `${venue} · MIC ${mic}` : venue;
};

const getMatchScore = (query: string, listing: EtfListing) => {
  const normalizedQuery = normalizeSymbol(query);
  const normalizedText = normalizeText(query);
  const ticker = normalizeSymbol(listing.symbol);
  const name = normalizeText(listing.name);
  const identifiers = [
    listing.instrumentIdentity.figi,
    listing.instrumentIdentity.compositeFigi,
    listing.instrumentIdentity.shareClassFigi,
    listing.isin,
  ]
    .filter((value): value is string => Boolean(value))
    .map(normaliseFigi);

  if (ticker === normalizedQuery) return 0;
  if (identifiers.includes(normalizedQuery)) return 1;
  if (name === normalizedText) return 2;
  if (ticker.startsWith(normalizedQuery)) return 3;

  const nameWords = name.split(" ").filter(Boolean);
  if (name.startsWith(normalizedText) || nameWords.some((word) => word.startsWith(normalizedText))) {
    return 4;
  }

  if (ticker.includes(normalizedQuery)) return 5;
  if (name.includes(normalizedText)) return 6;
  return 7;
};

const compareListings = (query: string, left: EtfListing, right: EtfListing) =>
  getMatchScore(query, left) - getMatchScore(query, right) ||
  left.symbol.localeCompare(right.symbol) ||
  (left.exchange ?? left.exchangeCode ?? "").localeCompare(
    right.exchange ?? right.exchangeCode ?? ""
  ) ||
  left.marketCurrency.localeCompare(right.marketCurrency);

const toListing = (value: unknown): EtfListing | null => {
  const record = asRecord(value);

  if (!record || !isEligibleEtfResult(record)) {
    return null;
  }

  const ticker = normalizeSymbol(field(record, "ticker"));
  const name = field(record, "name");
  const figi = normaliseFigi(field(record, "figi"));
  const currency = toCurrency(field(record, "currency"));

  if (!ticker || !name) {
    return null;
  }

  const compositeFigi = normaliseFigi(field(record, "compositeFIGI", "compositeFigi"));
  const shareClassFigi = normaliseFigi(field(record, "shareClassFIGI", "shareClassFigi"));
  const exchangeCode = normalizeSymbol(field(record, "exchCode", "exchangeCode"));
  const mic = normalizeSymbol(field(record, "micCode", "mic"));
  const securityType = getSecurityType(record);
  const securityType2 = getSecurityType2(record);
  const isin = normaliseFigi(field(record, "isin", "ISIN"));
  const listingId = figi || [ticker, exchangeCode, mic, currency ?? "unknown", name].join(":");
  const instrumentIdentity: InstrumentIdentity = {
    figi: figi || undefined,
    compositeFigi: compositeFigi || undefined,
    shareClassFigi: shareClassFigi || undefined,
    ticker,
    name,
    instrumentType: "ETF",
    exchange: exchangeCode || undefined,
    exchangeCode: exchangeCode || undefined,
    mic: mic || undefined,
    currency,
    securityType: securityType || undefined,
    securityType2: securityType2 || undefined,
  };

  return {
    listingId,
    symbol: ticker,
    name,
    kind: "etf",
    // This only keeps the form usable until the user confirms a currency or
    // EODHD resolves one.  Identity currency intentionally stays undefined.
    marketCurrency: currency ?? "USD",
    provider: "eodhd",
    source: "api",
    subtitle: getEtfVenueLabel(exchangeCode, mic),
    isin: isin || undefined,
    exchange: exchangeCode || undefined,
    exchangeCode: exchangeCode || undefined,
    mic: mic || undefined,
    securityType: securityType || undefined,
    providerPriceSymbol: undefined,
    priceStatus: "unchecked",
    instrumentIdentity,
  };
};

type NormalizedEtfResults = {
  listings: EtfListing[];
  exchangeTradedProductCount: number;
};

const normaliseEtfResults = (rawItems: unknown[]): NormalizedEtfResults => {
  let exchangeTradedProductCount = 0;
  const listings = rawItems.flatMap((value) => {
    const record = asRecord(value);

    if (record && isExchangeTradedProduct(record)) {
      exchangeTradedProductCount += 1;
    }

    const listing = toListing(value);
    return listing ? [listing] : [];
  });

  return {
    listings: uniqueBy(listings, (listing) => listing.listingId),
    exchangeTradedProductCount,
  };
};

const groupNormalizedEtfListings = (query: string, listings: EtfListing[]): EtfSearchGroup[] => {
  const sortedListings = [...listings].sort((left, right) => compareListings(query, left, right));
  const groups = new Map<string, EtfSearchGroup>();

  sortedListings.forEach((listing) => {
    // Only shareClassFIGI is safe for grouping distinct listings of one ETF.
    // A composite FIGI or a matching display name alone must not merge funds.
    const shareClassFigi = listing.instrumentIdentity.shareClassFigi;
    const groupId = shareClassFigi
      ? `etf:share-class:${shareClassFigi}`
      : `listing:${listing.listingId}`;
    const existing = groups.get(groupId);

    if (existing) {
      existing.listings.push(listing);
      return;
    }

    groups.set(groupId, {
      id: groupId,
      name: listing.name,
      instrumentType: "ETF",
      identity: {
        compositeFigi: listing.instrumentIdentity.compositeFigi,
        shareClassFigi,
        name: listing.name,
        instrumentType: "ETF",
      },
      listings: [listing],
    });
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      listings: [...group.listings].sort((left, right) => compareListings(query, left, right)),
    }))
    .sort(
      (left, right) =>
        Math.min(...left.listings.map((listing) => getMatchScore(query, listing))) -
          Math.min(...right.listings.map((listing) => getMatchScore(query, listing))) ||
        left.name.localeCompare(right.name)
    );
};

export const groupEtfListings = (query: string, rawItems: unknown[]): EtfSearchGroup[] =>
  groupNormalizedEtfListings(query, normaliseEtfResults(rawItems).listings);

export const groupEtfListingResults = (query: string, listings: EtfListing[]) =>
  groupNormalizedEtfListings(query, listings);

const isFigiQuery = (query: string) => /^BBG[A-Z0-9]{9,}$/i.test(query);
const isIsinQuery = (query: string) => /^[A-Z]{2}[A-Z0-9]{9}\d$/i.test(query);

const isDiagnosticsEnabled = () => process.env.OPENFIGI_DIAGNOSTICS === "true";

const logDiagnostics = (details: OpenFigiDiagnostics) => {
  if (isDiagnosticsEnabled()) {
    console.info("[openfigi:etf]", details);
  }
};

const classifyHttpFailure = (status: number): OpenFigiSearchFailureCode => {
  if (status === 400) return "invalid_request";
  if (status === 401 || status === 403) return "invalid_credentials";
  if (status === 429) return "rate_limit";
  return "provider_unavailable";
};

const getRateLimitRemaining = (response: Response) =>
  response.headers.get("x-ratelimit-remaining") ?? response.headers.get("x-rate-limit-remaining");

const requestOpenFigi = async ({
  path,
  payload,
  apiKey,
  rawQuery,
  normalizedQuery,
  fetcher = fetch,
}: {
  path: OpenFigiPath;
  payload: unknown;
  apiKey: string;
  rawQuery: string;
  normalizedQuery: string;
  fetcher?: FetchLike;
}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENFIGI_REQUEST_TIMEOUT_MS);
  const endpoint = `${OPENFIGI_API_ROOT}${path}`;

  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-OPENFIGI-APIKEY": apiKey,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.text();
    const details = {
      rawQuery,
      normalizedQuery,
      endpoint,
      method: "POST" as const,
      httpStatus: response.status,
      responseBodyPresent: body.trim().length > 0,
      rateLimitRemaining: getRateLimitRemaining(response),
    };

    if (!response.ok) {
      const errorCode = classifyHttpFailure(response.status);
      logDiagnostics({ ...details, errorClassification: errorCode });
      throw new OpenFigiSearchError(errorCode);
    }

    if (!body.trim()) {
      logDiagnostics({ ...details, errorClassification: "invalid_response" });
      throw new OpenFigiSearchError("invalid_response");
    }

    try {
      const parsed = JSON.parse(body) as unknown;
      logDiagnostics(details);
      return parsed;
    } catch {
      logDiagnostics({ ...details, errorClassification: "invalid_response" });
      throw new OpenFigiSearchError("invalid_response");
    }
  } catch (error) {
    if (error instanceof OpenFigiSearchError) {
      throw error;
    }

    const isAbort =
      (error instanceof DOMException && error.name === "AbortError") ||
      (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
    const errorCode: OpenFigiSearchFailureCode = isAbort ? "timeout" : "network";
    logDiagnostics({
      rawQuery,
      normalizedQuery,
      endpoint,
      method: "POST",
      errorClassification: errorCode,
    });
    throw new OpenFigiSearchError(errorCode);
  } finally {
    clearTimeout(timeoutId);
  }
};

const getFilterItems = (response: unknown): unknown[] => {
  const payload = asRecord(response);

  if (!payload || !Array.isArray((payload as OpenFigiFilterResponse).data)) {
    throw new OpenFigiSearchError("invalid_response");
  }

  return (payload as OpenFigiFilterResponse).data!.slice(0, OPENFIGI_MAX_RESULTS);
};

const getMappingItems = (response: unknown): unknown[] => {
  if (!Array.isArray(response)) {
    throw new OpenFigiSearchError("invalid_response");
  }

  return response.flatMap((value) => {
    const item = asRecord(value) as OpenFigiMappingItem | null;

    if (!item) {
      throw new OpenFigiSearchError("invalid_response");
    }

    if (Array.isArray(item.data)) {
      return item.data;
    }

    // OpenFIGI v3 uses warning for an identifier that has no match.
    if (text(item.warning)) {
      return [];
    }

    throw new OpenFigiSearchError("invalid_response");
  }).slice(0, OPENFIGI_MAX_RESULTS);
};

export class OpenFigiInstrumentSearchProvider implements InstrumentSearchProvider {
  private readonly apiKey: string;
  private readonly fetcher: FetchLike;

  constructor(
    apiKey = process.env.OPENFIGI_API_KEY?.trim() ?? "",
    fetcher: FetchLike = fetchOpenFigiWithSystemTrust
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  async searchEtfs(query: string) {
    if (!this.apiKey) {
      throw new OpenFigiSearchError("configuration");
    }

    const normalizedQuery = normalizeEtfSearchQuery(query);
    const isIdentifier = isFigiQuery(normalizedQuery) || isIsinQuery(normalizedQuery);
    const response = isIdentifier
      ? await requestOpenFigi({
          path: "/mapping",
          payload: [
            {
              idType: isFigiQuery(normalizedQuery) ? "ID_BB_GLOBAL" : "ID_ISIN",
              idValue: normalizeSymbol(normalizedQuery),
            },
          ],
          apiKey: this.apiKey,
          rawQuery: query,
          normalizedQuery,
          fetcher: this.fetcher,
        })
      : await requestOpenFigi({
          path: "/filter",
          payload: {
            query: normalizedQuery,
            securityType: "ETP",
          },
          apiKey: this.apiKey,
          rawQuery: query,
          normalizedQuery,
          fetcher: this.fetcher,
        });
    const rawItems = isIdentifier ? getMappingItems(response) : getFilterItems(response);
    const normalized = normaliseEtfResults(rawItems);
    const groups = groupNormalizedEtfListings(normalizedQuery, normalized.listings);

    logDiagnostics({
      rawQuery: query,
      normalizedQuery,
      endpoint: `${OPENFIGI_API_ROOT}${isIdentifier ? "/mapping" : "/filter"}`,
      method: "POST",
      rawResultCount: rawItems.length,
      normalizedListingCount: normalized.listings.length,
      exchangeTradedProductCount: normalized.exchangeTradedProductCount,
      finalGroupCount: groups.length,
    });

    return groups;
  }
}

const getAliasSearchFields = (alias: TickerAliasResolution) => [
  normalizeSymbol(alias.brokerSymbol),
  normalizeSymbol(alias.symbol),
  normalizeSymbol(alias.providerId ?? ""),
  normalizeSymbol(alias.isin ?? ""),
  normalizeText(alias.name ?? ""),
];

const isEtfAliasMatch = (query: string, alias: TickerAliasResolution) => {
  const normalizedSymbolQuery = normalizeSymbol(query);
  const normalizedTextQuery = normalizeText(query);

  if (!normalizedSymbolQuery || !normalizedTextQuery) {
    return false;
  }

  return getAliasSearchFields(alias).some((field) => {
    if (!field) return false;

    return (
      field === normalizedSymbolQuery ||
      field === normalizedTextQuery ||
      (normalizedSymbolQuery.length >= 2 && field.startsWith(normalizedSymbolQuery)) ||
      (normalizedTextQuery.length >= 2 && field.includes(normalizedTextQuery)) ||
      (normalizedTextQuery.length >= 2 && normalizedTextQuery.includes(field))
    );
  });
};

const getCatalogEtfAliases = (query: string) =>
  TICKER_ALIAS_MAP.filter(
    (alias) => alias.kind === "etf" && isEtfAliasMatch(query, alias)
  );

const getCatalogDisplayTicker = (alias: TickerAliasResolution) => {
  const providerSymbol = normalizeSymbol(alias.symbol);

  return isGpwSymbol(providerSymbol) ? getGpwTickerCore(providerSymbol) : providerSymbol;
};

const toCatalogEtfListing = (
  alias: TickerAliasResolution,
  openFigiListing?: EtfListing
): EtfListing | null => {
  const ticker = getCatalogDisplayTicker(alias);
  const name = alias.name?.trim();
  const currency = alias.marketCurrency;

  if (!ticker || !name || !currency) {
    return null;
  }

  const isGpw = isGpwSymbol(alias.symbol) || isGpwSymbol(alias.brokerSymbol);
  const figi = openFigiListing?.instrumentIdentity.figi;
  const instrumentIdentity: InstrumentIdentity = {
    ...openFigiListing?.instrumentIdentity,
    ticker,
    name,
    instrumentType: "ETF",
    exchange: isGpw ? "GPW" : openFigiListing?.instrumentIdentity.exchange,
    exchangeCode: isGpw ? "GPW" : openFigiListing?.instrumentIdentity.exchangeCode,
    currency,
    providerPriceSymbol: alias.providerId,
  };

  return {
    listingId: figi || `etf:catalog:${alias.isin ?? alias.symbol}`,
    symbol: ticker,
    name,
    kind: "etf",
    marketCurrency: currency,
    provider: alias.provider ?? "eodhd",
    providerId: alias.providerId,
    providerPriceSymbol: alias.providerId,
    source: "catalog",
    subtitle: isGpw ? "Giełda Papierów Wartościowych w Warszawie" : undefined,
    isin: alias.isin,
    exchange: isGpw ? "GPW" : openFigiListing?.exchange,
    exchangeCode: isGpw ? "GPW" : openFigiListing?.exchangeCode,
    mic: openFigiListing?.mic,
    securityType: openFigiListing?.securityType,
    priceStatus: "unchecked",
    instrumentIdentity,
  };
};

const toEodhdFallbackEtfListing = (
  result: Awaited<ReturnType<typeof searchEodhdEtfs>>[number]
): EtfListing | null => {
  const ticker = normalizeSymbol(result.symbol).split(".")[0] ?? normalizeSymbol(result.symbol);
  const exchange = normalizeSymbol(result.subtitle?.split("/")[0] ?? "");

  if (!ticker || !result.name || !result.providerId) {
    return null;
  }

  return {
    listingId: `etf:eodhd:${normalizeSymbol(result.providerId)}`,
    symbol: ticker,
    name: result.name,
    kind: "etf" as const,
    marketCurrency: result.marketCurrency,
    provider: "eodhd" as const,
    providerId: result.providerId,
    providerPriceSymbol: result.providerId,
    source: "api" as const,
    subtitle: result.subtitle,
    isin: result.isin,
    exchange: exchange || undefined,
    exchangeCode: exchange || undefined,
    priceStatus: "unchecked" as const,
    instrumentIdentity: {
      ticker,
      name: result.name,
      instrumentType: "ETF" as const,
      exchange: exchange || undefined,
      exchangeCode: exchange || undefined,
      currency: result.marketCurrency,
      providerPriceSymbol: result.providerId,
    },
  } satisfies EtfListing;
};

/**
 * The local alias catalogue and EODHD are ETF-only complements to OpenFIGI.
 * They are never consulted by the global asset search and are only used when
 * a source can provide a concrete provider/listing identity.
 */
const getEtfFallbackListings = async (
  query: string,
  provider: InstrumentSearchProvider,
  primaryListings: EtfListing[]
) => {
  const catalogAliases = getCatalogEtfAliases(query);
  const mappedCatalogListings = await Promise.all(
    catalogAliases.map(async (alias) => {
      const mappedGroup = alias.isin
        ? await provider.searchEtfs(alias.isin).catch(() => [])
        : [];
      const mappedListing = mappedGroup.flatMap((group) => group.listings)[0];

      return toCatalogEtfListing(alias, mappedListing);
    })
  );
  const catalogListings = mappedCatalogListings.filter(
    (listing): listing is EtfListing => Boolean(listing)
  );

  // EODHD is deliberately a last fallback.  Its exchange-wide recovery can
  // be more expensive, so it runs only when neither OpenFIGI nor the known
  // local catalogue found any ETF for this query.
  const eodhdListings =
    primaryListings.length === 0 && catalogListings.length === 0
      ? (await searchEodhdEtfs(query).catch(() => []))
          .slice(0, 8)
          .map(toEodhdFallbackEtfListing)
          .filter((listing): listing is EtfListing => Boolean(listing))
      : [];

  return uniqueBy([...catalogListings, ...eodhdListings], (listing) => listing.listingId);
};

const localSearchCache = new Map<string, { groups: EtfSearchGroup[]; expiresAt: number }>();
const inFlightSearches = new Map<string, Promise<EtfSearchGroup[]>>();
const requestWindows = new Map<string, number[]>();

export const enforceOpenFigiSearchRateLimit = (actorId: string) => {
  const now = Date.now();
  const previous = requestWindows.get(actorId) ?? [];
  const active = previous.filter((timestamp) => timestamp > now - SEARCH_RATE_WINDOW_MS);

  if (active.length >= SEARCH_RATE_LIMIT) {
    requestWindows.set(actorId, active);
    throw new OpenFigiSearchError("rate_limit");
  }

  active.push(now);
  requestWindows.set(actorId, active);
};

export const getEtfSearchCacheKey = (normalizedQuery: string) =>
  `openfigi:etf:v4:${normalizedQuery.toLocaleLowerCase("en-US")}`;

const getCachedSearch = async (cacheKey: string) => {
  const memory = localSearchCache.get(cacheKey);

  if (memory && memory.expiresAt > Date.now()) {
    return memory.groups;
  }

  let stored: EtfSearchGroup[] | null = null;

  try {
    stored = await getMarketCachePayload<EtfSearchGroup[]>(
      cacheKey,
      OPENFIGI_SEARCH_CACHE_TTL_MS,
      { ignoreEmptyArray: false }
    );
  } catch {
    // Cache availability must never prevent a discovery request.
    stored = null;
  }

  if (stored) {
    localSearchCache.set(cacheKey, {
      groups: stored,
      expiresAt: Date.now() + OPENFIGI_SEARCH_CACHE_TTL_MS,
    });
  }

  return stored;
};

export const searchEtfInstruments = async (
  query: string,
  provider: InstrumentSearchProvider = new OpenFigiInstrumentSearchProvider(),
  actorId?: string
) => {
  const normalizedQuery = normalizeEtfSearchQuery(query);

  if (!normalizedQuery) {
    return [];
  }

  const cacheKey = getEtfSearchCacheKey(normalizedQuery);
  const cached = await getCachedSearch(cacheKey);

  if (cached) {
    return cached;
  }

  const existingRequest = inFlightSearches.get(cacheKey);

  if (existingRequest) {
    return existingRequest;
  }

  if (actorId) {
    enforceOpenFigiSearchRateLimit(actorId);
  }

  const request = (async () => {
      let primaryGroups: EtfSearchGroup[] = [];
      let primaryError: unknown = null;

      try {
        primaryGroups = await provider.searchEtfs(normalizedQuery);
      } catch (error) {
        primaryError = error;
      }

      const primaryListings = primaryGroups.flatMap((group) => group.listings);
      const fallbackListings = await getEtfFallbackListings(
        normalizedQuery,
        provider,
        primaryListings
      );
      // Prefer a catalog record only when it was verified by its own ISIN.
      // FIGI is then the deduplication key, so this does not guess based on a
      // display name or a ticker collision.
      const groups = groupEtfListingResults(
        normalizedQuery,
        uniqueBy([...fallbackListings, ...primaryListings], (listing) => listing.listingId)
      );

      // A trusted ETF-specific fallback keeps discovery working when OpenFIGI
      // is temporarily unavailable. If it cannot identify any listing, retain
      // the original provider error so the UI does not misrepresent an outage
      // as an ordinary empty result.
      if (groups.length === 0 && primaryError) {
        throw primaryError;
      }

      logDiagnostics({
        rawQuery: query,
        normalizedQuery,
        endpoint: "Mexo ETF discovery",
        method: "POST",
        fallbackListingCount: fallbackListings.length,
        finalGroupCount: groups.length,
        errorClassification:
          primaryError instanceof OpenFigiSearchError ? primaryError.code : undefined,
      });
      localSearchCache.set(cacheKey, {
        groups,
        expiresAt: Date.now() + OPENFIGI_SEARCH_CACHE_TTL_MS,
      });
      try {
        await setMarketCachePayload(cacheKey, groups);
      } catch {
        // The in-memory cache remains useful for the current runtime instance.
      }
      return groups;
    })()
    .finally(() => {
      inFlightSearches.delete(cacheKey);
    });

  inFlightSearches.set(cacheKey, request);
  return request;
};

const OPENFIGI_TO_EODHD_EXCHANGES: Record<string, readonly string[]> = {
  US: ["US"],
  GR: ["XETRA"],
  GY: ["F"],
  LN: ["LSE"],
  FP: ["PA"],
  NA: ["AS"],
  IM: ["MI"],
  SW: ["SW"],
  CN: ["TO"],
  HK: ["HK"],
};

const getCandidateTicker = (candidate: EodhdEtfPriceCandidate) =>
  normalizeSymbol(candidate.providerId.split(".")[0] ?? candidate.symbol);

const getExpectedEodhdExchanges = (listing: EtfListing) => {
  const exchangeCode = normalizeSymbol(
    listing.instrumentIdentity.exchangeCode ?? listing.exchangeCode ?? listing.exchange ?? ""
  );
  return OPENFIGI_TO_EODHD_EXCHANGES[exchangeCode] ?? [];
};

type RankedPriceCandidate = {
  candidate: EodhdEtfPriceCandidate;
  score: number;
};

const rankPriceCandidate = (
  listing: EtfListing,
  candidate: EodhdEtfPriceCandidate
): RankedPriceCandidate | null => {
  const ticker = normalizeSymbol(listing.symbol);
  const expectedIsin = normaliseFigi(listing.isin ?? "");
  const expectedCurrency = listing.instrumentIdentity.currency;
  const expectedExchanges = getExpectedEodhdExchanges(listing);
  const candidateIsin = normaliseFigi(candidate.isin ?? "");
  const candidateExchange = normalizeSymbol(candidate.exchange);

  if (!candidate.providerId || getCandidateTicker(candidate) !== ticker) {
    return null;
  }

  if (expectedIsin && candidateIsin !== expectedIsin) {
    return null;
  }

  if (expectedCurrency && candidate.marketCurrency !== expectedCurrency) {
    return null;
  }

  if (expectedExchanges.length > 0 && !expectedExchanges.includes(candidateExchange)) {
    return null;
  }

  // A raw ticker is never enough.  We need either an exact ISIN, or a known
  // venue correspondence that identifies the selected listing.
  if (!expectedIsin && expectedExchanges.length === 0) {
    return null;
  }

  let score = 40; // exact ticker
  if (expectedIsin) score += 100;
  if (expectedExchanges.length > 0) score += 40;
  if (expectedCurrency) score += 20;

  return { candidate, score };
};

const unavailablePriceListing = (listing: EtfListing): EtfListing => ({
  ...listing,
  providerId: undefined,
  providerPriceSymbol: undefined,
  priceStatus: "unavailable",
  instrumentIdentity: {
    ...listing.instrumentIdentity,
    providerPriceSymbol: undefined,
  },
});

const hasVerifiedEtfProviderMapping = (listing: EtfListing) => {
  const providerId = text(listing.providerId);
  const listingPriceSymbol = text(listing.providerPriceSymbol);
  const identityPriceSymbol = text(listing.instrumentIdentity.providerPriceSymbol);
  const sameProviderSymbol =
    Boolean(providerId) &&
    normalizeSymbol(providerId) === normalizeSymbol(listingPriceSymbol) &&
    normalizeSymbol(providerId) === normalizeSymbol(identityPriceSymbol);
  const hasStableInstrumentIdentity = Boolean(
    listing.instrumentIdentity.figi ||
      (listing.isin && (listing.exchangeCode || listing.exchange || listing.mic))
  );

  return sameProviderSymbol && hasStableInstrumentIdentity;
};

/**
 * Resolves an EODHD price source only for an unambiguous, venue-aware match.
 * A selected ETF without such a match remains a valid historical transaction.
 */
export const resolveEtfListingPriceSource = async (
  listing: EtfListing,
  findCandidates: (query: string) => Promise<EodhdEtfPriceCandidate[]> =
    searchEodhdEtfPriceCandidates
): Promise<EtfListing> => {
  // A controlled ETF-catalog fallback can already provide an exact,
  // provider-specific price symbol (for example a GPW `.WA` listing).  Do not
  // erase that identity merely because EODHD cannot independently resolve it.
  if (hasVerifiedEtfProviderMapping(listing)) {
    return {
      ...listing,
      providerPriceSymbol: listing.providerId,
      priceStatus: "unchecked",
      instrumentIdentity: {
        ...listing.instrumentIdentity,
        providerPriceSymbol: listing.providerId,
      },
    };
  }

  const candidates = await findCandidates(listing.symbol);
  const rankedCandidates = uniqueBy(candidates, (candidate) => candidate.providerId)
    .flatMap((candidate) => {
      const ranked = rankPriceCandidate(listing, candidate);
      return ranked ? [ranked] : [];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.providerId.localeCompare(right.candidate.providerId)
    );
  const best = rankedCandidates[0];
  const hasTiedBestCandidate =
    best !== undefined && rankedCandidates.filter((candidate) => candidate.score === best.score).length > 1;

  if (!best || hasTiedBestCandidate) {
    return unavailablePriceListing(listing);
  }

  return {
    ...listing,
    provider: "eodhd",
    providerId: best.candidate.providerId,
    marketCurrency: best.candidate.marketCurrency,
    providerPriceSymbol: best.candidate.providerId,
    priceScale: best.candidate.priceScale,
    priceStatus: "available",
    instrumentIdentity: {
      ...listing.instrumentIdentity,
      currency: best.candidate.marketCurrency,
      providerPriceSymbol: best.candidate.providerId,
    },
  };
};

export const sanitiseEtfListing = (value: unknown): EtfListing | null => {
  const listing = asRecord(value);
  const identity = asRecord(listing?.instrumentIdentity);
  const symbol = normalizeSymbol(text(listing?.symbol));
  const name = text(listing?.name);
  const currency = toCurrency(text(listing?.marketCurrency));
  const ticker = normalizeSymbol(text(identity?.ticker) || symbol);

  if (!listing || !identity || !symbol || !name || !currency || !ticker) {
    return null;
  }

  const cleanFigi = (key: string) => {
    const value = normaliseFigi(text(identity[key]));
    return value || undefined;
  };
  const cleanText = (key: string) => text(identity[key]).slice(0, 160) || undefined;
  const figi = cleanFigi("figi");
  const exchangeCode = normalizeSymbol(cleanText("exchangeCode") ?? cleanText("exchange") ?? "");
  const mic = normalizeSymbol(cleanText("mic") ?? "");
  const listingId = normaliseFigi(text(listing.listingId)) || figi || [ticker, exchangeCode, mic, currency].join(":");
  const providerValue = text(listing.provider);
  const provider = (["binance", "finnhub", "stooq", "yahoo", "eodhd", "coingecko", "catalog", "obligacjeskarbowe"] as const)
    .includes(providerValue as "binance")
    ? providerValue as EtfListing["provider"]
    : "eodhd";
  const providerId = text(listing.providerId).slice(0, 160) || undefined;
  const listingPriceSymbol = text(listing.providerPriceSymbol).slice(0, 160) || undefined;
  const identityPriceSymbol = text(identity.providerPriceSymbol).slice(0, 160) || undefined;
  const isin = text(listing.isin).replace(/\s+/g, "").toUpperCase().slice(0, 32) || undefined;
  const hasConsistentProviderMapping =
    Boolean(providerId) &&
    normalizeSymbol(providerId ?? "") === normalizeSymbol(listingPriceSymbol ?? "") &&
    normalizeSymbol(providerId ?? "") === normalizeSymbol(identityPriceSymbol ?? "") &&
    Boolean(figi || (isin && (exchangeCode || mic)));
  // The resolver route receives a browser payload, so retain a price source
  // only when all three copies of the provider symbol agree and the selected
  // ETF has a stable FIGI or ISIN+venue identity. This keeps catalog-proven
  // mappings such as ETFBDIVPL.WA while refusing loose ticker-only input.
  const trustedProviderId = hasConsistentProviderMapping ? providerId : undefined;

  return {
    listingId,
    symbol,
    name: name.slice(0, 240),
    kind: "etf",
    marketCurrency: currency,
    provider,
    source: "api",
    isin,
    exchange: exchangeCode || undefined,
    exchangeCode: exchangeCode || undefined,
    mic: mic || undefined,
    securityType: cleanText("securityType"),
    providerId: trustedProviderId,
    providerPriceSymbol: trustedProviderId,
    priceStatus: "unchecked",
    instrumentIdentity: {
      figi,
      compositeFigi: cleanFigi("compositeFigi"),
      shareClassFigi: cleanFigi("shareClassFigi"),
      ticker,
      name: name.slice(0, 240),
      instrumentType: "ETF",
      exchange: exchangeCode || undefined,
      exchangeCode: exchangeCode || undefined,
      mic: mic || undefined,
      currency,
      securityType: cleanText("securityType"),
      securityType2: cleanText("securityType2"),
      providerPriceSymbol: trustedProviderId,
    },
  };
};

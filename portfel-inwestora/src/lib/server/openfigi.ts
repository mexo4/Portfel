import { searchEodhdEtfs } from "@/lib/server/eodhd";
import { getMarketCachePayload, setMarketCachePayload } from "@/lib/server/market-cache";
import { normalizeSymbol } from "@/lib/ticker";
import { normalizeText, toCurrencyCode, uniqueBy } from "@/lib/utils";
import type {
  CurrencyCode,
  EtfListing,
  EtfSearchGroup,
  InstrumentIdentity,
  InstrumentSearchResult,
} from "@/types/portfolio";

const OPENFIGI_API_ROOT = "https://api.openfigi.com/v3";
const OPENFIGI_SEARCH_CACHE_TTL_MS = 5 * 60 * 1_000;
const OPENFIGI_REQUEST_TIMEOUT_MS = 7_000;
const OPENFIGI_MAX_RESULTS = 60;

type JsonRecord = Record<string, unknown>;

type OpenFigiFilterResponse = {
  data?: unknown[];
};

type OpenFigiMappingResponse = Array<{
  data?: unknown[];
}>;

export type OpenFigiSearchFailureCode =
  | "configuration"
  | "rate_limit"
  | "unavailable"
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
  search: (query: string) => Promise<InstrumentSearchResult[]>;
};

type FetchLike = typeof fetch;

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

const getSecurityType = (record: JsonRecord) => field(record, "securityType");
const getSecurityType2 = (record: JsonRecord) => field(record, "securityType2");
const getMarketSector = (record: JsonRecord) => field(record, "marketSector");

const isEtf = (record: JsonRecord) => {
  const descriptor = normalizeText(
    [getSecurityType(record), getSecurityType2(record), field(record, "securityDescription")]
      .filter(Boolean)
      .join(" ")
  );

  return descriptor.includes("etf") || descriptor.includes("exchange traded fund");
};

const toCurrency = (value: string): CurrencyCode | undefined => {
  const normalized = normalizeSymbol(value);
  return /^[A-Z]{3}$/.test(normalized) ? toCurrencyCode(normalized) : undefined;
};

const toSearchComparable = (value: string) => normalizeText(value).replaceAll(" ", "");

const getOpenFigiQueryVariants = (query: string) => {
  const normalized = query.trim().replace(/\s+/g, " ");
  const withNumberBoundaries = normalized
    .replace(/([\p{L}])(?=\d)/gu, "$1 ")
    .replace(/(\d)(?=\p{L})/gu, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
  const punctuationSeparated = withNumberBoundaries
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compact = punctuationSeparated.replaceAll(" ", "");

  return uniqueBy(
    [normalized, withNumberBoundaries, punctuationSeparated, compact].filter(Boolean),
    (variant) => variant.toLocaleLowerCase()
  ).slice(0, 4);
};

const logOpenFigiSearchDiagnostic = (payload: {
  query: string;
  sentQueries: string[];
  responses: Array<{
    query: string;
    status: number;
    rawResultCount: number;
    firstTypes: string[];
  }>;
  normalizedResultCount: number;
  etfContextResultCount: number;
}) => {
  if (process.env.OPENFIGI_DIAGNOSTICS !== "true") {
    return;
  }

  console.info("OpenFIGI search diagnostic", payload);
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
  if (name.startsWith(normalizedText)) return 3;
  if (name.includes(normalizedText)) return 4;
  return 5;
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

  if (!record || !isEtf(record)) {
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
    // OpenFIGI v3 does not include currency in every result.  This is only a
    // form default; `instrumentIdentity.currency` remains absent until the
    // price resolver verifies it or the user explicitly confirms a currency.
    marketCurrency: currency ?? "USD",
    provider: "eodhd",
    source: "api",
    subtitle: [exchangeCode, mic].filter(Boolean).join(" / ") || undefined,
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

export const groupEtfListings = (query: string, rawItems: unknown[]): EtfSearchGroup[] => {
  const listings = uniqueBy(
    rawItems
      .map(toListing)
      .filter((listing): listing is EtfListing => Boolean(listing)),
    (listing) => listing.listingId
  ).sort((left, right) => compareListings(query, left, right));
  const groups = new Map<string, EtfSearchGroup>();

  listings.forEach((listing) => {
    const groupIdentifier =
      listing.instrumentIdentity.shareClassFigi ||
      listing.instrumentIdentity.compositeFigi ||
      listing.instrumentIdentity.figi;
    const groupId = groupIdentifier
      ? `etf:${groupIdentifier}`
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
        shareClassFigi: listing.instrumentIdentity.shareClassFigi,
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
        getMatchScore(query, left.listings[0]!) - getMatchScore(query, right.listings[0]!) ||
        left.name.localeCompare(right.name)
    );
};

const isFigiQuery = (query: string) => /^BBG[A-Z0-9]{9,}$/i.test(query);
const isIsinQuery = (query: string) => /^[A-Z]{2}[A-Z0-9]{9}\d$/i.test(query);

const parseResponse = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    throw new OpenFigiSearchError("invalid_response");
  }
};

const requestOpenFigi = async ({
  path,
  payload,
  apiKey,
  fetcher = fetch,
}: {
  path: "/filter" | "/mapping";
  payload: unknown;
  apiKey: string;
  fetcher?: FetchLike;
}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENFIGI_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetcher(`${OPENFIGI_API_ROOT}${path}`, {
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

    if (response.status === 429) {
      throw new OpenFigiSearchError("rate_limit");
    }

    if (!response.ok) {
      throw new OpenFigiSearchError("unavailable");
    }

    return parseResponse(response);
  } catch (error) {
    if (error instanceof OpenFigiSearchError) {
      throw error;
    }

    throw new OpenFigiSearchError("unavailable");
  } finally {
    clearTimeout(timeoutId);
  }
};

export class OpenFigiInstrumentSearchProvider implements InstrumentSearchProvider {
  private readonly apiKey: string;
  private readonly fetcher: FetchLike;

  constructor(
    apiKey = process.env.OPENFIGI_API_KEY?.trim() ?? "",
    fetcher: FetchLike = fetch
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  async searchEtfs(query: string) {
    if (!this.apiKey) {
      throw new OpenFigiSearchError("configuration");
    }

    const normalizedQuery = query.trim().replace(/\s+/g, " ");
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
          fetcher: this.fetcher,
        })
      : await requestOpenFigi({
          path: "/filter",
          payload: {
            query: normalizedQuery,
            securityType: "ETF",
          },
          apiKey: this.apiKey,
          fetcher: this.fetcher,
        });
    if (isIdentifier && !Array.isArray(response)) {
      throw new OpenFigiSearchError("invalid_response");
    }

    if (!isIdentifier && !asRecord(response)) {
      throw new OpenFigiSearchError("invalid_response");
    }

    const rawItems = isIdentifier
      ? ((response as OpenFigiMappingResponse)
          .flatMap((item) => (Array.isArray(item.data) ? item.data : []))
          .slice(0, OPENFIGI_MAX_RESULTS) as unknown[])
      : ((response as OpenFigiFilterResponse).data ?? []).slice(0, OPENFIGI_MAX_RESULTS);

    return groupEtfListings(normalizedQuery, rawItems);
  }
}

const localSearchCache = new Map<string, { groups: EtfSearchGroup[]; expiresAt: number }>();
const requestWindows = new Map<string, number[]>();
const SEARCH_RATE_WINDOW_MS = 60_000;
const SEARCH_RATE_LIMIT = 12;

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
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  const cacheKey = `openfigi:etf:search:${normalizeText(normalizedQuery)}`;
  const cached = await getCachedSearch(cacheKey);

  if (cached) {
    return cached;
  }

  if (actorId) {
    enforceOpenFigiSearchRateLimit(actorId);
  }

  const groups = await provider.searchEtfs(normalizedQuery);
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
};

const getEodhdTicker = (providerId: string | undefined, fallbackSymbol: string) =>
  normalizeSymbol(providerId?.split(".")[0] ?? fallbackSymbol);

/**
 * Resolves a pricing identifier only when the current price provider returns a
 * single compatible listing.  Ambiguity intentionally stays unresolved rather
 * than guessing a price from another exchange or currency.
 */
export const resolveEtfListingPriceSource = async (listing: EtfListing): Promise<EtfListing> => {
  const candidates = await searchEodhdEtfs(listing.symbol);
  const ticker = normalizeSymbol(listing.symbol);
  const compatible = candidates.filter(
    (candidate) =>
      getEodhdTicker(candidate.providerId, candidate.symbol) === ticker &&
      (!listing.instrumentIdentity.currency ||
        candidate.marketCurrency === listing.marketCurrency) &&
      Boolean(candidate.providerId)
  );
  const uniqueCandidates = uniqueBy(compatible, (candidate) => candidate.providerId ?? "");

  if (uniqueCandidates.length !== 1) {
    return {
      ...listing,
      providerId: undefined,
      providerPriceSymbol: undefined,
      priceStatus: "unavailable",
      instrumentIdentity: {
        ...listing.instrumentIdentity,
        providerPriceSymbol: undefined,
      },
    };
  }

  const candidate = uniqueCandidates[0]!;
  return {
    ...listing,
    provider: "eodhd",
    providerId: candidate.providerId,
    marketCurrency: candidate.marketCurrency,
    providerPriceSymbol: candidate.providerId,
    priceScale: candidate.priceScale,
    priceStatus: "available",
    instrumentIdentity: {
      ...listing.instrumentIdentity,
      currency: candidate.marketCurrency,
      providerPriceSymbol: candidate.providerId,
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

  return {
    listingId,
    symbol,
    name: name.slice(0, 240),
    kind: "etf",
    marketCurrency: currency,
    provider: "eodhd",
    source: "api",
    exchange: exchangeCode || undefined,
    exchangeCode: exchangeCode || undefined,
    mic: mic || undefined,
    securityType: cleanText("securityType"),
    providerId: undefined,
    providerPriceSymbol: undefined,
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
    },
  };
};

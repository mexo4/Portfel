import { getMarketCachePayload, setMarketCachePayload } from "@/lib/server/market-cache";
import { normalizeSymbol } from "@/lib/ticker";
import { normalizeText, round, toCurrencyCode, uniqueBy } from "@/lib/utils";
import type {
  AssetKind,
  AssetQuote,
  AssetSearchResult,
  CurrencyCode,
  FxRates,
} from "@/types/portfolio";

type EodhdSearchItem = {
  Code?: string;
  Name?: string;
  Type?: string;
  Exchange?: string;
  Country?: string;
  Currency?: string;
  ISIN?: string | null;
  Isin?: string | null;
};

export type EodhdIssuerIdentityLookup = {
  symbol: string;
  name: string;
  providerId?: string;
  provider?: string;
  isin?: string;
  exchange?: string;
};

type EodhdExchangeItem = {
  Code?: string;
  Name?: string;
  Type?: string;
  Exchange?: string;
  Country?: string;
  Currency?: string;
  ISIN?: string | null;
  Isin?: string | null;
};

type EodhdQuoteResponse = {
  code?: string;
  close?: number;
  previousClose?: number;
  timestamp?: number;
};

type EodhdHistoricalItem = {
  date?: string;
  close?: number;
  adjusted_close?: number;
};

type EodhdSearchKind = Extract<AssetKind, "stock" | "etf">;

type EodhdListing = {
  symbol: string;
  providerId: string;
  name: string;
  kind: EodhdSearchKind;
  exchange: string;
  country?: string;
  marketCurrency: CurrencyCode;
  isin?: string;
  priceScale?: number;
};

/**
 * Internal, ETF-only candidate shape used to resolve a price source selected
 * through OpenFIGI.  It intentionally keeps venue and ISIN metadata that the
 * general asset-search result does not need to expose.
 */
export type EodhdEtfPriceCandidate = Pick<
  EodhdListing,
  "symbol" | "providerId" | "name" | "exchange" | "country" | "marketCurrency" | "isin" | "priceScale"
>;

const EODHD_API_KEY = process.env.EODHD_API_KEY ?? "";
const EODHD_API_ROOT = "https://eodhd.com/api";
const EODHD_SEARCH_RESULT_LIMIT = 16;
const EODHD_SEARCH_TIMEOUT_MS = 4_000;
const EODHD_EXCHANGE_SEARCH_TIMEOUT_MS = 5_000;
const EODHD_SEARCH_CACHE_TTL_MS = 5 * 60 * 1_000;
const EODHD_EXCHANGE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const EODHD_QUOTE_CACHE_TTL_MS = 30_000;
const FX_RATE_CACHE_TTL_MS = 5 * 60 * 1_000;
const EODHD_ISSUER_SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

const EODHD_FALLBACK_EXCHANGES = [
  "WAR",
  "US",
  "LSE",
  "XETRA",
  "F",
  "AS",
  "PA",
  "MI",
  "SW",
  "TO",
  "NEO",
  "V",
  "HK",
  "MX",
] as const;

const EODHD_EXCHANGE_SUFFIX: Record<string, string> = {
  AS: "AS",
  BE: "BE",
  DU: "DU",
  F: "F",
  HK: "HK",
  HM: "HM",
  LSE: "L",
  MI: "MI",
  MU: "MU",
  MX: "MX",
  NEO: "NEO",
  PA: "PA",
  STU: "STU",
  SW: "SW",
  TO: "TO",
  US: "",
  V: "V",
  WAR: "PL",
  XETRA: "DE",
};

const DISPLAY_SUFFIX_TO_EODHD_EXCHANGES: Record<string, string[]> = {
  AS: ["AS"],
  BE: ["BE"],
  DE: ["XETRA"],
  DU: ["DU"],
  F: ["F"],
  HK: ["HK"],
  HM: ["HM"],
  L: ["LSE"],
  MI: ["MI"],
  MU: ["MU"],
  MX: ["MX"],
  NEO: ["NEO"],
  PA: ["PA"],
  STU: ["STU"],
  SW: ["SW"],
  TO: ["TO"],
  US: ["US"],
  V: ["V"],
  WA: ["WAR"],
  PL: ["WAR"],
};

const quoteCache = new Map<string, { quote: AssetQuote; expiresAt: number }>();
const fxRateCache = new Map<string, { rate: number; expiresAt: number }>();
const issuerSearchInFlight = new Map<string, Promise<EodhdSearchItem[] | null>>();

const hasEodhdApiKey = () => Boolean(EODHD_API_KEY);

const getCachedPayload = getMarketCachePayload;
const setCachedPayload = setMarketCachePayload;

const fetchJson = async <T,>(url: string, timeoutMs = 15_000): Promise<T | null> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const normalizeMoneyUnit = (value?: string) => {
  const normalized = toCurrencyCode(value, "USD");

  if (normalized === "GBX") {
    return {
      currency: "GBP" as CurrencyCode,
      priceScale: 0.01,
    };
  }

  if (normalized === "ZAC") {
    return {
      currency: "ZAR" as CurrencyCode,
      priceScale: 0.01,
    };
  }

  return {
    currency: normalized,
    priceScale: 1,
  };
};

const toProviderId = (code: string, exchange: string) => {
  const normalizedCode = normalizeSymbol(code);
  const normalizedExchange = normalizeSymbol(exchange);
  const providerSuffix = normalizedExchange === "WAR" ? "PL" : normalizedExchange;

  return `${normalizedCode}.${providerSuffix}`;
};

const toDisplaySymbol = (code: string, exchange: string) => {
  const normalizedCode = normalizeSymbol(code);
  const normalizedExchange = normalizeSymbol(exchange);
  const suffix = EODHD_EXCHANGE_SUFFIX[normalizedExchange];

  if (suffix === "") {
    return normalizedCode;
  }

  return `${normalizedCode}.${suffix ?? normalizedExchange}`;
};

const getQueryCandidates = (query: string) => {
  const trimmedQuery = query.trim();
  const normalizedQuery = normalizeSymbol(trimmedQuery);

  if (!normalizedQuery) {
    return [];
  }

  const parts = normalizedQuery.split(".");
  const baseTicker = parts[0] ?? "";
  const displaySuffix = parts.at(-1) ?? "";
  const exchangeVariant =
    baseTicker && displaySuffix === "WA"
      ? `${baseTicker}.PL`
      : baseTicker && displaySuffix === "PL"
        ? `${baseTicker}.WA`
        : "";

  return uniqueBy(
    [trimmedQuery, normalizedQuery, exchangeVariant, baseTicker].filter(Boolean),
    (item) => normalizeSymbol(item)
  );
};

const getQueryDisplaySuffix = (query: string) => {
  const parts = normalizeSymbol(query).split(".");

  if (parts.length < 2) {
    return null;
  }

  return parts.at(-1) ?? null;
};

const getListingIsin = (item: { ISIN?: string | null; Isin?: string | null }) =>
  normalizeSymbol(item.ISIN ?? item.Isin ?? "");

const toEodhdListing = (
  item: EodhdSearchItem | EodhdExchangeItem,
  kind: EodhdSearchKind
): EodhdListing | null => {
  const code = normalizeSymbol(item.Code ?? "");
  const exchange = normalizeSymbol(item.Exchange ?? "");
  const name = item.Name?.trim() ?? "";

  if (!code || !exchange || !name) {
    return null;
  }

  const { currency, priceScale } = normalizeMoneyUnit(item.Currency);
  const isin = getListingIsin(item);

  return {
    symbol: toDisplaySymbol(code, exchange),
    providerId: toProviderId(code, exchange),
    name,
    kind,
    exchange,
    country: item.Country?.trim(),
    marketCurrency: currency,
    isin: isin || undefined,
    priceScale: priceScale === 1 ? undefined : priceScale,
  };
};

const getListingMatchScore = (query: string, item: EodhdListing) => {
  const normalizedQuerySymbol = normalizeSymbol(query);
  const normalizedQueryText = normalizeText(query);
  const normalizedItemName = normalizeText(item.name);
  const providerId = normalizeSymbol(item.providerId);
  const listingCode = providerId.split(".")[0] ?? "";

  if (item.symbol === normalizedQuerySymbol) return 0;
  if (providerId === normalizedQuerySymbol) return 1;
  if (item.isin === normalizedQuerySymbol) return 2;
  if (listingCode === normalizedQuerySymbol) return 3;
  if (normalizedItemName === normalizedQueryText) return 4;
  if (item.symbol.startsWith(normalizedQuerySymbol)) return 5;
  if (listingCode.startsWith(normalizedQuerySymbol)) return 6;
  if (normalizedItemName.startsWith(normalizedQueryText)) return 7;
  if (normalizedItemName.includes(normalizedQueryText)) return 8;
  return 9;
};

const toSearchResult = (item: EodhdListing): AssetSearchResult => ({
  symbol: item.symbol,
  name: item.name,
  kind: item.kind,
  marketCurrency: item.marketCurrency,
  provider: "eodhd",
  providerId: item.providerId,
  subtitle: [item.exchange, item.country].filter(Boolean).join(" / "),
  source: "api",
  isin: item.isin,
  priceScale: item.priceScale,
  // EODHD Search's Country field describes the listing venue, not the
  // issuer's country of registration. For ordinary stocks keep it in subtitle
  // only. Preserve the pre-existing ETF search payload contract; ETFs are not
  // classified by issuer country in the asset-class allocation.
  issuerCountry: item.kind === "stock" ? undefined : item.country,
});

const fetchSearchListings = async (query: string, kind: EodhdSearchKind) => {
  if (!hasEodhdApiKey()) {
    return [];
  }

  const cacheKey = `eodhd:${kind}:search:${normalizeText(query)}`;
  const cachedPayload = await getCachedPayload<EodhdSearchItem[]>(
    cacheKey,
    EODHD_SEARCH_CACHE_TTL_MS
  );

  if (cachedPayload) {
    return cachedPayload
      .map((item) => toEodhdListing(item, kind))
      .filter((item): item is EodhdListing => Boolean(item));
  }

  const payload = await fetchJson<EodhdSearchItem[]>(
    `${EODHD_API_ROOT}/search/${encodeURIComponent(query)}?api_token=${encodeURIComponent(EODHD_API_KEY)}&fmt=json&type=${kind}&limit=50`,
    EODHD_SEARCH_TIMEOUT_MS
  );

  if (!payload) {
    return [];
  }

  await setCachedPayload(cacheKey, payload);

  return payload
    .map((item) => toEodhdListing(item, kind))
    .filter((item): item is EodhdListing => Boolean(item));
};

const fetchExchangeListings = async (exchange: string, kind: EodhdSearchKind) => {
  if (!hasEodhdApiKey()) {
    return [];
  }

  const normalizedExchange = normalizeSymbol(exchange);
  const cacheKey = `eodhd:${kind}:exchange:${normalizedExchange}`;
  const cachedPayload = await getCachedPayload<EodhdExchangeItem[]>(
    cacheKey,
    EODHD_EXCHANGE_CACHE_TTL_MS
  );

  if (cachedPayload) {
    return cachedPayload
      .map((item) => toEodhdListing(item, kind))
      .filter((item): item is EodhdListing => Boolean(item));
  }

  const payload = await fetchJson<EodhdExchangeItem[]>(
    `${EODHD_API_ROOT}/exchange-symbol-list/${encodeURIComponent(normalizedExchange)}?api_token=${encodeURIComponent(EODHD_API_KEY)}&fmt=json&type=${kind}`,
    EODHD_EXCHANGE_SEARCH_TIMEOUT_MS
  );

  if (!payload) {
    return [];
  }

  await setCachedPayload(cacheKey, payload);

  return payload
    .map((item) => toEodhdListing(item, kind))
    .filter((item): item is EodhdListing => Boolean(item));
};

const EODHD_ISSUER_EXCHANGE_SUFFIXES: Record<string, string> = {
  AS: "AS",
  AU: "AU",
  BE: "BE",
  BSE: "BSE",
  CO: "CO",
  DE: "XETRA",
  DU: "DU",
  F: "F",
  HK: "HK",
  HM: "HM",
  JK: "JK",
  KL: "KL",
  KO: "KO",
  KQ: "KQ",
  L: "LSE",
  UK: "LSE",
  MI: "MI",
  MU: "MU",
  MX: "MX",
  NEO: "NEO",
  NSE: "NSE",
  PA: "PA",
  PL: "WAR",
  WA: "WAR",
  STU: "STU",
  SW: "SW",
  SG: "SG",
  TSE: "TSE",
  TO: "TO",
  TW: "TW",
  US: "US",
  V: "V",
};

const EODHD_ISSUER_EXCHANGE_ALIASES: Record<string, string> = {
  "AUSTRALIAN SECURITIES EXCHANGE": "AU",
  "NEW YORK STOCK EXCHANGE": "US",
  "NEW YORK STOCK EXCHANGE INC": "US",
  NYSE: "US",
  NASDAQ: "US",
  "NASDAQ GLOBAL MARKET": "US",
  "NYSE ARCA": "US",
  GPW: "WAR",
  WARSAW: "WAR",
  "WARSAW STOCK EXCHANGE": "WAR",
  "LONDON STOCK EXCHANGE": "LSE",
  LSE: "LSE",
  "NASDAQ COPENHAGEN": "CO",
  "TOKYO STOCK EXCHANGE": "TSE",
  XETRA: "XETRA",
};

const getIssuerLookupCodeAndExchange = (value: string) => {
  const normalized = normalizeSymbol(value);
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot <= 0) return { code: normalized, exchange: undefined };

  const suffix = normalized.slice(lastDot + 1);
  const exchange = EODHD_ISSUER_EXCHANGE_SUFFIXES[suffix];
  return exchange
    ? { code: normalized.slice(0, lastDot), exchange }
    : { code: normalized, exchange: undefined };
};

const normalizeIssuerLookupExchange = (value: string | undefined) => {
  if (!value?.trim()) return undefined;
  const normalized = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  return EODHD_ISSUER_EXCHANGE_ALIASES[normalized] ??
    EODHD_ISSUER_EXCHANGE_SUFFIXES[normalized.replace(/\s+/g, "")] ??
    normalized;
};

const ISSUER_NAME_SUFFIXES = new Set([
  "adr",
  "class",
  "co",
  "company",
  "corp",
  "corporation",
  "depositary",
  "inc",
  "incorporated",
  "limited",
  "ltd",
  "ordinary",
  "plc",
  "receipt",
  "receipts",
  "shares",
]);

const issuerNameTokens = (value: string) =>
  normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !ISSUER_NAME_SUFFIXES.has(token));

const isCompatibleIssuerName = (left: string, right: string) => {
  const leftTokens = Array.from(new Set(issuerNameTokens(left)));
  const rightTokens = Array.from(new Set(issuerNameTokens(right)));
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;

  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const longer = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
  return shorter.every((token) => longer.includes(token));
};

const isCommonEquityType = (value: string | undefined) => {
  const normalized = normalizeText(value ?? "");
  return ["common stock", "ordinary share", "ordinary shares", "common shares"].includes(normalized);
};

const normalizeSearchIsin = (value: unknown) => {
  const isin = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin) ? isin : undefined;
};

/**
 * Resolve a listing ISIN only from an exact ticker/code + compatible company
 * name + common-equity EODHD result. The Search API's Country field is the
 * listing country and is deliberately never read here. Its result only gives
 * us an ISIN to check against GLEIF's legal-entity record.
 */
export const parseEodhdCommonStockIsin = (
  payload: unknown,
  identity: EodhdIssuerIdentityLookup,
  exchangeConstraint?: string
) => {
  if (!Array.isArray(payload)) return null;
  const { code: identityCode, exchange: identityExchange } = getIssuerLookupCodeAndExchange(
    identity.providerId?.trim() || identity.symbol
  );
  const fallbackCode = getIssuerLookupCodeAndExchange(identity.symbol).code;
  const requestedCode = identityCode || fallbackCode;
  const requiredExchange = normalizeIssuerLookupExchange(exchangeConstraint) ??
    normalizeIssuerLookupExchange(identity.exchange) ??
    identityExchange;
  const candidates = new Set<string>();

  for (const rawItem of payload) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
    const item = rawItem as EodhdSearchItem;
    const code = normalizeSymbol(item.Code ?? "");
    const exchange = normalizeIssuerLookupExchange(item.Exchange);
    const name = item.Name?.trim() ?? "";
    const isin = normalizeSearchIsin(item.ISIN ?? item.Isin);

    if (
      code !== requestedCode ||
      !isCommonEquityType(item.Type) ||
      !isin ||
      !name ||
      !identity.name.trim() ||
      !isCompatibleIssuerName(identity.name, name) ||
      (requiredExchange && exchange !== requiredExchange)
    ) {
      continue;
    }

    candidates.add(isin);
  }

  return candidates.size === 1 ? Array.from(candidates)[0]! : null;
};

const fetchIssuerSearchPayload = async (query: string, exchange?: string) => {
  if (!hasEodhdApiKey() || !query) return null;

  const normalizedExchange = normalizeIssuerLookupExchange(exchange);
  const cacheKey = `eodhd:issuer-search:v1:${normalizedExchange ?? "all"}:${normalizeSymbol(query)}`;
  const existing = issuerSearchInFlight.get(cacheKey);
  if (existing) return existing;

  const pending = (async () => {
    try {
      const cached = await getCachedPayload<EodhdSearchItem[]>(
        cacheKey,
        EODHD_ISSUER_SEARCH_CACHE_TTL_MS
      );
      if (cached) return cached;
    } catch {
      // Provider lookup may continue when the shared cache is unavailable.
    }

    const url = new URL(`${EODHD_API_ROOT}/search/${encodeURIComponent(query)}`);
    url.searchParams.set("api_token", EODHD_API_KEY);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("type", "stock");
    url.searchParams.set("limit", "50");
    if (normalizedExchange) url.searchParams.set("exchange", normalizedExchange);

    const payload = await fetchJson<unknown>(url.toString(), EODHD_SEARCH_TIMEOUT_MS);
    if (!Array.isArray(payload)) return null;
    const items = payload.filter(
      (item): item is EodhdSearchItem => item !== null && typeof item === "object" && !Array.isArray(item)
    );

    try {
      await setCachedPayload(cacheKey, items);
    } catch {
      // The public-source response remains useful even if the cache write fails.
    }
    return items;
  })().finally(() => {
    if (issuerSearchInFlight.get(cacheKey) === pending) issuerSearchInFlight.delete(cacheKey);
  });

  issuerSearchInFlight.set(cacheKey, pending);
  return pending;
};

/**
 * Recover a missing ISIN for a legacy stock lot. Search results are accepted
 * only when the ticker, listing venue (when known), company name and ordinary
 * share type agree. Multiple distinct matching ISINs fail closed.
 */
export const resolveEodhdCommonStockIsin = async (identity: EodhdIssuerIdentityLookup) => {
  const lookupSource = identity.providerId?.trim() || identity.symbol.trim();
  const primary = getIssuerLookupCodeAndExchange(lookupSource);
  const fallback = getIssuerLookupCodeAndExchange(identity.symbol);
  const query = primary.code || fallback.code;
  const exchange = normalizeIssuerLookupExchange(identity.exchange) ?? primary.exchange ?? fallback.exchange;
  if (!query || !identity.name.trim()) return null;

  const payload = await fetchIssuerSearchPayload(query, exchange);
  return payload ? parseEodhdCommonStockIsin(payload, identity, exchange) : null;
};

const searchExchangeFallbackListings = async (query: string, kind: EodhdSearchKind) => {
  const normalizedQuery = normalizeSymbol(query);

  if (!normalizedQuery) {
    return [];
  }

  const displaySuffix = getQueryDisplaySuffix(query);
  const candidateExchanges = displaySuffix
    ? DISPLAY_SUFFIX_TO_EODHD_EXCHANGES[displaySuffix] ?? []
    : [...EODHD_FALLBACK_EXCHANGES];

  if (candidateExchanges.length === 0) {
    return [];
  }

  const listings = (
    await Promise.all(candidateExchanges.map((exchange) => fetchExchangeListings(exchange, kind)))
  ).flat();

  const normalizedQueryText = normalizeText(query);

  return listings.filter((item) => {
    const providerCode = item.providerId.split(".")[0] ?? "";
    const haystack = normalizeText(
      [item.symbol, providerCode, item.name, item.isin, item.exchange, item.country]
        .filter(Boolean)
        .join(" ")
    );

    return (
      item.symbol === normalizedQuery ||
      providerCode === normalizedQuery ||
      item.isin === normalizedQuery ||
      haystack.includes(normalizedQueryText)
    );
  });
};

export const searchEodhdAssets = async (
  query: string,
  kind: EodhdSearchKind
): Promise<AssetSearchResult[]> => {
  if (!hasEodhdApiKey()) {
    return [];
  }

  const queryCandidates = getQueryCandidates(query);

  if (queryCandidates.length === 0) {
    return [];
  }

  const remoteListings = (
    await Promise.all(queryCandidates.map((candidate) => fetchSearchListings(candidate, kind)))
  ).flat();

  let combinedListings = uniqueBy(remoteListings, (item) => item.providerId);
  const hasExactMatch = combinedListings.some(
    (item) =>
      item.symbol === normalizeSymbol(query) ||
      item.providerId === normalizeSymbol(query) ||
      item.isin === normalizeSymbol(query)
  );

  if (!hasExactMatch || combinedListings.length === 0) {
    const fallbackListings = await searchExchangeFallbackListings(query, kind);
    combinedListings = uniqueBy(
      [...combinedListings, ...fallbackListings],
      (item) => item.providerId
    );
  }

  return combinedListings
    .sort(
      (left, right) =>
        getListingMatchScore(query, left) - getListingMatchScore(query, right) ||
        left.name.localeCompare(right.name, "en")
    )
    .slice(0, EODHD_SEARCH_RESULT_LIMIT)
    .map(toSearchResult);
};

export const searchEodhdEtfs = (query: string) => searchEodhdAssets(query, "etf");

/**
 * This deliberately does not use exchange-wide fallbacks.  Price resolution
 * must prefer an unavailable quote to a potentially unrelated listing.
 */
export const searchEodhdEtfPriceCandidates = async (
  query: string
): Promise<EodhdEtfPriceCandidate[]> => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery || !hasEodhdApiKey()) {
    return [];
  }

  const listings = await fetchSearchListings(normalizedQuery, "etf");
  return uniqueBy(listings, (listing) => listing.providerId);
};

export const searchEodhdStocks = (query: string) => searchEodhdAssets(query, "stock");

const getCachedQuote = (
  providerId: string,
  symbol: string,
  marketCurrency: CurrencyCode,
  priceScale?: number
) => {
  const cacheKey = normalizeSymbol(providerId);
  const cachedEntry = quoteCache.get(cacheKey);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    quoteCache.delete(cacheKey);
    return null;
  }

  return {
    ...cachedEntry.quote,
    symbol,
    providerId: cacheKey,
    marketCurrency,
    priceScale,
  };
};

const setCachedQuote = (providerId: string, quote: AssetQuote) => {
  quoteCache.set(normalizeSymbol(providerId), {
    quote: {
      ...quote,
      providerId: normalizeSymbol(providerId),
    },
    expiresAt: Date.now() + EODHD_QUOTE_CACHE_TTL_MS,
  });
};

const normalizeQuotePrice = (price: number, priceScale?: number) =>
  round(price * (priceScale ?? 1), 4);

export const fetchEodhdQuote = async ({
  symbol,
  providerId,
  marketCurrency,
  priceScale,
}: {
  symbol: string;
  providerId?: string;
  marketCurrency: CurrencyCode;
  priceScale?: number;
}): Promise<AssetQuote | null> => {
  const normalizedProviderId = normalizeSymbol(providerId ?? "");

  if (!hasEodhdApiKey() || !normalizedProviderId) {
    return null;
  }

  const cachedQuote = getCachedQuote(
    normalizedProviderId,
    symbol,
    marketCurrency,
    priceScale
  );

  if (cachedQuote) {
    return cachedQuote;
  }

  const realtimeQuote = await fetchJson<EodhdQuoteResponse>(
    `${EODHD_API_ROOT}/real-time/${encodeURIComponent(normalizedProviderId)}?api_token=${encodeURIComponent(EODHD_API_KEY)}&fmt=json`
  );
  const realtimePrice =
    typeof realtimeQuote?.close === "number" && realtimeQuote.close > 0
      ? realtimeQuote.close
      : typeof realtimeQuote?.previousClose === "number" && realtimeQuote.previousClose > 0
        ? realtimeQuote.previousClose
        : null;

  if (realtimePrice !== null) {
    const fetchedAt = new Date().toISOString();
    const marketTimestamp =
      typeof realtimeQuote?.timestamp === "number" && realtimeQuote.timestamp > 0
        ? new Date(realtimeQuote.timestamp * 1_000).toISOString()
        : undefined;
    const quote: AssetQuote = {
      symbol,
      price: normalizeQuotePrice(realtimePrice, priceScale),
      marketCurrency,
      provider: "eodhd",
      providerId: normalizedProviderId,
      fetchedAt,
      marketTimestamp,
      priceDate: marketTimestamp?.slice(0, 10),
      priceScale,
      previousClose:
        typeof realtimeQuote?.previousClose === "number" && realtimeQuote.previousClose > 0
          ? normalizeQuotePrice(realtimeQuote.previousClose, priceScale)
          : undefined,
    };
    setCachedQuote(normalizedProviderId, quote);
    return quote;
  }

  const dateTo = new Date().toISOString().slice(0, 10);
  const dateFrom = new Date(Date.now() - 14 * 24 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  const history = await fetchJson<EodhdHistoricalItem[]>(
    `${EODHD_API_ROOT}/eod/${encodeURIComponent(normalizedProviderId)}?api_token=${encodeURIComponent(EODHD_API_KEY)}&fmt=json&from=${dateFrom}&to=${dateTo}`,
    20_000
  );
  const historyCloses = (history ?? []).reduce<Array<{ price: number; priceDate?: string }>>(
    (snapshots, item) => {
      const price =
        typeof item.close === "number" && item.close > 0
          ? item.close
          : typeof item.adjusted_close === "number" && item.adjusted_close > 0
            ? item.adjusted_close
            : null;
      const priceDate =
        typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
          ? item.date
          : undefined;

      if (price !== null) {
        snapshots.push({ price, priceDate });
      }
      return snapshots;
    },
    []
  )
    .sort((left, right) => (left.priceDate ?? "").localeCompare(right.priceDate ?? ""));
  const historySnapshot = historyCloses.at(-1);
  const historyPrice = historySnapshot?.price;
  const previousClose = historyCloses.length > 1 ? historyCloses.at(-2)?.price : undefined;

  if (typeof historyPrice !== "number" || historyPrice <= 0) {
    return null;
  }

  const quote: AssetQuote = {
    symbol,
    price: normalizeQuotePrice(historyPrice, priceScale),
    marketCurrency,
    provider: "eodhd",
    providerId: normalizedProviderId,
    fetchedAt: new Date().toISOString(),
    priceDate: historySnapshot?.priceDate,
    priceScale,
    previousClose:
      typeof previousClose === "number" && previousClose > 0
        ? normalizeQuotePrice(previousClose, priceScale)
        : undefined,
  };
  setCachedQuote(normalizedProviderId, quote);
  return quote;
};

export const fetchEodhdEtfQuote = fetchEodhdQuote;

const getCachedFxRate = (code: string) => {
  const normalizedCode = normalizeSymbol(code);

  if (normalizedCode === "PLN") {
    return 1;
  }

  const cachedEntry = fxRateCache.get(normalizedCode);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    fxRateCache.delete(normalizedCode);
    return null;
  }

  return cachedEntry.rate;
};

const setCachedFxRate = (code: string, rate: number) => {
  fxRateCache.set(normalizeSymbol(code), {
    rate,
    expiresAt: Date.now() + FX_RATE_CACHE_TTL_MS,
  });
};

const fetchFxPairRate = async (pair: string) => {
  const response = await fetchJson<EodhdQuoteResponse>(
    `${EODHD_API_ROOT}/real-time/${encodeURIComponent(pair)}?api_token=${encodeURIComponent(EODHD_API_KEY)}&fmt=json`
  );

  if (typeof response?.close === "number" && response.close > 0) {
    return round(response.close, 6);
  }

  if (typeof response?.previousClose === "number" && response.previousClose > 0) {
    return round(response.previousClose, 6);
  }

  return null;
};

const fetchFxRateToPln = async (code: CurrencyCode): Promise<number | null> => {
  const normalizedCode = toCurrencyCode(code);

  if (normalizedCode === "PLN") {
    return 1;
  }

  if (normalizedCode === "GBX") {
    const gbpRate = await fetchFxRateToPln("GBP");
    return gbpRate === null ? null : round(gbpRate / 100, 6);
  }

  const cachedRate = getCachedFxRate(normalizedCode);

  if (cachedRate !== null) {
    return cachedRate;
  }

  const directPair = `${normalizedCode}PLN.FOREX`;
  const directRate = await fetchFxPairRate(directPair);

  if (directRate !== null) {
    setCachedFxRate(normalizedCode, directRate);
    return directRate;
  }

  const usdToPln = await fetchFxPairRate("USDPLN.FOREX");

  if (normalizedCode === "USD") {
    if (usdToPln !== null) {
      setCachedFxRate(normalizedCode, usdToPln);
      return usdToPln;
    }

    return null;
  }

  const codeToUsd = await fetchFxPairRate(`${normalizedCode}USD.FOREX`);

  if (codeToUsd === null || usdToPln === null) {
    return null;
  }

  const fallbackRate = round(codeToUsd * usdToPln, 6);
  setCachedFxRate(normalizedCode, fallbackRate);
  return fallbackRate;
};

export const fetchEodhdFxRates = async (codes: CurrencyCode[]): Promise<FxRates> => {
  const normalizedCodes = uniqueBy(
    codes
      .map((code) => toCurrencyCode(code))
      .filter(Boolean)
      .concat("PLN"),
    (code) => code
  );

  const results = await Promise.all(
    normalizedCodes.map(async (code) => [code, await fetchFxRateToPln(code)] as const)
  );

  return results.reduce<FxRates>((rates, [code, rate]) => {
    if (rate !== null) {
      rates[code] = rate;
    }

    return rates;
  }, { PLN: 1 });
};

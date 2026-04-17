import db from "@/lib/server/db";
import { normalizeSymbol } from "@/lib/ticker";
import { normalizeText, round, toCurrencyCode, uniqueBy } from "@/lib/utils";
import type {
  AssetQuote,
  AssetSearchResult,
  CurrencyCode,
  FxRates,
} from "@/types/portfolio";

type CacheRow = {
  payload_json: string;
  updated_at: string;
};

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

type EodhdEtfListing = {
  symbol: string;
  providerId: string;
  name: string;
  exchange: string;
  country?: string;
  marketCurrency: CurrencyCode;
  isin?: string;
  priceScale?: number;
};

const EODHD_API_KEY = process.env.EODHD_API_KEY ?? "";
const EODHD_API_ROOT = "https://eodhd.com/api";
const ETF_SEARCH_RESULT_LIMIT = 16;
const ETF_SEARCH_CACHE_TTL_MS = 5 * 60 * 1_000;
const ETF_EXCHANGE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const ETF_QUOTE_CACHE_TTL_MS = 30_000;
const FX_RATE_CACHE_TTL_MS = 5 * 60 * 1_000;

const ETF_FALLBACK_EXCHANGES = [
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
};

const readCacheStatement = db.prepare(
  "SELECT payload_json, updated_at FROM market_cache WHERE key = ?"
);
const writeCacheStatement = db.prepare(`
  INSERT INTO market_cache (key, payload_json, updated_at)
  VALUES (@key, @payloadJson, @updatedAt)
  ON CONFLICT(key) DO UPDATE SET
    payload_json = excluded.payload_json,
    updated_at = excluded.updated_at
`);

const quoteCache = new Map<string, { quote: AssetQuote; expiresAt: number }>();
const fxRateCache = new Map<string, { rate: number; expiresAt: number }>();

const hasEodhdApiKey = () => Boolean(EODHD_API_KEY);

const getCachedPayload = <T,>(key: string, ttlMs: number) => {
  const row = readCacheStatement.get(key) as CacheRow | undefined;

  if (!row?.payload_json) {
    return null;
  }

  const updatedAt = Date.parse(row.updated_at);

  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > ttlMs) {
    return null;
  }

  try {
    return JSON.parse(row.payload_json) as T;
  } catch {
    return null;
  }
};

const setCachedPayload = (key: string, payload: unknown) => {
  writeCacheStatement.run({
    key,
    payloadJson: JSON.stringify(payload),
    updatedAt: new Date().toISOString(),
  });
};

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

const toProviderId = (code: string, exchange: string) =>
  `${normalizeSymbol(code)}.${normalizeSymbol(exchange)}`;

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

  return uniqueBy(
    [trimmedQuery, normalizedQuery, parts[0] ?? ""].filter(Boolean),
    (item) => item
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

const toEtfListing = (
  item: EodhdSearchItem | EodhdExchangeItem
): EodhdEtfListing | null => {
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
    exchange,
    country: item.Country?.trim(),
    marketCurrency: currency,
    isin: isin || undefined,
    priceScale: priceScale === 1 ? undefined : priceScale,
  };
};

const getListingMatchScore = (query: string, item: EodhdEtfListing) => {
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

const toSearchResult = (item: EodhdEtfListing): AssetSearchResult => ({
  symbol: item.symbol,
  name: item.name,
  kind: "etf",
  marketCurrency: item.marketCurrency,
  provider: "eodhd",
  providerId: item.providerId,
  subtitle: [item.exchange, item.country].filter(Boolean).join(" / "),
  source: "api",
  isin: item.isin,
  priceScale: item.priceScale,
});

const fetchSearchListings = async (query: string) => {
  if (!hasEodhdApiKey()) {
    return [];
  }

  const cacheKey = `eodhd:etf:search:${normalizeText(query)}`;
  const cachedPayload = getCachedPayload<EodhdSearchItem[]>(cacheKey, ETF_SEARCH_CACHE_TTL_MS);

  if (cachedPayload) {
    return cachedPayload
      .map((item) => toEtfListing(item))
      .filter((item): item is EodhdEtfListing => Boolean(item));
  }

  const payload = await fetchJson<EodhdSearchItem[]>(
    `${EODHD_API_ROOT}/search/${encodeURIComponent(query)}?api_token=${encodeURIComponent(EODHD_API_KEY)}&fmt=json&type=etf&limit=50`
  );

  if (!payload) {
    return [];
  }

  setCachedPayload(cacheKey, payload);

  return payload
    .map((item) => toEtfListing(item))
    .filter((item): item is EodhdEtfListing => Boolean(item));
};

const fetchExchangeListings = async (exchange: string) => {
  if (!hasEodhdApiKey()) {
    return [];
  }

  const normalizedExchange = normalizeSymbol(exchange);
  const cacheKey = `eodhd:etf:exchange:${normalizedExchange}`;
  const cachedPayload = getCachedPayload<EodhdExchangeItem[]>(
    cacheKey,
    ETF_EXCHANGE_CACHE_TTL_MS
  );

  if (cachedPayload) {
    return cachedPayload
      .map((item) => toEtfListing(item))
      .filter((item): item is EodhdEtfListing => Boolean(item));
  }

  const payload = await fetchJson<EodhdExchangeItem[]>(
    `${EODHD_API_ROOT}/exchange-symbol-list/${encodeURIComponent(normalizedExchange)}?api_token=${encodeURIComponent(EODHD_API_KEY)}&fmt=json&type=etf`,
    25_000
  );

  if (!payload) {
    return [];
  }

  setCachedPayload(cacheKey, payload);

  return payload
    .map((item) => toEtfListing(item))
    .filter((item): item is EodhdEtfListing => Boolean(item));
};

const searchExchangeFallbackListings = async (query: string) => {
  const normalizedQuery = normalizeSymbol(query);

  if (!normalizedQuery) {
    return [];
  }

  const displaySuffix = getQueryDisplaySuffix(query);
  const candidateExchanges = displaySuffix
    ? DISPLAY_SUFFIX_TO_EODHD_EXCHANGES[displaySuffix] ?? []
    : [...ETF_FALLBACK_EXCHANGES];

  if (candidateExchanges.length === 0) {
    return [];
  }

  const listings = (
    await Promise.all(candidateExchanges.map((exchange) => fetchExchangeListings(exchange)))
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

export const searchEodhdEtfs = async (query: string): Promise<AssetSearchResult[]> => {
  if (!hasEodhdApiKey()) {
    return [];
  }

  const queryCandidates = getQueryCandidates(query);

  if (queryCandidates.length === 0) {
    return [];
  }

  const remoteListings = (
    await Promise.all(queryCandidates.map((candidate) => fetchSearchListings(candidate)))
  ).flat();

  let combinedListings = uniqueBy(remoteListings, (item) => item.providerId);
  const hasExactMatch = combinedListings.some(
    (item) =>
      item.symbol === normalizeSymbol(query) ||
      item.providerId === normalizeSymbol(query) ||
      item.isin === normalizeSymbol(query)
  );

  if (!hasExactMatch || combinedListings.length === 0) {
    const fallbackListings = await searchExchangeFallbackListings(query);
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
    .slice(0, ETF_SEARCH_RESULT_LIMIT)
    .map(toSearchResult);
};

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
    expiresAt: Date.now() + ETF_QUOTE_CACHE_TTL_MS,
  });
};

const normalizeQuotePrice = (price: number, priceScale?: number) =>
  round(price * (priceScale ?? 1), 4);

export const fetchEodhdEtfQuote = async ({
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
    const quote: AssetQuote = {
      symbol,
      price: normalizeQuotePrice(realtimePrice, priceScale),
      marketCurrency,
      provider: "eodhd",
      providerId: normalizedProviderId,
      fetchedAt: new Date(
        (realtimeQuote?.timestamp ?? Math.floor(Date.now() / 1_000)) * 1_000
      ).toISOString(),
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
  const historyCloses =
    history
      ?.map((item) =>
      typeof item.close === "number" && item.close > 0
        ? item.close
        : typeof item.adjusted_close === "number" && item.adjusted_close > 0
          ? item.adjusted_close
          : null
      )
      .filter((value): value is number => value !== null) ?? [];
  const historyPrice = historyCloses.at(-1);
  const previousClose = historyCloses.length > 1 ? historyCloses.at(-2) : undefined;

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
    priceScale,
    previousClose:
      typeof previousClose === "number" && previousClose > 0
        ? normalizeQuotePrice(previousClose, priceScale)
        : undefined,
  };
  setCachedQuote(normalizedProviderId, quote);
  return quote;
};

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

import {
  fetchEodhdQuote,
  fetchEodhdFxRates,
  searchEodhdEtfs,
  searchEodhdStocks,
} from "@/lib/server/eodhd";
import { fetchYahooQuote, searchYahooStocks } from "@/lib/server/yahoo";
import {
  findGpwCatalogEntry,
  searchGpwCatalog,
  warmGpwCatalog,
} from "@/lib/server/gpw-catalog";
import {
  getGpwTickerCore,
  inferCurrencyFromSymbol,
  isGpwSymbol,
  normalizeGpwSymbol,
  normalizeSymbol,
  toStooqGpwSymbol,
} from "@/lib/ticker";
import {
  getTickerLookupCandidates,
  resolveTickerAlias,
  resolveTickerIdentity,
} from "@/lib/ticker-aliases";
import { normalizeText, round, toCurrencyCode, uniqueBy } from "@/lib/utils";
import type {
  AssetKind,
  AssetQuote,
  AssetSearchMode,
  AssetSearchResult,
  CurrencyCode,
  FxRates,
  QuoteProvider,
} from "@/types/portfolio";

type FinnhubSearchResponse = {
  result?: Array<{
    symbol?: string;
    description?: string;
    displaySymbol?: string;
    type?: string;
  }>;
};

type FinnhubQuoteResponse = {
  c?: number;
  pc?: number;
  t?: number;
};

type StooqQuoteResponse = {
  symbols?: Array<{
    symbol?: string;
    date?: string;
    time?: string;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
    volume?: number;
  }>;
};

type CoinGeckoSearchResponse = {
  coins?: Array<{
    id?: string;
    name?: string;
    symbol?: string;
  }>;
};

type CoinGeckoCoin = {
  id: string;
  name: string;
  symbol: string;
};

type CoinGeckoSimplePrice = Record<
  string,
  {
    usd?: number;
    usd_24h_change?: number;
    last_updated_at?: number;
  }
>;

type BinanceTickerResponse = {
  lastPrice?: string;
  prevClosePrice?: string;
  price?: string;
  closeTime?: number;
};

type StooqHistorySnapshot = {
  price: number;
  previousClose?: number;
  priceDate: string;
  marketTimestamp?: string;
};

type StooqLiveSnapshot = {
  price: number;
  priceDate?: string;
  marketTimestamp?: string;
};

const FINNHUB_API_KEY =
  process.env.FINNHUB_API_KEY ?? process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? "";

const shouldUseGpwStooqQuote = ({
  symbol,
  kind,
  marketCurrency,
}: {
  symbol: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
}) => kind === "stock" && (isGpwSymbol(symbol) || marketCurrency === "PLN");

/**
 * A bare ticker is not a safe market identity.  In particular, a fallback
 * quote for `DIA` must never be accepted for a saved GPW asset `DIA.PL`.
 * Keep only candidates that explicitly carry the Warsaw-market suffix and
 * put the Yahoo spelling first where a Yahoo fallback is needed.
 */
export const getGpwScopedProviderCandidates = (candidates: string[]) =>
  uniqueBy(
    candidates
      .map((candidate) => normalizeSymbol(candidate))
      .filter((candidate) => isGpwSymbol(candidate))
      .sort((left, right) => Number(right.endsWith(".WA")) - Number(left.endsWith(".WA"))),
    (candidate) => candidate
  );

const isMarketIdentityDiagnosticsEnabled = () =>
  process.env.MARKET_DATA_DIAGNOSTICS === "true";

const logMarketIdentityDiagnostics = (
  stage: string,
  details: Record<string, unknown>
) => {
  if (isMarketIdentityDiagnosticsEnabled()) {
    console.info("[market-data:identity]", { stage, ...details });
  }
};

const logCryptoPriceDiagnostics = (details: Record<string, unknown>) => {
  if (isMarketIdentityDiagnosticsEnabled()) {
    console.info("[market-data:crypto-quote]", details);
  }
};

const isUsFinnhubSymbol = (symbol: string) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol);
const US_YAHOO_EXCHANGE_PATTERN = /\b(NYSE|NASDAQ|AMEX|BATS|CBOE|OTC)\b/i;

const isUsYahooSearchResult = (result: AssetSearchResult) =>
  result.provider === "yahoo" &&
  result.marketCurrency === "USD" &&
  US_YAHOO_EXCHANGE_PATTERN.test(result.subtitle ?? "");

const isStockLikeFinnhubType = (type?: string) => {
  const normalizedType = normalizeText(type ?? "");
  if (!normalizedType) return true;

  return (
    normalizedType.includes("common stock") ||
    normalizedType.includes("ordinary share") ||
    normalizedType.includes("adr")
  );
};

const getStooqTickerCore = (symbol: string) => getGpwTickerCore(symbol);

const getStooqSymbolCandidates = (symbol: string) => {
  const normalized = normalizeSymbol(symbol);
  const lookupCandidates = getTickerLookupCandidates({
    symbol: normalized,
    kind: "stock",
    marketCurrency: isGpwSymbol(normalized) ? "PLN" : inferCurrencyFromSymbol(normalized, "USD"),
  }).map((candidate) => normalizeSymbol(candidate.value));

  return uniqueBy(
    lookupCandidates.flatMap((candidate) => {
      const tickerCore = getStooqTickerCore(candidate);
      const normalizedCandidate = normalizeSymbol(candidate);
      const candidateLower = normalizedCandidate.toLowerCase();

      if (!tickerCore) {
        return [candidateLower];
      }

      return [
        `${tickerCore.toLowerCase()}.wa`,
        tickerCore.toLowerCase(),
        `${tickerCore}.WA`,
        tickerCore,
      ];
    }),
    (item) => item
  );
};

const STOOQ_DOMAINS = ["https://stooq.pl", "https://stooq.com"] as const;
const STOOQ_TEXT_PROXY_URL = "https://r.jina.ai/http://stooq.pl/q/?s=";
const STOOQ_RATE_LIMIT_PATTERN = /przekroczony\s+dzienny\s+limit\s+wywolan/i;
const GPW_QUOTE_CACHE_TTL_MS = 30_000;
const GPW_MARKET_CLOSE_MINUTE = 17 * 60 + 15;
const GPW_SEARCH_FALLBACK_TIMEOUT_MS = 1_500;
const FINNHUB_SEARCH_TIMEOUT_MS = 3_500;
const COINGECKO_SEARCH_CACHE_TTL_MS = 60_000;
const CRYPTO_QUOTE_CACHE_TTL_MS = 5_000;
const CRYPTO_MAX_QUOTE_AGE_MS = 20_000;
const COINGECKO_HEADERS = {
  Accept: "application/json",
  "User-Agent": "PortfelInwestora/0.1 price-sync",
};
const BINANCE_HEADERS = COINGECKO_HEADERS;

const gpwQuoteCache = new Map<string, { quote: AssetQuote; expiresAt: number }>();
const gpwQuoteInFlight = new Map<string, Promise<AssetQuote | null>>();
const coinGeckoSearchCache = new Map<string, { coins: CoinGeckoCoin[]; expiresAt: number }>();
const coinGeckoResolveCache = new Map<string, { providerId: string; expiresAt: number }>();
const coinGeckoQuoteCache = new Map<
  string,
  { quote: AssetQuote; createdAt: string; updatedAt: string; expiresAt: number }
>();
const coinGeckoQuoteInFlight = new Map<string, Promise<AssetQuote | null>>();

const safeFetch = async (
  url: string,
  init?: RequestInit,
  timeoutMs = 5_000
) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const logStooqDiagnostic = (payload: {
  endpoint: "live-json" | "live-csv" | "history-csv" | "page";
  symbol: string;
  requestSymbol: string;
  status?: number;
  price?: number;
  priceDate?: string;
  marketTimestamp?: string;
  accepted: boolean;
}) => {
  if (process.env.STOOQ_DIAGNOSTICS !== "true") {
    return;
  }

  const providerEndpoint =
    payload.endpoint === "history-csv"
      ? "stooq.pl/q/d/l"
      : payload.endpoint === "page"
        ? "r.jina.ai/http://stooq.pl/q/"
        : "stooq.pl/q/l";

  console.info("Stooq quote diagnostic", {
    ...payload,
    providerEndpoint,
  });
};

const toWarsawParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`,
    minute: Number(valueFor("hour")) * 60 + Number(valueFor("minute")),
  };
};

const shiftUtcDate = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getEasterSunday = (year: number) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const getGpwNonTradingDays = (year: number) => {
  const easter = getEasterSunday(year);
  const fixed = ["01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-25", "12-26"];
  const holidays = new Set(fixed.map((day) => `${year}-${day}`));

  holidays.add(shiftUtcDate(easter, -2)); // Good Friday
  holidays.add(shiftUtcDate(easter, 1)); // Easter Monday
  holidays.add(shiftUtcDate(easter, 60)); // Corpus Christi

  if (year >= 2025) {
    holidays.add(`${year}-12-24`);
  }

  return holidays;
};

const isGpwTradingDay = (date: string) => {
  const dayOfWeek = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return dayOfWeek !== 0 && dayOfWeek !== 6 && !getGpwNonTradingDays(Number(date.slice(0, 4))).has(date);
};

export const getLatestCompletedGpwSessionDate = (now = new Date()) => {
  const warsaw = toWarsawParts(now);
  let candidate = warsaw.date;

  if (warsaw.minute < GPW_MARKET_CLOSE_MINUTE) {
    candidate = shiftUtcDate(candidate, -1);
  }

  while (!isGpwTradingDay(candidate)) {
    candidate = shiftUtcDate(candidate, -1);
  }

  return candidate;
};

export const isFreshGpwMarketPrice = (priceDate: string | undefined, now = new Date()) =>
  Boolean(priceDate) && priceDate === getLatestCompletedGpwSessionDate(now);

const requiresFreshGpwSession = (symbol: string, fallbackCurrency: CurrencyCode) =>
  fallbackCurrency === "PLN" || isGpwSymbol(symbol);

const firstNonNull = async <T>(promises: Array<Promise<T | null>>) => {
  for (const promise of promises) {
    let result: T | null = null;

    try {
      result = await promise;
    } catch {
      result = null;
    }

    if (result) {
      return result;
    }
  }

  return null;
};

const parseStooqPageNumber = (value: string) => {
  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed > 0 ? round(parsed) : null;
};

const getStooqPageSymbolCandidates = (symbol: string) => {
  const requestSymbols = getStooqSymbolCandidates(symbol);

  return uniqueBy(
    requestSymbols.flatMap((candidate) => {
      const normalizedCandidate = normalizeSymbol(candidate);
      const tickerCore = getStooqTickerCore(normalizedCandidate);

      return tickerCore
        ? [tickerCore.toLowerCase(), `${tickerCore.toLowerCase()}.wa`, tickerCore]
        : [normalizedCandidate.toLowerCase()];
    }),
    (item) => item
  );
};

const normalizeGpwTickerQuery = (query: string) => {
  const normalized = normalizeSymbol(query);

  if (!normalized) {
    return null;
  }

  const tickerCore = getGpwTickerCore(normalized);
  return /^[A-Z0-9]{1,6}$/.test(tickerCore) ? tickerCore : null;
};

const containsStooqRateLimitMessage = (value: string) =>
  STOOQ_RATE_LIMIT_PATTERN.test(value);

const getGpwQuoteCacheKey = (symbol: string) => {
  const tickerCore = getStooqTickerCore(symbol);
  return `stooq:${tickerCore ? `${tickerCore}.WA` : toStooqGpwSymbol(symbol)}`;
};

const getCachedGpwQuote = (symbol: string) => {
  const cacheKey = getGpwQuoteCacheKey(symbol);
  const cachedEntry = gpwQuoteCache.get(cacheKey);

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    gpwQuoteCache.delete(cacheKey);
    return null;
  }

  return {
    ...cachedEntry.quote,
    symbol: normalizeGpwSymbol(symbol),
  };
};

const setCachedGpwQuote = (quote: AssetQuote) => {
  const normalizedSymbol = normalizeGpwSymbol(quote.symbol);
  const cacheKey = getGpwQuoteCacheKey(normalizedSymbol);

  gpwQuoteCache.set(cacheKey, {
    quote: {
      ...quote,
      symbol: normalizedSymbol,
    },
    expiresAt: Date.now() + GPW_QUOTE_CACHE_TTL_MS,
  });
};

const parseStooqJsonQuote = async (response: Response) => {
  try {
    const payload = (await response.json()) as StooqQuoteResponse;
    const item = payload.symbols?.[0];
    const close = Number(item?.close);

    if (!Number.isFinite(close) || close <= 0) {
      return null;
    }

    const priceDate =
      typeof item?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
        ? item.date
        : undefined;
    const marketTimestamp =
      priceDate && typeof item?.time === "string" && /^\d{2}:\d{2}(?::\d{2})?$/.test(item.time)
        ? `${priceDate}T${item.time}`
        : undefined;

    return {
      price: round(close),
      priceDate,
      marketTimestamp,
    } satisfies StooqLiveSnapshot;
  } catch {
    return null;
  }
};

export const parseStooqCsvQuote = (csv: string): StooqLiveSnapshot | null => {
  if (containsStooqRateLimitMessage(csv)) {
    return null;
  }

  const lines = csv
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const header = lines.length > 1 && /symbol/i.test(lines[0]) ? lines[0] : null;
  const candidateLine = header ? lines[1] : lines[0];

  if (!candidateLine) {
    return null;
  }

  const parts = candidateLine.split(",").map((part) => part.trim());
  const columns = header?.split(",").map((column) => column.trim().toLowerCase()) ?? [];
  const columnIndex = (name: string, fallback: number) => {
    const index = columns.indexOf(name);
    return index >= 0 ? index : fallback;
  };
  const date = parts[columnIndex("date", 1)];
  const time = parts[columnIndex("time", 2)];
  const close = Number(parts[columnIndex("close", 6)]);

  if (!Number.isFinite(close) || close <= 0) {
    return null;
  }

  const priceDate = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ? date : undefined;
  const marketTimestamp =
    priceDate && /^\d{2}:\d{2}(?::\d{2})?$/.test(time ?? "")
      ? `${priceDate}T${time}`
      : undefined;

  return {
    price: round(close),
    priceDate,
    marketTimestamp,
  };
};

export const parseStooqHistorySnapshot = (csv: string): StooqHistorySnapshot | null => {
  if (containsStooqRateLimitMessage(csv)) {
    return null;
  }

  const snapshots = csv
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d{4}-\d{2}-\d{2},/i.test(line))
    .map((line) => {
      const parts = line.split(",").map((part) => part.trim());
      return {
        priceDate: parts[0] ?? "",
        price: Number(parts[4]),
      };
    })
    .filter(
      (snapshot): snapshot is { priceDate: string; price: number } =>
        /^\d{4}-\d{2}-\d{2}$/.test(snapshot.priceDate) &&
        Number.isFinite(snapshot.price) &&
        snapshot.price > 0
    )
    .sort((left, right) => left.priceDate.localeCompare(right.priceDate));

  if (snapshots.length === 0) {
    return null;
  }

  const latest = snapshots.at(-1);
  const previous = snapshots.length > 1 ? snapshots.at(-2) : undefined;

  if (!latest) return null;

  return {
    price: round(latest.price),
    previousClose: previous ? round(previous.price) : undefined,
    priceDate: latest.priceDate,
  };
};

const fetchStooqPageQuote = async (
  symbol: string,
  fallbackCurrency: CurrencyCode,
  timeoutMs = 7_500
): Promise<AssetQuote | null> => {
  const pageSymbols = getStooqPageSymbolCandidates(symbol);

  for (const pageSymbol of pageSymbols) {
    const response = await safeFetch(
      `${STOOQ_TEXT_PROXY_URL}${encodeURIComponent(pageSymbol)}`,
      {
        headers: {
          Accept: "text/plain",
          "User-Agent": "Mozilla/5.0",
        },
        cache: "no-store",
      },
      timeoutMs
    );

    if (!response || !response.ok) {
      continue;
    }

    const markdown = await response.text();
    const priceMatch = markdown.match(/Kurs\s+\*\*([\d.,\s]+)\*\*/i);
    const price = priceMatch?.[1] ? parseStooqPageNumber(priceMatch[1]) : null;

    if (price === null) {
      continue;
    }

    const nameMatch = markdown.match(/Title:\s+.+?\s+-\s+(.+?)\s*$/m);

    return {
      symbol,
      price,
      marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
      provider: "stooq",
      fetchedAt: new Date().toISOString(),
      name: nameMatch?.[1]?.trim(),
    };
  }

  return null;
};

const buildGpwQuote = async (
  symbol: string,
  price: number,
  name?: string,
  previousClose?: number,
  marketData?: Pick<AssetQuote, "priceDate" | "marketTimestamp">
): Promise<AssetQuote> => {
  const normalizedSymbol = normalizeGpwSymbol(symbol);
  const catalogEntry = await findGpwCatalogEntry(normalizedSymbol);

  return {
    symbol: normalizedSymbol,
    price: round(price),
    marketCurrency: "PLN",
    provider: "stooq",
    fetchedAt: new Date().toISOString(),
    name: name?.trim() || catalogEntry?.name,
    previousClose,
    priceDate: marketData?.priceDate,
    marketTimestamp: marketData?.marketTimestamp,
  };
};

const fetchStooqHistoryQuoteForRequestSymbol = async (
  symbol: string,
  requestSymbol: string,
  fallbackCurrency: CurrencyCode,
  timeoutMs = 800
): Promise<AssetQuote | null> => {
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const response = await safeFetch(
    `https://stooq.pl/q/d/l/?s=${encodeURIComponent(requestSymbol)}&d1=20000101&d2=${today}&i=d`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
    },
    timeoutMs
  );

  if (!response?.ok) {
    logStooqDiagnostic({
      endpoint: "history-csv",
      symbol,
      requestSymbol,
      status: response?.status,
      accepted: false,
    });
    return null;
  }

  const csv = await response.text();
  const snapshot = parseStooqHistorySnapshot(csv);

  const accepted =
    Boolean(snapshot) &&
    (!requiresFreshGpwSession(symbol, fallbackCurrency) ||
      isFreshGpwMarketPrice(snapshot?.priceDate));
  logStooqDiagnostic({
    endpoint: "history-csv",
    symbol,
    requestSymbol,
    status: response.status,
    price: snapshot?.price,
    priceDate: snapshot?.priceDate,
    marketTimestamp: snapshot?.marketTimestamp,
    accepted,
  });

  if (!snapshot || !accepted) {
    return null;
  }

  return {
    symbol,
    price: snapshot.price,
    previousClose: snapshot.previousClose,
    marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
    provider: "stooq",
    fetchedAt: new Date().toISOString(),
    priceDate: snapshot.priceDate,
    marketTimestamp: snapshot.marketTimestamp,
  };
};

const fetchStooqLiveCsvQuote = async (
  symbol: string,
  fallbackCurrency: CurrencyCode,
  timeoutMs = 1_000
): Promise<AssetQuote | null> => {
  const requestSymbols = getStooqSymbolCandidates(symbol);

  for (const requestSymbol of requestSymbols) {
    const response = await safeFetch(
      `https://stooq.pl/q/l/?s=${encodeURIComponent(requestSymbol)}&f=sd2t2ohlcv&e=csv`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
        },
        cache: "no-store",
      },
      timeoutMs
    );

    if (!response?.ok) {
      logStooqDiagnostic({
        endpoint: "live-csv",
        symbol,
        requestSymbol,
        status: response?.status,
        accepted: false,
      });
      continue;
    }

    const csv = await response.text();

    if (containsStooqRateLimitMessage(csv)) {
      continue;
    }

    const snapshot = parseStooqCsvQuote(csv);
    const accepted =
      Boolean(snapshot) &&
      (!requiresFreshGpwSession(symbol, fallbackCurrency) ||
        isFreshGpwMarketPrice(snapshot?.priceDate));
    logStooqDiagnostic({
      endpoint: "live-csv",
      symbol,
      requestSymbol,
      status: response.status,
      price: snapshot?.price,
      priceDate: snapshot?.priceDate,
      marketTimestamp: snapshot?.marketTimestamp,
      accepted,
    });

    if (snapshot && accepted) {
      const historyQuote = await fetchStooqHistoryQuoteForRequestSymbol(
        symbol,
        requestSymbol,
        fallbackCurrency,
        3_500
      );

      return {
        symbol,
        price: snapshot.price,
        previousClose: historyQuote?.previousClose,
        marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
        provider: "stooq",
        fetchedAt: new Date().toISOString(),
        priceDate: snapshot.priceDate,
        marketTimestamp: snapshot.marketTimestamp,
      };
    }
  }

  return null;
};

const fetchStooqHistoryQuote = async (
  symbol: string,
  fallbackCurrency: CurrencyCode,
  timeoutMs = 800
): Promise<AssetQuote | null> => {
  const requestSymbols = [getStooqTickerCore(symbol).toLowerCase()];

  for (const requestSymbol of requestSymbols) {
    const historyQuote = await fetchStooqHistoryQuoteForRequestSymbol(
      symbol,
      requestSymbol,
      fallbackCurrency,
      timeoutMs
    );

    if (historyQuote) {
      return historyQuote;
    }
  }

  return null;
};

const searchGpwStooqTickerFallback = async (
  query: string
): Promise<AssetSearchResult[]> => {
  const tickerCore = normalizeGpwTickerQuery(query);

  if (!tickerCore) {
    return [];
  }

  const quote = await fetchStooqPageQuote(tickerCore, "PLN", GPW_SEARCH_FALLBACK_TIMEOUT_MS);

  if (!quote) {
    return [];
  }

  const canonicalSymbol = normalizeGpwSymbol(query);

  return [
    {
      symbol: canonicalSymbol,
      name: quote.name?.trim() || canonicalSymbol,
      kind: "stock",
      marketCurrency: "PLN",
      provider: "stooq",
      subtitle: "Stooq",
      source: "api",
    },
  ];
};

const searchFinnhub = async (
  query: string,
  kind: AssetKind,
  mode?: AssetSearchMode
): Promise<AssetSearchResult[]> => {
  if (!FINNHUB_API_KEY) return [];

  const response = await safeFetch(
    `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_API_KEY}`,
    {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    },
    FINNHUB_SEARCH_TIMEOUT_MS
  );

  if (!response?.ok) return [];

  const payload: FinnhubSearchResponse = await response.json();
  const filteredResults = (payload.result ?? []).filter(
    (
      item
    ): item is {
      symbol: string;
      description?: string;
      displaySymbol?: string;
      type?: string;
    } => {
      if (!item.symbol) return false;
      if (kind === "stock" && !isStockLikeFinnhubType(item.type)) return false;
      if (mode === "stock-gpw") return isGpwSymbol(item.symbol);
      if (mode === "stock-global") return isUsFinnhubSymbol(item.symbol);
      return true;
    }
  );

  return uniqueBy(
    filteredResults.map((item) => ({
        symbol: normalizeSymbol(item.symbol),
        name: item.description || item.displaySymbol || item.symbol,
        kind,
        marketCurrency:
          mode === "stock-gpw"
            ? "PLN"
            : inferCurrencyFromSymbol(item.symbol, "USD"),
        provider: mode === "stock-gpw" ? ("stooq" as const) : ("finnhub" as const),
      subtitle: "API",
      source: "api" as const,
    })),
    (item) => `${item.symbol}|${item.kind}|${item.provider}`
  )
    .slice(0, 8);
};

const getCoinGeckoMatchScore = (query: string, coin: CoinGeckoCoin) => {
  const normalizedQuerySymbol = normalizeSymbol(query);
  const normalizedQueryText = normalizeText(query);
  const normalizedCoinSymbol = normalizeSymbol(coin.symbol);
  const normalizedCoinName = normalizeText(coin.name);

  if (normalizedCoinSymbol === normalizedQuerySymbol) return 0;
  if (normalizedCoinName === normalizedQueryText) return 1;
  if (normalizedCoinSymbol.startsWith(normalizedQuerySymbol)) return 2;
  if (normalizedCoinName.startsWith(normalizedQueryText)) return 3;
  if (normalizedCoinSymbol.includes(normalizedQuerySymbol)) return 4;
  if (normalizedCoinName.includes(normalizedQueryText)) return 5;
  return 6;
};

const COINGECKO_SYMBOL_PROVIDER_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  TRX: "tron",
  AVAX: "avalanche-2",
};

const CRYPTO_SPOT_PAIRS: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  BNB: "BNBUSDT",
  SOL: "SOLUSDT",
  XRP: "XRPUSDT",
  ADA: "ADAUSDT",
  DOGE: "DOGEUSDT",
  DOT: "DOTUSDT",
  TRX: "TRXUSDT",
  AVAX: "AVAXUSDT",
};

const normalizeCoinGeckoProviderId = (symbol: string, providerId?: string) => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const normalizedProviderId = providerId?.trim();

  if (!normalizedProviderId) {
    return COINGECKO_SYMBOL_PROVIDER_IDS[normalizedSymbol];
  }

  if (normalizeSymbol(normalizedProviderId) === normalizedSymbol) {
    return COINGECKO_SYMBOL_PROVIDER_IDS[normalizedSymbol] ?? normalizedProviderId.toLowerCase();
  }

  return normalizedProviderId.toLowerCase();
};

const fetchCoinGeckoCoins = async (query: string): Promise<CoinGeckoCoin[]> => {
  const cacheKey = normalizeText(query);
  const cachedSearch = coinGeckoSearchCache.get(cacheKey);

  if (cachedSearch && cachedSearch.expiresAt > Date.now()) {
    return cachedSearch.coins;
  }

  const response = await safeFetch(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
    {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    },
    7_500
  );

  if (!response?.ok) {
    return cachedSearch?.coins ?? [];
  }

  const payload: CoinGeckoSearchResponse = await response.json();
  const coins = (payload.coins ?? [])
    .filter(
      (coin): coin is { id: string; name?: string; symbol?: string } => Boolean(coin.id)
    )
    .map((coin) => ({
      id: coin.id,
      name: coin.name || coin.id,
      symbol: normalizeSymbol(coin.symbol || coin.id),
    }));

  const rankedCoins = [...coins].sort(
    (left, right) =>
      getCoinGeckoMatchScore(query, left) - getCoinGeckoMatchScore(query, right) ||
      left.name.localeCompare(right.name, "pl")
  );

  coinGeckoSearchCache.set(cacheKey, {
    coins: rankedCoins,
    expiresAt: Date.now() + COINGECKO_SEARCH_CACHE_TTL_MS,
  });

  return rankedCoins;
};

const resolveCoinGeckoProviderId = async (symbol: string, providerId?: string) => {
  const normalizedProviderId = normalizeCoinGeckoProviderId(symbol, providerId);

  if (normalizedProviderId) {
    return normalizedProviderId;
  }

  const normalizedSymbol = normalizeSymbol(symbol);
  const cachedProvider = coinGeckoResolveCache.get(normalizedSymbol);

  if (cachedProvider && cachedProvider.expiresAt > Date.now()) {
    return cachedProvider.providerId;
  }

  const coins = await fetchCoinGeckoCoins(normalizedSymbol);
  const resolvedProviderId = coins[0]?.id;

  if (!resolvedProviderId) {
    return null;
  }

  coinGeckoResolveCache.set(normalizedSymbol, {
    providerId: resolvedProviderId,
    expiresAt: Date.now() + COINGECKO_SEARCH_CACHE_TTL_MS,
  });

  return resolvedProviderId;
};

const searchCoinGecko = async (query: string): Promise<AssetSearchResult[]> => {
  const coins = await fetchCoinGeckoCoins(query);

  return coins.slice(0, 8).map((coin) => ({
    symbol: coin.symbol,
    name: coin.name,
    kind: "crypto" as const,
    marketCurrency: "USD" as const,
    provider: "coingecko" as const,
    providerId: coin.id,
    subtitle: "CoinGecko",
    source: "api" as const,
  }));
};

const fetchFinnhubQuote = async (
  symbol: string,
  fallbackCurrency: CurrencyCode
): Promise<AssetQuote | null> => {
  if (!FINNHUB_API_KEY) return null;

  const quoteResponse = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_API_KEY}`,
    { cache: "no-store" }
  );

  if (!quoteResponse.ok) return null;

  const quotePayload: FinnhubQuoteResponse = await quoteResponse.json();
  const latestPrice =
    typeof quotePayload.c === "number" && quotePayload.c > 0
      ? quotePayload.c
      : typeof quotePayload.pc === "number" && quotePayload.pc > 0
        ? quotePayload.pc
        : null;

  if (latestPrice === null) {
    return null;
  }

  const marketTimestamp =
    typeof quotePayload.t === "number" && quotePayload.t > 0
      ? new Date(quotePayload.t * 1_000).toISOString()
      : undefined;

  return {
    symbol,
    price: round(latestPrice),
    marketCurrency: toCurrencyCode(fallbackCurrency),
    provider: "finnhub",
    fetchedAt: new Date().toISOString(),
    marketTimestamp,
    priceDate: marketTimestamp?.slice(0, 10),
    previousClose:
      typeof quotePayload.pc === "number" && quotePayload.pc > 0
        ? round(quotePayload.pc)
        : undefined,
  };
};

const fetchStooqQuote = async (
  symbol: string,
  fallbackCurrency: CurrencyCode
): Promise<AssetQuote | null> => {
  const requestSymbols = getStooqSymbolCandidates(symbol);

  for (const requestSymbol of requestSymbols) {
    for (const domain of STOOQ_DOMAINS) {
      const liveResponse = await safeFetch(
        `${domain}/q/l/?s=${encodeURIComponent(requestSymbol)}&f=sd2t2ohlcv&h&e=json`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
          },
          cache: "no-store",
        }
      );

      if (liveResponse?.ok) {
        const snapshot = await parseStooqJsonQuote(liveResponse);
        const accepted =
          Boolean(snapshot) &&
          (!requiresFreshGpwSession(symbol, fallbackCurrency) ||
            isFreshGpwMarketPrice(snapshot?.priceDate));
        logStooqDiagnostic({
          endpoint: "live-json",
          symbol,
          requestSymbol,
          status: liveResponse.status,
          price: snapshot?.price,
          priceDate: snapshot?.priceDate,
          marketTimestamp: snapshot?.marketTimestamp,
          accepted,
        });

        if (snapshot && accepted) {
          const historyQuote = await fetchStooqHistoryQuoteForRequestSymbol(
            symbol,
            requestSymbol,
            fallbackCurrency,
            4_500
          );

          return {
            symbol,
            price: snapshot.price,
            previousClose: historyQuote?.previousClose,
            marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
            provider: "stooq",
            fetchedAt: new Date().toISOString(),
            priceDate: snapshot.priceDate,
            marketTimestamp: snapshot.marketTimestamp,
          };
        }
      } else {
        logStooqDiagnostic({
          endpoint: "live-json",
          symbol,
          requestSymbol,
          status: liveResponse?.status,
          accepted: false,
        });
      }

      const csvLiveResponse = await safeFetch(
        `${domain}/q/l/?s=${encodeURIComponent(requestSymbol)}&f=sd2t2ohlcv&e=csv`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
          cache: "no-store",
        }
      );

      if (csvLiveResponse?.ok) {
        const csv = await csvLiveResponse.text();

        if (containsStooqRateLimitMessage(csv)) {
          continue;
        }

        const snapshot = parseStooqCsvQuote(csv);
        const accepted =
          Boolean(snapshot) &&
          (!requiresFreshGpwSession(symbol, fallbackCurrency) ||
            isFreshGpwMarketPrice(snapshot?.priceDate));
        logStooqDiagnostic({
          endpoint: "live-csv",
          symbol,
          requestSymbol,
          status: csvLiveResponse.status,
          price: snapshot?.price,
          priceDate: snapshot?.priceDate,
          marketTimestamp: snapshot?.marketTimestamp,
          accepted,
        });

        if (snapshot && accepted) {
          const historyQuote = await fetchStooqHistoryQuoteForRequestSymbol(
            symbol,
            requestSymbol,
            fallbackCurrency,
            4_500
          );

          return {
            symbol,
            price: snapshot.price,
            previousClose: historyQuote?.previousClose,
            marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
            provider: "stooq",
            fetchedAt: new Date().toISOString(),
            priceDate: snapshot.priceDate,
            marketTimestamp: snapshot.marketTimestamp,
          };
        }
      } else {
        logStooqDiagnostic({
          endpoint: "live-csv",
          symbol,
          requestSymbol,
          status: csvLiveResponse?.status,
          accepted: false,
        });
      }

      const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
      const historyResponse = await safeFetch(
        `${domain}/q/d/l/?s=${encodeURIComponent(requestSymbol)}&d1=20000101&d2=${today}&i=d`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
          cache: "no-store",
        },
        6_000
      );

      if (!historyResponse?.ok) {
        logStooqDiagnostic({
          endpoint: "history-csv",
          symbol,
          requestSymbol,
          status: historyResponse?.status,
          accepted: false,
        });
        continue;
      }

      const csv = await historyResponse.text();

      if (containsStooqRateLimitMessage(csv)) {
        continue;
      }

      const snapshot = parseStooqHistorySnapshot(csv);

      const accepted =
        Boolean(snapshot) &&
        (!requiresFreshGpwSession(symbol, fallbackCurrency) ||
          isFreshGpwMarketPrice(snapshot?.priceDate));
      logStooqDiagnostic({
        endpoint: "history-csv",
        symbol,
        requestSymbol,
        status: historyResponse.status,
        price: snapshot?.price,
        priceDate: snapshot?.priceDate,
        marketTimestamp: snapshot?.marketTimestamp,
        accepted,
      });

      if (snapshot && accepted) {
        return {
          symbol,
          price: snapshot.price,
          previousClose: snapshot.previousClose,
          marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
          provider: "stooq",
          fetchedAt: new Date().toISOString(),
          priceDate: snapshot.priceDate,
          marketTimestamp: snapshot.marketTimestamp,
        };
      }
    }
  }

  return requiresFreshGpwSession(symbol, fallbackCurrency)
    ? null
    : fetchStooqPageQuote(symbol, fallbackCurrency);
};

const getGpwQuoteSymbolCandidates = async (symbol: string) => {
  await warmGpwCatalog();
  const normalizedGpwSymbol = normalizeGpwSymbol(symbol);
  const tickerCore = getGpwTickerCore(normalizedGpwSymbol);
  const catalogEntry = await findGpwCatalogEntry(normalizedGpwSymbol);
  const catalogMatches = tickerCore ? await searchGpwCatalog(tickerCore) : [];
  const catalogCandidates = catalogEntry
    ? [catalogEntry.symbol]
    : catalogMatches.map((match) => match.symbol);

  return uniqueBy(
    [
      ...catalogCandidates,
      normalizedGpwSymbol,
      tickerCore ? `${tickerCore}.WA` : "",
      tickerCore ? `${tickerCore}.PL` : "",
      ...catalogMatches.map((match) => match.symbol),
    ]
      .filter(Boolean)
      .map((candidate) => normalizeGpwSymbol(candidate)),
    (candidate) => getGpwTickerCore(candidate)
  );
};

const fetchGpwStooqQuoteForCandidate = async (
  candidateSymbol: string
): Promise<AssetQuote | null> => {
  const normalizedGpwSymbol = normalizeGpwSymbol(candidateSymbol);
  const requestTickerCore = getStooqTickerCore(normalizedGpwSymbol);
  const requestGpwSymbol = requestTickerCore
    ? `${requestTickerCore}.WA`
    : toStooqGpwSymbol(normalizedGpwSymbol);

  if (!normalizedGpwSymbol || !requestGpwSymbol) {
    return null;
  }

  const cachedQuote = getCachedGpwQuote(normalizedGpwSymbol);

  if (cachedQuote) {
    return cachedQuote;
  }

  const cacheKey = getGpwQuoteCacheKey(requestGpwSymbol);
  const inFlightQuote = gpwQuoteInFlight.get(cacheKey);

  if (inFlightQuote) {
    return inFlightQuote;
  }

  const quotePromise = (async () => {
    const liveQuote = await fetchStooqLiveCsvQuote(requestGpwSymbol, "PLN");

    if (liveQuote) {
      const normalizedQuote = await buildGpwQuote(
        normalizedGpwSymbol,
        liveQuote.price,
        liveQuote.name,
        liveQuote.previousClose,
        liveQuote
      );
      setCachedGpwQuote(normalizedQuote);
      return normalizedQuote;
    }

    const historyQuote = await fetchStooqHistoryQuote(requestGpwSymbol, "PLN");

    if (historyQuote) {
      const normalizedQuote = await buildGpwQuote(
        normalizedGpwSymbol,
        historyQuote.price,
        historyQuote.name,
        historyQuote.previousClose,
        historyQuote
      );
      setCachedGpwQuote(normalizedQuote);
      return normalizedQuote;
    }

    return null;
  })().finally(() => {
    gpwQuoteInFlight.delete(cacheKey);
  });

  gpwQuoteInFlight.set(cacheKey, quotePromise);

  return quotePromise;
};

const fetchGpwStooqQuote = async (symbol: string): Promise<AssetQuote | null> => {
  const candidateSymbols = await getGpwQuoteSymbolCandidates(symbol);

  for (const candidateSymbol of candidateSymbols) {
    const quote = await fetchGpwStooqQuoteForCandidate(candidateSymbol);

    if (quote) {
      return quote;
    }
  }

  return null;
};

const toProviderMarketTimestamp = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  const timestamp = new Date(value).toISOString();
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : undefined;
};

/**
 * Crypto trades continuously, so its freshness is deliberately independent
 * from the completed-session policy used for GPW and other listed assets.
 */
export const isFreshCryptoQuote = (quote: AssetQuote, now = Date.now()) => {
  const marketTime = Date.parse(quote.marketTimestamp ?? "");

  return (
    Number.isFinite(marketTime) &&
    marketTime <= now + 5_000 &&
    now - marketTime <= CRYPTO_MAX_QUOTE_AGE_MS
  );
};

const getCryptoQuoteAgeMs = (quote: AssetQuote, now = Date.now()) => {
  const marketTime = Date.parse(quote.marketTimestamp ?? "");
  return Number.isFinite(marketTime) ? Math.max(0, now - marketTime) : null;
};

const cacheCryptoQuote = (coinId: string, quote: AssetQuote) => {
  const now = Date.now();
  const updatedAt = new Date(now).toISOString();
  const marketTime = Date.parse(quote.marketTimestamp ?? "");
  const marketExpiry = Number.isFinite(marketTime)
    ? marketTime + CRYPTO_MAX_QUOTE_AGE_MS
    : now;

  coinGeckoQuoteCache.set(coinId, {
    quote,
    createdAt: updatedAt,
    updatedAt,
    expiresAt: Math.min(now + CRYPTO_QUOTE_CACHE_TTL_MS, marketExpiry),
  });
};

const fetchBinanceSpotQuote = async (
  symbol: string,
  providerId: string
): Promise<AssetQuote | null> => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const pair = CRYPTO_SPOT_PAIRS[normalizedSymbol];

  if (!pair) {
    return null;
  }

  const endpoint = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(pair)}`;
  const response = await safeFetch(
    endpoint,
    { headers: BINANCE_HEADERS, cache: "no-store" },
    7_500
  );

  if (!response) {
    logCryptoPriceDiagnostics({
      stage: "provider-error",
      provider: "binance",
      endpoint: "/api/v3/ticker/24hr",
      symbol: pair,
      errorType: "network_or_timeout",
    });
    return null;
  }

  if (!response.ok) {
    logCryptoPriceDiagnostics({
      stage: "provider-error",
      provider: "binance",
      endpoint: "/api/v3/ticker/24hr",
      symbol: pair,
      status: response.status,
      errorType: "http",
    });
    return null;
  }

  let payload: BinanceTickerResponse;

  try {
    payload = (await response.json()) as BinanceTickerResponse;
  } catch {
    logCryptoPriceDiagnostics({
      stage: "provider-error",
      provider: "binance",
      endpoint: "/api/v3/ticker/24hr",
      symbol: pair,
      status: response.status,
      errorType: "invalid_json",
    });
    return null;
  }

  const price = Number(payload.lastPrice ?? payload.price);
  const previousClose = Number(payload.prevClosePrice);
  const fetchedAt = new Date().toISOString();
  const marketTimestamp = toProviderMarketTimestamp(payload.closeTime);

  if (!Number.isFinite(price) || price <= 0 || !marketTimestamp) {
    logCryptoPriceDiagnostics({
      stage: "provider-error",
      provider: "binance",
      endpoint: "/api/v3/ticker/24hr",
      symbol: pair,
      status: response.status,
      price: Number.isFinite(price) ? price : null,
      hasMarketTimestamp: Boolean(marketTimestamp),
      errorType: "malformed_quote",
    });
    return null;
  }

  const quote: AssetQuote = {
    symbol: normalizedSymbol,
    price: round(price, 4),
    marketCurrency: "USD",
    provider: "binance",
    providerId,
    fetchedAt,
    marketTimestamp,
    priceDate: marketTimestamp.slice(0, 10),
    previousClose:
      Number.isFinite(previousClose) && previousClose > 0
        ? round(previousClose, 4)
        : undefined,
  };

  const priceAgeMs = getCryptoQuoteAgeMs(quote);
  const accepted = isFreshCryptoQuote(quote);
  logCryptoPriceDiagnostics({
    stage: "provider-response",
    provider: "binance",
    endpoint: "/api/v3/ticker/24hr",
    symbol: pair,
    status: response.status,
    price: quote.price,
    marketTimestamp,
    fetchedAt,
    priceAgeMs,
    accepted,
  });

  return accepted ? quote : null;
};

const fetchCoinGeckoFallbackQuote = async (
  symbol: string,
  coinId: string
): Promise<AssetQuote | null> => {
  const endpoint = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
    coinId
  )}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`;
  const response = await safeFetch(
    endpoint,
    { headers: COINGECKO_HEADERS, cache: "no-store" },
    7_500
  );

  if (!response || !response.ok) {
    logCryptoPriceDiagnostics({
      stage: "provider-error",
      provider: "coingecko",
      endpoint: "/api/v3/simple/price",
      symbol: coinId,
      status: response?.status,
      errorType: response ? "http" : "network_or_timeout",
    });
    return null;
  }

  let payload: CoinGeckoSimplePrice;

  try {
    payload = (await response.json()) as CoinGeckoSimplePrice;
  } catch {
    logCryptoPriceDiagnostics({
      stage: "provider-error",
      provider: "coingecko",
      endpoint: "/api/v3/simple/price",
      symbol: coinId,
      status: response.status,
      errorType: "invalid_json",
    });
    return null;
  }

  const price = payload[coinId]?.usd;
  const dailyChangePercent = payload[coinId]?.usd_24h_change;
  const marketTimestamp = toProviderMarketTimestamp(
    typeof payload[coinId]?.last_updated_at === "number"
      ? payload[coinId]?.last_updated_at * 1_000
      : undefined
  );
  const fetchedAt = new Date().toISOString();

  if (typeof price !== "number" || price <= 0 || !marketTimestamp) {
    logCryptoPriceDiagnostics({
      stage: "provider-error",
      provider: "coingecko",
      endpoint: "/api/v3/simple/price",
      symbol: coinId,
      status: response.status,
      price: typeof price === "number" ? price : null,
      hasMarketTimestamp: Boolean(marketTimestamp),
      errorType: "malformed_quote",
    });
    return null;
  }

  const quote: AssetQuote = {
    symbol: normalizeSymbol(symbol),
    price: round(price, 4),
    marketCurrency: "USD",
    provider: "coingecko",
    providerId: coinId,
    fetchedAt,
    marketTimestamp,
    priceDate: marketTimestamp.slice(0, 10),
    previousClose:
      typeof dailyChangePercent === "number" &&
      Number.isFinite(dailyChangePercent) &&
      dailyChangePercent > -100
        ? round(price / (1 + dailyChangePercent / 100), 8)
        : undefined,
  };

  const priceAgeMs = getCryptoQuoteAgeMs(quote);
  const accepted = isFreshCryptoQuote(quote);
  logCryptoPriceDiagnostics({
    stage: "provider-response",
    provider: "coingecko",
    endpoint: "/api/v3/simple/price",
    symbol: coinId,
    status: response.status,
    price: quote.price,
    marketTimestamp,
    fetchedAt,
    priceAgeMs,
    accepted,
  });

  return accepted ? quote : null;
};

const fetchCoinGeckoQuote = async (
  symbol: string,
  providerId?: string
): Promise<AssetQuote | null> => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const coinId = await resolveCoinGeckoProviderId(normalizedSymbol, providerId);

  if (!coinId) return null;

  const cachedQuote = coinGeckoQuoteCache.get(coinId);

  if (cachedQuote && cachedQuote.expiresAt > Date.now() && isFreshCryptoQuote(cachedQuote.quote)) {
    logCryptoPriceDiagnostics({
      stage: "cache-hit",
      provider: cachedQuote.quote.provider,
      symbol: normalizedSymbol,
      price: cachedQuote.quote.price,
      marketTimestamp: cachedQuote.quote.marketTimestamp,
      fetchedAt: cachedQuote.quote.fetchedAt,
      createdAt: cachedQuote.createdAt,
      updatedAt: cachedQuote.updatedAt,
      expiresAt: new Date(cachedQuote.expiresAt).toISOString(),
      ttlMs: CRYPTO_QUOTE_CACHE_TTL_MS,
      priceAgeMs: getCryptoQuoteAgeMs(cachedQuote.quote),
    });
    return { ...cachedQuote.quote, symbol: normalizedSymbol };
  }

  const inFlightQuote = coinGeckoQuoteInFlight.get(coinId);

  if (inFlightQuote) {
    return inFlightQuote.then((quote) =>
      quote ? { ...quote, symbol: normalizedSymbol } : null
    );
  }

  const quotePromise = (async () => {
    const exchangeQuote = await fetchBinanceSpotQuote(normalizedSymbol, coinId);
    const quote = exchangeQuote ?? (await fetchCoinGeckoFallbackQuote(normalizedSymbol, coinId));

    if (quote) {
      cacheCryptoQuote(coinId, quote);
    }

    return quote;
  })().finally(() => {
    coinGeckoQuoteInFlight.delete(coinId);
  });

  coinGeckoQuoteInFlight.set(coinId, quotePromise);
  return quotePromise;
};

export const searchMarketAssets = async (
  query: string,
  kind: AssetKind,
  mode?: AssetSearchMode
): Promise<AssetSearchResult[]> => {
  if (!query.trim()) return [];

  const queryCandidates = uniqueBy(
    getTickerLookupCandidates({
      symbol: query,
      kind,
      includeName: false,
    }).map((candidate) => candidate.value),
    (candidate) => normalizeSymbol(candidate)
  );
  const searchFirst = async (
    searcher: (candidate: string) => Promise<AssetSearchResult[]>
  ) => {
    for (const candidate of queryCandidates) {
      const results = await searcher(candidate);

      if (results.length > 0) {
        return results;
      }
    }

    return [];
  };

  if (kind === "crypto") {
    return searchFirst(searchCoinGecko);
  }

  if (kind === "stock" && mode === "stock-gpw") {
    await warmGpwCatalog();
    const catalogResults = await searchFirst(searchGpwCatalog);

    if (catalogResults.length > 0) {
      return catalogResults;
    }

    return searchFirst(searchGpwStooqTickerFallback);
  }

  if (kind === "stock" && mode === "stock-international") {
    const yahooResults = await searchFirst(searchYahooStocks);

    if (yahooResults.length > 0) {
      return yahooResults;
    }

    const eodhdResults = await searchFirst(searchEodhdStocks);

    return eodhdResults.length > 0
      ? eodhdResults
      : searchFirst((candidate) => searchFinnhub(candidate, kind, mode));
  }

  if (kind === "stock" && mode === "stock-global") {
    const finnhubResults = await searchFirst((candidate) => searchFinnhub(candidate, kind, mode));

    if (finnhubResults.length > 0) {
      return finnhubResults;
    }

    const yahooResults = await searchFirst(searchYahooStocks);
    const usYahooResults = yahooResults.filter(isUsYahooSearchResult);

    return usYahooResults.length > 0 ? usYahooResults : yahooResults;
  }

  if (kind === "etf" || mode === "etf") {
    return searchFirst(searchEodhdEtfs);
  }

  if (kind === "stock") {
    return searchFirst((candidate) => searchFinnhub(candidate, kind, mode));
  }

  return [];
};

export const fetchAssetQuoteServer = async ({
  symbol,
  kind,
  marketCurrency,
  provider,
  providerId,
  priceScale,
}: {
  symbol: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
}) => {
  // An OpenFIGI ETF listing may deliberately have no price-provider mapping.
  // Do not turn its display ticker into a guessed quote request on another venue.
  if (kind === "etf" && !providerId?.trim()) {
    return null;
  }

  const requestedSymbol = normalizeSymbol(symbol);
  const identity = resolveTickerIdentity({
    symbol: requestedSymbol,
    kind,
    marketCurrency,
  });
  const alias = identity.alias ?? resolveTickerAlias(requestedSymbol, kind);
  const normalizedSymbol = normalizeSymbol(identity.symbol);
  const resolvedKind = identity.kind ?? kind;
  const resolvedMarketCurrency = toCurrencyCode(
    identity.marketCurrency ?? alias?.marketCurrency ?? marketCurrency,
    marketCurrency
  );
  const resolvedProvider = alias?.provider ?? provider;
  const resolvedProviderId = identity.providerId ?? alias?.providerId ?? providerId;
  const resolvedPriceScale = identity.priceScale ?? alias?.priceScale ?? priceScale;
  const lookupSymbols = getTickerLookupCandidates({
    symbol: requestedSymbol,
    kind,
    marketCurrency,
    providerId,
    isin: identity.isin,
    name: identity.name,
  }).map((candidate) => normalizeSymbol(candidate.value));
  const providerIdCandidates = uniqueBy(
    [
      identity.providerId,
      alias?.providerId,
      providerId,
      ...lookupSymbols,
    ].filter((candidate): candidate is string => Boolean(candidate?.trim())),
    (candidate) => normalizeSymbol(candidate)
  );
  const gpwProviderIdCandidates = getGpwScopedProviderCandidates([
    normalizedSymbol,
    ...providerIdCandidates,
  ]);
  const fetchEodhdQuoteFromProviderIds = (candidateProviderIds: string[]) =>
    firstNonNull(
      candidateProviderIds.map((candidateProviderId) =>
        fetchEodhdQuote({
          symbol: normalizedSymbol,
          providerId: candidateProviderId,
          marketCurrency: resolvedMarketCurrency,
          priceScale: resolvedPriceScale,
        })
      )
    );
  const discoverEodhdProviderIdsFromLookup = async () => {
    if (resolvedKind !== "stock" && resolvedKind !== "etf") {
      return [];
    }

    const searchEodhd = resolvedKind === "etf" ? searchEodhdEtfs : searchEodhdStocks;
    const searchResults = (
      await Promise.all(
        lookupSymbols.map(async (candidate) => {
          try {
            return await searchEodhd(candidate);
          } catch {
            return [];
          }
        })
      )
    ).flat();

    return uniqueBy(
      searchResults
        .map((result) => result.providerId)
        .filter((candidate): candidate is string => Boolean(candidate?.trim())),
      (candidate) => normalizeSymbol(candidate)
    );
  };
  const fetchEodhdQuoteFromLookup = async () => {
    const directQuote = await fetchEodhdQuoteFromProviderIds(providerIdCandidates);

    if (directQuote) {
      return directQuote;
    }

    const discoveredProviderIds = await discoverEodhdProviderIdsFromLookup();

    if (discoveredProviderIds.length === 0) {
      return null;
    }

    return fetchEodhdQuoteFromProviderIds(discoveredProviderIds);
  };
  const fetchFinnhubQuoteFromLookup = () =>
    firstNonNull(
      lookupSymbols.map((candidate) => fetchFinnhubQuote(candidate, resolvedMarketCurrency))
    );
  const isGpwStockRequest = shouldUseGpwStooqQuote({
    symbol: normalizedSymbol,
    kind: resolvedKind,
    marketCurrency: resolvedMarketCurrency,
  });

  logMarketIdentityDiagnostics("resolved", {
    requestedSymbol,
    resolvedSymbol: normalizedSymbol,
    kind: resolvedKind,
    marketCurrency: resolvedMarketCurrency,
    provider: resolvedProvider,
    providerId: resolvedProviderId ?? null,
    lookupSymbols,
    gpwProviderIdCandidates: isGpwStockRequest ? gpwProviderIdCandidates : undefined,
  });

  if (resolvedKind === "crypto") {
    return fetchCoinGeckoQuote(normalizedSymbol, resolvedProviderId);
  }

  if (resolvedProvider === "eodhd" && (resolvedKind === "stock" || resolvedKind === "etf")) {
    const eodhdQuote = await fetchEodhdQuoteFromLookup();

    if (eodhdQuote) {
      return eodhdQuote;
    }

    if (resolvedKind === "etf") {
      return null;
    }

    let yahooQuote: AssetQuote | null = null;

    for (const candidateProviderId of providerIdCandidates) {
      yahooQuote = await fetchYahooQuote({
        symbol: normalizedSymbol,
        providerId: candidateProviderId,
        fallbackCurrency: resolvedMarketCurrency,
      });

      if (yahooQuote) {
        break;
      }
    }

    if (yahooQuote) {
      return yahooQuote;
    }

    const stooqQuote = await firstNonNull(
      lookupSymbols.map((candidate) => fetchStooqQuote(candidate, resolvedMarketCurrency))
    );

    if (stooqQuote) {
      return stooqQuote;
    }
  }

  if (isGpwStockRequest) {
    const gpwQuote = await firstNonNull(
      uniqueBy([normalizedSymbol, ...lookupSymbols], (candidate) =>
        normalizeSymbol(candidate)
      ).map((candidate) => fetchGpwStooqQuote(candidate))
    );

    if (gpwQuote) {
      logMarketIdentityDiagnostics("gpw-stooq", {
        requestedSymbol,
        quoteSymbol: gpwQuote.symbol,
        quoteName: gpwQuote.name ?? null,
        quoteCurrency: gpwQuote.marketCurrency,
        quoteProvider: gpwQuote.provider,
        quoteProviderId: gpwQuote.providerId ?? null,
        price: gpwQuote.price,
      });
      return gpwQuote;
    }

    // Do not discover a GPW quote through a bare global ticker.  EODHD and
    // Yahoo receive only the explicit `.PL`/`.WA` market identity.
    const eodhdQuote = await fetchEodhdQuoteFromProviderIds(gpwProviderIdCandidates);

    if (eodhdQuote) {
      logMarketIdentityDiagnostics("gpw-eodhd", {
        requestedSymbol,
        quoteSymbol: eodhdQuote.symbol,
        quoteName: eodhdQuote.name ?? null,
        quoteCurrency: eodhdQuote.marketCurrency,
        quoteProvider: eodhdQuote.provider,
        quoteProviderId: eodhdQuote.providerId ?? null,
        price: eodhdQuote.price,
      });
      return eodhdQuote;
    }

    const yahooQuote = await firstNonNull(
      gpwProviderIdCandidates.map((candidateProviderId) =>
        fetchYahooQuote({
          symbol: normalizedSymbol,
          providerId: candidateProviderId,
          fallbackCurrency: resolvedMarketCurrency,
        })
      )
    );

    if (yahooQuote) {
      logMarketIdentityDiagnostics("gpw-yahoo", {
        requestedSymbol,
        quoteSymbol: yahooQuote.symbol,
        quoteName: yahooQuote.name ?? null,
        quoteCurrency: yahooQuote.marketCurrency,
        quoteProvider: yahooQuote.provider,
        quoteProviderId: yahooQuote.providerId ?? null,
        price: yahooQuote.price,
      });
      return yahooQuote;
    }

    // Finnhub accepts bare global tickers.  Returning no quote is safer than
    // turning a Polish asset into an unrelated US instrument.
    logMarketIdentityDiagnostics("gpw-unavailable", {
      requestedSymbol,
      resolvedSymbol: normalizedSymbol,
      marketCurrency: resolvedMarketCurrency,
    });
    return null;
  }

  if (resolvedProvider === "yahoo" && (resolvedKind === "stock" || resolvedKind === "etf")) {
    return firstNonNull(
      providerIdCandidates.map((candidateProviderId) =>
        fetchYahooQuote({
          symbol: normalizedSymbol,
          providerId: candidateProviderId,
          fallbackCurrency: resolvedMarketCurrency,
        })
      )
    );
  }

  if (resolvedProvider === "finnhub") {
    return (
      (await fetchFinnhubQuoteFromLookup()) ??
      (await firstNonNull(
        providerIdCandidates.map((candidateProviderId) =>
          fetchYahooQuote({
            symbol: normalizedSymbol,
            providerId: candidateProviderId,
            fallbackCurrency: resolvedMarketCurrency,
          })
        )
      )) ??
      (await firstNonNull(
        lookupSymbols.map((candidate) => fetchStooqQuote(candidate, resolvedMarketCurrency))
      )) ??
      (await fetchStooqQuote(`${normalizedSymbol}.US`, resolvedMarketCurrency))
    );
  }

  if (resolvedProvider === "stooq") {
    return (
      (await firstNonNull(
        lookupSymbols.map((candidate) => fetchStooqQuote(candidate, resolvedMarketCurrency))
      )) ??
      (await firstNonNull(
        providerIdCandidates.map((candidateProviderId) =>
          fetchYahooQuote({
            symbol: normalizedSymbol,
            providerId: candidateProviderId,
            fallbackCurrency: resolvedMarketCurrency,
          })
        )
      )) ??
      (await fetchFinnhubQuoteFromLookup())
    );
  }

  const autoQuote =
    (await fetchFinnhubQuoteFromLookup()) ??
    (await firstNonNull(
      providerIdCandidates.map((candidateProviderId) =>
        fetchYahooQuote({
          symbol: normalizedSymbol,
          providerId: candidateProviderId,
          fallbackCurrency: resolvedMarketCurrency,
        })
      )
    )) ??
    (await firstNonNull(
      lookupSymbols.map((candidate) => fetchStooqQuote(candidate, resolvedMarketCurrency))
    ));

  return autoQuote;
};

const shiftDateInputValue = (date: string, days: number) => {
  const sourceDate = new Date(`${date}T00:00:00.000Z`);
  sourceDate.setUTCDate(sourceDate.getUTCDate() + days);
  return sourceDate.toISOString().slice(0, 10);
};

const fetchNbpFxTable = async (table: "A" | "B", date?: string) => {
  const response = await fetch(
    `https://api.nbp.pl/api/exchangerates/tables/${table}${date ? `/${date}` : ""}?format=json`,
    {
    headers: {
      Accept: "application/json",
    },
    next: {
      revalidate: date ? 86_400 : 300,
    },
  });

  if (!response.ok) {
    throw new Error("NBP request failed");
  }

  const payload = (await response.json()) as Array<{
    rates?: Array<{
      code?: string;
      mid?: number;
    }>;
  }>;

  return payload[0]?.rates ?? [];
};

const fetchNbpHistoricalFxRates = async (codes: CurrencyCode[], date: string) => {
  for (let offset = 0; offset <= 7; offset += 1) {
    const effectiveDate = shiftDateInputValue(date, -offset);
    const [tableA, tableB] = await Promise.allSettled([
      fetchNbpFxTable("A", effectiveDate),
      fetchNbpFxTable("B", effectiveDate),
    ]);
    const nbpRates = [
      ...(tableA.status === "fulfilled" ? tableA.value : []),
      ...(tableB.status === "fulfilled" ? tableB.value : []),
    ];

    if (nbpRates.length === 0) {
      continue;
    }

    return codes.reduce<FxRates>((rates, code) => {
      if (code === "PLN") {
        rates[code] = 1;
        return rates;
      }

      const nbpRate = nbpRates.find((item) => item.code === code)?.mid;

      if (typeof nbpRate === "number" && nbpRate > 0) {
        rates[code] = round(nbpRate, 6);
      }

      return rates;
    }, { PLN: 1 });
  }

  return { PLN: 1 };
};

export const fetchFxRatesServer = async (
  codes: CurrencyCode[] = [],
  date?: string
): Promise<FxRates> => {
  const normalizedCodes = uniqueBy(
    codes.map((code) => toCurrencyCode(code)).concat("PLN"),
    (code) => code
  );

  if (date) {
    const historicalNbpRates = await fetchNbpHistoricalFxRates(normalizedCodes, date);
    const missingHistoricalCodes = normalizedCodes.filter(
      (code) => historicalNbpRates[code] === undefined
    );

    if (missingHistoricalCodes.length === 0) {
      return historicalNbpRates;
    }

    const fallbackCurrentRates = await fetchEodhdFxRates(missingHistoricalCodes);

    return normalizedCodes.reduce<FxRates>((rates, code) => {
      if (historicalNbpRates[code] !== undefined) {
        rates[code] = historicalNbpRates[code];
        return rates;
      }

      if (fallbackCurrentRates[code] !== undefined) {
        rates[code] = fallbackCurrentRates[code];
        return rates;
      }

      if (code === "PLN") {
        rates[code] = 1;
      }

      return rates;
    }, { PLN: 1 });
  }

  const eodhdRates = await fetchEodhdFxRates(normalizedCodes);
  const missingCodes = normalizedCodes.filter((code) => eodhdRates[code] === undefined);

  if (missingCodes.length === 0) {
    return eodhdRates;
  }

  const [tableA, tableB] = await Promise.allSettled([fetchNbpFxTable("A"), fetchNbpFxTable("B")]);
  const nbpRates = [
    ...(tableA.status === "fulfilled" ? tableA.value : []),
    ...(tableB.status === "fulfilled" ? tableB.value : []),
  ];

  return normalizedCodes.reduce<FxRates>((rates, code) => {
    if (rates[code] !== undefined) {
      return rates;
    }

    if (eodhdRates[code] !== undefined) {
      rates[code] = eodhdRates[code];
      return rates;
    }

    if (code === "PLN") {
      rates[code] = 1;
      return rates;
    }

    const nbpRate = nbpRates.find((item) => item.code === code)?.mid;

    if (typeof nbpRate === "number" && nbpRate > 0) {
      rates[code] = round(nbpRate, 6);
    }

    return rates;
  }, { PLN: 1 });
};

import {
  fetchEodhdQuote,
  fetchEodhdFxRates,
  searchEodhdEtfs,
  searchEodhdStocks,
} from "@/lib/server/eodhd";
import { fetchYahooQuote, searchYahooStocks } from "@/lib/server/yahoo";
import {
  findGpwCatalogEntry,
  findGpwCatalogEntryWithPrice,
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

type StooqHistorySnapshot = {
  price: number;
  previousClose?: number;
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

const getStooqSymbolCandidates = (symbol: string) => {
  const normalized = normalizeSymbol(symbol);

  if (isGpwSymbol(normalized)) {
    const tickerCore = getGpwTickerCore(normalized);

    return uniqueBy(
      [`${tickerCore}.wa`, tickerCore.toLowerCase(), `${tickerCore}.WA`, tickerCore],
      (item) => item
    );
  }

  const normalizedLower = normalized.toLowerCase();

  return uniqueBy(
    [
      `${normalizedLower}.wa`,
      normalizedLower,
      `${normalizedLower}.wa`.toUpperCase(),
      normalized,
    ],
    (item) => item
  );
};

const STOOQ_DOMAINS = ["https://stooq.pl", "https://stooq.com"] as const;
const STOOQ_TEXT_PROXY_URL = "https://r.jina.ai/http://stooq.pl/q/?s=";
const STOOQ_RATE_LIMIT_PATTERN = /przekroczony\s+dzienny\s+limit\s+wywolan/i;
const GPW_QUOTE_CACHE_TTL_MS = 30_000;
const GPW_SEARCH_FALLBACK_TIMEOUT_MS = 1_500;
const FINNHUB_SEARCH_TIMEOUT_MS = 3_500;
const COINGECKO_SEARCH_CACHE_TTL_MS = 60_000;
const COINGECKO_QUOTE_CACHE_TTL_MS = 30_000;

const gpwQuoteCache = new Map<string, { quote: AssetQuote; expiresAt: number }>();
const gpwQuoteInFlight = new Map<string, Promise<AssetQuote | null>>();
const coinGeckoSearchCache = new Map<string, { coins: CoinGeckoCoin[]; expiresAt: number }>();
const coinGeckoResolveCache = new Map<string, { providerId: string; expiresAt: number }>();
const coinGeckoQuoteCache = new Map<string, { quote: AssetQuote; expiresAt: number }>();

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

const parseStooqPageNumber = (value: string) => {
  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) && parsed > 0 ? round(parsed) : null;
};

const getStooqPageSymbolCandidates = (symbol: string) => {
  const normalized = normalizeSymbol(symbol);

  if (isGpwSymbol(normalized)) {
    const tickerCore = getGpwTickerCore(normalized);
    return uniqueBy([tickerCore.toLowerCase(), `${tickerCore.toLowerCase()}.wa`, tickerCore], (item) => item);
  }

  return uniqueBy([normalized.toLowerCase()], (item) => item);
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

const getGpwQuoteCacheKey = (symbol: string) => `stooq:${toStooqGpwSymbol(symbol)}`;

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

const toGpwCatalogQuote = (
  symbol: string,
  catalogEntry: { price: number | null; name: string } | null
) => {
  if (!catalogEntry?.price) {
    return null;
  }

  return buildGpwQuote(symbol, catalogEntry.price, catalogEntry.name);
};

const parseStooqJsonQuote = async (response: Response) => {
  try {
    const payload = (await response.json()) as StooqQuoteResponse;
    const item = payload.symbols?.[0];
    const close = Number(item?.close);

    if (!Number.isFinite(close) || close <= 0) {
      return null;
    }

    return round(close);
  } catch {
    return null;
  }
};

const parseStooqCsvQuote = (csv: string) => {
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

  const candidateLine =
    lines.length > 1 && /symbol/i.test(lines[0]) ? lines[1] : lines[0];
  const parts = candidateLine.split(",").map((part) => part.trim());
  const close = Number(parts[6] ?? parts[4] ?? parts[parts.length - 1]);

  return Number.isFinite(close) && close > 0 ? round(close) : null;
};

const parseStooqHistorySnapshot = (csv: string): StooqHistorySnapshot | null => {
  if (containsStooqRateLimitMessage(csv)) {
    return null;
  }

  const dataLines = csv
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d{4}-\d{2}-\d{2},/i.test(line));

  if (dataLines.length === 0) {
    return null;
  }

  const lastLine = dataLines.at(-1);

  if (!lastLine) {
    return null;
  }

  const lastClose = Number(lastLine.split(",")[4]);

  if (!Number.isFinite(lastClose) || lastClose <= 0) {
    return null;
  }

  const previousLine = dataLines.length > 1 ? dataLines.at(-2) : null;
  const previousClose = previousLine ? Number(previousLine.split(",")[4]) : Number.NaN;

  return {
    price: round(lastClose),
    previousClose:
      Number.isFinite(previousClose) && previousClose > 0
        ? round(previousClose)
        : undefined,
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

const buildGpwQuote = (
  symbol: string,
  price: number,
  name?: string,
  previousClose?: number
): AssetQuote => {
  const normalizedSymbol = normalizeGpwSymbol(symbol);
  const catalogEntry = findGpwCatalogEntry(normalizedSymbol);

  return {
    symbol: normalizedSymbol,
    price: round(price),
    marketCurrency: "PLN",
    provider: "stooq",
    fetchedAt: new Date().toISOString(),
    name: name?.trim() || catalogEntry?.name,
    previousClose,
  };
};

const getCachedGpwCatalogQuote = (symbol: string) =>
  toGpwCatalogQuote(symbol, findGpwCatalogEntry(symbol));

const getRefreshedGpwCatalogQuote = async (symbol: string) =>
  toGpwCatalogQuote(symbol, await findGpwCatalogEntryWithPrice(symbol));

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
    return null;
  }

  const csv = await response.text();
  const snapshot = parseStooqHistorySnapshot(csv);

  if (!snapshot) {
    return null;
  }

  return {
    symbol,
    price: snapshot.price,
    previousClose: snapshot.previousClose,
    marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
    provider: "stooq",
    fetchedAt: new Date().toISOString(),
  };
};

const fetchStooqLiveCsvQuote = async (
  symbol: string,
  fallbackCurrency: CurrencyCode,
  timeoutMs = 1_000
): Promise<AssetQuote | null> => {
  const requestSymbols = [getGpwTickerCore(symbol).toLowerCase()];

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
      continue;
    }

    const csv = await response.text();

    if (containsStooqRateLimitMessage(csv)) {
      continue;
    }

    const close = parseStooqCsvQuote(csv);

    if (close !== null) {
      const historyQuote = await fetchStooqHistoryQuoteForRequestSymbol(
        symbol,
        requestSymbol,
        fallbackCurrency,
        3_500
      );

      return {
        symbol,
        price: close,
        previousClose: historyQuote?.previousClose,
        marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
        provider: "stooq",
        fetchedAt: new Date().toISOString(),
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
  const requestSymbols = [getGpwTickerCore(symbol).toLowerCase()];

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
  if (providerId) {
    return providerId;
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

  return {
    symbol,
    price: round(latestPrice),
    marketCurrency: toCurrencyCode(fallbackCurrency),
    provider: "finnhub",
    fetchedAt: new Date().toISOString(),
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
        const close = await parseStooqJsonQuote(liveResponse);

        if (close !== null) {
          const historyQuote = await fetchStooqHistoryQuoteForRequestSymbol(
            symbol,
            requestSymbol,
            fallbackCurrency,
            4_500
          );

          return {
            symbol,
            price: close,
            previousClose: historyQuote?.previousClose,
            marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
            provider: "stooq",
            fetchedAt: new Date().toISOString(),
          };
        }
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

        const close = parseStooqCsvQuote(csv);

        if (close !== null) {
          const historyQuote = await fetchStooqHistoryQuoteForRequestSymbol(
            symbol,
            requestSymbol,
            fallbackCurrency,
            4_500
          );

          return {
            symbol,
            price: close,
            previousClose: historyQuote?.previousClose,
            marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
            provider: "stooq",
            fetchedAt: new Date().toISOString(),
          };
        }
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
        continue;
      }

      const csv = await historyResponse.text();

      if (containsStooqRateLimitMessage(csv)) {
        continue;
      }

      const snapshot = parseStooqHistorySnapshot(csv);

      if (snapshot) {
        return {
          symbol,
          price: snapshot.price,
          previousClose: snapshot.previousClose,
          marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
          provider: "stooq",
          fetchedAt: new Date().toISOString(),
        };
      }
    }
  }

  return fetchStooqPageQuote(symbol, fallbackCurrency);
};

const fetchGpwStooqQuote = async (symbol: string): Promise<AssetQuote | null> => {
  warmGpwCatalog();
  const normalizedGpwSymbol = normalizeGpwSymbol(symbol);
  const requestGpwSymbol = toStooqGpwSymbol(normalizedGpwSymbol);

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
      const normalizedQuote = buildGpwQuote(
        normalizedGpwSymbol,
        liveQuote.price,
        liveQuote.name,
        liveQuote.previousClose
      );
      setCachedGpwQuote(normalizedQuote);
      return normalizedQuote;
    }

    const historyQuote = await fetchStooqHistoryQuote(requestGpwSymbol, "PLN");

    if (historyQuote) {
      const normalizedQuote = buildGpwQuote(
        normalizedGpwSymbol,
        historyQuote.price,
        historyQuote.name,
        historyQuote.previousClose
      );
      setCachedGpwQuote(normalizedQuote);
      return normalizedQuote;
    }

    const catalogQuote = getCachedGpwCatalogQuote(normalizedGpwSymbol);

    if (catalogQuote) {
      setCachedGpwQuote(catalogQuote);
      return catalogQuote;
    }

    const pageQuote = await fetchStooqPageQuote(
      getGpwTickerCore(requestGpwSymbol),
      "PLN",
      20_000
    );

    if (pageQuote) {
      const normalizedQuote = buildGpwQuote(
        normalizedGpwSymbol,
        pageQuote.price,
        pageQuote.name
      );
      setCachedGpwQuote(normalizedQuote);
      return normalizedQuote;
    }

    const refreshedCatalogQuote = await getRefreshedGpwCatalogQuote(normalizedGpwSymbol);

    if (refreshedCatalogQuote) {
      setCachedGpwQuote(refreshedCatalogQuote);
      return refreshedCatalogQuote;
    }

    return null;
  })().finally(() => {
    gpwQuoteInFlight.delete(cacheKey);
  });

  gpwQuoteInFlight.set(cacheKey, quotePromise);

  return quotePromise;
};

const fetchCoinGeckoQuote = async (
  symbol: string,
  providerId?: string
): Promise<AssetQuote | null> => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const coinId = await resolveCoinGeckoProviderId(normalizedSymbol, providerId);

  if (!coinId) return null;

  const cachedQuote = coinGeckoQuoteCache.get(coinId);

  if (cachedQuote && cachedQuote.expiresAt > Date.now()) {
    return {
      ...cachedQuote.quote,
      symbol: normalizedSymbol,
    };
  }

  const response = await safeFetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
      coinId
    )}&vs_currencies=usd&include_24hr_change=true`,
    {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    },
    7_500
  );

  if (!response?.ok) {
    return cachedQuote?.quote
      ? {
          ...cachedQuote.quote,
          symbol: normalizedSymbol,
        }
      : null;
  }

  const payload = (await response.json()) as Record<
    string,
    {
      usd?: number;
      usd_24h_change?: number;
    }
  >;
  const price = payload[coinId]?.usd;
  const dailyChangePercent = payload[coinId]?.usd_24h_change;

  if (typeof price !== "number" || price <= 0) return null;

  const previousClose =
    typeof dailyChangePercent === "number" &&
    Number.isFinite(dailyChangePercent) &&
    dailyChangePercent > -100
      ? round(price / (1 + dailyChangePercent / 100), 8)
      : undefined;

  const quote: AssetQuote = {
    symbol: normalizedSymbol,
    price: round(price),
    marketCurrency: "USD",
    provider: "coingecko",
    providerId: coinId,
    fetchedAt: new Date().toISOString(),
    previousClose,
  };

  coinGeckoQuoteCache.set(coinId, {
    quote,
    expiresAt: Date.now() + COINGECKO_QUOTE_CACHE_TTL_MS,
  });

  return quote;
};

export const searchMarketAssets = async (
  query: string,
  kind: AssetKind,
  mode?: AssetSearchMode
): Promise<AssetSearchResult[]> => {
  if (!query.trim()) return [];

  if (kind === "crypto") {
    return searchCoinGecko(query);
  }

  if (kind === "stock" && mode === "stock-gpw") {
    warmGpwCatalog();
    const catalogResults = await searchGpwCatalog(query);

    if (catalogResults.length > 0) {
      return catalogResults;
    }

    return searchGpwStooqTickerFallback(query);
  }

  if (kind === "stock" && mode === "stock-international") {
    const yahooResults = await searchYahooStocks(query);

    if (yahooResults.length > 0) {
      return yahooResults;
    }

    const eodhdResults = await searchEodhdStocks(query);

    return eodhdResults.length > 0 ? eodhdResults : searchFinnhub(query, kind, mode);
  }

  if (kind === "stock" && mode === "stock-global") {
    const finnhubResults = await searchFinnhub(query, kind, mode);

    if (finnhubResults.length > 0) {
      return finnhubResults;
    }

    const yahooResults = await searchYahooStocks(query);
    const usYahooResults = yahooResults.filter(isUsYahooSearchResult);

    return usYahooResults.length > 0 ? usYahooResults : yahooResults;
  }

  if (kind === "etf" || mode === "etf") {
    return searchEodhdEtfs(query);
  }

  if (kind === "stock") {
    return searchFinnhub(query, kind, mode);
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
  const normalizedSymbol = normalizeSymbol(symbol);
  const isGpwStockRequest = shouldUseGpwStooqQuote({
    symbol: normalizedSymbol,
    kind,
    marketCurrency,
  });

  if (kind === "crypto") {
    return fetchCoinGeckoQuote(normalizedSymbol, providerId);
  }

  if (provider === "eodhd" && (kind === "stock" || kind === "etf")) {
    const eodhdQuote = await fetchEodhdQuote({
      symbol: normalizedSymbol,
      providerId,
      marketCurrency,
      priceScale,
    });

    if (eodhdQuote) {
      return eodhdQuote;
    }

    if (kind === "stock") {
      const yahooQuote = await fetchYahooQuote({
        symbol: normalizedSymbol,
        fallbackCurrency: marketCurrency,
      });

      if (yahooQuote) {
        return yahooQuote;
      }
    }

    if (kind === "etf") {
      return eodhdQuote;
    }
  }

  if (isGpwStockRequest) {
    return fetchGpwStooqQuote(normalizedSymbol);
  }

  if (provider === "yahoo" && kind === "stock") {
    return fetchYahooQuote({
      symbol: normalizedSymbol,
      providerId,
      fallbackCurrency: marketCurrency,
    });
  }

  if (provider === "finnhub") {
    return (
      (await fetchFinnhubQuote(normalizedSymbol, marketCurrency)) ??
      (await fetchYahooQuote({
        symbol: normalizedSymbol,
        fallbackCurrency: marketCurrency,
      })) ??
      (await fetchStooqQuote(normalizedSymbol, marketCurrency)) ??
      (await fetchStooqQuote(`${normalizedSymbol}.US`, marketCurrency))
    );
  }

  if (provider === "stooq") {
    return (
      (await fetchStooqQuote(normalizedSymbol, marketCurrency)) ??
      (await fetchYahooQuote({
        symbol: normalizedSymbol,
        fallbackCurrency: marketCurrency,
      })) ??
      (await fetchFinnhubQuote(normalizedSymbol, marketCurrency))
    );
  }

  const autoQuote =
    (await fetchFinnhubQuote(normalizedSymbol, marketCurrency)) ??
    (await fetchYahooQuote({
      symbol: normalizedSymbol,
      fallbackCurrency: marketCurrency,
    })) ??
    (await fetchStooqQuote(normalizedSymbol, marketCurrency));

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

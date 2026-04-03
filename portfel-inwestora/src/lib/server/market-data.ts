import {
  findGpwCatalogEntry,
  findGpwCatalogEntryWithPrice,
  searchGpwCatalog,
  warmGpwCatalog,
} from "@/lib/server/gpw-catalog";
import { inferCurrencyFromSymbol, normalizeSymbol } from "@/lib/ticker";
import { normalizeText, round, toCurrencyCode, uniqueBy } from "@/lib/utils";
import type {
  AssetKind,
  AssetQuote,
  AssetSearchMode,
  AssetSearchResult,
  CurrencyCode,
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

type CommoditySymbolPayload = {
  symbols?:
    | Array<{
        symbol?: string;
        category?: string;
        name?: string;
        status?: string;
        currency?: {
          code?: string;
        };
        unit?: {
          symbol?: string;
          name?: string;
        };
      }>
    | Record<
        string,
        {
          symbol?: string;
          category?: string;
          name?: string;
          status?: string;
          currency?: {
            code?: string;
          };
          unit?: {
            symbol?: string;
            name?: string;
          };
        }
      >;
};

const FINNHUB_API_KEY =
  process.env.FINNHUB_API_KEY ?? process.env.NEXT_PUBLIC_FINNHUB_API_KEY ?? "";
const COMMODITY_API_KEY =
  process.env.COMMODITY_PRICE_API_KEY ??
  process.env.NEXT_PUBLIC_COMMODITY_API_KEY ??
  "";

const isGpwSymbol = (symbol: string) => /\.WA$/i.test(symbol);
const isEuropeanEtfSymbol = (symbol: string) => /\.(AS|DE|DU|F|HM|MI|MU)$/i.test(symbol);
const normalizeGpwSymbol = (symbol: string) => {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return normalized;
  return isGpwSymbol(normalized) ? normalized : `${normalized}.WA`;
};
const getGpwTickerCore = (symbol: string) => normalizeGpwSymbol(symbol).replace(/\.WA$/i, "");
const shouldUseGpwStooqQuote = ({
  symbol,
  kind,
  marketCurrency,
}: {
  symbol: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
}) => kind === "stock" && (isGpwSymbol(symbol) || marketCurrency === "PLN");

const getEtfProvider = (symbol: string): QuoteProvider =>
  isEuropeanEtfSymbol(symbol) ? "stooq" : "finnhub";

const isUsFinnhubSymbol = (symbol: string) => /^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol);

const isStockLikeFinnhubType = (type?: string) => {
  const normalizedType = normalizeText(type ?? "");
  if (!normalizedType) return true;

  return (
    normalizedType.includes("common stock") ||
    normalizedType.includes("ordinary share") ||
    normalizedType.includes("adr")
  );
};

const isEtfLikeFinnhubType = (type?: string) => {
  const normalizedType = normalizeText(type ?? "");
  if (!normalizedType) return true;

  return (
    normalizedType.includes("etf") ||
    normalizedType.includes("exchange traded fund") ||
    normalizedType.includes("fund") ||
    normalizedType.includes("etn") ||
    normalizedType.includes("etp")
  );
};

const getStooqSymbolCandidates = (symbol: string) => {
  const normalized = symbol.trim().toLowerCase();

  if (isGpwSymbol(normalized)) {
    const withoutSuffix = normalized.replace(/\.wa$/i, "");

    return uniqueBy(
      [normalized, withoutSuffix, normalized.toUpperCase(), withoutSuffix.toUpperCase()],
      (item) => item
    );
  }

  return uniqueBy(
    [
      `${normalized}.wa`,
      normalized,
      `${normalized}.wa`.toUpperCase(),
      normalized.toUpperCase(),
    ],
    (item) => item
  );
};

const STOOQ_DOMAINS = ["https://stooq.pl", "https://stooq.com"] as const;
const STOOQ_TEXT_PROXY_URL = "https://r.jina.ai/http://stooq.pl/q/?s=";
const STOOQ_RATE_LIMIT_PATTERN = /przekroczony\s+dzienny\s+limit\s+wywolan/i;
const GPW_QUOTE_CACHE_TTL_MS = 30_000;

const gpwQuoteCache = new Map<string, { quote: AssetQuote; expiresAt: number }>();
const gpwQuoteInFlight = new Map<string, Promise<AssetQuote | null>>();

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
  const normalized = symbol.trim().toLowerCase();

  if (isGpwSymbol(normalized)) {
    const withoutSuffix = normalized.replace(/\.wa$/i, "");
    return uniqueBy([withoutSuffix, normalized], (item) => item);
  }

  return uniqueBy([normalized], (item) => item);
};

const normalizeGpwTickerQuery = (query: string) => {
  const normalized = normalizeSymbol(query);

  if (!normalized) {
    return null;
  }

  if (isGpwSymbol(normalized)) {
    const tickerCore = normalized.replace(/\.WA$/i, "");
    return /^[A-Z0-9]{1,6}$/.test(tickerCore) ? tickerCore : null;
  }

  return /^[A-Z0-9]{1,6}$/.test(normalized) ? normalized : null;
};

const containsStooqRateLimitMessage = (value: string) =>
  STOOQ_RATE_LIMIT_PATTERN.test(value);

const getGpwQuoteCacheKey = (symbol: string) => `stooq:${normalizeGpwSymbol(symbol)}`;

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

  gpwQuoteCache.set(getGpwQuoteCacheKey(normalizedSymbol), {
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

const buildGpwQuote = (symbol: string, price: number, name?: string): AssetQuote => {
  const normalizedSymbol = normalizeGpwSymbol(symbol);
  const catalogEntry = findGpwCatalogEntry(normalizedSymbol);

  return {
    symbol: normalizedSymbol,
    price: round(price),
    marketCurrency: "PLN",
    provider: "stooq",
    fetchedAt: new Date().toISOString(),
    name: name?.trim() || catalogEntry?.name,
  };
};

const getCachedGpwCatalogQuote = async (symbol: string) => {
  const catalogEntry = await findGpwCatalogEntryWithPrice(symbol);

  if (!catalogEntry?.price) {
    return null;
  }

  return buildGpwQuote(symbol, catalogEntry.price, catalogEntry.name);
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
      return {
        symbol,
        price: close,
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
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");

  for (const requestSymbol of requestSymbols) {
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
      continue;
    }

    const csv = await response.text();

    if (containsStooqRateLimitMessage(csv)) {
      continue;
    }

    const lines = csv
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const lastDataLine = [...lines].reverse().find((line) => /^\d{4}-\d{2}-\d{2},/i.test(line));

    if (!lastDataLine) {
      continue;
    }

    const close = Number(lastDataLine.split(",")[4]);

    if (Number.isFinite(close) && close > 0) {
      return {
        symbol,
        price: round(close),
        marketCurrency: inferCurrencyFromSymbol(symbol, fallbackCurrency),
        provider: "stooq",
        fetchedAt: new Date().toISOString(),
      };
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

  const quote = await fetchStooqPageQuote(tickerCore, "PLN", 5_000);

  if (!quote) {
    return [];
  }

  const canonicalSymbol = normalizeGpwSymbol(tickerCore);

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

  const response = await fetch(
    `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_API_KEY}`,
    {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) return [];

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
      if (kind === "etf" && !isEtfLikeFinnhubType(item.type)) return false;
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
        provider:
          mode === "stock-gpw"
            ? ("stooq" as const)
            : kind === "etf"
              ? getEtfProvider(item.symbol)
              : ("finnhub" as const),
      subtitle: "API",
      source: "api" as const,
    })),
    (item) => `${item.symbol}|${item.kind}|${item.provider}`
  )
    .slice(0, 8);
};

const searchCoinGecko = async (query: string): Promise<AssetSearchResult[]> => {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`,
    {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) return [];

  const payload: CoinGeckoSearchResponse = await response.json();

  return (payload.coins ?? [])
    .filter((coin): coin is { id: string; name?: string; symbol?: string } => Boolean(coin.id))
    .slice(0, 8)
    .map((coin) => ({
      symbol: normalizeSymbol(coin.symbol || coin.id),
      name: coin.name || coin.id,
      kind: "crypto" as const,
      marketCurrency: "USD" as const,
      provider: "coingecko" as const,
      providerId: coin.id,
      subtitle: "CoinGecko",
      source: "api" as const,
    }));
};

const fetchCommoditySymbols = async () => {
  if (!COMMODITY_API_KEY) return [];

  const upstream = new URL("https://api.commoditypriceapi.com/v2/symbols");
  upstream.searchParams.set("apiKey", COMMODITY_API_KEY);

  const response = await fetch(
    upstream.toString(),
    {
      headers: {
        Accept: "application/json",
        "x-api-key": COMMODITY_API_KEY,
      },
      next: {
        revalidate: 3600,
      },
    }
  );

  if (!response.ok) return [];

  const payload = (await response.json()) as CommoditySymbolPayload;
  const rawSymbols = payload.symbols;

  const items = Array.isArray(rawSymbols)
    ? rawSymbols
    : Object.values(rawSymbols ?? {});

  return items.filter(
    (
      item
    ): item is {
      symbol: string;
      category?: string;
      name?: string;
      status?: string;
      currency?: {
        code?: string;
      };
      unit?: {
        symbol?: string;
        name?: string;
      };
    } => Boolean(item.symbol) && item.status !== "deprecated"
  );
};

const searchCommodityApi = async (query: string): Promise<AssetSearchResult[]> => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  const symbols = await fetchCommoditySymbols();

  return symbols
    .filter((item) => {
      const haystack = normalizeText(
        [
          item.symbol,
          item.name,
          item.category,
          item.unit?.symbol,
          item.unit?.name,
        ]
          .filter(Boolean)
          .join(" ")
      );

      return haystack.includes(normalizedQuery);
    })
    .slice(0, 8)
    .map((item) => ({
      symbol: item.symbol,
      name: item.name ?? item.symbol,
      kind: "commodity" as const,
      marketCurrency: toCurrencyCode(item.currency?.code),
      provider: "commoditypriceapi" as const,
      providerId: item.symbol,
      subtitle: item.category,
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

  if (typeof quotePayload.c !== "number" || quotePayload.c <= 0) {
    return null;
  }

  return {
    symbol,
    price: round(quotePayload.c),
    marketCurrency: toCurrencyCode(fallbackCurrency),
    provider: "finnhub",
    fetchedAt: new Date().toISOString(),
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
          return {
            symbol,
            price: close,
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
          return {
            symbol,
            price: close,
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

      const lines = csv
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      if (lines.length < 2) {
        continue;
      }

      const lastLine = lines[lines.length - 1];
      const parts = lastLine.split(",");
      const close = Number(parts[4]);

      if (Number.isFinite(close) && close > 0) {
        return {
          symbol,
          price: round(close),
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

  if (!normalizedGpwSymbol) {
    return null;
  }

  const cachedQuote = getCachedGpwQuote(normalizedGpwSymbol);

  if (cachedQuote) {
    return cachedQuote;
  }

  const cacheKey = getGpwQuoteCacheKey(normalizedGpwSymbol);
  const inFlightQuote = gpwQuoteInFlight.get(cacheKey);

  if (inFlightQuote) {
    return inFlightQuote;
  }

  const quotePromise = (async () => {
    const liveQuote = await fetchStooqLiveCsvQuote(normalizedGpwSymbol, "PLN");

    if (liveQuote) {
      const normalizedQuote = buildGpwQuote(
        normalizedGpwSymbol,
        liveQuote.price,
        liveQuote.name
      );
      setCachedGpwQuote(normalizedQuote);
      return normalizedQuote;
    }

    const historyQuote = await fetchStooqHistoryQuote(normalizedGpwSymbol, "PLN");

    if (historyQuote) {
      const normalizedQuote = buildGpwQuote(
        normalizedGpwSymbol,
        historyQuote.price,
        historyQuote.name
      );
      setCachedGpwQuote(normalizedQuote);
      return normalizedQuote;
    }

    const catalogQuote = await getCachedGpwCatalogQuote(normalizedGpwSymbol);

    if (catalogQuote) {
      setCachedGpwQuote(catalogQuote);
      return catalogQuote;
    }

    const pageQuote = await fetchStooqPageQuote(
      getGpwTickerCore(normalizedGpwSymbol),
      "PLN",
      5_000
    );

    if (!pageQuote) {
      return null;
    }

    const normalizedQuote = buildGpwQuote(
      normalizedGpwSymbol,
      pageQuote.price,
      pageQuote.name
    );
    setCachedGpwQuote(normalizedQuote);
    return normalizedQuote;
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
  let coinId = providerId ?? "";

  if (!coinId) {
    const matches = await searchCoinGecko(symbol);
    coinId = matches[0]?.providerId ?? "";
  }

  if (!coinId) return null;

  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
      coinId
    )}&vs_currencies=usd`,
    {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) return null;

  const payload = (await response.json()) as Record<
    string,
    {
      usd?: number;
    }
  >;
  const price = payload[coinId]?.usd;

  if (typeof price !== "number" || price <= 0) return null;

  return {
    symbol: normalizeSymbol(symbol),
    price: round(price),
    marketCurrency: "USD",
    provider: "coingecko",
    providerId: coinId,
    fetchedAt: new Date().toISOString(),
  };
};

const COMMODITY_SYMBOL_MAP: Record<string, string> = {
  XAU: "XAU",
  XAG: "XAG",
  WTI: "WTIOIL-FUT",
  BRENT: "BRENTOIL-SPOT",
  NG: "NG-FUT",
};

const parseCommodityRate = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return round(value);
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const typedValue = value as Record<string, unknown>;
  const nestedCandidates = [
    typedValue.rate,
    typedValue.price,
    typedValue.value,
    typedValue.close,
    typedValue.latest,
  ];

  for (const candidate of nestedCandidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) {
      return round(candidate);
    }
  }

  return null;
};

const fetchCommodityQuote = async (
  symbol: string,
  providerId?: string
): Promise<AssetQuote | null> => {
  if (!COMMODITY_API_KEY) return null;

  const providerSymbol = normalizeSymbol(providerId ?? symbol);
  const mappedSymbol = COMMODITY_SYMBOL_MAP[providerSymbol] ?? providerSymbol;
  const upstream = new URL("https://api.commoditypriceapi.com/v2/rates/latest");
  upstream.searchParams.set("apiKey", COMMODITY_API_KEY);
  upstream.searchParams.set("symbols", mappedSymbol);

  const response = await fetch(upstream.toString(), {
    headers: {
      Accept: "application/json",
      "x-api-key": COMMODITY_API_KEY,
    },
    cache: "no-store",
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    rates?: Record<string, unknown>;
    metaData?: Record<
      string,
      {
        quote?: string | { code?: string };
      }
    >;
  };
  const rateKeys = uniqueBy(
    [
      mappedSymbol,
      mappedSymbol.toUpperCase(),
      mappedSymbol.toLowerCase(),
      providerSymbol,
      symbol,
      symbol.toUpperCase(),
    ],
    (item) => item
  );
  const rateEntryKey = rateKeys.find((key) => key in (payload.rates ?? {}));
  const price = rateEntryKey ? parseCommodityRate(payload.rates?.[rateEntryKey]) : null;

  if (!price) return null;

  const rawQuoteValue =
    (rateEntryKey && payload.metaData?.[rateEntryKey]?.quote) ??
    payload.metaData?.[mappedSymbol]?.quote;
  const quoteCode =
    typeof rawQuoteValue === "string" ? rawQuoteValue : rawQuoteValue?.code;

  return {
    symbol,
    price,
    marketCurrency: toCurrencyCode(quoteCode ?? "USD"),
    provider: "commoditypriceapi",
    providerId: providerSymbol,
    fetchedAt: new Date().toISOString(),
  };
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

  if (kind === "commodity") {
    return searchCommodityApi(query);
  }

  if (kind === "stock" && mode === "stock-gpw") {
    warmGpwCatalog();
    const catalogResults = await searchGpwCatalog(query);

    if (catalogResults.length > 0) {
      return catalogResults;
    }

    return searchGpwStooqTickerFallback(query);
  }

  if (kind === "stock" || kind === "etf") {
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
}: {
  symbol: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
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

  if (kind === "commodity") {
    return fetchCommodityQuote(normalizedSymbol, providerId);
  }

  if (isGpwStockRequest) {
    return fetchGpwStooqQuote(normalizedSymbol);
  }

  if (provider === "finnhub") {
    return (
      (await fetchFinnhubQuote(normalizedSymbol, marketCurrency)) ??
      (await fetchStooqQuote(normalizedSymbol, marketCurrency)) ??
      (await fetchStooqQuote(`${normalizedSymbol}.US`, marketCurrency))
    );
  }

  if (provider === "stooq") {
    return (
      (await fetchStooqQuote(normalizedSymbol, marketCurrency)) ??
      (await fetchFinnhubQuote(normalizedSymbol, marketCurrency))
    );
  }

  const autoQuote =
    (await fetchFinnhubQuote(normalizedSymbol, marketCurrency)) ??
    (await fetchStooqQuote(normalizedSymbol, marketCurrency));

  return autoQuote;
};

export const fetchFxRatesServer = async () => {
  const response = await fetch("https://api.nbp.pl/api/exchangerates/tables/A?format=json", {
    headers: {
      Accept: "application/json",
    },
    next: {
      revalidate: 300,
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

  const rates = payload[0]?.rates ?? [];

  return {
    PLN: 1,
    USD: rates.find((item) => item.code === "USD")?.mid ?? 1,
    EUR: rates.find((item) => item.code === "EUR")?.mid ?? 1,
  } as const;
};

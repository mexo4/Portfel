import * as https from "node:https";
import * as tls from "node:tls";
import { inferCurrencyFromSymbol, normalizeSymbol } from "@/lib/ticker";
import { normalizeText, round, toCurrencyCode, uniqueBy } from "@/lib/utils";
import type { AssetQuote, AssetSearchResult, CurrencyCode } from "@/types/portfolio";

type YahooSearchResponse = {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    exchange?: string;
    exchDisp?: string;
    quoteType?: string;
    typeDisp?: string;
    currency?: string;
  }>;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        currency?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
        shortName?: string;
        longName?: string;
        exchangeName?: string;
        fullExchangeName?: string;
        instrumentType?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
        adjclose?: Array<{
          adjclose?: Array<number | null>;
        }>;
      };
    }>;
    error?: {
      description?: string;
    } | null;
  };
};

type YahooQuoteSummaryResponse = {
  quoteResponse?: {
    result?: Array<{
      symbol?: string;
      currency?: string;
      regularMarketPrice?: number;
      regularMarketPreviousClose?: number;
      regularMarketTime?: number;
      shortName?: string;
      longName?: string;
    }>;
    error?: {
      description?: string;
    } | null;
  };
};

type YahooChartResult = NonNullable<
  NonNullable<YahooChartResponse["chart"]>["result"]
>[number];

type YahooMoneyUnit = {
  currency: CurrencyCode;
  priceScale: number;
};

const YAHOO_SEARCH_CACHE_TTL_MS = 60_000;
const YAHOO_QUOTE_CACHE_TTL_MS = 30_000;
const YAHOO_SEARCH_TIMEOUT_MS = 3_000;
const YAHOO_QUOTE_TIMEOUT_MS = 2_500;

const searchCache = new Map<string, { results: AssetSearchResult[]; expiresAt: number }>();
const quoteCache = new Map<string, { quote: AssetQuote; expiresAt: number }>();
const quoteInFlight = new Map<string, Promise<AssetQuote | null>>();

type TlsWithSystemCertificates = typeof tls & {
  getCACertificates?: (source: "default" | "bundled" | "system" | "extra") => string[];
};

const getYahooCaCertificates = () => {
  const getCACertificates = (tls as TlsWithSystemCertificates).getCACertificates;
  const systemCertificates = getCACertificates?.("system") ?? [];

  return Array.from(new Set([...tls.rootCertificates, ...systemCertificates]));
};

const yahooHttpsAgent = new https.Agent({
  keepAlive: true,
  ca: getYahooCaCertificates(),
});

export const normalizeYahooMoneyUnit = (
  value?: string,
  fallbackCurrency: CurrencyCode = "USD"
): YahooMoneyUnit => {
  const rawValue = value?.trim();
  const normalizedValue = rawValue?.toUpperCase();

  if (rawValue === "GBp" || normalizedValue === "GBX") {
    return {
      currency: "GBP",
      priceScale: 0.01,
    };
  }

  if (normalizedValue === "ZAC") {
    return {
      currency: "ZAR",
      priceScale: 0.01,
    };
  }

  return {
    currency: toCurrencyCode(rawValue, fallbackCurrency),
    priceScale: 1,
  };
};

const safeFetchJson = async <T,>(url: string, timeoutMs: number) => {
  return new Promise<T | null>((resolve) => {
    let isSettled = false;
    let request: ReturnType<typeof https.get> | null = null;

    const settle = (value: T | null) => {
      if (isSettled) {
        return;
      }

      isSettled = true;
      clearTimeout(timeoutId);

      resolve(value);
    };

    const timeoutId = setTimeout(() => {
      request?.destroy();
      settle(null);
    }, timeoutMs);

    request = https.get(
      url,
      {
        agent: yahooHttpsAgent,
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0",
        },
      },
      (response) => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          settle(null);
          return;
        }

        response.setEncoding("utf8");

        let body = "";

        response.on("data", (chunk: string) => {
          body += chunk;

          if (body.length > 1_000_000) {
            request?.destroy();
            settle(null);
          }
        });

        response.on("end", () => {
          if (isSettled) {
            return;
          }

          try {
            settle(JSON.parse(body) as T);
          } catch {
            settle(null);
          }
        });
      }
    );

    request.on("error", () => settle(null));
    request.setTimeout(timeoutMs, () => {
      request?.destroy();
      settle(null);
    });
  });
};

const firstNonNull = async <T,>(promises: Array<Promise<T | null>>) => {
  if (promises.length === 0) {
    return null;
  }

  return new Promise<T | null>((resolve) => {
    let pendingCount = promises.length;
    let isResolved = false;

    const settleEmpty = () => {
      pendingCount -= 1;

      if (pendingCount === 0 && !isResolved) {
        isResolved = true;
        resolve(null);
      }
    };

    promises.forEach((promise) => {
      promise
        .then((result) => {
          if (isResolved) {
            return;
          }

          if (result) {
            isResolved = true;
            resolve(result);
            return;
          }

          settleEmpty();
        })
        .catch(settleEmpty);
    });
  });
};

const getPositiveNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;

const buildYahooQuote = ({
  requestedSymbol,
  providerId,
  rawPrice,
  rawPreviousClose,
  rawCurrency,
  fallbackCurrency,
  marketTimestamp,
  name,
}: {
  requestedSymbol: string;
  providerId: string;
  rawPrice: number;
  rawPreviousClose?: number;
  rawCurrency?: string;
  fallbackCurrency: CurrencyCode;
  marketTimestamp?: string;
  name?: string;
}): AssetQuote => {
  const moneyUnit = normalizeYahooMoneyUnit(rawCurrency, fallbackCurrency);

  return {
    symbol: normalizeSymbol(requestedSymbol),
    price: round(rawPrice * moneyUnit.priceScale, 4),
    marketCurrency: moneyUnit.currency,
    provider: "yahoo",
    providerId: normalizeSymbol(providerId),
    // Provider time and local fetch time are deliberately distinct: a market
    // may be closed while the response is fetched moments ago.
    fetchedAt: new Date().toISOString(),
    marketTimestamp,
    priceDate: marketTimestamp?.slice(0, 10),
    name: name?.trim() || undefined,
    priceScale: moneyUnit.priceScale === 1 ? undefined : moneyUnit.priceScale,
    previousClose:
      typeof rawPreviousClose === "number"
        ? round(rawPreviousClose * moneyUnit.priceScale, 4)
        : undefined,
  };
};

const toYahooSummaryQuote = (
  item: NonNullable<
    NonNullable<YahooQuoteSummaryResponse["quoteResponse"]>["result"]
  >[number],
  requestedSymbol: string,
  fallbackCurrency: CurrencyCode
) => {
  const rawPrice =
    getPositiveNumber(item.regularMarketPrice) ??
    getPositiveNumber(item.regularMarketPreviousClose);

  if (rawPrice === null || !item.symbol) {
    return null;
  }

  return buildYahooQuote({
    requestedSymbol,
    providerId: item.symbol,
    rawPrice,
    rawPreviousClose: getPositiveNumber(item.regularMarketPreviousClose) ?? undefined,
    rawCurrency: item.currency,
    fallbackCurrency,
    marketTimestamp:
      typeof item.regularMarketTime === "number" && item.regularMarketTime > 0
        ? new Date(item.regularMarketTime * 1_000).toISOString()
        : undefined,
    name: item.longName?.trim() || item.shortName?.trim(),
  });
};

const toYahooChartQuote = (
  result: YahooChartResult,
  requestedSymbol: string,
  fallbackCurrency: CurrencyCode,
  candidate: string
) => {
  const meta = result.meta;

  if (!meta) {
    return null;
  }

  const rawPrice = getPositiveNumber(meta.regularMarketPrice) ?? getLatestClose(result);

  if (rawPrice === null) {
    return null;
  }

  const rawPreviousClose =
    getPositiveNumber(meta.chartPreviousClose) ?? getPositiveNumber(meta.previousClose);

  return buildYahooQuote({
    requestedSymbol,
    providerId: meta.symbol ?? candidate,
    rawPrice,
    rawPreviousClose: rawPreviousClose ?? undefined,
    rawCurrency: meta.currency,
    fallbackCurrency,
    marketTimestamp:
      typeof meta.regularMarketTime === "number" && meta.regularMarketTime > 0
        ? new Date(meta.regularMarketTime * 1_000).toISOString()
        : undefined,
    name: meta.longName?.trim() || meta.shortName?.trim(),
  });
};

const fetchYahooQuoteSummary = async (
  candidates: string[],
  requestedSymbol: string,
  fallbackCurrency: CurrencyCode
) => {
  const payload = await safeFetchJson<YahooQuoteSummaryResponse>(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
      candidates.join(",")
    )}`,
    YAHOO_QUOTE_TIMEOUT_MS
  );

  const quoteResults = payload?.quoteResponse?.result ?? [];
  const quoteBySymbol = new Map(
    quoteResults.map((item) => [normalizeSymbol(item.symbol ?? ""), item])
  );

  for (const candidate of candidates) {
    const summaryQuote = quoteBySymbol.get(candidate);

    if (!summaryQuote) {
      continue;
    }

    const quote = toYahooSummaryQuote(summaryQuote, requestedSymbol, fallbackCurrency);

    if (quote) {
      return quote;
    }
  }

  return null;
};

const fetchYahooChartQuote = async (
  candidate: string,
  requestedSymbol: string,
  fallbackCurrency: CurrencyCode
) => {
  const payload = await safeFetchJson<YahooChartResponse>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      candidate
    )}?range=5d&interval=1d&includePrePost=false&events=div%2Csplits`,
    YAHOO_QUOTE_TIMEOUT_MS
  );
  const result = payload?.chart?.result?.[0];

  return result ? toYahooChartQuote(result, requestedSymbol, fallbackCurrency, candidate) : null;
};

const fetchYahooQuoteUncached = async ({
  candidates,
  requestedSymbol,
  fallbackCurrency,
}: {
  candidates: string[];
  requestedSymbol: string;
  fallbackCurrency: CurrencyCode;
}) => {
  const quote = await firstNonNull([
    fetchYahooQuoteSummary(candidates, requestedSymbol, fallbackCurrency),
    ...candidates.map((candidate) =>
      fetchYahooChartQuote(candidate, requestedSymbol, fallbackCurrency)
    ),
  ]);

  if (!quote) {
    return null;
  }

  candidates.forEach((candidate) => setCachedQuote(candidate, quote));
  setCachedQuote(quote.providerId ?? requestedSymbol, quote);

  return quote;
};

const getQuoteInFlightKey = (candidates: string[], fallbackCurrency: CurrencyCode) =>
  `${fallbackCurrency}:${candidates.join("|")}`;

const getSearchMatchScore = (query: string, result: AssetSearchResult) => {
  const normalizedQuerySymbol = normalizeSymbol(query);
  const normalizedQueryText = normalizeText(query);
  const normalizedSymbol = normalizeSymbol(result.symbol);
  const normalizedName = normalizeText(result.name);

  if (normalizedSymbol === normalizedQuerySymbol) return 0;
  if (normalizedName === normalizedQueryText) return 1;
  if (normalizedName.startsWith(normalizedQueryText)) return 2;
  if (normalizedName.includes(normalizedQueryText)) return 3;
  if (normalizedSymbol.startsWith(normalizedQuerySymbol)) return 4;
  return 5;
};

const getExchangePriority = (result: AssetSearchResult) => {
  const subtitle = result.subtitle?.toUpperCase() ?? "";

  if (/\b(OTC|PINK)\b/.test(subtitle)) return 4;
  if (
    /\b(NYSE|NASDAQ|TOKYO|XETRA|LONDON|EURONEXT|SIX|TORONTO|HONG KONG|MILAN|MADRID|PARIS)\b/.test(
      subtitle
    )
  ) {
    return 0;
  }
  if (/\b(FRANKFURT|STUTTGART|HANOVER|SWISS|AMSTERDAM)\b/.test(subtitle)) return 1;
  return 2;
};

export const searchYahooStocks = async (query: string): Promise<AssetSearchResult[]> => {
  const trimmedQuery = query.trim();

  if (!trimmedQuery) {
    return [];
  }

  const cacheKey = normalizeText(trimmedQuery);
  const cachedEntry = searchCache.get(cacheKey);

  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.results;
  }

  const payload = await safeFetchJson<YahooSearchResponse>(
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      trimmedQuery
    )}&quotesCount=24&newsCount=0`,
    YAHOO_SEARCH_TIMEOUT_MS
  );

  const results = uniqueBy(
    (payload?.quotes ?? [])
      .filter((item) => item.symbol && normalizeSymbol(item.quoteType ?? "") === "EQUITY")
      .map((item) => {
        const symbol = normalizeSymbol(item.symbol ?? "");
        const moneyUnit = normalizeYahooMoneyUnit(
          item.currency,
          inferCurrencyFromSymbol(symbol, "USD")
        );

        return {
          symbol,
          name: item.longname?.trim() || item.shortname?.trim() || symbol,
          kind: "stock" as const,
          marketCurrency: moneyUnit.currency,
          provider: "yahoo" as const,
          providerId: symbol,
          subtitle: [item.exchDisp || item.exchange, "Yahoo"].filter(Boolean).join(" / "),
          source: "api" as const,
          priceScale: moneyUnit.priceScale === 1 ? undefined : moneyUnit.priceScale,
        };
      }),
    (item) => item.symbol
  )
    .sort(
      (left, right) =>
        getSearchMatchScore(trimmedQuery, left) - getSearchMatchScore(trimmedQuery, right) ||
        getExchangePriority(left) - getExchangePriority(right) ||
        left.name.localeCompare(right.name, "pl")
    )
    .slice(0, 16);

  searchCache.set(cacheKey, {
    results,
    expiresAt: Date.now() + YAHOO_SEARCH_CACHE_TTL_MS,
  });

  return results;
};

const getCachedQuote = (providerId: string) => {
  const cachedEntry = quoteCache.get(normalizeSymbol(providerId));

  if (!cachedEntry) {
    return null;
  }

  if (cachedEntry.expiresAt <= Date.now()) {
    quoteCache.delete(normalizeSymbol(providerId));
    return null;
  }

  return cachedEntry.quote;
};

const setCachedQuote = (providerId: string, quote: AssetQuote) => {
  quoteCache.set(normalizeSymbol(providerId), {
    quote,
    expiresAt: Date.now() + YAHOO_QUOTE_CACHE_TTL_MS,
  });
};

const getLatestClose = (result: YahooChartResult) => {
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const adjustedCloses = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const candidateCloses = adjustedCloses.length > 0 ? adjustedCloses : closes;

  for (let index = candidateCloses.length - 1; index >= 0; index -= 1) {
    const close = candidateCloses[index];

    if (typeof close === "number" && Number.isFinite(close) && close > 0) {
      return close;
    }
  }

  return null;
};

export const fetchYahooQuote = async ({
  symbol,
  providerId,
  fallbackCurrency,
}: {
  symbol: string;
  providerId?: string;
  fallbackCurrency: CurrencyCode;
}): Promise<AssetQuote | null> => {
  const candidates = uniqueBy(
    [providerId, symbol].filter((item): item is string => Boolean(item?.trim())).map(normalizeSymbol),
    (item) => item
  );

  for (const candidate of candidates) {
    const cachedQuote = getCachedQuote(candidate);

    if (cachedQuote) {
      return {
        ...cachedQuote,
        symbol: normalizeSymbol(symbol),
      };
    }
  }

  const inFlightKey = getQuoteInFlightKey(candidates, fallbackCurrency);
  const inFlightQuote = quoteInFlight.get(inFlightKey);

  if (inFlightQuote) {
    const quote = await inFlightQuote;
    return quote ? { ...quote, symbol: normalizeSymbol(symbol) } : null;
  }

  const quotePromise = fetchYahooQuoteUncached({
    candidates,
    requestedSymbol: symbol,
    fallbackCurrency,
  }).finally(() => {
    quoteInFlight.delete(inFlightKey);
  });

  quoteInFlight.set(inFlightKey, quotePromise);

  const quote = await quotePromise;
  return quote ? { ...quote, symbol: normalizeSymbol(symbol) } : null;
};

import { getMarketCacheEntry, setMarketCachePayload } from "@/lib/server/market-cache";
import { isReusableHistoryCacheEntry } from "@/lib/server/portfolio-history-cache-policy";
import { fetchFxRatesServer } from "@/lib/server/market-data";
import { fetchTreasuryBondQuoteSeriesServer } from "@/lib/server/treasury-bonds";
import { normalizeYahooMoneyUnit } from "@/lib/server/yahoo";
import { FALLBACK_FX_RATES } from "@/lib/constants";
import {
  getOperationCashDeltas,
  getPortfolioAccountArchivedDate,
} from "@/lib/operation-engine";
import { createHash } from "node:crypto";
import https from "node:https";
import {
  getGpwTickerCore,
  getPortfolioAssetGroupKey,
  isGpwSymbol,
  normalizeSymbol,
} from "@/lib/ticker";
import {
  getTickerLookupCandidates,
  resolveTickerAlias,
  resolveTickerIdentity,
} from "@/lib/ticker-aliases";
import { round, toCurrencyCode, toDateInputValue } from "@/lib/utils";
import type {
  AssetKind,
  CurrencyCode,
  PortfolioAsset,
  PortfolioAccount,
  PortfolioAssetHistorySeries,
  PortfolioBenchmarkDefinition,
  PortfolioBenchmarkHistorySeries,
  PortfolioHistoryPoint,
  PortfolioHistoryResponse,
  PortfolioHistoryScope,
  PortfolioOperation,
  PortfolioRealizedAdjustment,
  PortfolioSale,
  QuoteProvider,
} from "@/types/portfolio";

type PricePoint = {
  date: string;
  close: number;
};

type FxPoint = {
  date: string;
  rate: number;
};

type PortfolioHistorySegment = {
  id: string;
  groupKey: string;
  historyKey: string;
  kind: AssetKind;
  symbol: string;
  quantity: number;
  purchaseDate: string;
  startDate: string;
  endDate: string;
  marketCurrency: CurrencyCode;
  purchaseCurrency: CurrencyCode;
  purchasePriceCurrency?: CurrencyCode;
  purchaseFxRateToPln?: number;
  purchasePrice: number;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
};

type InstrumentHistoryDefinition = {
  historyKey: string;
  kind: AssetKind;
  symbol: string;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
  purchaseDate: string;
};

type InstrumentHistoryResult = {
  points: PricePoint[];
  warning?: string;
};

type AssetSeriesDefinition = {
  groupKey: string;
  label: string;
  symbol: string;
  kind: AssetKind;
};

const setCachedPayload = setMarketCachePayload;

const EODHD_API_KEY = process.env.EODHD_API_KEY ?? "";
const HISTORY_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const FX_HISTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const historyCacheRequestsInFlight = new Map<string, Promise<unknown>>();

const isHistoryDiagnosticsEnabled = () =>
  process.env.PORTFOLIO_HISTORY_DIAGNOSTICS === "true";

const logHistoryDiagnostic = (event: string, fields: Record<string, number | string>) => {
  if (!isHistoryDiagnosticsEnabled()) return;
  console.info(`[portfolio-history] ${event}`, fields);
};
const NBP_CHUNK_MAX_DAYS = 360;

const fetchTextWithNodeHttps = (
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
) =>
  new Promise<string | null>((resolve) => {
    const request = https.get(
      url,
      {
        headers,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (response) => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          resolve(null);
          return;
        }

        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve(body);
        });
      }
    );

    request.on("timeout", () => {
      request.destroy();
      resolve(null);
    });
    request.on("error", () => {
      resolve(null);
    });
  });

const safeFetchText = async (url: string, timeoutMs = 20_000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    Accept: "text/plain, text/csv",
    "Accept-Encoding": "identity",
    "User-Agent": "Mozilla/5.0",
  };

  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const text = await response.text();

    if (!text.includes("/__verify")) {
      return text;
    }

    return await fetchTextAfterStooqVerification(url, text, response, timeoutMs);
  } catch {
    const text = await fetchTextWithNodeHttps(url, headers, timeoutMs);
    return text?.includes("/__verify") ? null : text;
  } finally {
    clearTimeout(timeoutId);
  }
};

const getSetCookieHeader = (response: Response) => {
  const headersWithGetSetCookie = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const cookies = headersWithGetSetCookie.getSetCookie?.();

  if (cookies && cookies.length > 0) {
    return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
  }

  return response.headers.get("set-cookie")?.split(",").map((cookie) => cookie.split(";")[0]).join("; ");
};

const solveStooqChallenge = (html: string) => {
  const challenge = html.match(/const c="([^"]+)"/)?.[1];
  const difficulty = Number(html.match(/d=(\d+)/)?.[1] ?? 0);

  if (!challenge || !Number.isFinite(difficulty) || difficulty <= 0) {
    return null;
  }

  const prefix = "0".repeat(difficulty);

  for (let nonce = 0; nonce < 2_000_000; nonce += 1) {
    const hash = createHash("sha256").update(`${challenge}${nonce}`).digest("hex");

    if (hash.startsWith(prefix)) {
      return { challenge, nonce };
    }
  }

  return null;
};

const fetchTextAfterStooqVerification = async (
  url: string,
  challengeHtml: string,
  response: Response,
  timeoutMs: number
) => {
  const solution = solveStooqChallenge(challengeHtml);

  if (!solution) {
    return null;
  }

  const cookie = getSetCookieHeader(response);
  const targetUrl = new URL(url);
  const verifyResponse = await fetch(`${targetUrl.origin}/__verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams({
      c: solution.challenge,
      n: String(solution.nonce),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  if (!verifyResponse?.ok) {
    return null;
  }

  const verifyCookie = getSetCookieHeader(verifyResponse);
  const verifiedResponse = await fetch(url, {
    headers: {
      Accept: "text/plain, text/csv",
      "User-Agent": "Mozilla/5.0",
      ...(verifyCookie || cookie ? { Cookie: verifyCookie ?? cookie } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);

  if (!verifiedResponse?.ok) {
    return null;
  }

  const verifiedText = await verifiedResponse.text();
  return verifiedText.includes("/__verify") ? null : verifiedText;
};

const safeFetchJson = async <T,>(url: string, timeoutMs = 20_000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    "User-Agent": "Mozilla/5.0",
  };

  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    const text = await fetchTextWithNodeHttps(url, headers, timeoutMs);

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  } finally {
    clearTimeout(timeoutId);
  }
};

const formatDateOnly = (value: Date) => value.toISOString().slice(0, 10);

const shiftDateInputValue = (date: string, days: number) => {
  const sourceDate = new Date(`${date}T00:00:00.000Z`);
  sourceDate.setUTCDate(sourceDate.getUTCDate() + days);
  return sourceDate.toISOString().slice(0, 10);
};

const getDateRange = (startDate: string, endDate: string) => {
  const dates: string[] = [];

  for (
    let cursor = toDateInputValue(startDate);
    cursor <= endDate;
    cursor = shiftDateInputValue(cursor, 1)
  ) {
    dates.push(cursor);
  }

  return dates;
};

const addDays = (date: string, days: number) => shiftDateInputValue(date, days);

const getDaysBetween = (startDate: string, endDate: string) => {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();

  return Math.max(0, Math.floor((end - start) / 86_400_000));
};

const getCachedOrFetch = async <T,>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
) => {
  const inFlight = historyCacheRequestsInFlight.get(key);
  if (inFlight) return inFlight as Promise<T>;

  const request = (async () => {
    const startedAt = performance.now();
    const cachedEntry = await getMarketCacheEntry(key, ttlMs);

    if (cachedEntry !== null && isReusableHistoryCacheEntry(cachedEntry.payload, cachedEntry.updatedAt)) {
      const cachedPayload = cachedEntry.payload as T;
      const isNegativeArrayCache = Array.isArray(cachedPayload) && cachedPayload.length === 0;
      logHistoryDiagnostic("cache-hit", {
        key: createHash("sha256").update(key).digest("hex").slice(0, 10),
        source: key.startsWith("portfolio-history:") ? key.split(":")[1] ?? "history" : "history",
        empty: isNegativeArrayCache ? 1 : 0,
        points: Array.isArray(cachedPayload) ? cachedPayload.length : 0,
        durationMs: Math.round(performance.now() - startedAt),
      });
      return cachedPayload;
    }

    const fetchStartedAt = performance.now();
    const payload = await fetcher();
    const fetchMs = performance.now() - fetchStartedAt;
    const storeStartedAt = performance.now();
    await setCachedPayload(key, payload);
    const storeMs = performance.now() - storeStartedAt;
    logHistoryDiagnostic("cache-miss", {
      key: createHash("sha256").update(key).digest("hex").slice(0, 10),
      source: key.startsWith("portfolio-history:") ? key.split(":")[1] ?? "history" : "history",
      empty: Array.isArray(payload) && payload.length === 0 ? 1 : 0,
      points: Array.isArray(payload) ? payload.length : 0,
      fetchMs: Math.round(fetchMs),
      cacheWriteMs: Math.round(storeMs),
      totalMs: Math.round(performance.now() - startedAt),
    });
    return payload;
  })();

  historyCacheRequestsInFlight.set(key, request);
  try {
    return await request;
  } finally {
    if (historyCacheRequestsInFlight.get(key) === request) {
      historyCacheRequestsInFlight.delete(key);
    }
  }
};

const dedupeAndSortPricePoints = (points: PricePoint[]) => {
  const byDate = new Map<string, number>();

  for (const point of points) {
    if (!point.date || !Number.isFinite(point.close) || point.close <= 0) {
      continue;
    }

    byDate.set(point.date, round(point.close, 8));
  }

  return Array.from(byDate.entries())
    .map(([date, close]) => ({ date, close }))
    .sort((left, right) => left.date.localeCompare(right.date));
};

const MAX_RELIABLE_PRICE_GAP_DAYS = 5;

export const hasUnreliableHistoryGap = (
  points: readonly PricePoint[],
  startDate: string,
  endDate: string
) => {
  let cursor = startDate;
  for (const point of points) {
    if (point.date < startDate || point.date > endDate) continue;
    if (getDaysBetween(cursor, point.date) > MAX_RELIABLE_PRICE_GAP_DAYS) return true;
    cursor = point.date;
  }
  return getDaysBetween(cursor, endDate) > MAX_RELIABLE_PRICE_GAP_DAYS;
};

const dedupeAndSortFxPoints = (points: FxPoint[]) => {
  const byDate = new Map<string, number>();

  for (const point of points) {
    if (!point.date || !Number.isFinite(point.rate) || point.rate <= 0) {
      continue;
    }

    byDate.set(point.date, round(point.rate, 6));
  }

  return Array.from(byDate.entries())
    .map(([date, rate]) => ({ date, rate }))
    .sort((left, right) => left.date.localeCompare(right.date));
};

const parseStooqHistory = (csv: string) =>
  dedupeAndSortPricePoints(
    csv
      .trim()
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(","))
      .map((parts) => ({
        date: parts[0] ?? "",
        close: Number(parts[4]),
      }))
  );

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
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
  };
};

const toYahooStockSymbol = (symbol: string) => {
  const normalizedSymbol = normalizeSymbol(symbol);

  if (isGpwSymbol(normalizedSymbol)) {
    return `${getGpwTickerCore(normalizedSymbol)}.WA`;
  }

  return normalizedSymbol.replace(/\.US$/i, "");
};

const fetchYahooStockHistory = async (
  symbol: string,
  startDate: string,
  endDate: string,
  fallbackPriceScale = 1
) => {
  const yahooSymbol = toYahooStockSymbol(symbol);
  const period1 = Math.floor(new Date(`${startDate}T00:00:00.000Z`).getTime() / 1_000);
  const period2 = Math.floor(new Date(`${endDate}T23:59:59.000Z`).getTime() / 1_000);

  return getCachedOrFetch<PricePoint[]>(
    `portfolio-history:yahoo:${isGpwSymbol(yahooSymbol) ? "gpw-v2:" : ""}${normalizeSymbol(
      yahooSymbol
    )}:${startDate}:${endDate}:${
      fallbackPriceScale ?? 1
    }`,
    HISTORY_CACHE_TTL_MS,
    async () => {
      const payload = await safeFetchJson<YahooChartResponse>(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
          yahooSymbol
        )}?period1=${period1}&period2=${period2}&interval=1d&includePrePost=false&events=div%2Csplits`,
        25_000
      );
      const result = payload?.chart?.result?.[0];
      const timestamps = result?.timestamp ?? [];
      const closes = result?.indicators?.quote?.[0]?.close ?? [];
      const adjustedCloses = result?.indicators?.adjclose?.[0]?.adjclose ?? [];
      const yahooMoneyUnit = normalizeYahooMoneyUnit(result?.meta?.currency);
      const priceScale =
        yahooMoneyUnit.priceScale !== 1 ? yahooMoneyUnit.priceScale : fallbackPriceScale;

      return dedupeAndSortPricePoints(
        timestamps.map((timestamp, index) => ({
          date: formatDateOnly(new Date(timestamp * 1_000)),
          close: Number(adjustedCloses[index] ?? closes[index]) * priceScale,
        }))
      );
    }
  );
};

const fetchStooqStockHistory = async (
  symbol: string,
  startDate: string,
  endDate: string
) => {
  const normalizedSymbol = normalizeSymbol(symbol);
  const lowerSymbol = normalizedSymbol.toLowerCase();
  const candidates = isGpwSymbol(normalizedSymbol)
    ? [`${getGpwTickerCore(normalizedSymbol).toLowerCase()}.wa`]
    : Array.from(
        new Set(
          lowerSymbol.endsWith(".us")
            ? [lowerSymbol, lowerSymbol.replace(/\.us$/i, "")]
            : [`${lowerSymbol}.us`, lowerSymbol]
        )
      );
  const start = startDate.replaceAll("-", "");
  const end = endDate.replaceAll("-", "");

  for (const candidate of candidates) {
    const cacheKey = `portfolio-history:stooq:${candidate}:${start}:${end}`;
    const points = await getCachedOrFetch<PricePoint[]>(
      cacheKey,
      HISTORY_CACHE_TTL_MS,
      async () => {
        const csv = await safeFetchText(
          `https://stooq.pl/q/d/l/?s=${encodeURIComponent(candidate)}&d1=${start}&d2=${end}&i=d`
        );
        return csv ? parseStooqHistory(csv) : [];
      }
    );

    if (points.length > 0) {
      return points;
    }
  }

  return [];
};

const fetchStockHistory = async (
  symbol: string,
  startDate: string,
  endDate: string,
  yahooFallbackPriceScale?: number
) => {
  const yahooPoints = await fetchYahooStockHistory(
    symbol,
    startDate,
    endDate,
    yahooFallbackPriceScale
  );

  if (yahooPoints.length > 0) {
    return yahooPoints;
  }

  return fetchStooqStockHistory(symbol, startDate, endDate);
};

const getEodhdHistoryProviderIdCandidates = (providerId: string) => {
  const normalizedProviderId = normalizeSymbol(providerId);
  const providerCore = normalizedProviderId.replace(/\.(PL|WAR)$/i, "");

  if (normalizedProviderId.endsWith(".PL")) {
    return [normalizedProviderId, `${providerCore}.WAR`];
  }

  if (normalizedProviderId.endsWith(".WAR")) {
    return [`${providerCore}.PL`, normalizedProviderId];
  }

  return [normalizedProviderId];
};

const fetchEodhdHistoryForProviderId = async (
  providerId: string,
  startDate: string,
  endDate: string,
  priceScale?: number
) => {
  if (!EODHD_API_KEY) {
    return [];
  }

  const normalizedProviderId = normalizeSymbol(providerId);

  return getCachedOrFetch<PricePoint[]>(
    `portfolio-history:eodhd:${normalizedProviderId}:${startDate}:${endDate}:${
      priceScale ?? 1
    }`,
    HISTORY_CACHE_TTL_MS,
    async () => {
      const payload = await safeFetchJson<
        Array<{
          date?: string;
          close?: number;
          adjusted_close?: number;
        }>
      >(
        `https://eodhd.com/api/eod/${encodeURIComponent(
          normalizedProviderId
        )}?api_token=${encodeURIComponent(
          EODHD_API_KEY
        )}&fmt=json&from=${startDate}&to=${endDate}`,
        25_000
      );

      return dedupeAndSortPricePoints(
        (payload ?? []).map((item) => ({
          date: item.date ?? "",
          close:
            ((typeof item.adjusted_close === "number" && item.adjusted_close > 0
              ? item.adjusted_close
              : item.close) ?? 0) * (priceScale ?? 1),
        }))
      );
    }
  );
};

const fetchEodhdHistory = async (
  providerId: string,
  startDate: string,
  endDate: string,
  priceScale?: number
) => {
  for (const candidateProviderId of getEodhdHistoryProviderIdCandidates(providerId)) {
    const points = await fetchEodhdHistoryForProviderId(
      candidateProviderId,
      startDate,
      endDate,
      priceScale
    );

    if (points.length > 0) {
      return points;
    }
  }

  return [];
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

const normalizeCoinGeckoHistoryProviderId = (symbol: string, providerId?: string) => {
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

const fetchCoinGeckoHistory = async (
  providerId: string,
  startDate: string,
  endDate: string
) => {
  const from = Math.floor(new Date(`${startDate}T00:00:00.000Z`).getTime() / 1_000);
  const to = Math.floor(new Date(`${endDate}T23:59:59.000Z`).getTime() / 1_000);

  return getCachedOrFetch<PricePoint[]>(
    `portfolio-history:coingecko:${providerId.toLowerCase()}:${startDate}:${endDate}`,
    HISTORY_CACHE_TTL_MS,
    async () => {
      const payload = await safeFetchJson<{
        prices?: Array<[number, number]>;
      }>(
        `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
          providerId
        )}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`,
        25_000
      );

      return dedupeAndSortPricePoints(
        (payload?.prices ?? []).map(([timestamp, close]) => ({
          date: formatDateOnly(new Date(timestamp)),
          close: round(close, 8),
        }))
      );
    }
  );
};

const getHistoryLookupSymbols = ({
  symbol,
  kind,
  marketCurrency,
  providerId,
}: {
  symbol: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
  providerId?: string;
}) =>
  getTickerLookupCandidates({
    symbol,
    kind,
    marketCurrency,
    providerId,
  }).map((candidate) => normalizeSymbol(candidate.value));

const getGpwScopedHistorySymbols = (symbols: string[], fallbackSymbol: string) =>
  Array.from(
    new Set(
      [fallbackSymbol, ...symbols]
        .map((symbol) => normalizeSymbol(symbol))
        .filter((symbol) => isGpwSymbol(symbol))
    )
  );

const fetchInstrumentHistory = async ({
  kind,
  symbol,
  marketCurrency,
  provider,
  providerId,
  priceScale,
  purchaseDate,
}: InstrumentHistoryDefinition,
  startDate: string,
  endDate: string
): Promise<InstrumentHistoryResult> => {
  try {
    const normalizedSymbol = normalizeSymbol(symbol);
    const identity = resolveTickerIdentity({
      symbol: normalizedSymbol,
      kind,
      marketCurrency,
    });
    const alias = identity.alias ?? resolveTickerAlias(normalizedSymbol, kind);
    const resolvedKind = identity.kind ?? alias?.kind ?? kind;
    const resolvedSymbol = normalizeSymbol(identity.symbol);
    const resolvedMarketCurrency = toCurrencyCode(
      identity.marketCurrency ?? alias?.marketCurrency ?? marketCurrency,
      marketCurrency
    );
    const resolvedProvider = alias?.provider ?? provider;
    const resolvedProviderId = identity.providerId ?? alias?.providerId ?? providerId;
    const resolvedPriceScale = identity.priceScale ?? alias?.priceScale ?? priceScale;
    const lookupSymbols = getHistoryLookupSymbols({
      symbol: resolvedSymbol,
      kind: resolvedKind,
      marketCurrency: resolvedMarketCurrency,
      providerId: resolvedProviderId,
    });
    const isGpwStockRequest =
      resolvedKind === "stock" &&
      (isGpwSymbol(resolvedSymbol) || resolvedMarketCurrency === "PLN");
    const historyLookupSymbols = isGpwStockRequest
      ? getGpwScopedHistorySymbols(lookupSymbols, resolvedSymbol)
      : lookupSymbols;

    if (resolvedKind === "bond") {
      const points = await fetchTreasuryBondQuoteSeriesServer({
        code: resolvedSymbol,
        purchaseDate,
        startDate,
        endDate,
      });

      return {
        points: dedupeAndSortPricePoints(
          points.map((point) => ({
            date: point.date,
            close: point.price,
          }))
        ),
      };
    }

    if (resolvedKind === "stock") {
      if (resolvedProvider === "eodhd" && resolvedProviderId) {
        const eodhdPoints = await fetchEodhdHistory(
          resolvedProviderId,
          startDate,
          endDate,
          resolvedPriceScale
        );

        if (eodhdPoints.length > 0) {
          return { points: eodhdPoints };
        }
      }

      for (const stockHistorySymbol of historyLookupSymbols) {
        const points = await fetchStockHistory(
          stockHistorySymbol,
          startDate,
          endDate,
          resolvedPriceScale
        );

        if (points.length > 0) {
          return { points };
        }
      }

      return {
        points: [],
        warning: `Nie udalo sie pobrac pelnej historii cen dla ${symbol}; uzyto fallbacku z danych zakupu.`,
      };
    }

    if (resolvedKind === "etf") {
      const eodhdPoints = resolvedProvider === "eodhd" && resolvedProviderId
        ? await fetchEodhdHistory(resolvedProviderId, startDate, endDate, resolvedPriceScale)
        : [];

      if (eodhdPoints.length > 0) {
        return { points: eodhdPoints };
      }

      for (const etfHistorySymbol of lookupSymbols) {
        const points = await fetchStockHistory(
          etfHistorySymbol,
          startDate,
          endDate,
          resolvedPriceScale
        );

        if (points.length > 0) {
          return { points };
        }
      }

      return {
        points: [],
        warning: `Nie udalo sie pobrac pelnej historii cen dla ETF ${symbol}; uzyto fallbacku z danych zakupu.`,
      };
    }

    if (resolvedKind === "crypto") {
      const coinGeckoProviderId = normalizeCoinGeckoHistoryProviderId(
        resolvedSymbol,
        resolvedProviderId
      );

      if (!coinGeckoProviderId) {
        return {
          points: [],
          warning: `Krypto ${symbol} nie ma providerId CoinGecko; uzyto fallbacku z danych zakupu.`,
        };
      }

      const points = await fetchCoinGeckoHistory(
        coinGeckoProviderId,
        startDate,
        endDate
      );
      const filteredPoints = points.filter(
        (point) => point.date >= startDate && point.date <= endDate
      );

      return filteredPoints.length > 0
        ? { points: filteredPoints }
        : {
            points: [],
            warning: `Nie udalo sie pobrac pelnej historii cen dla krypto ${symbol}; uzyto fallbacku z danych zakupu.`,
          };
    }

    return {
      points: [],
      warning: `Brakuje historii cen dla ${symbol} (${resolvedMarketCurrency}); uzyto fallbacku z danych zakupu.`,
    };
  } catch {
    return {
      points: [],
      warning: `Nie udalo sie zbudowac historii dla ${symbol}; uzyto fallbacku z danych zakupu.`,
    };
  }
};

const chunkDateRange = (startDate: string, endDate: string) => {
  const chunks: Array<{ startDate: string; endDate: string }> = [];
  let cursor = startDate;

  while (cursor <= endDate) {
    const nextEnd = addDays(
      cursor,
      Math.min(NBP_CHUNK_MAX_DAYS - 1, getDaysBetween(cursor, endDate))
    );

    chunks.push({
      startDate: cursor,
      endDate: nextEnd,
    });

    cursor = addDays(nextEnd, 1);
  }

  return chunks;
};

const fetchNbpFxChunk = async (
  table: "A" | "B",
  code: CurrencyCode,
  startDate: string,
  endDate: string
) => {
  const payload = await safeFetchJson<{
    rates?: Array<{
      effectiveDate?: string;
      mid?: number;
    }>;
  }>(
    `https://api.nbp.pl/api/exchangerates/rates/${table}/${encodeURIComponent(
      code
    )}/${startDate}/${endDate}?format=json`,
    20_000
  );

  return dedupeAndSortFxPoints(
    (payload?.rates ?? []).map((rate) => ({
      date: rate.effectiveDate ?? "",
      rate: rate.mid ?? 0,
    }))
  );
};

const fetchHistoricalFxPoints = async (
  code: CurrencyCode,
  startDate: string,
  endDate: string
) => {
  if (code === "PLN") {
    return [{ date: startDate, rate: 1 }];
  }

  const cacheKey = `portfolio-history:fx:${code}:${startDate}:${endDate}`;

  return getCachedOrFetch<FxPoint[]>(cacheKey, FX_HISTORY_CACHE_TTL_MS, async () => {
    const chunkPoints = await Promise.all(
      chunkDateRange(startDate, endDate).map(async (chunk) => {
        const tableAPoints = await fetchNbpFxChunk("A", code, chunk.startDate, chunk.endDate);

        if (tableAPoints.length > 0) {
          return tableAPoints;
        }

        return fetchNbpFxChunk("B", code, chunk.startDate, chunk.endDate);
      })
    );

    return dedupeAndSortFxPoints(chunkPoints.flat());
  });
};

const buildFxSeries = async (
  codes: CurrencyCode[],
  startDate: string,
  endDate: string
) => {
  const uniqueCodes = Array.from(
    new Set(codes.map((code) => toCurrencyCode(code, "PLN")).concat("PLN"))
  );
  const dates = getDateRange(startDate, endDate);
  const fxEntries = await Promise.all(
    uniqueCodes.map(async (code) => {
      if (code === "PLN") {
        return {
          code,
          dailyRates: new Map(dates.map((date) => [date, 1] as const)),
          historicalDailyRates: new Map(dates.map((date) => [date, 1] as const)),
          warnings: [] as string[],
        };
      }

      const [points, fallbackRates] = await Promise.all([
        fetchHistoricalFxPoints(code, startDate, endDate),
        fetchFxRatesServer([code]).catch(() => ({} as Record<CurrencyCode, number>)),
      ]);
      const fallbackFxRates: Record<CurrencyCode, number> = FALLBACK_FX_RATES;
      const fallbackRate = fallbackRates[code] ?? fallbackFxRates[code];
      const dailyRates = new Map<string, number>();
      const historicalDailyRates = new Map<string, number | null>();
      let pointIndex = 0;
      let lastKnownRate: number | undefined;
      let usedFallback = false;
      let missingRate = false;
      let firstUnavailableDate: string | null = null;
      let lastUnavailableDate: string | null = null;

      for (const date of dates) {
        while (pointIndex < points.length && points[pointIndex]!.date <= date) {
          lastKnownRate = points[pointIndex]!.rate;
          pointIndex += 1;
        }

        if (typeof lastKnownRate === "number" && lastKnownRate > 0) {
          dailyRates.set(date, lastKnownRate);
          historicalDailyRates.set(date, lastKnownRate);
          continue;
        }

        // Keep historical conversion separate from the valuation fallback.
        // The latter is useful for a provisional PLN history, but must never
        // be presented as an actual historic exchange rate.
        historicalDailyRates.set(date, null);
        firstUnavailableDate ??= date;
        lastUnavailableDate = date;

        if (typeof fallbackRate === "number" && Number.isFinite(fallbackRate) && fallbackRate > 0) {
          dailyRates.set(date, fallbackRate);
          usedFallback = true;
        } else {
          dailyRates.set(date, 0);
          missingRate = true;
        }
      }

      return {
        code,
        dailyRates,
        historicalDailyRates,
        warnings:
          missingRate
            ? [`Brakuje historycznego kursu FX ${code} dla zakresu ${firstUnavailableDate}–${lastUnavailableDate}; części historii nie można wiarygodnie przeliczyć.`]
            : usedFallback || points.length === 0
              ? [
                  `Brak wcześniejszej historii FX ${code} przed ${firstUnavailableDate}; wstępna wycena PLN użyła kursu bieżącego, dlatego TWR w tym okresie jest niepełny.`,
                ]
              : [],
      };
    })
  );

  const fxSeriesByCode = new Map(
    fxEntries.map((entry) => [entry.code, entry.dailyRates] as const)
  );
  const historicalFxSeriesByCode = new Map(
    fxEntries.map((entry) => [entry.code, entry.historicalDailyRates] as const)
  );
  const warnings = fxEntries.flatMap((entry) => entry.warnings);
  const warningsByCode = new Map(
    fxEntries.map((entry) => [entry.code, entry.warnings] as const)
  );

  return {
    fxSeriesByCode,
    historicalFxSeriesByCode,
    warnings,
    warningsByCode,
  };
};

const getSegmentHistoryKey = ({
  kind,
  symbol,
  providerId,
  purchaseDate,
}: {
  kind: AssetKind;
  symbol: string;
  providerId?: string;
  purchaseDate: string;
}) => {
  if (kind === "bond") {
    return `${kind}:${normalizeSymbol(symbol)}:${purchaseDate}`;
  }

  if (kind === "crypto" || kind === "etf" || (kind === "stock" && providerId)) {
    return `${kind}:${normalizeSymbol(providerId ?? symbol)}`;
  }

  return `${kind}:${normalizeSymbol(symbol)}`;
};

const buildOpenAssetSegment = (asset: PortfolioAsset, today: string): PortfolioHistorySegment => ({
  id: asset.id,
  groupKey: getPortfolioAssetGroupKey(asset),
  historyKey: getSegmentHistoryKey({
    kind: asset.kind,
    symbol: asset.symbol,
    providerId: asset.providerId,
    purchaseDate: asset.purchaseDate,
  }),
  kind: asset.kind,
  symbol: asset.symbol,
  quantity: round(asset.quantity, 6),
  purchaseDate: asset.purchaseDate,
  startDate: asset.purchaseDate,
  endDate: today,
  marketCurrency: toCurrencyCode(asset.marketCurrency),
  purchaseCurrency: toCurrencyCode(asset.purchaseCurrency),
  purchasePriceCurrency:
    typeof asset.purchasePriceCurrency === "string" && asset.purchasePriceCurrency
      ? toCurrencyCode(asset.purchasePriceCurrency)
      : undefined,
  purchaseFxRateToPln:
    typeof asset.purchaseFxRateToPln === "number" &&
    Number.isFinite(asset.purchaseFxRateToPln) &&
    asset.purchaseFxRateToPln > 0
      ? round(asset.purchaseFxRateToPln, 8)
      : undefined,
  purchasePrice: round(asset.purchasePrice, 8),
  provider: asset.provider,
  providerId: asset.providerId,
  priceScale: asset.priceScale,
});

const buildSoldAllocationSegment = (
  sale: PortfolioSale,
  allocation: PortfolioSale["allocations"][number]
): PortfolioHistorySegment | null => {
  const startDate = toDateInputValue(allocation.purchaseDate);
  const endDate = shiftDateInputValue(toDateInputValue(sale.saleDate), -1);

  if (endDate < startDate) {
    return null;
  }

  return {
    id: `${sale.id}:${allocation.lotId}`,
    groupKey: getPortfolioAssetGroupKey({
      kind: allocation.kind ?? sale.kind,
      symbol: allocation.symbol ?? sale.symbol,
    }),
    historyKey: getSegmentHistoryKey({
      kind: allocation.kind ?? sale.kind,
      symbol: allocation.symbol ?? sale.symbol,
      providerId: allocation.providerId ?? sale.providerId,
      purchaseDate: allocation.purchaseDate,
    }),
    kind: allocation.kind ?? sale.kind,
    symbol: allocation.symbol ?? sale.symbol,
    quantity: round(allocation.quantity, 6),
    purchaseDate: allocation.purchaseDate,
    startDate,
    endDate,
    marketCurrency: toCurrencyCode(allocation.marketCurrency ?? sale.marketCurrency),
    purchaseCurrency: toCurrencyCode(allocation.purchaseCurrency),
    purchasePriceCurrency:
      typeof allocation.purchasePriceCurrency === "string" && allocation.purchasePriceCurrency
        ? toCurrencyCode(allocation.purchasePriceCurrency)
        : undefined,
    purchaseFxRateToPln:
      typeof allocation.purchaseFxRateToPln === "number" &&
      Number.isFinite(allocation.purchaseFxRateToPln) &&
      allocation.purchaseFxRateToPln > 0
        ? round(allocation.purchaseFxRateToPln, 8)
        : undefined,
    purchasePrice: round(allocation.purchasePrice, 8),
    provider: allocation.provider ?? sale.provider,
    providerId: allocation.providerId ?? sale.providerId,
    priceScale: allocation.priceScale ?? sale.priceScale,
  } satisfies PortfolioHistorySegment;
};

const getNeededFxCodes = (
  assets: PortfolioAsset[],
  sales: PortfolioSale[],
  benchmarks: PortfolioBenchmarkDefinition[] = [],
  operations: PortfolioOperation[] = []
) => {
  const codes = new Set<CurrencyCode>(["PLN"]);

  for (const asset of assets) {
    codes.add(toCurrencyCode(asset.marketCurrency));
    codes.add(toCurrencyCode(asset.purchaseCurrency));
    codes.add(toCurrencyCode(asset.purchasePriceCurrency, asset.purchaseCurrency));
  }

  for (const sale of sales) {
    for (const allocation of sale.allocations) {
      codes.add(toCurrencyCode(allocation.purchaseCurrency));
      codes.add(toCurrencyCode(allocation.purchasePriceCurrency, allocation.purchaseCurrency));
      codes.add(toCurrencyCode(allocation.marketCurrency ?? sale.marketCurrency));
    }
  }

  for (const benchmark of benchmarks) {
    codes.add(toCurrencyCode(benchmark.marketCurrency));
  }

  for (const operation of operations) {
    for (const delta of getOperationCashDeltas(operation)) {
      codes.add(toCurrencyCode(delta.currency));
    }
  }

  return Array.from(codes);
};

const getPortfolioHistoryStartDate = ({
  assets,
  sales,
  realizedAdjustments,
  operations = [],
}: {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
  operations?: PortfolioOperation[];
}) => {
  const candidateDates = [
    ...assets.map((asset) => asset.purchaseDate),
    ...sales.flatMap((sale) => [sale.saleDate, ...sale.allocations.map((allocation) => allocation.purchaseDate)]),
    ...realizedAdjustments.map((adjustment) => adjustment.date),
    ...operations
      .filter((operation) => getOperationCashDeltas(operation).length > 0)
      .map((operation) => operation.date),
  ]
    .map((date) => toDateInputValue(date, ""))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return candidateDates[0] ?? null;
};

const addAmountToDateMap = (map: Map<string, number>, date: string, amount: number) => {
  if (!Number.isFinite(amount) || amount === 0) {
    return;
  }

  map.set(date, round((map.get(date) ?? 0) + amount));
};

const getFxRateForDate = (
  fxSeriesByCode: Map<CurrencyCode, Map<string, number>>,
  code: CurrencyCode,
  date: string
) => {
  const normalizedCode = toCurrencyCode(code, "PLN");

  if (normalizedCode === "PLN") {
    return 1;
  }

  const fallbackFxRates: Record<CurrencyCode, number> = FALLBACK_FX_RATES;
  return fxSeriesByCode.get(normalizedCode)?.get(date) ?? fallbackFxRates[normalizedCode] ?? 0;
};

const getHistoricalFxRateForDate = (
  fxSeriesByCode: Map<CurrencyCode, Map<string, number | null>>,
  code: CurrencyCode,
  date: string
) => fxSeriesByCode.get(toCurrencyCode(code, "PLN"))?.get(date) ?? null;

export const getPortfolioTwrFxWarnings = (
  requiredFxCodes: readonly CurrencyCode[],
  warningsByCode: ReadonlyMap<CurrencyCode, readonly string[]>
) => requiredFxCodes.flatMap((code) => warningsByCode.get(code) ?? []);

const convertToPlnOnDate = (
  amount: number,
  currency: CurrencyCode,
  date: string,
  fxSeriesByCode: Map<CurrencyCode, Map<string, number>>
) => round(amount * getFxRateForDate(fxSeriesByCode, currency, date));

type PurchaseValueSource = {
  purchaseCurrency: CurrencyCode;
  purchasePriceCurrency?: CurrencyCode;
  purchaseFxRateToPln?: number;
  purchaseDate: string;
};

const getPurchasePriceCurrency = (source: PurchaseValueSource) =>
  toCurrencyCode(source.purchasePriceCurrency, source.purchaseCurrency);

const convertPurchaseValueToPlnOnDate = (
  amount: number,
  source: PurchaseValueSource,
  fxSeriesByCode: Map<CurrencyCode, Map<string, number>>
) => {
  if (
    typeof source.purchaseFxRateToPln === "number" &&
    Number.isFinite(source.purchaseFxRateToPln) &&
    source.purchaseFxRateToPln > 0
  ) {
    return round(amount * source.purchaseFxRateToPln);
  }

  return convertToPlnOnDate(
    amount,
    getPurchasePriceCurrency(source),
    source.purchaseDate,
    fxSeriesByCode
  );
};

export const buildBuyCashflowEvents = (
  assets: PortfolioAsset[],
  sales: PortfolioSale[],
  fxSeriesByCode: Map<CurrencyCode, Map<string, number>>,
  operations: PortfolioOperation[] = []
) => {
  const events = new Map<string, number>();
  const cashImpactLotIds = new Set(
    operations
      .filter(
        (operation) =>
          operation.operationType === "BUY" && operation.metadata.cashImpact === true
      )
      .map((operation) => operation.metadata.lotId)
      .filter((lotId): lotId is string => typeof lotId === "string")
  );
  const cashImpactSaleIds = new Set(
    operations
      .filter(
        (operation) =>
          operation.operationType === "SELL" && operation.metadata.cashImpact === true
      )
      .map((operation) => operation.metadata.saleId)
      .filter((saleId): saleId is string => typeof saleId === "string")
  );

  for (const asset of assets) {
    if (cashImpactLotIds.has(asset.id)) {
      continue;
    }
    const investedPln = round(
      convertPurchaseValueToPlnOnDate(
        asset.purchasePrice * asset.quantity,
        asset,
        fxSeriesByCode
      ) + asset.feePln
    );

    addAmountToDateMap(events, asset.purchaseDate, investedPln);
  }

  for (const sale of sales) {
    for (const allocation of sale.allocations) {
      if (cashImpactLotIds.has(allocation.lotId)) {
        continue;
      }
      const investedPln = round(
        convertPurchaseValueToPlnOnDate(
          allocation.purchasePrice * allocation.quantity,
          allocation,
          fxSeriesByCode
        ) + allocation.allocatedBuyFeePln
      );

      addAmountToDateMap(events, allocation.purchaseDate, investedPln);
    }
  }

  for (const sale of sales) {
    if (cashImpactSaleIds.has(sale.id)) {
      continue;
    }
    addAmountToDateMap(events, sale.saleDate, -round(sale.realizedInvestedPln));
  }

  return {
    events,
    hasUnmirroredSale: sales.some((sale) => !cashImpactSaleIds.has(sale.id)),
  };
};

const buildCashLedgerEvents = (
  operations: PortfolioOperation[],
  accounts: PortfolioAccount[],
  fxSeriesByCode: Map<CurrencyCode, Map<string, number>>
) => {
  const deltasByDate = new Map<string, ReturnType<typeof getOperationCashDeltas>>();
  const externalFlowsByDate = new Map<string, number>();
  const externalCashFlowEntries: Array<{ date: string; amountPln: number; kind: "DEPOSIT" | "WITHDRAW" | "BALANCE_ADJUSTMENT" | "ARCHIVE_ADJUSTMENT" }> = [];

  operations.forEach((operation) => {
    const date = toDateInputValue(operation.date, "");
    if (!date) return;

    const deltas = getOperationCashDeltas(operation);
    if (!deltas.length) return;

    deltasByDate.set(date, [...(deltasByDate.get(date) ?? []), ...deltas]);

    const isExternalFlow =
      operation.operationType === "DEPOSIT" ||
      operation.operationType === "WITHDRAW" ||
      (operation.operationType === "CUSTOM" &&
        operation.metadata.cashEntryKind === "BALANCE_ADJUSTMENT");

    if (isExternalFlow) {
      const flowPln = deltas.reduce(
        (total, delta) =>
          total + convertToPlnOnDate(delta.amount, delta.currency, date, fxSeriesByCode),
        0
      );
      addAmountToDateMap(externalFlowsByDate, date, flowPln);
      if (flowPln !== 0) {
        externalCashFlowEntries.push({
          date,
          amountPln: round(flowPln),
          kind: operation.operationType === "DEPOSIT"
            ? "DEPOSIT"
            : operation.operationType === "WITHDRAW"
              ? "WITHDRAW"
              : "BALANCE_ADJUSTMENT",
        });
      }
    }
  });

  // Archiving is a current-state choice, not a deletion of the ledger. Keep
  // every historical side of transfers/conversions, then neutralize only a
  // residual balance removed from the current view on the archive date. A
  // fully transferred account therefore contributes exactly zero external
  // flow and can never manufacture P/L.
  const archivedByDate = new Map<string, PortfolioAccount[]>();
  for (const account of accounts) {
    const archivedDate = getPortfolioAccountArchivedDate(account);
    if (!archivedDate) continue;
    archivedByDate.set(archivedDate, [...(archivedByDate.get(archivedDate) ?? []), account]);
  }

  const balancesByKey = new Map<string, { accountId: string; currency: CurrencyCode; amount: number }>();
  const ledgerDates = Array.from(new Set([...deltasByDate.keys(), ...archivedByDate.keys()])).sort();
  for (const date of ledgerDates) {
    for (const delta of deltasByDate.get(date) ?? []) {
      const key = `${delta.accountId}:${delta.currency}`;
      const current = balancesByKey.get(key);
      balancesByKey.set(key, {
        accountId: delta.accountId,
        currency: delta.currency,
        amount: round((current?.amount ?? 0) + delta.amount, 8),
      });
    }

    for (const account of archivedByDate.get(date) ?? []) {
      const removedValuePln = Array.from(balancesByKey.values())
        .filter((balance) => balance.accountId === account.id && balance.amount !== 0)
        .reduce(
          (total, balance) =>
            total + convertToPlnOnDate(balance.amount, balance.currency, date, fxSeriesByCode),
          0
        );
      if (removedValuePln !== 0) {
        addAmountToDateMap(externalFlowsByDate, date, -removedValuePln);
        externalCashFlowEntries.push({
          date,
          amountPln: round(-removedValuePln),
          kind: "ARCHIVE_ADJUSTMENT",
        });
      }
    }
  }

  return { deltasByDate, externalFlowsByDate, externalCashFlowEntries };
};

const buildAdjustmentEvents = (realizedAdjustments: PortfolioRealizedAdjustment[]) => {
  const events = new Map<string, number>();

  for (const adjustment of realizedAdjustments) {
    addAmountToDateMap(events, adjustment.date, adjustment.amountPlnSnapshot);
  }

  return events;
};

const buildInstrumentDefinitions = (segments: PortfolioHistorySegment[]) => {
  const definitions = new Map<string, InstrumentHistoryDefinition>();

  for (const segment of segments) {
    if (definitions.has(segment.historyKey)) {
      continue;
    }

    definitions.set(segment.historyKey, {
      historyKey: segment.historyKey,
      kind: segment.kind,
      symbol: segment.symbol,
      marketCurrency: segment.marketCurrency,
      provider: segment.provider,
      providerId: segment.providerId,
      priceScale: segment.priceScale,
      purchaseDate: segment.purchaseDate,
    });
  }

  return Array.from(definitions.values());
};

const getBenchmarkHistoryKey = (benchmark: PortfolioBenchmarkDefinition) =>
  benchmark.kind === "crypto" ||
  benchmark.kind === "etf" ||
  (benchmark.kind === "stock" && benchmark.providerId)
    ? `${benchmark.kind}:${normalizeSymbol(benchmark.providerId ?? benchmark.symbol)}`
    : `${benchmark.kind}:${normalizeSymbol(benchmark.symbol)}`;

const buildBenchmarkInstrumentDefinitions = ({
  benchmarks,
  startDate,
}: {
  benchmarks: PortfolioBenchmarkDefinition[];
  startDate: string;
}) => {
  const definitions = new Map<string, InstrumentHistoryDefinition>();

  for (const benchmark of benchmarks) {
    const historyKey = getBenchmarkHistoryKey(benchmark);

    if (definitions.has(historyKey)) {
      continue;
    }

    definitions.set(historyKey, {
      historyKey,
      kind: benchmark.kind,
      symbol: benchmark.symbol,
      marketCurrency: toCurrencyCode(benchmark.marketCurrency),
      provider: benchmark.provider,
      providerId: benchmark.providerId,
      priceScale: benchmark.priceScale,
      purchaseDate: startDate,
    });
  }

  return Array.from(definitions.values());
};

const buildBenchmarkReturnSeries = ({
  benchmarks,
  dates,
  fxSeriesByCode,
  instrumentHistoryByKey,
  warnings,
}: {
  benchmarks: PortfolioBenchmarkDefinition[];
  dates: string[];
  fxSeriesByCode: Map<CurrencyCode, Map<string, number>>;
  instrumentHistoryByKey: Map<string, InstrumentHistoryResult>;
  warnings: Set<string>;
}): PortfolioBenchmarkHistorySeries[] =>
  benchmarks
    .map((benchmark) => {
      const history = instrumentHistoryByKey.get(getBenchmarkHistoryKey(benchmark));
      const historyPoints = history?.points ?? [];
      const marketCurrency = toCurrencyCode(benchmark.marketCurrency);

      if (historyPoints.length === 0 || dates.length === 0) {
        if (!history?.warning) {
          warnings.add(
            `Nie udalo sie pobrac historii dla benchmarku ${benchmark.name}; pominieto go na wykresie.`
          );
        }
        return null;
      }

      let pointIndex = 0;
      let lastKnownClose: number | undefined;
      let previousPricePln: number | null = null;
      let cumulativeReturnFactor = 1;

      const points = dates.reduce<PortfolioBenchmarkHistorySeries["points"]>((nextPoints, date) => {
        while (pointIndex < historyPoints.length && historyPoints[pointIndex]!.date <= date) {
          lastKnownClose = historyPoints[pointIndex]!.close;
          pointIndex += 1;
        }

        if (
          typeof lastKnownClose === "number" &&
          Number.isFinite(lastKnownClose) &&
          lastKnownClose > 0
        ) {
          const pricePln =
            lastKnownClose * getFxRateForDate(fxSeriesByCode, marketCurrency, date);

          if (pricePln > 0) {
            if (previousPricePln !== null && previousPricePln > 0) {
              cumulativeReturnFactor *= pricePln / previousPricePln;
            }

            previousPricePln = pricePln;

            nextPoints.push({
              date,
              price: round(lastKnownClose, 8),
              pricePln: round(pricePln, 6),
              returnPercent: round((cumulativeReturnFactor - 1) * 100, 2),
            });
          }
        }

        return nextPoints;
      }, []);

      if (points.length === 0) {
        warnings.add(
          `Nie udalo sie dopasowac historii kursu dla benchmarku ${benchmark.name}; pominieto go na wykresie.`
        );
        return null;
      }

      return {
        id: benchmark.id,
        label: benchmark.name,
        points,
      } satisfies PortfolioBenchmarkHistorySeries;
    })
    .filter((series): series is PortfolioBenchmarkHistorySeries => Boolean(series));

const buildAssetSeriesDefinitions = ({
  assets,
  sales,
}: {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
}) => {
  const definitions = new Map<string, AssetSeriesDefinition>();

  for (const asset of assets) {
    const groupKey = getPortfolioAssetGroupKey(asset);

    if (!definitions.has(groupKey)) {
      definitions.set(groupKey, {
        groupKey,
        label: asset.name,
        symbol: asset.symbol,
        kind: asset.kind,
      });
    }
  }

  for (const sale of sales) {
    for (const allocation of sale.allocations) {
      const kind = allocation.kind ?? sale.kind;
      const symbol = allocation.symbol ?? sale.symbol;
      const groupKey = getPortfolioAssetGroupKey({ kind, symbol });

      if (!definitions.has(groupKey)) {
        definitions.set(groupKey, {
          groupKey,
          label: allocation.name ?? sale.name,
          symbol,
          kind,
        });
      }
    }
  }

  return Array.from(definitions.values()).sort((left, right) =>
    left.label.localeCompare(right.label, "pl")
  );
};

export const buildPortfolioHistory = async ({
  assets,
  sales,
  realizedAdjustments,
  operations = [],
  accounts = [],
  benchmarks = [],
  presentationCurrency = "PLN",
}: {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
  operations?: PortfolioOperation[];
  accounts?: PortfolioAccount[];
  benchmarks?: PortfolioBenchmarkDefinition[];
  presentationCurrency?: CurrencyCode;
}): Promise<PortfolioHistoryResponse> => {
  const normalizedPresentationCurrency = toCurrencyCode(presentationCurrency, "PLN");
  const buildStartedAt = performance.now();
  const today = toDateInputValue(new Date().toISOString());
  const startDate = getPortfolioHistoryStartDate({
    assets,
    sales,
    realizedAdjustments,
    operations,
  });

  if (!startDate) {
    return {
      points: [],
      warnings: [],
      twrStatus: "unavailable",
      twrStatusReason: "Brak danych historycznych do wyliczenia TWR.",
      presentationCurrency: normalizedPresentationCurrency,
      presentationTwrStatus: "unavailable",
      presentationTwrStatusReason: "Brak danych historycznych do wyliczenia TWR.",
      assetSeries: [],
      benchmarkSeries: [],
    };
  }

  const dates = getDateRange(startDate, today);
  const openSegments = assets.map((asset) => buildOpenAssetSegment(asset, today));
  const soldSegments = sales
    .flatMap((sale) => sale.allocations.map((allocation) => buildSoldAllocationSegment(sale, allocation)))
    .filter((segment): segment is PortfolioHistorySegment => Boolean(segment));
  const segments = [...openSegments, ...soldSegments];
  const warnings = new Set<string>();
  const twrIssues = new Set<string>();

  const fxStartedAt = performance.now();
  const requiredFxCodes = getNeededFxCodes(assets, sales, benchmarks, operations);
  // Historical FX and instrument quotes are independent remote reads. Start the
  // FX side before assembling quote definitions, then wait for both below.
  // This deliberately leaves the cache keys, fallbacks and post-fetch
  // calculations unchanged.
  const fxSeriesPromise = buildFxSeries(
    [...new Set([...requiredFxCodes, normalizedPresentationCurrency])],
    startDate,
    today
  ).then((fxSeries) => {
    logHistoryDiagnostic("fx-ready", {
      currencies: requiredFxCodes.length,
      durationMs: Math.round(performance.now() - fxStartedAt),
    });
    return fxSeries;
  });
  const instrumentDefinitions = Array.from(
    new Map(
      [
        ...buildInstrumentDefinitions(segments),
        ...buildBenchmarkInstrumentDefinitions({
          benchmarks,
          startDate,
        }),
      ].map((definition) => [definition.historyKey, definition] as const)
    ).values()
  );
  const quotesStartedAt = performance.now();
  const instrumentHistoryEntriesPromise = Promise.all(
    instrumentDefinitions.map(async (definition) => {
      const history = await fetchInstrumentHistory(definition, startDate, today);
      return [definition.historyKey, history] as const;
    })
  ).then((entries) => {
    logHistoryDiagnostic("quotes-ready", {
      instruments: instrumentDefinitions.length,
      durationMs: Math.round(performance.now() - quotesStartedAt),
    });
    return entries;
  });
  const [
    { fxSeriesByCode, historicalFxSeriesByCode, warnings: fxWarnings, warningsByCode },
    instrumentHistoryEntries,
  ] = await Promise.all([fxSeriesPromise, instrumentHistoryEntriesPromise]);

  for (const warning of fxWarnings) {
    warnings.add(warning);
  }
  // A missing rate for a source-currency cash flow/asset makes the PLN history
  // unreliable. A missing rate only for the selected display currency must
  // not invalidate the independently calculated PLN TWR.
  getPortfolioTwrFxWarnings(requiredFxCodes, warningsByCode).forEach((warning) => twrIssues.add(warning));

  const legacyCashflows = buildBuyCashflowEvents(
    assets,
    sales,
    fxSeriesByCode,
    operations
  );
  const netInvestedEvents = legacyCashflows.events;
  if (legacyCashflows.hasUnmirroredSale) {
    // Legacy asset/sale state does not contain the sale proceeds as a historic
    // cash balance. Treating the missing proceeds as zero can manufacture a
    // large daily loss and a false aggregate TWR. Keep the historical value/P&L
    // unchanged, but withhold TWR until the cash side of every sale is known.
    twrIssues.add("Starsza sprzedaż nie ma kompletnego lustrzanego rejestru gotówki.");
  }
  const cashLedgerEvents = buildCashLedgerEvents(
    operations,
    accounts,
    fxSeriesByCode
  );
  cashLedgerEvents.externalFlowsByDate.forEach((amount, date) =>
    addAmountToDateMap(netInvestedEvents, date, amount)
  );
  const adjustmentEvents = buildAdjustmentEvents(realizedAdjustments);
  const assetSeriesDefinitions = buildAssetSeriesDefinitions({ assets, sales });
  const assetValueByGroupKey = new Map(
    assetSeriesDefinitions.map((definition) => [
      definition.groupKey,
      new Map<string, number>(dates.map((date) => [date, 0] as [string, number])),
    ] as const)
  );
  const instrumentHistoryByKey = new Map<string, InstrumentHistoryResult>(
    instrumentHistoryEntries
  );

  for (const [, history] of instrumentHistoryEntries) {
    if (history.warning) {
      warnings.add(history.warning);
    }
  }

  const benchmarkSeries = buildBenchmarkReturnSeries({
    benchmarks,
    dates,
    fxSeriesByCode,
    instrumentHistoryByKey,
    warnings,
  });

  const portfolioValueByDate = new Map<string, number>(dates.map((date) => [date, 0]));

  for (const segment of segments) {
    const history = instrumentHistoryByKey.get(segment.historyKey);
    const historyPoints = history?.points ?? [];
    const firstHistoryDate = historyPoints[0]?.date;
    const initialGapDays =
      firstHistoryDate && firstHistoryDate > segment.startDate
        ? getDaysBetween(segment.startDate, firstHistoryDate)
        : 0;
    if (history?.warning) {
      twrIssues.add(`Brak pełnej historii notowań ${segment.symbol} (${segment.startDate}–${segment.endDate}).`);
    }
    if (hasUnreliableHistoryGap(historyPoints, segment.startDate, segment.endDate)) {
      twrIssues.add(`Historia notowań ${segment.symbol} ma luki przekraczające 5 dni (${segment.startDate}–${segment.endDate}).`);
    }
    let pointIndex = 0;
    let lastKnownClose: number | undefined;
    let usedFallback = false;
    let usedFallbackAfterEntry = false;

    for (const date of dates) {
      if (date < segment.startDate || date > segment.endDate) {
        continue;
      }

      while (pointIndex < historyPoints.length && historyPoints[pointIndex]!.date <= date) {
        lastKnownClose = historyPoints[pointIndex]!.close;
        pointIndex += 1;
      }

      const hasProviderPrice = typeof lastKnownClose === "number" && lastKnownClose > 0;
      const unitPrice = hasProviderPrice ? lastKnownClose! : segment.purchasePrice;
      const currency = hasProviderPrice
        ? segment.marketCurrency
        : getPurchasePriceCurrency(segment);
      const convertedValue = convertToPlnOnDate(
        unitPrice * segment.quantity,
        currency,
        date,
        fxSeriesByCode
      );
      const nextValue = round((portfolioValueByDate.get(date) ?? 0) + convertedValue);

      portfolioValueByDate.set(date, nextValue);
      assetValueByGroupKey
        .get(segment.groupKey)
        ?.set(
          date,
          round((assetValueByGroupKey.get(segment.groupKey)?.get(date) ?? 0) + convertedValue)
        );

      if (!hasProviderPrice) {
        usedFallback = true;
        if (date > segment.startDate) {
          usedFallbackAfterEntry = true;
        }
      }
    }

    if (usedFallbackAfterEntry) {
      twrIssues.add(`Pozycja ${segment.symbol} używa ceny zakupu zamiast kursu rynkowego po ${segment.startDate}.`);
    }

    if (usedFallback && historyPoints.length > 0 && initialGapDays > 5) {
      warnings.add(
        `Historia ${segment.symbol} ma braki na poczatku zakresu; brakujace dni wyceniono po cenie zakupu.`
      );
    }
  }

  const points: PortfolioHistoryPoint[] = [];
  let cumulativeNetInvestedPln = 0;
  let cumulativeAdjustmentsPln = 0;
  let cumulativeTimeWeightedReturnFactor = 1;
  let previousPortfolioValuePln: number | null = null;
  let cumulativeNetInvestedPresentation = 0;
  let cumulativeAdjustmentsPresentation = 0;
  let cumulativePresentationReturnFactor = 1;
  let previousPortfolioValuePresentation: number | null = null;
  let presentationFlowsComplete = true;
  let presentationAdjustmentsComplete = true;
  let hasMissingPresentationFx = false;
  const cashBalancesByKey = new Map<string, { accountId: string; currency: CurrencyCode; amount: number }>();
  const accountArchivedDates = new Map(
    accounts.map((account) => [account.id, getPortfolioAccountArchivedDate(account)] as const)
  );

  for (const date of dates) {
    const externalFlowPln = netInvestedEvents.get(date) ?? 0;
    const realizedAdjustmentPln = adjustmentEvents.get(date) ?? 0;

    cumulativeNetInvestedPln = round(
      cumulativeNetInvestedPln + externalFlowPln
    );
    cumulativeAdjustmentsPln = round(
      cumulativeAdjustmentsPln + realizedAdjustmentPln
    );

    for (const delta of cashLedgerEvents.deltasByDate.get(date) ?? []) {
      const key = `${delta.accountId}:${delta.currency}`;
      const current = cashBalancesByKey.get(key);
      cashBalancesByKey.set(key, {
        accountId: delta.accountId,
        currency: delta.currency,
        amount: round((current?.amount ?? 0) + delta.amount, 8),
      });
    }
    const cashValuePln = Array.from(cashBalancesByKey.values()).reduce(
      (total, balance) => {
        const archivedDate = accountArchivedDates.get(balance.accountId);
        if (archivedDate && archivedDate <= date) return total;
        return total + convertToPlnOnDate(balance.amount, balance.currency, date, fxSeriesByCode);
      },
      0
    );
    const portfolioValuePln = round(
      (portfolioValueByDate.get(date) ?? 0) + cashValuePln
    );
    const netInvestedPln = round(cumulativeNetInvestedPln);
    const profitLossPln = round(
      portfolioValuePln - netInvestedPln + cumulativeAdjustmentsPln
    );

    const presentationRateToPln = getHistoricalFxRateForDate(
      historicalFxSeriesByCode,
      normalizedPresentationCurrency,
      date
    );
    const canPresentValue = typeof presentationRateToPln === "number" && presentationRateToPln > 0;
    const portfolioValuePresentation = canPresentValue
      ? round(portfolioValuePln / presentationRateToPln)
      : null;
    const externalFlowPresentation = externalFlowPln === 0
      ? 0
      : canPresentValue ? externalFlowPln / presentationRateToPln : null;
    const realizedAdjustmentPresentation = realizedAdjustmentPln === 0
      ? 0
      : canPresentValue ? realizedAdjustmentPln / presentationRateToPln : null;

    if (!canPresentValue && (portfolioValuePln !== 0 || externalFlowPln !== 0 || realizedAdjustmentPln !== 0)) {
      hasMissingPresentationFx = true;
    }
    if (externalFlowPresentation === null) presentationFlowsComplete = false;
    else cumulativeNetInvestedPresentation = round(cumulativeNetInvestedPresentation + externalFlowPresentation);
    if (realizedAdjustmentPresentation === null) presentationAdjustmentsComplete = false;
    else cumulativeAdjustmentsPresentation = round(cumulativeAdjustmentsPresentation + realizedAdjustmentPresentation);

    const presentationNetInvested = presentationFlowsComplete ? cumulativeNetInvestedPresentation : null;
    const presentationProfitLoss =
      portfolioValuePresentation !== null && presentationNetInvested !== null && presentationAdjustmentsComplete
        ? round(portfolioValuePresentation - presentationNetInvested + cumulativeAdjustmentsPresentation)
        : null;

    if (
      previousPortfolioValuePresentation !== null &&
      previousPortfolioValuePresentation > 0 &&
      portfolioValuePresentation !== null &&
      externalFlowPresentation !== null &&
      realizedAdjustmentPresentation !== null
    ) {
      const dailyPresentationReturn = (
        portfolioValuePresentation + realizedAdjustmentPresentation -
        previousPortfolioValuePresentation - externalFlowPresentation
      ) / previousPortfolioValuePresentation;
      if (Number.isFinite(dailyPresentationReturn)) {
        cumulativePresentationReturnFactor *= 1 + dailyPresentationReturn;
      }
    }

    if (previousPortfolioValuePln !== null && previousPortfolioValuePln > 0) {
      const dailyReturn =
        (portfolioValuePln +
          realizedAdjustmentPln -
          previousPortfolioValuePln -
          externalFlowPln) /
        previousPortfolioValuePln;

      if (Number.isFinite(dailyReturn)) {
        cumulativeTimeWeightedReturnFactor *= 1 + dailyReturn;
      }
    }

    points.push({
      date,
      portfolioValuePln,
      netInvestedPln,
      profitLossPln,
      timeWeightedReturnPercent: round(
        (cumulativeTimeWeightedReturnFactor - 1) * 100,
        2
      ),
      presentationPortfolioValue: portfolioValuePresentation,
      presentationNetInvested,
      presentationProfitLoss,
      presentationTimeWeightedReturnPercent: round(
        (cumulativePresentationReturnFactor - 1) * 100,
        2
      ),
    });

    previousPortfolioValuePln = portfolioValuePln;
    previousPortfolioValuePresentation = portfolioValuePresentation;
  }

  const hasValuableHistory = points.some((point) => point.portfolioValuePln > 0);
  const twrStatus: PortfolioHistoryResponse["twrStatus"] = !hasValuableHistory
    ? "unavailable"
    : twrIssues.size > 0
      ? "incomplete"
      : "complete";
  if (twrStatus !== "complete") {
    for (const point of points) {
      point.timeWeightedReturnPercent = null;
    }
  }

  const presentationTwrStatus: NonNullable<PortfolioHistoryResponse["presentationTwrStatus"]> =
    !hasValuableHistory
      ? "unavailable"
      : twrStatus !== "complete" || hasMissingPresentationFx
        ? "incomplete"
        : "complete";
  if (presentationTwrStatus !== "complete") {
    for (const point of points) point.presentationTimeWeightedReturnPercent = null;
  }

  // Keep the external ledger movements alongside the derived history. This is
  // intentionally a narrow feed: buys, sells, dividends and internal
  // transfers stay inside the portfolio and must never become XIRR cash flows.
  const externalCashFlows = cashLedgerEvents.externalCashFlowEntries
    .sort((left, right) => left.date.localeCompare(right.date))
    .map(({ date, amountPln, kind }) => {
      const presentationRateToPln = getHistoricalFxRateForDate(
        historicalFxSeriesByCode,
        normalizedPresentationCurrency,
        date
      );
      return {
        date,
        amountPln: round(amountPln),
        kind,
        presentationAmount:
          typeof presentationRateToPln === "number" && presentationRateToPln > 0
            ? round(amountPln / presentationRateToPln)
            : null,
      };
    });

  const assetSeries: PortfolioAssetHistorySeries[] = assetSeriesDefinitions
    .map((definition) => ({
      groupKey: definition.groupKey,
      label: definition.label,
      symbol: definition.symbol,
      kind: definition.kind,
      points: dates.map((date) => ({
        date,
        valuePln: round(assetValueByGroupKey.get(definition.groupKey)?.get(date) ?? 0),
        valuePresentation: (() => {
          const rate = getHistoricalFxRateForDate(historicalFxSeriesByCode, normalizedPresentationCurrency, date);
          return typeof rate === "number" && rate > 0
            ? round((assetValueByGroupKey.get(definition.groupKey)?.get(date) ?? 0) / rate)
            : null;
        })(),
      })),
    }))
    .filter((series) => series.points.some((point) => point.valuePln !== 0));

  logHistoryDiagnostic("portfolio-ready", {
    days: points.length,
    instruments: instrumentDefinitions.length,
    segments: segments.length,
    operations: operations.length,
    accounts: accounts.length,
    warnings: warnings.size,
    durationMs: Math.round(performance.now() - buildStartedAt),
    twrStatus: twrStatus ?? "unavailable",
  });

  return {
    points,
    assetSeries,
    benchmarkSeries: benchmarkSeries.map((series) => {
      let presentationStartPrice: number | null = null;
      return {
        ...series,
        points: series.points.map((point) => {
          const rate = getHistoricalFxRateForDate(historicalFxSeriesByCode, normalizedPresentationCurrency, point.date);
          const pricePresentation = typeof rate === "number" && rate > 0 ? round(point.pricePln / rate) : null;
          if (presentationStartPrice === null && pricePresentation !== null) presentationStartPrice = pricePresentation;
          return {
            ...point,
            pricePresentation,
            presentationReturnPercent: pricePresentation !== null && presentationStartPrice
              ? round(((pricePresentation / presentationStartPrice) - 1) * 100, 2)
              : null,
          };
        }),
      };
    }),
    warnings: Array.from(warnings).sort((left, right) => left.localeCompare(right, "pl")),
    twrStatus,
    presentationCurrency: normalizedPresentationCurrency,
    presentationTwrStatus,
    ...(twrStatus === "incomplete"
      ? { twrStatusReason: Array.from(twrIssues).slice(0, 5).join(" ") }
      : twrStatus === "unavailable"
        ? { twrStatusReason: "Brak wystarczających danych historycznych do wyliczenia TWR." }
        : {}),
    ...(presentationTwrStatus === "incomplete"
      ? { presentationTwrStatusReason: hasMissingPresentationFx
          ? `Brakuje historycznego kursu ${normalizedPresentationCurrency} w części zakresu; TWR w tej walucie nie jest dostępny. ${Array.from(twrIssues).slice(0, 5).join(" ")}`
          : Array.from(twrIssues).slice(0, 5).join(" ") }
      : presentationTwrStatus === "unavailable"
        ? { presentationTwrStatusReason: "Brak wystarczających danych historycznych do wyliczenia TWR." }
        : {}),
    externalCashFlows,
  };
};

/**
 * Combines independently calculated real portfolios into the virtual
 * all-portfolios view. Each input keeps its own instrument identity and is
 * valued in PLN first; only the final chart presentation converts currency.
 * This deliberately does not fake a combined benchmark or asset OHLC series.
 */
export const aggregatePortfolioHistoryPoints = (
  histories: Array<Pick<PortfolioHistoryResponse, "points">>
): PortfolioHistoryPoint[] => {
  const scopedPoints = histories.map(({ points }) =>
    [...points].sort((left, right) => left.date.localeCompare(right.date))
  );
  const dates = Array.from(new Set(scopedPoints.flatMap((points) => points.map(({ date }) => date))))
    .sort((left, right) => left.localeCompare(right));
  const pointIndices = scopedPoints.map(() => -1);
  let cumulativeTimeWeightedReturnFactor = 1;
  let cumulativePresentationReturnFactor = 1;

  return dates.map((date) => {
    let previousAggregateValuePln = 0;
    let aggregateProfitLossDeltaPln = 0;
    let previousAggregatePresentationValue = 0;
    let aggregatePresentationProfitLossDelta = 0;
    let presentationValuesComplete = true;
    let presentationHistoryCount = 0;
    const currentPoints: PortfolioHistoryPoint[] = [];
    scopedPoints.forEach((points, scopeIndex) => {
      const previousPointIndex = pointIndices[scopeIndex] ?? -1;
      let pointIndex = pointIndices[scopeIndex] ?? -1;
      while (pointIndex + 1 < points.length && points[pointIndex + 1]!.date <= date) {
        pointIndex += 1;
      }
      pointIndices[scopeIndex] = pointIndex;
      const currentPoint = pointIndex >= 0 ? points[pointIndex] : undefined;
      const previousPoint = previousPointIndex >= 0 ? points[previousPointIndex] : undefined;
      if (currentPoint) currentPoints.push(currentPoint);
      if (currentPoint && previousPoint && previousPoint.portfolioValuePln > 0) {
        // Combine constituent daily TWR numerators over the value that was
        // actually invested at the start of this interval. A portfolio whose
        // first history point falls on this date is an inception, not a gain
        // on the other selected portfolios.
        previousAggregateValuePln += previousPoint.portfolioValuePln;
        aggregateProfitLossDeltaPln += currentPoint.profitLossPln - previousPoint.profitLossPln;
      }
      if (currentPoint) {
        if (typeof currentPoint.presentationPortfolioValue === "number") {
          presentationHistoryCount += 1;
        } else {
          presentationValuesComplete = false;
        }
      }
      if (
        currentPoint && previousPoint &&
        typeof previousPoint.presentationPortfolioValue === "number" &&
        typeof previousPoint.presentationProfitLoss === "number" &&
        typeof currentPoint.presentationProfitLoss === "number" &&
        previousPoint.presentationPortfolioValue > 0
      ) {
        previousAggregatePresentationValue += previousPoint.presentationPortfolioValue;
        aggregatePresentationProfitLossDelta +=
          currentPoint.presentationProfitLoss - previousPoint.presentationProfitLoss;
      }
    });
    const portfolioValuePln = round(currentPoints.reduce((total, point) => total + point.portfolioValuePln, 0));
    const netInvestedPln = round(currentPoints.reduce((total, point) => total + point.netInvestedPln, 0));
    const profitLossPln = round(currentPoints.reduce((total, point) => total + point.profitLossPln, 0));

    if (previousAggregateValuePln > 0) {
      // Per-portfolio P/L deltas already remove deposits/withdrawals and add
      // realized adjustments. Weight their returns by prior portfolio values.
      const dailyReturn = aggregateProfitLossDeltaPln / previousAggregateValuePln;
      if (Number.isFinite(dailyReturn)) {
        cumulativeTimeWeightedReturnFactor *= 1 + dailyReturn;
      }
    }

    if (previousAggregatePresentationValue > 0) {
      const dailyPresentationReturn = aggregatePresentationProfitLossDelta / previousAggregatePresentationValue;
      if (Number.isFinite(dailyPresentationReturn)) {
        cumulativePresentationReturnFactor *= 1 + dailyPresentationReturn;
      }
    }

    const canPresentAggregate = currentPoints.length > 0 && presentationValuesComplete &&
      currentPoints.every((point) => typeof point.presentationPortfolioValue === "number");
    const presentationPortfolioValue = canPresentAggregate
      ? round(currentPoints.reduce((total, point) => total + point.presentationPortfolioValue!, 0))
      : null;
    const presentationNetInvested = canPresentAggregate && currentPoints.every((point) => typeof point.presentationNetInvested === "number")
      ? round(currentPoints.reduce((total, point) => total + point.presentationNetInvested!, 0))
      : null;
    const presentationProfitLoss = canPresentAggregate && currentPoints.every((point) => typeof point.presentationProfitLoss === "number")
      ? round(currentPoints.reduce((total, point) => total + point.presentationProfitLoss!, 0))
      : null;

    return {
      date,
      portfolioValuePln,
      netInvestedPln,
      profitLossPln,
      timeWeightedReturnPercent: round((cumulativeTimeWeightedReturnFactor - 1) * 100, 2),
      ...(presentationHistoryCount > 0
        ? {
            presentationPortfolioValue,
            presentationNetInvested,
            presentationProfitLoss,
            presentationTimeWeightedReturnPercent: round((cumulativePresentationReturnFactor - 1) * 100, 2),
          }
        : {}),
    };
  });
};

export const getAggregateTwrStatus = (
  histories: ReadonlyArray<Pick<PortfolioHistoryResponse, "twrStatus">>
): NonNullable<PortfolioHistoryResponse["twrStatus"]> => {
  if (histories.length === 0) return "unavailable";
  if (histories.every((history) => history.twrStatus === "complete")) return "complete";
  return histories.some((history) => history.twrStatus === "incomplete")
    ? "incomplete"
    : "unavailable";
};

const aggregateExternalCashFlows = (
  histories: ReadonlyArray<Pick<PortfolioHistoryResponse, "externalCashFlows">>
) => {
  // Preserve individual dated entries so gross contributions remain visible.
  // XIRR combines same-date movements internally for its NPV calculation.
  return histories
    .flatMap((history) => history.externalCashFlows ?? [])
    .sort((left, right) => left.date.localeCompare(right.date));
};

export const buildAggregatePortfolioHistory = async ({
  portfolioScopes,
  benchmarks = [],
  presentationCurrency = "PLN",
}: {
  portfolioScopes: PortfolioHistoryScope[];
  benchmarks?: PortfolioBenchmarkDefinition[];
  presentationCurrency?: CurrencyCode;
}): Promise<PortfolioHistoryResponse> => {
  const aggregateStartedAt = performance.now();
  const normalizedPresentationCurrency = toCurrencyCode(presentationCurrency, "PLN");
  const uniqueScopes = Array.from(
    new Map(
      portfolioScopes
        .filter(
          (scope) =>
            scope.portfolioId &&
            (scope.assets.length ||
              scope.sales.length ||
              scope.realizedAdjustments.length ||
              (scope.operations?.length ?? 0))
        )
        .map((scope) => [scope.portfolioId, scope] as const)
    ).values()
  );

  if (uniqueScopes.length === 0) {
    return {
      points: [],
      warnings: [],
      twrStatus: "unavailable",
      twrStatusReason: "Brak danych historycznych do wyliczenia TWR.",
      presentationCurrency: normalizedPresentationCurrency,
      presentationTwrStatus: "unavailable",
      presentationTwrStatusReason: "Brak danych historycznych do wyliczenia TWR.",
      externalCashFlows: [],
      assetSeries: [],
      benchmarkSeries: [],
    };
  }

  const histories = await Promise.all(
    uniqueScopes.map((scope) =>
      buildPortfolioHistory({
        assets: scope.assets,
        sales: scope.sales,
        realizedAdjustments: scope.realizedAdjustments,
        operations: scope.operations ?? [],
        accounts: scope.accounts ?? [],
        presentationCurrency: normalizedPresentationCurrency,
        // A user-selected benchmark has no single economically correct
        // aggregate start/cash-flow basis. Keep the existing per-portfolio
        // calculation honest rather than producing a synthetic comparison.
        benchmarks: [],
      })
    )
  );
  const warnings = new Set(histories.flatMap((history) => history.warnings));
  const twrStatus = getAggregateTwrStatus(histories);
  const presentationTwrStatus = getAggregateTwrStatus(histories.map((history) => ({
    twrStatus: history.presentationTwrStatus ?? history.twrStatus,
  })));
  const points = aggregatePortfolioHistoryPoints(histories).map((point) => ({
    ...point,
    timeWeightedReturnPercent:
      twrStatus === "complete" ? point.timeWeightedReturnPercent : null,
    presentationTimeWeightedReturnPercent:
      presentationTwrStatus === "complete" ? point.presentationTimeWeightedReturnPercent ?? null : null,
  }));
  const externalCashFlows = aggregateExternalCashFlows(histories);
  const twrStatusReason = Array.from(
    new Set(histories.flatMap((history, index) => history.twrStatusReason
      ? [`${uniqueScopes[index]?.portfolioName ?? "Portfel"} (${uniqueScopes[index]?.portfolioId ?? "?"}): ${history.twrStatusReason}`]
      : []))
  ).join(" ");
  const presentationTwrStatusReason = Array.from(
    new Set(histories.flatMap((history, index) => history.presentationTwrStatusReason
      ? [`${uniqueScopes[index]?.portfolioName ?? "Portfel"} (${uniqueScopes[index]?.portfolioId ?? "?"}): ${history.presentationTwrStatusReason}`]
      : []))
  ).join(" ");

  logHistoryDiagnostic("aggregate-ready", {
    portfolios: uniqueScopes.length,
    days: points.length,
    durationMs: Math.round(performance.now() - aggregateStartedAt),
    twrStatus: twrStatus ?? "unavailable",
  });

  if (benchmarks.length > 0) {
    warnings.add("Benchmarki są dostępne po wyborze konkretnego portfela; widok łączny nie tworzy syntetycznej serii.");
  }

  return {
    points,
    warnings: Array.from(warnings).sort((left, right) => left.localeCompare(right, "pl")),
    twrStatus,
    presentationCurrency: normalizedPresentationCurrency,
    presentationTwrStatus,
    ...(twrStatusReason ? { twrStatusReason } : {}),
    ...(presentationTwrStatusReason ? { presentationTwrStatusReason } : {}),
    externalCashFlows,
    assetSeries: [],
    benchmarkSeries: [],
  };
};

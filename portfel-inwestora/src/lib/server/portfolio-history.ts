import db from "@/lib/server/db";
import { fetchFxRatesServer } from "@/lib/server/market-data";
import { fetchTreasuryBondQuoteSeriesServer } from "@/lib/server/treasury-bonds";
import { normalizeYahooMoneyUnit } from "@/lib/server/yahoo";
import {
  getGpwTickerCore,
  getPortfolioAssetGroupKey,
  isGpwSymbol,
  normalizeSymbol,
} from "@/lib/ticker";
import { round, toCurrencyCode, toDateInputValue } from "@/lib/utils";
import type {
  AssetKind,
  CurrencyCode,
  PortfolioAsset,
  PortfolioAssetHistorySeries,
  PortfolioBenchmarkDefinition,
  PortfolioBenchmarkHistorySeries,
  PortfolioHistoryPoint,
  PortfolioHistoryResponse,
  PortfolioRealizedAdjustment,
  PortfolioSale,
  QuoteProvider,
} from "@/types/portfolio";

type CacheRow = {
  payload_json: string;
  updated_at: string;
};

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

const EODHD_API_KEY = process.env.EODHD_API_KEY ?? "";
const HISTORY_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const FX_HISTORY_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const NBP_CHUNK_MAX_DAYS = 360;

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

const safeFetchText = async (url: string, timeoutMs = 20_000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/plain, text/csv",
        "User-Agent": "Mozilla/5.0",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

const safeFetchJson = async <T,>(url: string, timeoutMs = 20_000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
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
  const cachedPayload = getCachedPayload<T>(key, ttlMs);

  if (cachedPayload !== null) {
    return cachedPayload;
  }

  const payload = await fetcher();
  setCachedPayload(key, payload);
  return payload;
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
    `portfolio-history:yahoo:${normalizeSymbol(yahooSymbol)}:${startDate}:${endDate}:${
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

const fetchCoinGeckoHistory = async (providerId: string) => {
  return getCachedOrFetch<PricePoint[]>(
    `portfolio-history:coingecko:${normalizeSymbol(providerId)}`,
    HISTORY_CACHE_TTL_MS,
    async () => {
      const payload = await safeFetchJson<{
        prices?: Array<[number, number]>;
      }>(
        `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
          providerId
        )}/market_chart?vs_currency=usd&days=max&interval=daily`,
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
    if (kind === "bond") {
      const points = await fetchTreasuryBondQuoteSeriesServer({
        code: symbol,
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

    if (kind === "stock") {
      if (provider === "eodhd" && providerId) {
        const eodhdPoints = await fetchEodhdHistory(
          providerId,
          startDate,
          endDate,
          priceScale
        );

        if (eodhdPoints.length > 0) {
          return { points: eodhdPoints };
        }
      }

      const stockHistorySymbol = provider === "yahoo" && providerId ? providerId : symbol;
      const points = await fetchStockHistory(
        stockHistorySymbol,
        startDate,
        endDate,
        priceScale
      );

      return points.length > 0
        ? { points }
        : {
            points: [],
            warning: `Nie udalo sie pobrac pelnej historii cen dla ${symbol}; uzyto fallbacku z danych zakupu.`,
          };
    }

    if (kind === "etf") {
      if (!providerId) {
        return {
          points: [],
          warning: `ETF ${symbol} nie ma providerId do historii EODHD; uzyto fallbacku z danych zakupu.`,
        };
      }

      const points = await fetchEodhdHistory(providerId, startDate, endDate, priceScale);

      return points.length > 0
        ? { points }
        : {
            points: [],
            warning: `Nie udalo sie pobrac pelnej historii cen dla ETF ${symbol}; uzyto fallbacku z danych zakupu.`,
          };
    }

    if (kind === "crypto") {
      if (!providerId) {
        return {
          points: [],
          warning: `Krypto ${symbol} nie ma providerId CoinGecko; uzyto fallbacku z danych zakupu.`,
        };
      }

      const points = await fetchCoinGeckoHistory(providerId);
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
      warning: `Brakuje historii cen dla ${symbol} (${marketCurrency}); uzyto fallbacku z danych zakupu.`,
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
          warnings: [] as string[],
        };
      }

      const [points, fallbackRates] = await Promise.all([
        fetchHistoricalFxPoints(code, startDate, endDate),
        fetchFxRatesServer([code]).catch(() => ({ [code]: 1 } as Record<CurrencyCode, number>)),
      ]);
      const fallbackRate = fallbackRates[code] ?? 1;
      const dailyRates = new Map<string, number>();
      let pointIndex = 0;
      let lastKnownRate: number | undefined;
      let usedFallback = false;

      for (const date of dates) {
        while (pointIndex < points.length && points[pointIndex]!.date <= date) {
          lastKnownRate = points[pointIndex]!.rate;
          pointIndex += 1;
        }

        if (typeof lastKnownRate === "number" && lastKnownRate > 0) {
          dailyRates.set(date, lastKnownRate);
          continue;
        }

        dailyRates.set(date, fallbackRate);
        usedFallback = true;
      }

      return {
        code,
        dailyRates,
        warnings:
          usedFallback || points.length === 0
            ? [
                `Brak pelnej historii FX dla ${code}; brakujace dni uzupelniono biezacym kursem.`,
              ]
            : [],
      };
    })
  );

  const fxSeriesByCode = new Map(
    fxEntries.map((entry) => [entry.code, entry.dailyRates] as const)
  );
  const warnings = fxEntries.flatMap((entry) => entry.warnings);

  return {
    fxSeriesByCode,
    warnings,
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
    purchasePrice: round(allocation.purchasePrice, 8),
    provider: allocation.provider ?? sale.provider,
    providerId: allocation.providerId ?? sale.providerId,
    priceScale: allocation.priceScale ?? sale.priceScale,
  } satisfies PortfolioHistorySegment;
};

const getNeededFxCodes = (
  assets: PortfolioAsset[],
  sales: PortfolioSale[],
  benchmarks: PortfolioBenchmarkDefinition[] = []
) => {
  const codes = new Set<CurrencyCode>(["PLN"]);

  for (const asset of assets) {
    codes.add(toCurrencyCode(asset.marketCurrency));
    codes.add(toCurrencyCode(asset.purchaseCurrency));
  }

  for (const sale of sales) {
    for (const allocation of sale.allocations) {
      codes.add(toCurrencyCode(allocation.purchaseCurrency));
      codes.add(toCurrencyCode(allocation.marketCurrency ?? sale.marketCurrency));
    }
  }

  for (const benchmark of benchmarks) {
    codes.add(toCurrencyCode(benchmark.marketCurrency));
  }

  return Array.from(codes);
};

const getPortfolioHistoryStartDate = ({
  assets,
  sales,
  realizedAdjustments,
}: {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
}) => {
  const candidateDates = [
    ...assets.map((asset) => asset.purchaseDate),
    ...sales.flatMap((sale) => [sale.saleDate, ...sale.allocations.map((allocation) => allocation.purchaseDate)]),
    ...realizedAdjustments.map((adjustment) => adjustment.date),
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
) => fxSeriesByCode.get(toCurrencyCode(code, "PLN"))?.get(date) ?? 1;

const convertToPlnOnDate = (
  amount: number,
  currency: CurrencyCode,
  date: string,
  fxSeriesByCode: Map<CurrencyCode, Map<string, number>>
) => round(amount * getFxRateForDate(fxSeriesByCode, currency, date));

const buildBuyCashflowEvents = (
  assets: PortfolioAsset[],
  sales: PortfolioSale[],
  fxSeriesByCode: Map<CurrencyCode, Map<string, number>>
) => {
  const events = new Map<string, number>();

  for (const asset of assets) {
    const investedPln = round(
      convertToPlnOnDate(
        asset.purchasePrice * asset.quantity,
        asset.purchaseCurrency,
        asset.purchaseDate,
        fxSeriesByCode
      ) + asset.feePln
    );

    addAmountToDateMap(events, asset.purchaseDate, investedPln);
  }

  for (const sale of sales) {
    for (const allocation of sale.allocations) {
      const investedPln = round(
        convertToPlnOnDate(
          allocation.purchasePrice * allocation.quantity,
          allocation.purchaseCurrency,
          allocation.purchaseDate,
          fxSeriesByCode
        ) + allocation.allocatedBuyFeePln
      );

      addAmountToDateMap(events, allocation.purchaseDate, investedPln);
    }
  }

  for (const sale of sales) {
    addAmountToDateMap(events, sale.saleDate, -round(sale.realizedInvestedPln));
  }

  return events;
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
  benchmarks = [],
}: {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
  benchmarks?: PortfolioBenchmarkDefinition[];
}): Promise<PortfolioHistoryResponse> => {
  const today = toDateInputValue(new Date().toISOString());
  const startDate = getPortfolioHistoryStartDate({
    assets,
    sales,
    realizedAdjustments,
  });

  if (!startDate) {
    return {
      points: [],
      warnings: [],
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

  const { fxSeriesByCode, warnings: fxWarnings } = await buildFxSeries(
    getNeededFxCodes(assets, sales, benchmarks),
    startDate,
    today
  );

  for (const warning of fxWarnings) {
    warnings.add(warning);
  }

  const netInvestedEvents = buildBuyCashflowEvents(assets, sales, fxSeriesByCode);
  const adjustmentEvents = buildAdjustmentEvents(realizedAdjustments);
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
  const assetSeriesDefinitions = buildAssetSeriesDefinitions({ assets, sales });
  const assetValueByGroupKey = new Map(
    assetSeriesDefinitions.map((definition) => [
      definition.groupKey,
      new Map<string, number>(dates.map((date) => [date, 0] as [string, number])),
    ] as const)
  );
  const instrumentHistoryEntries = await Promise.all(
    instrumentDefinitions.map(async (definition) => {
      const history = await fetchInstrumentHistory(definition, startDate, today);
      return [definition.historyKey, history] as const;
    })
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
    let pointIndex = 0;
    let lastKnownClose: number | undefined;
    let usedFallback = false;

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
      const currency = hasProviderPrice ? segment.marketCurrency : segment.purchaseCurrency;
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
      }
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

  for (const date of dates) {
    const externalFlowPln = netInvestedEvents.get(date) ?? 0;
    const realizedAdjustmentPln = adjustmentEvents.get(date) ?? 0;

    cumulativeNetInvestedPln = round(
      cumulativeNetInvestedPln + externalFlowPln
    );
    cumulativeAdjustmentsPln = round(
      cumulativeAdjustmentsPln + realizedAdjustmentPln
    );

    const portfolioValuePln = round(portfolioValueByDate.get(date) ?? 0);
    const netInvestedPln = round(cumulativeNetInvestedPln);
    const profitLossPln = round(
      portfolioValuePln - netInvestedPln + cumulativeAdjustmentsPln
    );

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
    });

    previousPortfolioValuePln = portfolioValuePln;
  }

  const assetSeries: PortfolioAssetHistorySeries[] = assetSeriesDefinitions
    .map((definition) => ({
      groupKey: definition.groupKey,
      label: definition.label,
      symbol: definition.symbol,
      kind: definition.kind,
      points: dates.map((date) => ({
        date,
        valuePln: round(assetValueByGroupKey.get(definition.groupKey)?.get(date) ?? 0),
      })),
    }))
    .filter((series) => series.points.some((point) => point.valuePln !== 0));

  return {
    points,
    assetSeries,
    benchmarkSeries,
    warnings: Array.from(warnings).sort((left, right) => left.localeCompare(right, "pl")),
  };
};

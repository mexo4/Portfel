import type { Candle } from "@/lib/instrument-chart";
import { getCachedOrFetchHistoryRange, resolveHistoryDefinition, toYahooStockSymbol } from "@/lib/server/portfolio-history";
import { fetchYahooDailyHistory, normalizeYahooMoneyUnit } from "@/lib/server/yahoo";
import { isConfirmedYahooCrypto, toYahooCryptoSymbol, toYahooSymbolFromEodhdProviderId } from "@/lib/server/yahoo-backup";
import { round, uniqueBy } from "@/lib/utils";
import type { AssetKind, CurrencyCode, QuoteProvider } from "@/types/portfolio";

/**
 * Daily open, high, low and close from Yahoo Finance for the instrument chart. Prices are as the
 * exchange printed them (split-adjusted by Yahoo, not dividend-adjusted), so the user's trades
 * sit on them. A series is accepted only in the holding's own quote currency, and for a coin only
 * when Yahoo confirms it is that coin; otherwise there are no candles, never another
 * instrument's.
 */

type CandleDefinition = {
  kind: AssetKind;
  symbol: string;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
};

type Dependencies = {
  fetchHistory?: typeof fetchYahooDailyHistory;
  cached?: typeof getCachedOrFetchHistoryRange;
};

const scaleCandle = (candle: Candle, scale: number): Candle => ({
  date: candle.date,
  open: round(candle.open * scale, 8),
  high: round(candle.high * scale, 8),
  low: round(candle.low * scale, 8),
  close: round(candle.close * scale, 8),
});

/** Yahoo spellings of a share or fund, the most trusted first. */
export const getYahooCandleSymbols = (definition: CandleDefinition) => {
  const resolved = resolveHistoryDefinition(definition);
  const listing = resolved.kind === "etf" && resolved.provider === "eodhd" && resolved.providerId
    ? toYahooSymbolFromEodhdProviderId(resolved.providerId)
    : null;
  const symbols = (resolved.kind === "stock" ? resolved.historyLookupSymbols : resolved.lookupSymbols).map(toYahooStockSymbol);
  return {
    resolved,
    symbols: uniqueBy([...(listing ? [listing] : []), ...symbols].filter(Boolean), (symbol) => symbol),
  };
};

export const fetchInstrumentCandles = async (
  definition: CandleDefinition,
  startDate: string,
  endDate: string,
  { fetchHistory = fetchYahooDailyHistory, cached = getCachedOrFetchHistoryRange }: Dependencies = {}
): Promise<Candle[]> => {
  try {
    const { resolved, symbols } = getYahooCandleSymbols(definition);
    const isCrypto = resolved.kind === "crypto";
    if (resolved.kind !== "stock" && resolved.kind !== "etf" && !isCrypto) return [];
    const coinSymbol = isCrypto ? toYahooCryptoSymbol(resolved.symbol) : null;
    if (isCrypto && (!coinSymbol || resolved.marketCurrency !== "USD")) return [];

    for (const yahooSymbol of isCrypto ? [coinSymbol!] : symbols) {
      const candles = await cached<Candle>(
        // The currency, the scale and a coin's saved id are part of the key: the checks below
        // depend on them, so another holding must not read a series accepted for this one.
        `portfolio-history:candles:v1:yahoo:${yahooSymbol}:${resolved.marketCurrency}:${resolved.priceScale ?? 1}:${isCrypto ? (resolved.providerId ?? "none").toLowerCase() : "-"}:${startDate}`,
        startDate,
        endDate,
        async (rangeStart, rangeEnd) => {
          const history = await fetchHistory({ symbol: yahooSymbol, startDate: rangeStart, endDate: rangeEnd });
          if (!history?.candles?.length || !history.currency) return [];
          const unit = normalizeYahooMoneyUnit(history.currency, resolved.marketCurrency);
          if (unit.currency !== resolved.marketCurrency) return [];
          if (isCrypto && (
            history.instrumentType?.trim().toUpperCase() !== "CRYPTOCURRENCY" ||
            !isConfirmedYahooCrypto({ symbol: resolved.symbol, providerId: resolved.providerId, yahooName: history.name })
          )) return [];
          const scale = unit.priceScale !== 1 ? unit.priceScale : resolved.priceScale ?? 1;
          return history.candles.map((candle) => scaleCandle(candle, scale));
        }
      );
      if (candles.length > 0) return candles;
    }
    return [];
  } catch {
    return [];
  }
};

import type { CfdQuoteSource } from "@/lib/cfd";
import { YAHOO_UNKNOWN_CURRENCY, fetchYahooDailyHistory, fetchYahooQuote } from "@/lib/server/yahoo";
import type { AssetQuote, CurrencyCode, QuoteProvider } from "@/types/portfolio";

const shiftDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The current quote of a CFD from its public source. The position keeps its own identity; only the
 * price and its times come from the source. A contract quoted in anything but dollars is refused.
 */
export const fetchCfdQuoteServer = async (
  source: CfdQuoteSource,
  position: { symbol: string; marketCurrency: CurrencyCode; provider: QuoteProvider; providerId?: string },
  fetchers: { quote: typeof fetchYahooQuote; history: typeof fetchYahooDailyHistory } = { quote: fetchYahooQuote, history: fetchYahooDailyHistory }
): Promise<AssetQuote | null> => {
  const quote = await fetchers.quote({ symbol: source.yahooSymbol, fallbackCurrency: YAHOO_UNKNOWN_CURRENCY });
  if (!quote || quote.marketCurrency !== "USD" || !(quote.price > 0)) return null;
  const day = quote.priceDate ?? quote.fetchedAt.slice(0, 10);
  // The close of the session before, for today's change. Without it the change is left empty.
  const history = await fetchers.history({ symbol: source.yahooSymbol, startDate: shiftDays(day, -10), endDate: day }).catch(() => null);
  const previousClose = history?.points.filter((point) => point.date < day).at(-1)?.close;
  return {
    symbol: position.symbol,
    price: quote.price,
    marketCurrency: position.marketCurrency,
    provider: position.provider,
    providerId: position.providerId,
    instrumentType: "CFD",
    fetchedAt: quote.fetchedAt,
    priceDate: day,
    marketTimestamp: quote.marketTimestamp,
    previousClose,
  };
};

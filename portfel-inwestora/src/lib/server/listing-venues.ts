import { venueFromExchangeCode, type VenueId } from "@/lib/listing-venue";
import { fetchYahooListingExchange } from "@/lib/server/yahoo";

/** A company rarely moves to another exchange; a failure is asked again soon. */
const FOUND_TTL_MS = 7 * 86_400_000;
const MISSING_TTL_MS = 10 * 60_000;
const CONCURRENCY = 5;
const MAX_CACHED = 2_000;

export const MAX_VENUE_SYMBOLS = 100;
export const VENUE_SYMBOL = /^[A-Z]{1,6}(-[A-Z]{1,2})?$/;

type Fetcher = typeof fetchYahooListingExchange;
const cache = new Map<string, { venue: VenueId | null; expiresAt: number }>();

const resolveOne = async (symbol: string, fetchExchange: Fetcher): Promise<VenueId | null> => {
  const cached = cache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.venue;
  const listing = await fetchExchange(symbol).catch(() => null);
  // Only a dollar listing answers for a dollar holding.
  const venue = listing && listing.currency?.toUpperCase() === "USD" ? venueFromExchangeCode(listing.exchangeName) : null;
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(symbol, { venue, expiresAt: Date.now() + (venue ? FOUND_TTL_MS : MISSING_TTL_MS) });
  return venue;
};

/** The exchange of each US ticker; tickers with no confirmed exchange are left out. */
export const resolveListingVenues = async (symbols: string[], fetchExchange: Fetcher = fetchYahooListingExchange) => {
  const queue = [...new Set(symbols.filter((symbol) => VENUE_SYMBOL.test(symbol)))].slice(0, MAX_VENUE_SYMBOLS);
  const venues: Record<string, VenueId> = {};
  const worker = async () => {
    for (let symbol = queue.shift(); symbol; symbol = queue.shift()) {
      const venue = await resolveOne(symbol, fetchExchange);
      if (venue) venues[symbol] = venue;
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return venues;
};

/**
 * Daily closes of a Binance spot pair, used as the history of a catalogue coin
 * when CoinGecko has none (its free plan refuses ranges older than a year, and
 * its limit is often used up). The pair is chosen by the caller from the
 * catalogue, by CoinGecko id, so this never guesses a coin from a ticker.
 */

export type BinanceDailyClose = { date: string; close: number };

type FetchLike = (input: string, init?: { signal?: AbortSignal; cache?: RequestCache }) => Promise<Response>;

const KLINES_URL = "https://api.binance.com/api/v3/klines";
const DAY_MS = 86_400_000;
const MAX_CANDLES_PER_REQUEST = 1_000;
// 12 requests of 1000 daily candles is 32 years, far more than any pair has.
const MAX_REQUESTS = 12;
const PAIR_PATTERN = /^[A-Z0-9]{5,20}$/;

const toStartOfDayMs = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

/** `[openTime, open, high, low, close, ...]` rows -> `{ date, close }`, oldest first. */
export const parseBinanceKlines = (payload: unknown): BinanceDailyClose[] => {
  if (!Array.isArray(payload)) return [];

  const byDate = new Map<string, number>();

  for (const row of payload) {
    if (!Array.isArray(row)) continue;

    const openTime = Number(row[0]);
    const close = Number(row[4]);

    if (!Number.isFinite(openTime) || !Number.isFinite(close) || close <= 0) continue;

    byDate.set(new Date(openTime).toISOString().slice(0, 10), close);
  }

  return Array.from(byDate, ([date, close]) => ({ date, close })).sort((left, right) =>
    left.date.localeCompare(right.date)
  );
};

/** A failed or empty request is "no history", never an error: the caller falls through. */
export const fetchBinanceDailyCloses = async ({
  pair,
  startDate,
  endDate,
  fetchImpl = fetch,
  timeoutMs = 15_000,
}: {
  pair: string;
  startDate: string;
  endDate: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<BinanceDailyClose[]> => {
  if (!PAIR_PATTERN.test(pair)) return [];

  const startMs = toStartOfDayMs(startDate);
  const endMs = toStartOfDayMs(endDate) + DAY_MS - 1;

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return [];

  const closes: BinanceDailyClose[] = [];
  let cursor = startMs;

  for (let request = 0; request < MAX_REQUESTS && cursor <= endMs; request += 1) {
    const params = new URLSearchParams({
      symbol: pair,
      interval: "1d",
      startTime: String(cursor),
      endTime: String(endMs),
      limit: String(MAX_CANDLES_PER_REQUEST),
    });
    let candles: BinanceDailyClose[] = [];
    let candleCount = 0;

    try {
      const response = await fetchImpl(`${KLINES_URL}?${params.toString()}`, {
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });

      if (!response.ok) return closes;

      const payload: unknown = await response.json();
      candleCount = Array.isArray(payload) ? payload.length : 0;
      candles = parseBinanceKlines(payload);
    } catch {
      return closes;
    }

    closes.push(...candles);

    // A short page is the last one.
    if (candleCount < MAX_CANDLES_PER_REQUEST || candles.length === 0) break;

    cursor = toStartOfDayMs(candles[candles.length - 1]!.date) + DAY_MS;
  }

  return closes;
};

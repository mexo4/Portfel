import { getMarketCachePayload, setMarketCachePayload } from "@/lib/server/market-cache";
import { createTtlMemo } from "@/lib/server/ttl-memo";
import { parseEurostatMonthlySeries } from "@/lib/synthetic-benchmarks";

/**
 * Monthly HICP index for Poland (2015 = 100) from Eurostat's public dissemination API (dataset
 * prc_hicp_minr, ECOICOP ver. 2, total). Eurostat publishes a month a few weeks after it ends,
 * so the series is read at most twice a day, shared through the market cache, and a failed read
 * is not repeated for ten minutes.
 */

const EUROSTAT_URL =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?geo=PL&coicop18=TOTAL&unit=I15&format=JSON&lang=EN";
const CACHE_KEY = "inflation:pl-hicp:v1";
const CACHE_TTL_MS = 12 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 10 * 60 * 1_000;
const TIMEOUT_MS = 10_000;

type MonthlyIndex = Array<{ month: string; index: number }>;

const memo = createTtlMemo<MonthlyIndex>({ ttlMs: CACHE_TTL_MS, maxEntries: 1 });
const failures = createTtlMemo<true>({ ttlMs: FAILURE_TTL_MS, maxEntries: 1 });
let inFlight: Promise<MonthlyIndex> | null = null;

const fetchFromEurostat = async (): Promise<MonthlyIndex> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(EUROSTAT_URL, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`Eurostat HTTP ${response.status}`);
    const series = parseEurostatMonthlySeries(await response.json());
    if (series.length < 12) throw new Error("Eurostat returned too few months");
    return series;
  } finally {
    clearTimeout(timeout);
  }
};

/** The monthly index, or an empty list when it cannot be read (the benchmark then gets a warning). */
export const getPolishInflationIndex = async (): Promise<MonthlyIndex> => {
  const cached = memo.get(CACHE_KEY);
  if (cached) return cached;
  if (failures.get(CACHE_KEY)) return [];
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const stored = await getMarketCachePayload<MonthlyIndex>(CACHE_KEY, CACHE_TTL_MS, { ignoreEmptyArray: true }).catch(() => null);
      if (Array.isArray(stored) && stored.length > 0) {
        memo.set(CACHE_KEY, stored);
        return stored;
      }
      const series = await fetchFromEurostat();
      memo.set(CACHE_KEY, series);
      await setMarketCachePayload(CACHE_KEY, series).catch(() => undefined);
      return series;
    } catch (error) {
      console.warn("[inflation] Nie udało się pobrać indeksu HICP z Eurostatu.", { message: error instanceof Error ? error.message : String(error) });
      failures.set(CACHE_KEY, true);
      return [];
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
};

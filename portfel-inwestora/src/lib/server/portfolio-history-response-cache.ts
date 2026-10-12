import type { PortfolioHistoryResponse } from "@/types/portfolio";

const HISTORY_RESPONSE_CACHE_TTL_MS = 3 * 60 * 1_000;
const HISTORY_RESPONSE_CACHE_MAX_ENTRIES = 24;
const HISTORY_RESPONSE_CACHE_MAX_ENTRY_BYTES = 4 * 1024 * 1024;
const HISTORY_RESPONSE_CACHE_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

type CacheEntry = {
  response: PortfolioHistoryResponse;
  expiresAt: number;
  byteLength: number;
};

const responses = new Map<string, CacheEntry>();
let cachedResponseBytes = 0;

const removeEntry = (key: string) => {
  const entry = responses.get(key);
  if (!entry) return;
  cachedResponseBytes -= entry.byteLength;
  responses.delete(key);
};

/**
 * Process-local cache for an already calculated history response. The caller's
 * key must be user-scoped and include portfolio revision, selected portfolio
 * IDs, presentation currency, benchmarks, and the history's current date.
 */
export const getCachedPortfolioHistoryResponse = (
  key: string,
  now = Date.now()
): PortfolioHistoryResponse | undefined => {
  const entry = responses.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    removeEntry(key);
    return undefined;
  }

  // Refresh insertion order for a small LRU cache.
  responses.delete(key);
  responses.set(key, entry);
  return entry.response;
};

export const setCachedPortfolioHistoryResponse = (
  key: string,
  response: PortfolioHistoryResponse,
  now = Date.now()
) => {
  removeEntry(key);
  const byteLength = JSON.stringify(response).length * 2;
  if (byteLength > HISTORY_RESPONSE_CACHE_MAX_ENTRY_BYTES) return;

  responses.set(key, {
    response,
    expiresAt: now + HISTORY_RESPONSE_CACHE_TTL_MS,
    byteLength,
  });
  cachedResponseBytes += byteLength;

  while (
    responses.size > HISTORY_RESPONSE_CACHE_MAX_ENTRIES ||
    cachedResponseBytes > HISTORY_RESPONSE_CACHE_MAX_TOTAL_BYTES
  ) {
    const oldestKey = responses.keys().next().value;
    if (oldestKey === undefined) break;
    removeEntry(oldestKey);
  }
};

export const clearPortfolioHistoryResponseCache = () => {
  responses.clear();
  cachedResponseBytes = 0;
};

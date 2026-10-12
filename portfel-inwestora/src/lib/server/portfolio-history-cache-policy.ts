export const EMPTY_HISTORY_CACHE_TTL_MS = 10 * 60 * 1_000;

export const isReusableHistoryCacheEntry = (
  payload: unknown,
  updatedAt: string,
  now = Date.now()
) => {
  if (!Array.isArray(payload) || payload.length > 0) return true;
  const cachedAt = Date.parse(updatedAt);
  return Number.isFinite(cachedAt) && now - cachedAt <= EMPTY_HISTORY_CACHE_TTL_MS;
};

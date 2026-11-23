export const EMPTY_HISTORY_CACHE_TTL_MS = 10 * 60 * 1_000;

/**
 * How long a calculated portfolio history is reused, in memory, in the
 * database and in the browser. Building one takes tens of seconds on a cold
 * server, so a reload (F5) inside this window must not build it again. The
 * newest point can therefore be this old; a manual refresh bypasses it.
 */
export const PORTFOLIO_HISTORY_RESPONSE_TTL_MS = 60 * 60 * 1_000;

export const isReusableHistoryCacheEntry = (
  payload: unknown,
  updatedAt: string,
  now = Date.now()
) => {
  if (!Array.isArray(payload) || payload.length > 0) return true;
  const cachedAt = Date.parse(updatedAt);
  return Number.isFinite(cachedAt) && now - cachedAt <= EMPTY_HISTORY_CACHE_TTL_MS;
};

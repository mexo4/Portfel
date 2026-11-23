import { execute, queryOne } from "@/lib/server/db";
import { PORTFOLIO_HISTORY_RESPONSE_TTL_MS } from "@/lib/server/portfolio-history-cache-policy";
import type { PortfolioHistoryResponse } from "@/types/portfolio";

/**
 * Calculated portfolio histories kept in the database, per user.
 *
 * A history takes tens of seconds to build on a cold server, and the in-memory
 * copy disappears with every restart and is not shared between processes. This
 * copy survives both, so a reload (F5) inside `PORTFOLIO_HISTORY_RESPONSE_TTL_MS`
 * is served from here. It lives in its own user-owned table, not in the shared
 * `market_cache`: it is derived from the user's portfolio, so it is removed with
 * the account (`ON DELETE CASCADE`) and never mixed with market data.
 *
 * Every function is best effort for the caller: a database that is unavailable
 * must never make a history request fail, so the route treats an error as a miss.
 */

export const MAX_STORED_HISTORIES_PER_USER = 8;
export const MAX_STORED_HISTORY_CHARS = 4 * 1024 * 1024;
// A stored time later than this in the future means a wrong clock; do not trust it.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

type StoredHistoryRow = {
  payload_json: string;
  updated_at: string;
};

type StoreParameter = string | number;

type StoreDatabase = {
  queryOne: <T>(sql: string, params?: StoreParameter[]) => Promise<T | undefined | null>;
  execute: (sql: string, params?: StoreParameter[]) => Promise<unknown>;
};

const isStoredHistory = (value: unknown): value is PortfolioHistoryResponse => {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<PortfolioHistoryResponse>;

  return (
    Array.isArray(candidate.points) &&
    Array.isArray(candidate.warnings) &&
    Array.isArray(candidate.benchmarkSeries)
  );
};

export const createPortfolioHistoryStore = (database: StoreDatabase) => ({
  async read(
    userId: string,
    cacheKey: string,
    now = Date.now()
  ): Promise<PortfolioHistoryResponse | null> {
    const row = await database.queryOne<StoredHistoryRow>(
      "SELECT payload_json, updated_at FROM user_portfolio_history_cache WHERE user_id = $1 AND cache_key = $2",
      [userId, cacheKey]
    );

    if (!row?.payload_json) return null;

    const storedAt = Date.parse(row.updated_at);

    if (
      !Number.isFinite(storedAt) ||
      now - storedAt > PORTFOLIO_HISTORY_RESPONSE_TTL_MS ||
      storedAt - now > MAX_CLOCK_SKEW_MS
    ) {
      return null;
    }

    try {
      const parsed = JSON.parse(row.payload_json) as unknown;
      return isStoredHistory(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },

  async store(
    userId: string,
    cacheKey: string,
    response: PortfolioHistoryResponse,
    now = Date.now()
  ) {
    const payload = JSON.stringify(response);

    // Same ceiling as the in-memory copy: one huge history is simply not kept.
    if (payload.length > MAX_STORED_HISTORY_CHARS) return;

    await database.execute(
      `
        INSERT INTO user_portfolio_history_cache (user_id, cache_key, payload_json, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, cache_key) DO UPDATE SET
          payload_json = EXCLUDED.payload_json,
          updated_at = EXCLUDED.updated_at
      `,
      [userId, cacheKey, payload, new Date(now).toISOString()]
    );

    // Bounded per user: nothing older than the TTL, and only the newest few.
    await database.execute(
      `
        DELETE FROM user_portfolio_history_cache
        WHERE user_id = $1
          AND (
            updated_at < $2
            OR cache_key NOT IN (
              SELECT cache_key FROM user_portfolio_history_cache
              WHERE user_id = $1
              ORDER BY updated_at DESC
              LIMIT $3
            )
          )
      `,
      [
        userId,
        new Date(now - PORTFOLIO_HISTORY_RESPONSE_TTL_MS).toISOString(),
        MAX_STORED_HISTORIES_PER_USER,
      ]
    );
  },
});

const portfolioHistoryStore = createPortfolioHistoryStore({ queryOne, execute });

export const readStoredPortfolioHistory = portfolioHistoryStore.read;
export const storePortfolioHistory = portfolioHistoryStore.store;

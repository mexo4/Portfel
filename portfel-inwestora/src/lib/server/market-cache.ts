import { execute, queryOne } from "@/lib/server/db";

type MarketCacheRow = {
  payload_json: string;
  updated_at: string;
};

const MARKET_CACHE_MAINTENANCE_INTERVAL_MS = 1000 * 60 * 60 * 12;
let lastMarketCacheMaintenanceAt = 0;

const isoBefore = (ageMs: number) => new Date(Date.now() - ageMs).toISOString();

/**
 * Cache keys include search/history ranges, so their primary keys alone do not
 * prevent unbounded growth. These values are all reconstructible from their
 * providers and already have much shorter read TTLs than this retention.
 */
export const purgeExpiredMarketCacheEntries = async () => {
  await execute(
    `
      DELETE FROM market_cache
      WHERE
        ("key" LIKE 'portfolio-history:%' AND updated_at < $1)
        OR ("key" LIKE 'eodhd:%' AND updated_at < $2)
        OR ("key" LIKE 'openfigi:etf:%' AND updated_at < $3)
        OR ("key" LIKE 'gpw-catalog%' AND updated_at < $4)
        OR ("key" LIKE 'treasury-bond-series%' AND updated_at < $4)
        OR ("key" LIKE 'treasury-bond-cpi%' AND updated_at < $5)
    `,
    [
      isoBefore(1000 * 60 * 60 * 24 * 14),
      isoBefore(1000 * 60 * 60 * 24 * 3),
      isoBefore(1000 * 60 * 60 * 24),
      isoBefore(1000 * 60 * 60 * 24 * 7),
      isoBefore(1000 * 60 * 60 * 24 * 90),
    ]
  );
};

const scheduleMarketCacheMaintenance = () => {
  const now = Date.now();
  if (now - lastMarketCacheMaintenanceAt < MARKET_CACHE_MAINTENANCE_INTERVAL_MS) {
    return;
  }

  lastMarketCacheMaintenanceAt = now;
  void purgeExpiredMarketCacheEntries().catch(() => {
    // A cache cleanup failure must never make a provider response unavailable.
    lastMarketCacheMaintenanceAt = 0;
  });
};

export const getMarketCachePayload = async <T,>(
  key: string,
  ttlMs: number,
  options: { ignoreEmptyArray?: boolean } = {}
) => {
  const row = await queryOne<MarketCacheRow>(
    'SELECT payload_json, updated_at FROM market_cache WHERE "key" = $1',
    [key]
  );

  if (!row?.payload_json) {
    return null;
  }

  const updatedAt = Date.parse(row.updated_at);

  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > ttlMs) {
    return null;
  }

  try {
    const payload = JSON.parse(row.payload_json) as T;

    if (options.ignoreEmptyArray && Array.isArray(payload) && payload.length === 0) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
};

export const setMarketCachePayload = async (
  key: string,
  payload: unknown,
  updatedAt = new Date().toISOString()
) => {
  await execute(
    `
      INSERT INTO market_cache ("key", payload_json, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT ("key") DO UPDATE SET
        payload_json = CASE
          WHEN market_cache.payload_json IS DISTINCT FROM EXCLUDED.payload_json
            THEN EXCLUDED.payload_json
          ELSE market_cache.payload_json
        END,
        updated_at = EXCLUDED.updated_at
    `,
    [key, JSON.stringify(payload), updatedAt]
  );

  scheduleMarketCacheMaintenance();
};

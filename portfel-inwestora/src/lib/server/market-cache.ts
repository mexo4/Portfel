import { execute, queryOne } from "@/lib/server/db";

type MarketCacheRow = {
  payload_json: string;
  updated_at: string;
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
        payload_json = EXCLUDED.payload_json,
        updated_at = EXCLUDED.updated_at
    `,
    [key, JSON.stringify(payload), updatedAt]
  );
};

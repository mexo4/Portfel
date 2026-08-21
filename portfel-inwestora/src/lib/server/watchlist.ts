import { randomUUID } from "node:crypto";
import { query, queryOne } from "@/lib/server/db";
import { normalizeWatchlistItemInput, type WatchlistItem, type WatchlistItemInput } from "@/lib/watchlist";
import type { QuoteProvider } from "@/types/portfolio";

type WatchlistRow = {
  id: string;
  canonical_key: string;
  symbol: string;
  name: string;
  market_currency: string;
  provider: string | null;
  provider_id: string | null;
  isin: string | null;
  core_instrument_id: string | null;
  created_at: string;
  updated_at: string;
};

const toWatchlistItem = (row: WatchlistRow): WatchlistItem => ({
  id: row.id,
  canonicalKey: row.canonical_key,
  symbol: row.symbol,
  name: row.name,
  marketCurrency: row.market_currency,
  provider: row.provider as QuoteProvider | null ?? undefined,
  providerId: row.provider_id ?? undefined,
  isin: row.isin ?? undefined,
  coreInstrumentId: row.core_instrument_id ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const getUserWatchlist = async (userId: string): Promise<WatchlistItem[]> => {
  const rows = await query<WatchlistRow>(
    `
      SELECT id, canonical_key, symbol, name, market_currency, provider,
             provider_id, isin, core_instrument_id, created_at, updated_at
      FROM user_watchlist_items
      WHERE user_id = $1
      ORDER BY name ASC, symbol ASC
    `,
    [userId]
  );

  return rows.map(toWatchlistItem);
};

const findOwnedCoreInstrumentId = async (userId: string, ticker: string) => {
  const row = await queryOne<{ id: string }>(
    `
      SELECT instrument.id
      FROM core_instruments AS instrument
      INNER JOIN core_portfolios AS portfolio ON portfolio.id = instrument.portfolio_id
      WHERE portfolio.user_id = $1
        AND instrument.type = 'STOCK'
        AND instrument.market_currency = 'PLN'
        AND UPPER(REGEXP_REPLACE(instrument.symbol, '\\.(WA|PL)$', '', 'i')) = $2
      ORDER BY instrument.updated_at DESC
      LIMIT 1
    `,
    [userId, ticker]
  );
  return row?.id;
};

export const addUserWatchlistItem = async (
  userId: string,
  rawInput: WatchlistItemInput
): Promise<WatchlistItem> => {
  const input = normalizeWatchlistItemInput(rawInput);
  if (!input) {
    throw new Error("Do obserwowanych można dodać wyłącznie akcję GPW.");
  }

  const ticker = input.canonicalKey.slice("gpw:ticker:".length);
  const coreInstrumentId = await findOwnedCoreInstrumentId(userId, ticker);
  const now = new Date().toISOString();
  const row = await queryOne<WatchlistRow>(
    `
      INSERT INTO user_watchlist_items (
        id, user_id, canonical_key, symbol, name, market_currency,
        provider, provider_id, isin, core_instrument_id, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
      ON CONFLICT (user_id, canonical_key) DO UPDATE SET
        symbol = EXCLUDED.symbol,
        name = EXCLUDED.name,
        market_currency = EXCLUDED.market_currency,
        provider = COALESCE(EXCLUDED.provider, user_watchlist_items.provider),
        provider_id = COALESCE(EXCLUDED.provider_id, user_watchlist_items.provider_id),
        isin = COALESCE(EXCLUDED.isin, user_watchlist_items.isin),
        core_instrument_id = COALESCE(EXCLUDED.core_instrument_id, user_watchlist_items.core_instrument_id),
        updated_at = EXCLUDED.updated_at
      RETURNING id, canonical_key, symbol, name, market_currency, provider,
                provider_id, isin, core_instrument_id, created_at, updated_at
    `,
    [
      randomUUID(),
      userId,
      input.canonicalKey,
      input.symbol,
      input.name,
      input.marketCurrency,
      input.provider ?? null,
      input.providerId ?? null,
      input.isin ?? null,
      coreInstrumentId ?? null,
      now,
    ]
  );

  if (!row) {
    throw new Error("Nie udało się zapisać obserwowanej spółki.");
  }

  return toWatchlistItem(row);
};

export const removeUserWatchlistItem = async (userId: string, canonicalKey: string) => {
  const rows = await query<{ id: string }>(
    `
      DELETE FROM user_watchlist_items
      WHERE user_id = $1 AND canonical_key = $2
      RETURNING id
    `,
    [userId, canonicalKey]
  );
  return rows.length > 0;
};

/** Convert a user-scoped entry into the existing normalized GPW event input. */
export const getWatchlistCorporateEventInputs = (items: WatchlistItem[]) =>
  items.map((item) => ({
    id: item.coreInstrumentId ?? `watchlist:${item.id}`,
    assetKind: "stock" as const,
    symbol: item.symbol,
    name: item.name,
    marketCurrency: item.marketCurrency,
    provider: item.provider,
    providerId: item.providerId,
    isin: item.isin,
  }));

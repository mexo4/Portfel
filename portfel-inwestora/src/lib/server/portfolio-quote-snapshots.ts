import { execute, query } from "@/lib/server/db";
import type { PortfolioAsset, PortfolioBook } from "@/types/portfolio";

export type PortfolioQuoteSnapshotInput = {
  portfolioId: string;
  assetId: string;
  latestPrice: number;
  latestPriceDate?: string;
  latestPriceMarketTimestamp?: string;
  latestPriceFetchedAt?: string;
  previousClose?: number;
  lastUpdatedAt?: string;
  marketCurrency?: PortfolioAsset["marketCurrency"];
  provider?: PortfolioAsset["provider"];
  providerId?: string;
  priceScale?: number;
};

type PortfolioQuoteSnapshotRow = {
  portfolio_id: string;
  asset_id: string;
  payload_json: string;
  quote_timestamp: string;
  updated_at: string;
};

const MAX_SNAPSHOTS_PER_REQUEST = 500;

const isValidDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const isValidSnapshot = (value: unknown): value is PortfolioQuoteSnapshotInput => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const snapshot = value as Partial<PortfolioQuoteSnapshotInput>;
  return (
    typeof snapshot.portfolioId === "string" &&
    snapshot.portfolioId.length > 0 &&
    snapshot.portfolioId.length <= 128 &&
    typeof snapshot.assetId === "string" &&
    snapshot.assetId.length > 0 &&
    snapshot.assetId.length <= 128 &&
    typeof snapshot.latestPrice === "number" &&
    Number.isFinite(snapshot.latestPrice) &&
    snapshot.latestPrice > 0
  );
};

const sanitiseSnapshot = (snapshot: PortfolioQuoteSnapshotInput) => {
  const fetchedAt = isValidDate(snapshot.latestPriceFetchedAt)
    ? snapshot.latestPriceFetchedAt
    : isValidDate(snapshot.lastUpdatedAt)
      ? snapshot.lastUpdatedAt
      : new Date().toISOString();
  const marketTimestamp = isValidDate(snapshot.latestPriceMarketTimestamp)
    ? snapshot.latestPriceMarketTimestamp
    : undefined;

  return {
    portfolioId: snapshot.portfolioId,
    assetId: snapshot.assetId,
    latestPrice: snapshot.latestPrice,
    latestPriceDate: typeof snapshot.latestPriceDate === "string" ? snapshot.latestPriceDate : undefined,
    latestPriceMarketTimestamp: marketTimestamp,
    latestPriceFetchedAt: fetchedAt,
    previousClose:
      typeof snapshot.previousClose === "number" && Number.isFinite(snapshot.previousClose)
        ? snapshot.previousClose
        : undefined,
    lastUpdatedAt: fetchedAt,
    marketCurrency: typeof snapshot.marketCurrency === "string" ? snapshot.marketCurrency : undefined,
    provider: typeof snapshot.provider === "string" ? snapshot.provider : undefined,
    providerId: typeof snapshot.providerId === "string" ? snapshot.providerId : undefined,
    priceScale:
      typeof snapshot.priceScale === "number" && Number.isFinite(snapshot.priceScale)
        ? snapshot.priceScale
        : undefined,
    quoteTimestamp: marketTimestamp ?? fetchedAt,
  };
};

const getSnapshotFreshness = (asset: PortfolioAsset) => {
  const marketTimestamp = asset.latestPriceMarketTimestamp;
  const fetchedAt = asset.latestPriceFetchedAt ?? asset.lastUpdatedAt;
  const timestamp = marketTimestamp ?? fetchedAt;
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;

  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const isUsableStoredPrice = (asset: PortfolioAsset) =>
  typeof asset.latestPrice === "number" &&
  Number.isFinite(asset.latestPrice) &&
  asset.latestPrice > 0;

const applySnapshot = (
  asset: PortfolioAsset,
  snapshot: PortfolioQuoteSnapshotInput
): PortfolioAsset => {
  if (!isUsableStoredPrice({ ...asset, latestPrice: snapshot.latestPrice })) {
    return asset;
  }

  const snapshotFreshness = getSnapshotFreshness({
    ...asset,
    latestPrice: snapshot.latestPrice,
    latestPriceMarketTimestamp: snapshot.latestPriceMarketTimestamp,
    latestPriceFetchedAt: snapshot.latestPriceFetchedAt,
    lastUpdatedAt: snapshot.lastUpdatedAt,
  });

  if (isUsableStoredPrice(asset) && snapshotFreshness < getSnapshotFreshness(asset)) {
    return asset;
  }

  return {
    ...asset,
    latestPrice: snapshot.latestPrice,
    latestPriceDate: snapshot.latestPriceDate ?? asset.latestPriceDate,
    latestPriceMarketTimestamp:
      snapshot.latestPriceMarketTimestamp ?? asset.latestPriceMarketTimestamp,
    latestPriceFetchedAt: snapshot.latestPriceFetchedAt ?? asset.latestPriceFetchedAt,
    previousClose: snapshot.previousClose ?? asset.previousClose,
    lastUpdatedAt: snapshot.lastUpdatedAt ?? asset.lastUpdatedAt,
    // These fields are quote metadata, not display identity.  Keeping them
    // with a valid quote prevents mixing a unit price with a stale currency.
    marketCurrency: snapshot.marketCurrency ?? asset.marketCurrency,
    provider: snapshot.provider ?? asset.provider,
    providerId: snapshot.providerId ?? asset.providerId,
    priceScale: snapshot.priceScale ?? asset.priceScale,
  };
};

export const getPortfolioQuoteSnapshots = async (portfolioIds: string[]) => {
  if (portfolioIds.length === 0) {
    return new Map<string, PortfolioQuoteSnapshotInput>();
  }

  const rows = await query<PortfolioQuoteSnapshotRow>(
    `
      SELECT portfolio_id, asset_id, payload_json, quote_timestamp, updated_at
      FROM portfolio_asset_quotes
      WHERE portfolio_id = ANY($1::text[])
    `,
    [portfolioIds]
  );
  const snapshots = new Map<string, PortfolioQuoteSnapshotInput>();

  rows.forEach((row) => {
    try {
      const parsed = JSON.parse(row.payload_json) as unknown;
      if (!isValidSnapshot(parsed)) {
        return;
      }

      const snapshot = sanitiseSnapshot({
        ...parsed,
        portfolioId: row.portfolio_id,
        assetId: row.asset_id,
        latestPriceMarketTimestamp:
          (parsed as PortfolioQuoteSnapshotInput).latestPriceMarketTimestamp ?? row.quote_timestamp,
        latestPriceFetchedAt:
          (parsed as PortfolioQuoteSnapshotInput).latestPriceFetchedAt ?? row.updated_at,
      });
      snapshots.set(`${snapshot.portfolioId}:${snapshot.assetId}`, snapshot);
    } catch {
      // A malformed cache entry is ignored; it must not block a portfolio read.
    }
  });

  return snapshots;
};

export const mergePortfolioBookQuoteSnapshots = (
  portfolioBook: PortfolioBook,
  snapshots: Map<string, PortfolioQuoteSnapshotInput>
): PortfolioBook => ({
  ...portfolioBook,
  portfolios: portfolioBook.portfolios.map((portfolio) => ({
    ...portfolio,
    assets: portfolio.assets.map((asset) => {
      const snapshot = snapshots.get(`${portfolio.id}:${asset.id}`);
      return snapshot ? applySnapshot(asset, snapshot) : asset;
    }),
  })),
});

export const savePortfolioQuoteSnapshots = async (
  userId: string,
  rawSnapshots: unknown[]
) => {
  const snapshots = rawSnapshots
    .filter(isValidSnapshot)
    .slice(0, MAX_SNAPSHOTS_PER_REQUEST)
    .map(sanitiseSnapshot);

  if (snapshots.length === 0) {
    return { saved: 0 };
  }

  const latestByAsset = new Map<string, (typeof snapshots)[number]>();
  snapshots.forEach((snapshot) => {
    const key = `${snapshot.portfolioId}:${snapshot.assetId}`;
    const current = latestByAsset.get(key);
    if (!current || Date.parse(snapshot.quoteTimestamp) >= Date.parse(current.quoteTimestamp)) {
      latestByAsset.set(key, snapshot);
    }
  });
  const uniqueSnapshots = Array.from(latestByAsset.values());
  const portfolioIds = Array.from(new Set(uniqueSnapshots.map((snapshot) => snapshot.portfolioId)));
  const ownedRows = await query<{ id: string }>(
    "SELECT id FROM core_portfolios WHERE user_id = $1 AND id = ANY($2::text[])",
    [userId, portfolioIds]
  );

  if (ownedRows.length !== portfolioIds.length) {
    throw new Error("Nieprawidlowy portfel dla zapisu kursow.");
  }

  const now = new Date().toISOString();
  await execute(
    `
      INSERT INTO portfolio_asset_quotes (
        portfolio_id, asset_id, payload_json, quote_timestamp, updated_at
      )
      SELECT item.portfolio_id, item.asset_id, item.payload_json, item.quote_timestamp, $2
      FROM jsonb_to_recordset($1::jsonb) AS item(
        portfolio_id text,
        asset_id text,
        payload_json text,
        quote_timestamp text
      )
      ON CONFLICT (portfolio_id, asset_id) DO UPDATE SET
        payload_json = EXCLUDED.payload_json,
        quote_timestamp = EXCLUDED.quote_timestamp,
        updated_at = EXCLUDED.updated_at
      WHERE EXCLUDED.quote_timestamp > portfolio_asset_quotes.quote_timestamp
    `,
    [
      JSON.stringify(
        uniqueSnapshots.map((snapshot) => ({
          portfolio_id: snapshot.portfolioId,
          asset_id: snapshot.assetId,
          payload_json: JSON.stringify(snapshot),
          quote_timestamp: snapshot.quoteTimestamp,
        }))
      ),
      now,
    ]
  );

  return { saved: uniqueSnapshots.length };
};

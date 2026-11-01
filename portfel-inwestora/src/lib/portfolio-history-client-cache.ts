import { fetchPortfolioHistory } from "@/lib/api";
import type { PortfolioHistoryResponse } from "@/types/portfolio";

export type PortfolioHistoryRequest = Omit<Parameters<typeof fetchPortfolioHistory>[0], "signal">;

export type PortfolioHistoryRequestDescriptor = {
  key: string;
  payload: PortfolioHistoryRequest;
};

const HISTORY_REQUEST_CACHE_TTL_MS = 3 * 60 * 1_000;
const HISTORY_REQUEST_CACHE_MAX_ENTRIES = 8;

const withoutLiveQuoteFields = <T extends PortfolioHistoryRequest["assets"][number]>(asset: T) => {
  const historyAsset = { ...asset };
  delete historyAsset.latestPrice;
  delete historyAsset.latestPriceDate;
  delete historyAsset.latestPriceMarketTimestamp;
  delete historyAsset.latestPriceFetchedAt;
  delete historyAsset.previousClose;
  delete historyAsset.lastUpdatedAt;
  return historyAsset;
};

/**
 * Builds one user- and scope-specific request identity shared by the app-entry
 * prefetch and the chart screen. Quote refreshes do not change historical input.
 */
export const createPortfolioHistoryRequestDescriptor = ({
  userId,
  refreshRevision,
  payload,
}: {
  userId: string;
  refreshRevision: number;
  payload: PortfolioHistoryRequest;
}): PortfolioHistoryRequestDescriptor => {
  const hasPortfolioScopes = Boolean(payload.portfolioScopes?.length);
  const normalizedPayload: PortfolioHistoryRequest = {
    assets: (hasPortfolioScopes ? [] : payload.assets).map(withoutLiveQuoteFields),
    sales: payload.sales,
    realizedAdjustments: payload.realizedAdjustments,
    operations: hasPortfolioScopes ? [] : payload.operations,
    accounts: hasPortfolioScopes ? [] : payload.accounts,
    accountType: hasPortfolioScopes ? undefined : payload.accountType,
    benchmarks: payload.benchmarks ?? [],
    presentationCurrency: payload.presentationCurrency,
    portfolioScopes: payload.portfolioScopes?.map((scope) => ({
      portfolioId: scope.portfolioId,
      accountType: scope.accountType,
      assets: scope.assets.map(withoutLiveQuoteFields),
      sales: scope.sales,
      realizedAdjustments: scope.realizedAdjustments,
      operations: scope.operations ?? [],
      accounts: scope.accounts ?? [],
    })),
  };

  return {
    key: JSON.stringify({ userId, refreshRevision, request: normalizedPayload }),
    payload: normalizedPayload,
  };
};

export const hasPortfolioHistoryInputs = (payload: PortfolioHistoryRequest) =>
  payload.assets.length > 0 ||
  payload.sales.length > 0 ||
  payload.realizedAdjustments.length > 0 ||
  (payload.operations?.length ?? 0) > 0 ||
  Boolean(payload.portfolioScopes?.some((scope) =>
    scope.assets.length > 0 ||
    scope.sales.length > 0 ||
    scope.realizedAdjustments.length > 0 ||
    (scope.operations?.length ?? 0) > 0
  ));

/** Small bounded single-flight cache, independently testable without network access. */
export const createPortfolioHistoryRequestCache = <TResponse>({
  ttlMs = HISTORY_REQUEST_CACHE_TTL_MS,
  maxEntries = HISTORY_REQUEST_CACHE_MAX_ENTRIES,
  now = Date.now,
}: {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
} = {}) => {
  const entries = new Map<string, { promise: Promise<TResponse>; expiresAt: number | null }>();

  const prune = () => {
    for (const [key, entry] of entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now()) entries.delete(key);
    }
    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value;
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
    }
  };

  return {
    getOrLoad(key: string, load: () => Promise<TResponse>) {
      prune();
      const existing = entries.get(key);
      if (existing) {
        entries.delete(key);
        entries.set(key, existing);
        return existing.promise;
      }

      const entry: { promise: Promise<TResponse>; expiresAt: number | null } = {
        promise: Promise.resolve().then(load),
        expiresAt: null,
      };
      entries.set(key, entry);
      prune();
      void entry.promise.then(
        () => {
          if (entries.get(key) === entry) {
            entry.expiresAt = now() + ttlMs;
            prune();
          }
        },
        () => {
          if (entries.get(key) === entry) entries.delete(key);
        }
      );
      return entry.promise;
    },
    clear() {
      entries.clear();
    },
    get size() {
      prune();
      return entries.size;
    },
  };
};

const portfolioHistoryRequestCache = createPortfolioHistoryRequestCache<PortfolioHistoryResponse>();

/** Used both for background prefetch and for the visible chart request. */
export const getPortfolioHistoryCached = (descriptor: PortfolioHistoryRequestDescriptor) =>
  portfolioHistoryRequestCache.getOrLoad(
    descriptor.key,
    () => fetchPortfolioHistory(descriptor.payload)
  );

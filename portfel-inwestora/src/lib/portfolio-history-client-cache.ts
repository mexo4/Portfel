import { fetchPortfolioHistory } from "@/lib/api";
import type { PortfolioHistoryProgress } from "@/lib/portfolio-history-progress";
import type { PortfolioHistoryResponse } from "@/types/portfolio";

export type PortfolioHistoryRequest = Omit<Parameters<typeof fetchPortfolioHistory>[0], "signal">;

export type PortfolioHistoryRequestDescriptor = {
  key: string;
  payload: PortfolioHistoryRequest;
};

const HISTORY_REQUEST_CACHE_TTL_MS = 30 * 60 * 1_000;
const HISTORY_REQUEST_CACHE_MAX_ENTRIES = 8;
const SESSION_CACHE_STORAGE_KEY = "mexo.portfolio-history.v1";
const SESSION_CACHE_MAX_CHARS = 1_500_000;
const historyProgressByKey = new Map<string, PortfolioHistoryProgress>();
const historyProgressListeners = new Map<
  string,
  Set<(progress: PortfolioHistoryProgress | null) => void>
>();
const historyProgressAbortControllers = new Set<AbortController>();

type PersistentCacheStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const getBrowserSessionStorage = (): PersistentCacheStorage | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

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
  storage,
}: {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
  storage?: PersistentCacheStorage | null;
} = {}) => {
  const entries = new Map<string, { promise: Promise<TResponse>; expiresAt: number | null }>();
  const getStorage = () => storage === null ? undefined : storage ?? getBrowserSessionStorage();

  const readPersistent = (key: string): { response: TResponse; expiresAt: number } | undefined => {
    const sessionStorage = getStorage();
    if (!sessionStorage) return undefined;

    try {
      const serialized = sessionStorage.getItem(SESSION_CACHE_STORAGE_KEY);
      if (!serialized) return undefined;
      const record = JSON.parse(serialized) as {
        key?: unknown;
        expiresAt?: unknown;
        response?: TResponse;
      };
      if (
        typeof record.key !== "string" ||
        typeof record.expiresAt !== "number" ||
        record.expiresAt <= now() ||
        record.key !== key ||
        record.response === undefined
      ) {
        sessionStorage.removeItem(SESSION_CACHE_STORAGE_KEY);
        return undefined;
      }
      return { response: record.response, expiresAt: record.expiresAt };
    } catch {
      try {
        sessionStorage.removeItem(SESSION_CACHE_STORAGE_KEY);
      } catch {
        // Storage can be disabled or quota-limited; in-memory caching still works.
      }
      return undefined;
    }
  };

  const writePersistent = (key: string, response: TResponse, expiresAt: number) => {
    const sessionStorage = getStorage();
    if (!sessionStorage) return;

    try {
      const serialized = JSON.stringify({ key, expiresAt, response });
      if (serialized.length > SESSION_CACHE_MAX_CHARS) return;
      sessionStorage.setItem(SESSION_CACHE_STORAGE_KEY, serialized);
    } catch {
      // Private browsing and full storage must not turn a successful API read into an error.
    }
  };

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

      let responseExpiresAt: number | null = null;
      const entry: { promise: Promise<TResponse>; expiresAt: number | null } = {
        promise: Promise.resolve().then(async () => {
          const persistentResponse = readPersistent(key);
          if (persistentResponse) {
            responseExpiresAt = persistentResponse.expiresAt;
            return persistentResponse.response;
          }

          const response = await load();
          responseExpiresAt = now() + ttlMs;
          writePersistent(key, response, responseExpiresAt);
          return response;
        }),
        expiresAt: null,
      };
      entries.set(key, entry);
      prune();
      void entry.promise.then(
        () => {
          if (entries.get(key) === entry) {
            entry.expiresAt = responseExpiresAt ?? now() + ttlMs;
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

const publishHistoryProgress = (
  key: string,
  progress: PortfolioHistoryProgress | null,
) => {
  if (progress) {
    historyProgressByKey.delete(key);
    historyProgressByKey.set(key, progress);
    while (historyProgressByKey.size > HISTORY_REQUEST_CACHE_MAX_ENTRIES) {
      const oldestKey = historyProgressByKey.keys().next().value;
      if (oldestKey === undefined) break;
      historyProgressByKey.delete(oldestKey);
    }
  } else {
    historyProgressByKey.delete(key);
  }
  historyProgressListeners.get(key)?.forEach((listener) => listener(progress));
};

const subscribeToHistoryProgress = (
  key: string,
  listener?: (progress: PortfolioHistoryProgress | null) => void,
) => {
  if (!listener) return () => undefined;
  const listeners = historyProgressListeners.get(key) ?? new Set();
  listeners.add(listener);
  historyProgressListeners.set(key, listeners);
  const current = historyProgressByKey.get(key);
  if (current) listener(current);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) historyProgressListeners.delete(key);
  };
};

const createProgressId = () => {
  if (typeof window !== "undefined" && typeof window.crypto?.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};

const startHistoryProgressStream = (key: string, progressId: string) => {
  const controller = new AbortController();
  historyProgressAbortControllers.add(controller);
  publishHistoryProgress(key, {
    completed: 0,
    total: 1,
    percentage: 0,
    phase: "Uruchamiam pobieranie historii",
    done: false,
  });

  void (async () => {
    try {
      const response = await fetch(
        `/api/portfolio-history/progress?id=${encodeURIComponent(progressId)}`,
        { cache: "no-store", credentials: "same-origin", signal: controller.signal },
      );
      if (!response.ok || !response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const data = frame.split("\n")
            .find((line) => line.startsWith("data:"))
            ?.slice(5)
            .trim();
          if (!data) continue;
          try {
            publishHistoryProgress(key, JSON.parse(data) as PortfolioHistoryProgress);
          } catch {
            // Ignore malformed progress events; the history response remains authoritative.
          }
        }
      }
    } catch {
      // Progress is auxiliary; do not fail or delay the actual chart request.
    }
  })().finally(() => historyProgressAbortControllers.delete(controller));

  return controller;
};

/** Used both for background prefetch and for the visible chart request. */
export const getPortfolioHistoryCached = (
  descriptor: PortfolioHistoryRequestDescriptor,
  onProgress?: (progress: PortfolioHistoryProgress | null) => void,
) => {
  const unsubscribe = subscribeToHistoryProgress(descriptor.key, onProgress);
  const response = portfolioHistoryRequestCache.getOrLoad(descriptor.key, async () => {
    const progressId = createProgressId();
    const progressController = startHistoryProgressStream(descriptor.key, progressId);
    try {
      const history = await fetchPortfolioHistory({ ...descriptor.payload, progressId });
      publishHistoryProgress(descriptor.key, {
        completed: 1,
        total: 1,
        percentage: 100,
        phase: "Wykres gotowy",
        done: true,
      });
      return history;
    } catch (error) {
      publishHistoryProgress(descriptor.key, null);
      throw error;
    } finally {
      progressController.abort();
      historyProgressAbortControllers.delete(progressController);
    }
  });
  return response.finally(unsubscribe);
};

export const clearPortfolioHistoryRequestCache = () => {
  portfolioHistoryRequestCache.clear();
  historyProgressAbortControllers.forEach((controller) => controller.abort());
  historyProgressAbortControllers.clear();
  historyProgressByKey.clear();
  historyProgressListeners.clear();
  const storage = getBrowserSessionStorage();
  try {
    storage?.removeItem(SESSION_CACHE_STORAGE_KEY);
  } catch {
    // Logout should not be blocked if browser storage is unavailable.
  }
};

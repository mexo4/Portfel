import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { buildAutomaticBondCouponAdjustments, normalizePortfolioState } from "@/lib/portfolio-state";
import { getCurrentAccountData } from "@/lib/server/auth";
import { buildAggregatePortfolioHistory, buildPortfolioHistory } from "@/lib/server/portfolio-history";
import {
  getCachedPortfolioHistoryResponse,
  setCachedPortfolioHistoryResponse,
} from "@/lib/server/portfolio-history-response-cache";
import {
  readStoredPortfolioHistory,
  storePortfolioHistory,
} from "@/lib/server/portfolio-history-store";
import { getSortedPortfolioRealizedAdjustments } from "@/lib/portfolio-state";
import { ensurePortfolioCoreModel } from "@/lib/operation-engine";
import { getAuthorizedPortfolioScopeIds } from "@/lib/portfolio-selection";
import { toCurrencyCode } from "@/lib/utils";
import type {
  PortfolioAccount,
  PortfolioAccountType,
  PortfolioBenchmarkDefinition,
  PortfolioHistoryScope,
  PortfolioOperation,
  PortfolioState,
  PortfolioHistoryResponse,
} from "@/types/portfolio";
import {
  failPortfolioHistoryProgress,
  finishPortfolioHistoryProgress,
  registerPortfolioHistoryProgress,
  reportPortfolioHistoryProgress,
} from "@/lib/server/portfolio-history-progress";

export const runtime = "nodejs";

const historyBuildsInFlight = new Map<string, Promise<PortfolioHistoryResponse>>();

const buildHistoryOnce = (
  key: string,
  build: () => Promise<PortfolioHistoryResponse>
) => {
  const active = historyBuildsInFlight.get(key);
  if (active) return active;
  const pending = Promise.resolve().then(build);
  historyBuildsInFlight.set(key, pending);
  void pending.finally(() => {
    if (historyBuildsInFlight.get(key) === pending) historyBuildsInFlight.delete(key);
  }).catch(() => undefined);
  return pending;
};

type HistoryCacheStatus = "hit" | "stored" | "miss" | "shared";

/**
 * Part of every cache key, in memory and in the database. Raise it whenever the
 * history calculation changes what it returns for the same input, so a result
 * computed by the old code is never served from either copy.
 *
 * 2: purchases imported from a broker without a lotId are no longer counted as
 *    new capital (net invested, P/L and the flow-neutral returns were wrong).
 */
const HISTORY_ENGINE_VERSION = "2";

/**
 * `key` identifies a calculation in memory; `storeKey` is the same identity
 * without the user, because the stored copy has its own user column.
 */
const historyBuildKeys = (userId: string, revision: number, input: unknown) => {
  const storeKey = `${HISTORY_ENGINE_VERSION}:${revision}:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;
  return { key: `${userId}:${storeKey}`, storeKey };
};

// Fields a quote refresh rewrites and the history calculation never reads. The
// browser rewrites `priceSource` to "AUTOMATIC" after its first quote refresh
// (the database copy has none), which gave every page load two different keys.
const HISTORY_IRRELEVANT_ASSET_FIELDS = [
  "priceSource",
  "latestPrice",
  "latestPriceDate",
  "latestPriceMarketTimestamp",
  "latestPriceFetchedAt",
  "previousClose",
  "lastUpdatedAt",
] as const;

const withoutHistoryIrrelevantFields = <T extends object>(asset: T): T => {
  const copy = { ...asset } as Record<string, unknown>;

  for (const field of HISTORY_IRRELEVANT_ASSET_FIELDS) {
    delete copy[field];
  }

  return copy as T;
};

const logHistoryStoreFailure = (error: unknown) => {
  console.warn(
    "[portfolio-history] stored history unavailable:",
    error instanceof Error ? error.message : "unknown error"
  );
};

const getOrBuildHistoryResponse = async (
  { userId, key, storeKey, forceRefresh }: {
    userId: string;
    key: string;
    storeKey: string;
    /** A manual refresh must not be answered from either copy. */
    forceRefresh: boolean;
  },
  build: () => Promise<PortfolioHistoryResponse>
) => {
  if (!forceRefresh) {
    const cached = getCachedPortfolioHistoryResponse(key);
    if (cached) return { response: cached, cacheStatus: "hit" as HistoryCacheStatus };
  }

  const alreadyBuilding = historyBuildsInFlight.has(key);
  let fromStore = false;
  const response = await buildHistoryOnce(key, async () => {
    if (!forceRefresh) {
      const cachedAfterRace = getCachedPortfolioHistoryResponse(key);
      if (cachedAfterRace) return cachedAfterRace;

      // The in-memory copy is gone after a restart or on another process; the
      // stored one is not. A broken database is just a miss.
      const stored = await readStoredPortfolioHistory(userId, storeKey).catch((error) => {
        logHistoryStoreFailure(error);
        return null;
      });
      if (stored) {
        fromStore = true;
        setCachedPortfolioHistoryResponse(key, stored);
        return stored;
      }
    }

    const built = await build();
    setCachedPortfolioHistoryResponse(key, built);
    void storePortfolioHistory(userId, storeKey, built).catch(logHistoryStoreFailure);
    return built;
  });
  const cacheStatus: HistoryCacheStatus = fromStore
    ? "stored"
    : alreadyBuilding
      ? "shared"
      : "miss";
  return { response, cacheStatus };
};

const currentHistoryDate = () => new Date().toISOString().slice(0, 10);

const respondWithTiming = (
  body: unknown,
  status: number,
  startedAt: number,
  authMs: number,
  buildMs: number,
  scopeCount: number,
  cacheStatus: HistoryCacheStatus = "miss"
) => {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set(
    "Server-Timing",
    `auth;dur=${authMs.toFixed(1)}, history;dur=${buildMs.toFixed(1)}, historycache;desc="${cacheStatus}", total;dur=${(performance.now() - startedAt).toFixed(1)}`
  );
  if (process.env.PORTFOLIO_HISTORY_DIAGNOSTICS === "true") {
    console.info("[portfolio-history] request", {
      status,
      scopeCount,
      authMs: Number(authMs.toFixed(1)),
      historyMs: Number(buildMs.toFixed(1)),
      historyCache: cacheStatus,
      totalMs: Number((performance.now() - startedAt).toFixed(1)),
    });
  }
  return response;
};

const mergeRealizedAdjustments = (
  ...groups: PortfolioState["realizedAdjustments"][]
) =>
  getSortedPortfolioRealizedAdjustments(
    Array.from(
      new Map(
        groups.flat().map((adjustment) => [adjustment.id, adjustment] as const)
      ).values()
    )
  );

export async function POST(request: Request) {
  const requestStartedAt = performance.now();
  let progressId: string | undefined;
  let progressBuildKey: string | undefined;
  const authStartedAt = requestStartedAt;
  // Historical series still need quote snapshots because they carry verified
  // listing metadata (provider, venue and quote currency). Issuer-country
  // enrichment is unrelated to history and can trigger public GLEIF lookups,
  // so keep that work out of this latency-critical request.
  const accountData = await getCurrentAccountData({
    enrichIssuerCountries: false,
  });
  const authMs = performance.now() - authStartedAt;

  if (!accountData) {
    return respondWithTiming({ error: "Brak autoryzacji." }, 401, requestStartedAt, authMs, 0, 0);
  }

  try {
    const payload = (await request.json()) as {
      assets?: PortfolioState["assets"];
      sales?: PortfolioState["sales"];
      realizedAdjustments?: PortfolioState["realizedAdjustments"];
      operations?: PortfolioOperation[];
      accounts?: PortfolioAccount[];
      accountType?: PortfolioAccountType;
      benchmarks?: PortfolioBenchmarkDefinition[];
      portfolioScopes?: PortfolioHistoryScope[];
      portfolioScopeIds?: string[];
      presentationCurrency?: string;
      progressId?: string;
      /** Set by an explicit "refresh data": build again instead of reusing a copy. */
      forceRefresh?: boolean;
    };
    progressId = typeof payload.progressId === "string" ? payload.progressId : undefined;
    const forceRefresh = payload.forceRefresh === true;
    const presentationCurrency = toCurrencyCode(payload.presentationCurrency, "PLN");
    const benchmarks = Array.isArray(payload.benchmarks) ? payload.benchmarks : [];
    const rawScopes = Array.isArray(payload.portfolioScopes) ? payload.portfolioScopes : [];

    if (Array.isArray(payload.portfolioScopeIds) || rawScopes.length > 0) {
      // Client-supplied histories are not trusted for aggregate requests. Only
      // use their IDs, intersected with the authenticated user's server book.
      const requestedIds = Array.isArray(payload.portfolioScopeIds)
        ? payload.portfolioScopeIds
        : rawScopes.flatMap((scope) => typeof scope?.portfolioId === "string" ? [scope.portfolioId] : []);
      const authorizedIds = getAuthorizedPortfolioScopeIds(
        requestedIds,
        accountData.portfolios.map(({ id }) => id)
      );
      if (!authorizedIds) {
        return NextResponse.json({ error: "Zakres zawiera portfel spoza konta użytkownika." }, { status: 403 });
      }
      const selectedIds = new Set(authorizedIds);
      const portfolioScopes = accountData.portfolios.flatMap((portfolio) => {
        if (!selectedIds.has(portfolio.id)) return [];
        const corePortfolio = ensurePortfolioCoreModel(portfolio);
        const state = normalizePortfolioState({
          assets: corePortfolio.assets,
          sales: corePortfolio.sales,
          realizedAdjustments: corePortfolio.realizedAdjustments,
        });
        return [{
          portfolioId: corePortfolio.id,
          portfolioName: corePortfolio.name,
          accountType: corePortfolio.accountType,
          assets: state.assets,
          sales: state.sales,
          realizedAdjustments: mergeRealizedAdjustments(
            state.realizedAdjustments,
            buildAutomaticBondCouponAdjustments(
              state.assets,
              state.sales,
              corePortfolio.accountType
            )
          ),
          operations: corePortfolio.operations ?? [],
          accounts: corePortfolio.accounts ?? [],
        }];
      });
      const historyStartedAt = performance.now();
      const { key: historyKey, storeKey } = historyBuildKeys(accountData.user.id, accountData.portfolioRevision, {
        ids: [...authorizedIds].sort(),
        benchmarks,
        presentationCurrency,
        historyDate: currentHistoryDate(),
      });
      progressBuildKey = historyKey;
      const progressEnabled = registerPortfolioHistoryProgress(
        progressId,
        accountData.user.id,
        historyKey,
        historyBuildsInFlight.has(historyKey),
      );
      const { response: history, cacheStatus } = await getOrBuildHistoryResponse(
        { userId: accountData.user.id, key: historyKey, storeKey, forceRefresh },
        () => buildAggregatePortfolioHistory({
          portfolioScopes,
          benchmarks,
          presentationCurrency,
          onProgress: progressEnabled
            ? (progress) => reportPortfolioHistoryProgress(historyKey, accountData.user.id, progress)
            : undefined,
        })
      );
      if (progressEnabled) finishPortfolioHistoryProgress(historyKey, accountData.user.id);
      return respondWithTiming(
        history,
        200,
        requestStartedAt,
        authMs,
        performance.now() - historyStartedAt,
        portfolioScopes.length,
        cacheStatus
      );
    }
    const portfolioState = normalizePortfolioState({
      assets: Array.isArray(payload.assets) ? payload.assets : [],
      sales: Array.isArray(payload.sales) ? payload.sales : [],
      realizedAdjustments: Array.isArray(payload.realizedAdjustments)
        ? payload.realizedAdjustments
        : [],
    });
    const effectiveRealizedAdjustments = mergeRealizedAdjustments(
      portfolioState.realizedAdjustments,
      buildAutomaticBondCouponAdjustments(
        portfolioState.assets,
        portfolioState.sales,
        payload.accountType
      )
    );
    const operations = Array.isArray(payload.operations) ? payload.operations : [];
    const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    const historyStartedAt = performance.now();
    const { key: historyKey, storeKey } = historyBuildKeys(accountData.user.id, accountData.portfolioRevision, {
      assets: portfolioState.assets.map(withoutHistoryIrrelevantFields),
      sales: portfolioState.sales,
      realizedAdjustments: effectiveRealizedAdjustments,
      operations,
      accounts,
      benchmarks,
      presentationCurrency,
      historyDate: currentHistoryDate(),
    });
    progressBuildKey = historyKey;
    const progressEnabled = registerPortfolioHistoryProgress(
      progressId,
      accountData.user.id,
      historyKey,
      historyBuildsInFlight.has(historyKey),
    );
    const { response: history, cacheStatus } = await getOrBuildHistoryResponse(
      { userId: accountData.user.id, key: historyKey, storeKey, forceRefresh },
      () => buildPortfolioHistory({
        assets: portfolioState.assets,
        sales: portfolioState.sales,
        realizedAdjustments: effectiveRealizedAdjustments,
        operations,
        accounts,
        benchmarks,
        presentationCurrency,
        // The application renders portfolio-level history only. Keep the
        // builder's richer series available to other callers, but do not
        // serialize unused per-asset daily data in this latency-sensitive API.
        includeAssetSeries: false,
        onProgress: progressEnabled
          ? (progress) => reportPortfolioHistoryProgress(historyKey, accountData.user.id, progress)
          : undefined,
      })
    );
    if (progressEnabled) finishPortfolioHistoryProgress(historyKey, accountData.user.id);

    return respondWithTiming(
      history,
      200,
      requestStartedAt,
      authMs,
      performance.now() - historyStartedAt,
      1,
      cacheStatus
    );
  } catch (error) {
    if (progressBuildKey && progressId) failPortfolioHistoryProgress(progressBuildKey, accountData.user.id);
    const message =
      error instanceof Error
        ? error.message
        : "Nie udało się zbudować historii portfela.";

    return respondWithTiming({ error: message }, 400, requestStartedAt, authMs, 0, 0);
  }
}

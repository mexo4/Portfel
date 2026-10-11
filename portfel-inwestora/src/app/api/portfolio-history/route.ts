import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { buildAutomaticBondCouponAdjustments, normalizePortfolioState } from "@/lib/portfolio-state";
import { getCurrentAccountData } from "@/lib/server/auth";
import { buildAggregatePortfolioHistory, buildPortfolioHistory } from "@/lib/server/portfolio-history";
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

const historyBuildKey = (userId: string, revision: number, input: unknown) =>
  `${userId}:${revision}:${createHash("sha256").update(JSON.stringify(input)).digest("hex")}`;

const respondWithTiming = (
  body: unknown,
  status: number,
  startedAt: number,
  authMs: number,
  buildMs: number,
  scopeCount: number
) => {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set(
    "Server-Timing",
    `auth;dur=${authMs.toFixed(1)}, history;dur=${buildMs.toFixed(1)}, total;dur=${(performance.now() - startedAt).toFixed(1)}`
  );
  if (process.env.PORTFOLIO_HISTORY_DIAGNOSTICS === "true") {
    console.info("[portfolio-history] request", {
      status,
      scopeCount,
      authMs: Number(authMs.toFixed(1)),
      historyMs: Number(buildMs.toFixed(1)),
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
  const authStartedAt = requestStartedAt;
  const accountData = await getCurrentAccountData();
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
    };
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
      const history = await buildHistoryOnce(
        historyBuildKey(accountData.user.id, accountData.portfolioRevision, { ids: authorizedIds, benchmarks, presentationCurrency }),
        () => buildAggregatePortfolioHistory({ portfolioScopes, benchmarks, presentationCurrency })
      );
      return respondWithTiming(history, 200, requestStartedAt, authMs, performance.now() - historyStartedAt, portfolioScopes.length);
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
    const history = await buildHistoryOnce(
      historyBuildKey(accountData.user.id, accountData.portfolioRevision, {
        assets: portfolioState.assets,
        sales: portfolioState.sales,
        realizedAdjustments: effectiveRealizedAdjustments,
        operations,
        accounts,
        benchmarks,
        presentationCurrency,
      }),
      () => buildPortfolioHistory({
        assets: portfolioState.assets,
        sales: portfolioState.sales,
        realizedAdjustments: effectiveRealizedAdjustments,
        operations,
        accounts,
        benchmarks,
        presentationCurrency,
      })
    );

    return respondWithTiming(history, 200, requestStartedAt, authMs, performance.now() - historyStartedAt, 1);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nie udalo sie zbudowac historii portfela.";

    return respondWithTiming({ error: message }, 400, requestStartedAt, authMs, 0, 0);
  }
}

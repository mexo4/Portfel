import { NextResponse } from "next/server";
import { buildAutomaticBondCouponAdjustments, normalizePortfolioState } from "@/lib/portfolio-state";
import { getCurrentAccountData } from "@/lib/server/auth";
import { buildAggregatePortfolioHistory, buildPortfolioHistory } from "@/lib/server/portfolio-history";
import { getSortedPortfolioRealizedAdjustments } from "@/lib/portfolio-state";
import { ensurePortfolioCoreModel } from "@/lib/operation-engine";
import { getAuthorizedPortfolioScopeIds } from "@/lib/portfolio-selection";
import type {
  PortfolioAccount,
  PortfolioAccountType,
  PortfolioBenchmarkDefinition,
  PortfolioHistoryScope,
  PortfolioOperation,
  PortfolioState,
} from "@/types/portfolio";

export const runtime = "nodejs";

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
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
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
    };
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
      return NextResponse.json(await buildAggregatePortfolioHistory({ portfolioScopes, benchmarks }));
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
    const history = await buildPortfolioHistory({
      assets: portfolioState.assets,
      sales: portfolioState.sales,
      realizedAdjustments: effectiveRealizedAdjustments,
      operations: Array.isArray(payload.operations) ? payload.operations : [],
      accounts: Array.isArray(payload.accounts) ? payload.accounts : [],
      benchmarks,
    });

    return NextResponse.json(history);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nie udalo sie zbudowac historii portfela.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

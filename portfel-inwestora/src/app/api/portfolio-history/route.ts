import { NextResponse } from "next/server";
import { buildAutomaticBondCouponAdjustments, normalizePortfolioState } from "@/lib/portfolio-state";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { buildAggregatePortfolioHistory, buildPortfolioHistory } from "@/lib/server/portfolio-history";
import { getSortedPortfolioRealizedAdjustments } from "@/lib/portfolio-state";
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
  const user = await getCurrentAuthenticatedUser();

  if (!user) {
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
    };
    const benchmarks = Array.isArray(payload.benchmarks) ? payload.benchmarks : [];
    const rawScopes = Array.isArray(payload.portfolioScopes) ? payload.portfolioScopes : [];

    if (rawScopes.length > 0) {
      const portfolioScopes = rawScopes.slice(0, 50).flatMap((scope) => {
        if (!scope || typeof scope.portfolioId !== "string" || !scope.portfolioId.trim()) {
          return [];
        }
        const state = normalizePortfolioState({
          assets: Array.isArray(scope.assets) ? scope.assets : [],
          sales: Array.isArray(scope.sales) ? scope.sales : [],
          realizedAdjustments: Array.isArray(scope.realizedAdjustments)
            ? scope.realizedAdjustments
            : [],
        });
        return [{
          portfolioId: scope.portfolioId,
          assets: state.assets,
          sales: state.sales,
          realizedAdjustments: mergeRealizedAdjustments(
            state.realizedAdjustments,
            buildAutomaticBondCouponAdjustments(
              state.assets,
              state.sales,
              scope.accountType
            )
          ),
          operations: Array.isArray(scope.operations) ? scope.operations : [],
          accounts: Array.isArray(scope.accounts) ? scope.accounts : [],
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

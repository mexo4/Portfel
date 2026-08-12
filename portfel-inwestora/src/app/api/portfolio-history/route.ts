import { NextResponse } from "next/server";
import { buildAutomaticBondCouponAdjustments, normalizePortfolioState } from "@/lib/portfolio-state";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { buildPortfolioHistory } from "@/lib/server/portfolio-history";
import { getSortedPortfolioRealizedAdjustments } from "@/lib/portfolio-state";
import type { PortfolioBenchmarkDefinition, PortfolioState } from "@/types/portfolio";

export const runtime = "nodejs";

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
      benchmarks?: PortfolioBenchmarkDefinition[];
    };
    const portfolioState = normalizePortfolioState({
      assets: Array.isArray(payload.assets) ? payload.assets : [],
      sales: Array.isArray(payload.sales) ? payload.sales : [],
      realizedAdjustments: Array.isArray(payload.realizedAdjustments)
        ? payload.realizedAdjustments
        : [],
    });
    const effectiveRealizedAdjustments = getSortedPortfolioRealizedAdjustments([
      ...portfolioState.realizedAdjustments,
      ...buildAutomaticBondCouponAdjustments(portfolioState.assets, portfolioState.sales),
    ]);
    const history = await buildPortfolioHistory({
      assets: portfolioState.assets,
      sales: portfolioState.sales,
      realizedAdjustments: effectiveRealizedAdjustments,
      benchmarks: Array.isArray(payload.benchmarks) ? payload.benchmarks : [],
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

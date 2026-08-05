import { NextResponse } from "next/server";
import {
  getCurrentAccountData,
  PortfolioRevisionConflictError,
  updateCurrentUserPortfolio,
} from "@/lib/server/auth";
import type { PortfolioBook, PortfolioState } from "@/types/portfolio";

export const runtime = "nodejs";

export async function GET() {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  return NextResponse.json({
    assets: accountData.assets,
    sales: accountData.sales,
    realizedAdjustments: accountData.realizedAdjustments,
    portfolios: accountData.portfolios,
    activePortfolioId: accountData.activePortfolioId,
    portfolioRevision: accountData.portfolioRevision,
  });
}

export async function PUT(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as {
      assets?: PortfolioState["assets"];
      sales?: PortfolioState["sales"];
      realizedAdjustments?: PortfolioState["realizedAdjustments"];
      portfolios?: PortfolioBook["portfolios"];
      activePortfolioId?: PortfolioBook["activePortfolioId"];
      portfolioRevision?: number;
    };

    const activePortfolioId = accountData.activePortfolioId;
    const activePortfolio =
      accountData.portfolios.find((portfolio) => portfolio.id === activePortfolioId) ??
      accountData.portfolios[0];
    const nextPortfolio: PortfolioBook = Array.isArray(payload.portfolios)
      ? {
          schemaVersion: 2,
          portfolios: payload.portfolios,
          activePortfolioId:
            typeof payload.activePortfolioId === "string"
              ? payload.activePortfolioId
              : payload.portfolios[0]?.id ?? "",
        }
      : {
          schemaVersion: 2,
          portfolios: accountData.portfolios.map((portfolio) =>
            portfolio.id === activePortfolio?.id
              ? {
                  ...portfolio,
                  assets: Array.isArray(payload.assets) ? payload.assets : portfolio.assets,
                  sales: Array.isArray(payload.sales) ? payload.sales : portfolio.sales,
                  realizedAdjustments: Array.isArray(payload.realizedAdjustments)
                    ? payload.realizedAdjustments
                    : portfolio.realizedAdjustments,
                  updatedAt: new Date().toISOString(),
                }
              : portfolio
          ),
          activePortfolioId,
        };

    const savedPortfolio = await updateCurrentUserPortfolio(
      accountData.user.id,
      nextPortfolio,
      payload.portfolioRevision ?? accountData.portfolioRevision
    );

    return NextResponse.json({
      saved: true,
      portfolios: savedPortfolio.portfolioBook.portfolios,
      activePortfolioId: savedPortfolio.portfolioBook.activePortfolioId,
      portfolioRevision: savedPortfolio.portfolioRevision,
    });
  } catch (error) {
    if (error instanceof PortfolioRevisionConflictError) {
      const latestAccountData = await getCurrentAccountData();

      return NextResponse.json(
        {
          error: error.message,
          code: "PORTFOLIO_CONFLICT",
          portfolios: latestAccountData?.portfolios ?? [],
          activePortfolioId: latestAccountData?.activePortfolioId ?? "",
          portfolioRevision:
            latestAccountData?.portfolioRevision ?? error.currentRevision,
        },
        { status: 409 }
      );
    }

    const message = error instanceof Error ? error.message : "Nie udalo sie zapisac portfela.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

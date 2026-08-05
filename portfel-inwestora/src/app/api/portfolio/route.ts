import { NextResponse } from "next/server";
import {
  getCurrentAccountData,
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
    };

    const nextPortfolio =
      Array.isArray(payload.portfolios)
        ? {
            portfolios: payload.portfolios,
            activePortfolioId:
              typeof payload.activePortfolioId === "string"
                ? payload.activePortfolioId
                : payload.portfolios[0]?.id ?? "",
          }
        : {
            assets: Array.isArray(payload.assets) ? payload.assets : [],
            sales: Array.isArray(payload.sales) ? payload.sales : [],
            realizedAdjustments: Array.isArray(payload.realizedAdjustments)
              ? payload.realizedAdjustments
              : [],
          };

    await updateCurrentUserPortfolio(accountData.user.id, nextPortfolio);

    return NextResponse.json({ saved: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udalo sie zapisac portfela.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

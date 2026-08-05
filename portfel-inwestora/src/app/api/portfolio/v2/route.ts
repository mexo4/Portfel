import { NextResponse } from "next/server";
import { FALLBACK_FX_RATES } from "@/lib/constants";
import { calculatePortfolioSnapshot } from "@/lib/portfolio-engine";
import {
  getCurrentAccountData,
  updateCurrentUserPortfolio,
} from "@/lib/server/auth";
import { normalizePortfolioBook } from "@/lib/portfolio-state";
import type { PortfolioBook } from "@/types/portfolio";

export const runtime = "nodejs";

export async function GET() {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const portfolioBook = normalizePortfolioBook({
    portfolios: accountData.portfolios,
    activePortfolioId: accountData.activePortfolioId,
  });
  const activePortfolio =
    portfolioBook.portfolios.find(
      (portfolio) => portfolio.id === portfolioBook.activePortfolioId
    ) ?? portfolioBook.portfolios[0];

  return NextResponse.json({
    schemaVersion: 2,
    portfolios: portfolioBook.portfolios,
    activePortfolioId: portfolioBook.activePortfolioId,
    portfolioRevision: accountData.portfolioRevision,
    activePortfolio,
    snapshot: calculatePortfolioSnapshot({
      portfolio: activePortfolio,
      fxRates: FALLBACK_FX_RATES,
    }),
  });
}

export async function PUT(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as Partial<PortfolioBook> & {
      portfolioRevision?: number;
    };
    const { portfolioRevision, ...portfolioPayload } = payload;
    const portfolioBook = normalizePortfolioBook(portfolioPayload);
    const updatedPortfolio = await updateCurrentUserPortfolio(
      accountData.user.id,
      portfolioBook,
      portfolioRevision ?? accountData.portfolioRevision
    );

    return NextResponse.json({
      schemaVersion: 2,
      ...updatedPortfolio.portfolioBook,
      portfolioRevision: updatedPortfolio.portfolioRevision,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie zapisac portfela V2.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

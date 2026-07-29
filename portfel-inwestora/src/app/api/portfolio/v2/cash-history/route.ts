import { NextResponse } from "next/server";
import { buildCashHistory } from "@/lib/cash-engine";
import { getCurrentAccountData } from "@/lib/server/auth";
import { normalizePortfolioBook } from "@/lib/portfolio-state";
import type { InvestmentPortfolio } from "@/types/portfolio";

export const runtime = "nodejs";

const getPortfolioById = (
  portfolios: InvestmentPortfolio[],
  portfolioId: string | undefined,
  activePortfolioId: string
) =>
  portfolios.find((portfolio) => portfolio.id === portfolioId) ??
  portfolios.find((portfolio) => portfolio.id === activePortfolioId) ??
  portfolios[0];

export async function GET(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const portfolioBook = normalizePortfolioBook({
    portfolios: accountData.portfolios,
    activePortfolioId: accountData.activePortfolioId,
  });
  const portfolio = getPortfolioById(
    portfolioBook.portfolios,
    searchParams.get("portfolioId") ?? undefined,
    portfolioBook.activePortfolioId
  );

  return NextResponse.json({
    portfolioId: portfolio.id,
    history: buildCashHistory(portfolio),
  });
}

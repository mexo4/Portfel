import { NextResponse } from "next/server";
import {
  normalizePortfolioOperation,
} from "@/lib/operation-engine";
import {
  getCurrentAccountData,
  updateCurrentUserPortfolio,
} from "@/lib/server/auth";
import { normalizePortfolioBook } from "@/lib/portfolio-state";
import type { PortfolioOperation } from "@/types/portfolio";

export const runtime = "nodejs";

const createOperationId = () =>
  `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getPortfolioByRequest = (
  portfolioId: string | null,
  portfolios: ReturnType<typeof normalizePortfolioBook>["portfolios"],
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
  const portfolio = getPortfolioByRequest(
    searchParams.get("portfolioId"),
    portfolioBook.portfolios,
    portfolioBook.activePortfolioId
  );

  return NextResponse.json({
    portfolioId: portfolio.id,
    operations: portfolio.operations ?? [],
  });
}

export async function POST(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as {
      portfolioId?: string;
      operation?: Partial<PortfolioOperation>;
    };
    const portfolioBook = normalizePortfolioBook({
      portfolios: accountData.portfolios,
      activePortfolioId: accountData.activePortfolioId,
    });
    const targetPortfolio = getPortfolioByRequest(
      payload.portfolioId ?? null,
      portfolioBook.portfolios,
      portfolioBook.activePortfolioId
    );
    const now = new Date().toISOString();
    const operation = normalizePortfolioOperation(
      targetPortfolio.id,
      {
        id: payload.operation?.id ?? createOperationId(),
        createdAt: now,
        updatedAt: now,
        date: now.slice(0, 10),
        notes: "",
        metadata: {},
        ...payload.operation,
      },
      targetPortfolio.accounts ?? [],
      targetPortfolio.instruments ?? [],
      now
    );

    if (!operation) {
      throw new Error("Operacja nie ma poprawnego identyfikatora.");
    }

    const updatedBook = {
      ...portfolioBook,
      portfolios: portfolioBook.portfolios.map((portfolio) =>
        portfolio.id === targetPortfolio.id
          ? {
              ...portfolio,
              operations: [...(portfolio.operations ?? []), operation],
              updatedAt: now,
            }
          : portfolio
      ),
    };
    const updatedPortfolio = await updateCurrentUserPortfolio(
      accountData.user.id,
      updatedBook
    );

    return NextResponse.json({
      operation,
      ...updatedPortfolio,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie zapisac operacji.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import {
  normalizePortfolioOperation,
} from "@/lib/operation-engine";
import {
  getCurrentAccountData,
  updateCurrentUserPortfolio,
} from "@/lib/server/auth";
import { normalizePortfolioBook } from "@/lib/portfolio-state";
import { isAccountOwnedByPortfolio, resolveRequestedPortfolio } from "@/lib/server/portfolio-request-scope";
import type { PortfolioOperation } from "@/types/portfolio";

export const runtime = "nodejs";

const createOperationId = () =>
  `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
  const portfolio = resolveRequestedPortfolio(
    portfolioBook.portfolios,
    searchParams.get("portfolioId"),
    portfolioBook.activePortfolioId
  );
  if (!portfolio) return NextResponse.json({ error: "Nie znaleziono wybranego portfela." }, { status: 404 });

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
    const targetPortfolio = resolveRequestedPortfolio(
      portfolioBook.portfolios,
      payload.portfolioId ?? null,
      portfolioBook.activePortfolioId
    );
    if (!targetPortfolio) throw new Error("Nie znaleziono wybranego portfela.");
    const requestedAccountId = payload.operation?.accountId;
    if (typeof requestedAccountId === "string" && !requestedAccountId.trim()) {
      throw new Error("Wybierz konto należące do wskazanego portfela.");
    }
    if (typeof requestedAccountId === "string" && requestedAccountId.trim()) {
      const account = targetPortfolio.accounts?.find((item) => item.id === requestedAccountId);
      if (!isAccountOwnedByPortfolio(account, targetPortfolio.id)) {
        throw new Error("Wybrane konto nie należy do wskazanego portfela.");
      }
    }
    const targetAccountId = payload.operation?.metadata?.targetAccountId;
    if (typeof targetAccountId === "string" && targetAccountId.trim()) {
      const account = targetPortfolio.accounts?.find((item) => item.id === targetAccountId);
      if (!isAccountOwnedByPortfolio(account, targetPortfolio.id)) {
        throw new Error("Konto docelowe nie należy do wskazanego portfela.");
      }
    }
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
      updatedBook,
      accountData.portfolioRevision
    );

    return NextResponse.json({
      operation,
      ...updatedPortfolio.portfolioBook,
      portfolioRevision: updatedPortfolio.portfolioRevision,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie zapisac operacji.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

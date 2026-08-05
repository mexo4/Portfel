import { NextResponse } from "next/server";
import {
  buildDividendOperation,
  getDefaultDividendAccount,
  getDefaultDividendInstrument,
  getPortfolioDividends,
  isDividendOperation,
} from "@/lib/dividend-engine";
import { FALLBACK_FX_RATES } from "@/lib/constants";
import {
  getCurrentAccountData,
  updateCurrentUserPortfolio,
} from "@/lib/server/auth";
import { normalizePortfolioBook } from "@/lib/portfolio-state";
import type { InvestmentPortfolio } from "@/types/portfolio";

export const runtime = "nodejs";

type DividendRouteProps = {
  params: Promise<{
    dividendId: string;
  }>;
};

const getPortfolioById = (
  portfolios: InvestmentPortfolio[],
  portfolioId: string | undefined,
  activePortfolioId: string
) =>
  portfolios.find((portfolio) => portfolio.id === portfolioId) ??
  portfolios.find((portfolio) => portfolio.id === activePortfolioId) ??
  portfolios[0];

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toStringValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;

export async function PUT(request: Request, { params }: DividendRouteProps) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const { dividendId } = await params;
    const payload = (await request.json()) as Record<string, unknown>;
    const portfolioBook = normalizePortfolioBook({
      portfolios: accountData.portfolios,
      activePortfolioId: accountData.activePortfolioId,
    });
    const portfolio = getPortfolioById(
      portfolioBook.portfolios,
      toStringValue(payload.portfolioId) || undefined,
      portfolioBook.activePortfolioId
    );
    const existingOperation = (portfolio.operations ?? []).find(
      (operation) => operation.id === dividendId && isDividendOperation(operation)
    );

    if (!existingOperation) {
      throw new Error("Nie znaleziono dywidendy.");
    }

    const instrument =
      portfolio.instruments?.find(
        (item) => item.id === toStringValue(payload.instrumentId)
      ) ??
      portfolio.instruments?.find((item) => item.id === existingOperation.assetId) ??
      getDefaultDividendInstrument(portfolio);
    const account =
      portfolio.accounts?.find((item) => item.id === toStringValue(payload.accountId)) ??
      portfolio.accounts?.find((item) => item.id === existingOperation.accountId) ??
      getDefaultDividendAccount(portfolio.accounts);

    if (!instrument || !account) {
      throw new Error("Brakuje instrumentu albo konta inwestycyjnego dla dywidendy.");
    }

    const operation = buildDividendOperation({
      id: existingOperation.id,
      portfolioId: portfolio.id,
      accountId: account.id,
      instrumentId: instrument.id,
      quantity: toNumber(payload.quantity, existingOperation.quantity ?? 0),
      dividendPerShare: toNumber(payload.dividendPerShare, existingOperation.price ?? 0),
      currency: toStringValue(payload.currency, existingOperation.currency),
      exchangeRate:
        payload.exchangeRate === null || payload.exchangeRate === ""
          ? null
          : toNumber(payload.exchangeRate, existingOperation.exchangeRate ?? 1),
      withholdingTax: toNumber(
        payload.withholdingTax,
        typeof existingOperation.metadata.withholdingTax === "number"
          ? existingOperation.metadata.withholdingTax
          : 0
      ),
      domesticTax: toNumber(
        payload.domesticTax,
        typeof existingOperation.metadata.domesticTax === "number"
          ? existingOperation.metadata.domesticTax
          : 0
      ),
      exDividendDate: toStringValue(
        payload.exDividendDate,
        typeof existingOperation.metadata.exDividendDate === "string"
          ? existingOperation.metadata.exDividendDate
          : existingOperation.date
      ),
      recordDate: toStringValue(
        payload.recordDate,
        typeof existingOperation.metadata.recordDate === "string"
          ? existingOperation.metadata.recordDate
          : existingOperation.date
      ),
      paymentDate: toStringValue(payload.paymentDate, existingOperation.date),
      country: toStringValue(
        payload.country,
        typeof existingOperation.metadata.country === "string"
          ? existingOperation.metadata.country
          : "Nie ustawiono"
      ),
      notes: toStringValue(payload.notes, existingOperation.notes),
      createdAt: existingOperation.createdAt,
    });
    const nextOperation = {
      ...operation,
      updatedAt: new Date().toISOString(),
    };
    const nextBook = {
      ...portfolioBook,
      portfolios: portfolioBook.portfolios.map((item) =>
        item.id === portfolio.id
          ? {
              ...item,
              operations: (item.operations ?? []).map((candidate) =>
                candidate.id === dividendId ? nextOperation : candidate
              ),
              updatedAt: new Date().toISOString(),
            }
          : item
      ),
    };
    const updatedPortfolioResult = await updateCurrentUserPortfolio(
      accountData.user.id,
      nextBook,
      accountData.portfolioRevision
    );
    const updatedBook = updatedPortfolioResult.portfolioBook;
    const updatedPortfolio = getPortfolioById(
      updatedBook.portfolios,
      portfolio.id,
      updatedBook.activePortfolioId
    );

    return NextResponse.json({
      dividend: getPortfolioDividends(updatedPortfolio, FALLBACK_FX_RATES).find(
        (dividend) => dividend.operationId === dividendId
      ),
      portfolios: updatedBook.portfolios,
      activePortfolioId: updatedBook.activePortfolioId,
      portfolioRevision: updatedPortfolioResult.portfolioRevision,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie zaktualizowac dywidendy.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: DividendRouteProps) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const { dividendId } = await params;
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

    if (
      !(portfolio.operations ?? []).some(
        (operation) => operation.id === dividendId && isDividendOperation(operation)
      )
    ) {
      throw new Error("Nie znaleziono dywidendy.");
    }

    const nextBook = {
      ...portfolioBook,
      portfolios: portfolioBook.portfolios.map((item) =>
        item.id === portfolio.id
          ? {
              ...item,
              operations: (item.operations ?? []).filter(
                (operation) => operation.id !== dividendId
              ),
              updatedAt: new Date().toISOString(),
            }
          : item
      ),
    };
    const updatedPortfolioResult = await updateCurrentUserPortfolio(
      accountData.user.id,
      nextBook,
      accountData.portfolioRevision
    );
    const updatedBook = updatedPortfolioResult.portfolioBook;

    return NextResponse.json({
      success: true,
      portfolios: updatedBook.portfolios,
      activePortfolioId: updatedBook.activePortfolioId,
      portfolioRevision: updatedPortfolioResult.portfolioRevision,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie usunac dywidendy.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

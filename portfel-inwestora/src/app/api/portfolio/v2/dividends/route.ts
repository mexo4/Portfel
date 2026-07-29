import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  buildDividendOperation,
  getDefaultDividendAccount,
  getDefaultDividendInstrument,
  getPortfolioDividends,
} from "@/lib/dividend-engine";
import { FALLBACK_FX_RATES } from "@/lib/constants";
import {
  getCurrentAccountData,
  updateCurrentUserPortfolio,
} from "@/lib/server/auth";
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

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toStringValue = (value: unknown, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;

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
    dividends: getPortfolioDividends(portfolio, FALLBACK_FX_RATES),
  });
}

export async function POST(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
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
    const instrument =
      portfolio.instruments?.find(
        (item) => item.id === toStringValue(payload.instrumentId)
      ) ?? getDefaultDividendInstrument(portfolio);
    const account =
      portfolio.accounts?.find((item) => item.id === toStringValue(payload.accountId)) ??
      getDefaultDividendAccount(portfolio.accounts);

    if (!instrument || !account) {
      throw new Error("Brakuje instrumentu albo konta inwestycyjnego dla dywidendy.");
    }

    const operation = buildDividendOperation({
      id: `dividend-${randomUUID()}`,
      portfolioId: portfolio.id,
      accountId: account.id,
      instrumentId: instrument.id,
      quantity: toNumber(payload.quantity),
      dividendPerShare: toNumber(payload.dividendPerShare),
      currency: toStringValue(payload.currency, instrument.marketCurrency),
      exchangeRate:
        payload.exchangeRate === null || payload.exchangeRate === ""
          ? null
          : toNumber(payload.exchangeRate, instrument.marketCurrency === "PLN" ? 1 : 0) || null,
      withholdingTax: toNumber(payload.withholdingTax),
      domesticTax: toNumber(payload.domesticTax),
      exDividendDate: toStringValue(payload.exDividendDate),
      recordDate: toStringValue(payload.recordDate),
      paymentDate: toStringValue(payload.paymentDate),
      country: toStringValue(payload.country, "Nie ustawiono"),
      notes: toStringValue(payload.notes),
    });

    if (!operation.quantity || operation.quantity <= 0 || !operation.price || operation.price <= 0) {
      throw new Error("Podaj poprawna ilosc akcji i dywidende na akcje.");
    }

    const nextBook = {
      ...portfolioBook,
      portfolios: portfolioBook.portfolios.map((item) =>
        item.id === portfolio.id
          ? {
              ...item,
              operations: [...(item.operations ?? []), operation],
              updatedAt: new Date().toISOString(),
            }
          : item
      ),
    };
    const updatedBook = await updateCurrentUserPortfolio(accountData.user.id, nextBook);
    const updatedPortfolio = getPortfolioById(
      updatedBook.portfolios,
      portfolio.id,
      updatedBook.activePortfolioId
    );

    return NextResponse.json({
      dividend: getPortfolioDividends(updatedPortfolio, FALLBACK_FX_RATES).find(
        (dividend) => dividend.operationId === operation.id
      ),
      portfolios: updatedBook.portfolios,
      activePortfolioId: updatedBook.activePortfolioId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie zapisac dywidendy.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

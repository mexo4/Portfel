import { NextResponse } from "next/server";
import { FALLBACK_FX_RATES } from "@/lib/constants";
import { getPortfolioDividends } from "@/lib/dividend-engine";
import { normalizePortfolioBook } from "@/lib/portfolio-state";
import { getCurrentAccountData } from "@/lib/server/auth";
import { fetchHistoricalFxPoints } from "@/lib/server/portfolio-history";
import { buildPit38Report, collectPit38RateNeeds, createRateBefore } from "@/lib/tax-pit38";
import type { CurrencyCode, PortfolioDividend } from "@/types/portfolio";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

const shiftDate = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/**
 * PIT-38 helper summary for one tax year. The portfolios are read from the account on the server,
 * never taken from the request; the request only names the year and, optionally, which of the
 * account's portfolios to include.
 */
export async function GET(request: Request) {
  const accountData = await getCurrentAccountData();
  if (!accountData) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401, headers: NO_STORE });

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2000 || year > currentYear) {
    return NextResponse.json({ error: "Podaj rok podatkowy od 2000 do bieżącego." }, { status: 400, headers: NO_STORE });
  }

  const book = normalizePortfolioBook({ portfolios: accountData.portfolios, activePortfolioId: accountData.activePortfolioId });
  const requestedIds = (searchParams.get("portfolioIds") ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const portfolios = requestedIds.length > 0 ? book.portfolios.filter((portfolio) => requestedIds.includes(portfolio.id)) : book.portfolios;
  if (portfolios.length === 0) {
    return NextResponse.json({ error: "Nie znaleziono wybranych portfeli." }, { status: 404, headers: NO_STORE });
  }

  try {
    const dividendsByPortfolio = new Map<string, PortfolioDividend[]>(
      portfolios.map((portfolio) => [portfolio.id, getPortfolioDividends(portfolio, FALLBACK_FX_RATES)])
    );
    const needs = collectPit38RateNeeds(portfolios, dividendsByPortfolio, year);
    // One range request per currency: from two weeks before the first date (to reach the business
    // day before it over a long holiday) to the last date.
    const pointsByCurrency = new Map<CurrencyCode, Array<{ date: string; rate: number }>>(
      await Promise.all(
        [...needs.entries()].map(async ([currency, dates]) => {
          const sorted = [...dates].sort();
          const points = await fetchHistoricalFxPoints(currency, shiftDate(sorted[0], -14), sorted[sorted.length - 1]);
          return [currency, points.filter((point) => point.rate > 0)] as const;
        })
      )
    );
    const report = buildPit38Report({ portfolios, dividendsByPortfolio, year, rateBefore: createRateBefore(pointsByCurrency) });

    return NextResponse.json({ report }, { headers: NO_STORE });
  } catch (error) {
    console.error("[tax-pit38] Nie udało się przygotować zestawienia.", { message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Nie udało się przygotować zestawienia podatkowego. Spróbuj ponownie." }, { status: 502, headers: NO_STORE });
  }
}

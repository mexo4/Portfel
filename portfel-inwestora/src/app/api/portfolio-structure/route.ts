import { NextResponse } from "next/server";
import { getCurrentAccountData } from "@/lib/server/auth";
import { buildStructureForPortfolios } from "@/lib/server/portfolio-structure";
import { getAuthorizedPortfolioScopeIds } from "@/lib/portfolio-selection";
import { toCurrencyCode } from "@/lib/utils";
import type { PortfolioStructureResponse } from "@/lib/portfolio-structure";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHED = 40;
const cache = new Map<string, { expiresAt: number; result: Promise<PortfolioStructureResponse> }>();

/**
 * The structure of the signed-in user's own portfolios over time. Only portfolio ids come from the
 * browser; the data is the account's saved book. The same cached market history as the portfolio
 * charts is used, so a portfolio already charted costs no new provider calls.
 */
export async function POST(request: Request) {
  const accountData = await getCurrentAccountData({ enrichIssuerCountries: false });
  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401, headers: NO_STORE });
  }

  let body: { portfolioScopeIds?: unknown; presentationCurrency?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe zapytanie." }, { status: 400, headers: NO_STORE });
  }

  const requestedIds = Array.isArray(body.portfolioScopeIds) ? body.portfolioScopeIds.filter((id): id is string => typeof id === "string") : [];
  const authorizedIds = getAuthorizedPortfolioScopeIds(requestedIds, accountData.portfolios.map(({ id }) => id));
  if (!authorizedIds) {
    return NextResponse.json({ error: "Zakres zawiera portfel spoza konta użytkownika." }, { status: 403, headers: NO_STORE });
  }
  const currency = toCurrencyCode(typeof body.presentationCurrency === "string" ? body.presentationCurrency : "PLN", "PLN");
  const selected = new Set(authorizedIds);
  const portfolios = accountData.portfolios.filter((portfolio) => selected.has(portfolio.id));

  const now = Date.now();
  const key = [accountData.user.id, accountData.portfolioRevision, [...authorizedIds].sort().join(","), currency, new Date(now).toISOString().slice(0, 10)].join("|");
  let entry = cache.get(key);
  if (!entry || entry.expiresAt <= now) {
    entry = { expiresAt: now + CACHE_TTL_MS, result: buildStructureForPortfolios(portfolios, currency) };
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
    entry.result.catch(() => cache.delete(key));
  }

  try {
    return NextResponse.json(await entry.result, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "Nie udało się policzyć struktury portfela." }, { status: 502, headers: NO_STORE });
  }
}

import { NextResponse } from "next/server";
import { getAuthorizedDashboardScope } from "@/lib/dashboard-scope-auth";
import { getCurrentAccountData } from "@/lib/server/auth";
import { getUserDashboardLayouts, saveUserDashboardLayouts } from "@/lib/server/dashboard-layout";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const account = await getCurrentAccountData();
  if (!account) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const scopeKey = getAuthorizedDashboardScope(request, new Set(account.portfolios.map((item) => item.id)));
  if (!scopeKey) return NextResponse.json({ error: "Nieprawidłowy zakres pulpitu." }, { status: 403 });

  return NextResponse.json(await getUserDashboardLayouts(account.user.id, scopeKey));
}

export async function PUT(request: Request) {
  const account = await getCurrentAccountData();
  if (!account) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const scopeKey = getAuthorizedDashboardScope(request, new Set(account.portfolios.map((item) => item.id)));
  if (!scopeKey) return NextResponse.json({ error: "Nieprawidłowy zakres pulpitu." }, { status: 403 });

  try {
    const payload = (await request.json()) as { layouts?: unknown };
    if (!("layouts" in payload)) {
      return NextResponse.json({ error: "Brakuje konfiguracji pulpitu." }, { status: 400 });
    }
    return NextResponse.json(await saveUserDashboardLayouts(account.user.id, scopeKey, payload.layouts));
  } catch {
    return NextResponse.json({ error: "Nie udało się zapisać układu pulpitu." }, { status: 400 });
  }
}

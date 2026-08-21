import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { getUserPerformancePreferences, saveUserPerformancePreferences } from "@/lib/server/performance-preferences";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  return NextResponse.json(await getUserPerformancePreferences(user.id));
}

export async function PUT(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  try {
    const payload = (await request.json()) as { visibleMetrics?: unknown };
    if (!("visibleMetrics" in payload)) {
      return NextResponse.json({ error: "Brakuje konfiguracji wyników." }, { status: 400 });
    }
    return NextResponse.json(await saveUserPerformancePreferences(user.id, payload.visibleMetrics));
  } catch {
    return NextResponse.json({ error: "Nie udało się zapisać konfiguracji wyników." }, { status: 400 });
  }
}

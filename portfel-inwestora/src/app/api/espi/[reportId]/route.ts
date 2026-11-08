import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { canAccessFeature } from "@/lib/entitlements";
import { getEspiReport } from "@/lib/server/espi";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reportId: string }> }
) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  if (!canAccessFeature(user, "espi")) {
    return NextResponse.json({ error: "Brak dostępu do modułu ESPI." }, { status: 403 });
  }

  try {
    const { reportId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(reportId)) {
      return NextResponse.json({ error: "Nieprawidłowy identyfikator raportu." }, { status: 400 });
    }
    const report = await getEspiReport({ userId: user.id, reportId });
    return report
      ? NextResponse.json({ report })
      : NextResponse.json({ error: "Nie znaleziono raportu ESPI." }, { status: 404 });
  } catch (error) {
    console.error("GET /api/espi/[reportId] failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Nie udało się odczytać raportu ESPI." }, { status: 500 });
  }
}


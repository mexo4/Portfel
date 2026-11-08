import { after, NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { canAccessFeature } from "@/lib/entitlements";
import { hasAdminRole } from "@/lib/server/access";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";
import {
  getEspiFeed,
  getEspiSyncState,
  synchronizePapEspi,
  validateEspiFeedFilters,
} from "@/lib/server/espi";

export const runtime = "nodejs";

const unavailable = () => NextResponse.json({ error: "Brak dostępu do modułu ESPI." }, { status: 403 });

export async function GET(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  if (!canAccessFeature(user, "espi")) return unavailable();

  try {
    const filters = validateEspiFeedFilters(new URL(request.url).searchParams);
    const sync = await getEspiSyncState();
    if (sync.status === "NOT_SYNCED") {
      await synchronizePapEspi({ backfillPages: 2 });
    } else if (sync.isStale && !sync.isRefreshing) {
      // Existing records are returned immediately. Next.js keeps this task
      // alive after the response, which gives Netlify a true stale-while-
      // revalidate path without one external request per user.
      after(async () => {
        await synchronizePapEspi();
      });
    }
    return NextResponse.json(await getEspiFeed({ userId: user.id, filters }));
  } catch (error) {
    console.error("GET /api/espi failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Nie udało się odczytać raportów ESPI." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  if (!hasAdminRole(user)) {
    return NextResponse.json({ error: "Synchronizację ESPI może uruchomić wyłącznie administrator." }, { status: 403 });
  }
  const limited = await applyAuthRateLimit(request, "espiSync", user.id);
  if (limited) return limited;

  try {
    const payload = await request.json().catch(() => ({})) as { backfillPages?: unknown; backfillFrom?: unknown };
    const backfillPages = typeof payload.backfillPages === "number"
      ? Math.min(Math.max(Math.trunc(payload.backfillPages), 0), 4)
      : 1;
    const backfillFrom = typeof payload.backfillFrom === "string" && /^20\d{2}-\d{2}-\d{2}$/.test(payload.backfillFrom)
      ? payload.backfillFrom
      : undefined;
    return NextResponse.json(await synchronizePapEspi({ force: true, backfillPages, backfillFrom }));
  } catch (error) {
    console.error("POST /api/espi failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Nie udało się odświeżyć raportów ESPI." }, { status: 500 });
  }
}

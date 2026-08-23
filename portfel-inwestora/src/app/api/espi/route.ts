import { after, NextResponse } from "next/server";
import { MEXO_TESTER_MODE } from "@/lib/constants";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import {
  getEspiFeed,
  getEspiSyncState,
  synchronizePapEspi,
  validateEspiFeedFilters,
} from "@/lib/server/espi";

export const runtime = "nodejs";

const unavailable = () => NextResponse.json({ error: "Moduł ESPI jest dostępny w trybie Tester." }, { status: 404 });

export async function GET(request: Request) {
  if (!MEXO_TESTER_MODE) return unavailable();
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

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
  if (!MEXO_TESTER_MODE) return unavailable();
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  try {
    const payload = await request.json().catch(() => ({})) as { backfillPages?: unknown };
    const backfillPages = typeof payload.backfillPages === "number"
      ? Math.min(Math.max(Math.trunc(payload.backfillPages), 0), 4)
      : 1;
    return NextResponse.json(await synchronizePapEspi({ force: true, backfillPages }));
  } catch (error) {
    console.error("POST /api/espi failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Nie udało się odświeżyć raportów ESPI." }, { status: 500 });
  }
}


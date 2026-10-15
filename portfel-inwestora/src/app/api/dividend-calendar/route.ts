import { after, NextResponse } from "next/server";
import type { DividendCalendarResponse, DividendCalendarScope } from "@/lib/corporate-events";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import {
  getGlobalDividends,
  getGlobalDividendSourceState,
  synchronizeGlobalDividends,
} from "@/lib/server/corporate-events";
import { getUserTrackedGpwInstruments } from "@/lib/server/espi";

export const runtime = "nodejs";

const getWarsawDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

const addCalendarMonths = (date: string, months: number) => {
  const [year, month, day] = date.split("-").map(Number);
  const targetMonth = month - 1 + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
};

const getScope = (value: string | null): DividendCalendarScope =>
  value === "watchlist" || value === "portfolio" ? value : "all";

const PROJECTION_CHECK_COOLDOWN_MS = 60_000;
let dividendProjectionInFlight = false;
let dividendProjectionPending = false;
let lastDividendProjectionCheckAt = 0;

export async function GET(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const scope = getScope(searchParams.get("scope"));
  const today = getWarsawDate();

  try {
    const initialState = await getGlobalDividendSourceState();
    const shouldRefreshSource = initialState.isStale && !initialState.isRefreshing;
    const projectionCheckDue = Date.now() - lastDividendProjectionCheckAt >= PROJECTION_CHECK_COOLDOWN_MS;
    const shouldStartSync = !dividendProjectionInFlight && (
      shouldRefreshSource || dividendProjectionPending || projectionCheckDue
    );

    if (shouldStartSync) {
      dividendProjectionInFlight = true;
      lastDividendProjectionCheckAt = Date.now();
      after(async () => {
        try {
          let projection = await synchronizeGlobalDividends({ refreshSource: shouldRefreshSource });
          for (let batch = 0; batch < 9 && projection.pending > 0; batch += 1) {
            projection = await synchronizeGlobalDividends({ refreshSource: false });
          }
          dividendProjectionPending = projection.pending > 0;
        } catch (error) {
          dividendProjectionPending = false;
          console.error("Dividend calendar background synchronization failed", {
            error: error instanceof Error ? error.name : "unknown",
          });
        } finally {
          dividendProjectionInFlight = false;
        }
      });
    }

    const tracked = scope === "all" ? [] : await getUserTrackedGpwInstruments(user.id);
    const canonicalKeys = scope === "all"
      ? undefined
      : tracked
          .filter((instrument) => scope === "watchlist" ? instrument.watched : instrument.held)
          .map((instrument) => instrument.canonicalKey);
    const response: DividendCalendarResponse = {
      events: await getGlobalDividends({
        fromDate: today,
        toDate: addCalendarMonths(today, 12),
        canonicalKeys,
      }),
      scope,
      sourceState: {
        status: initialState.status,
        lastCheckedAt: initialState.lastCheckedAt,
        lastSuccessfulSyncAt: initialState.lastSuccessAt,
        isRefreshing: initialState.isRefreshing || shouldRefreshSource || dividendProjectionInFlight,
        isStale: initialState.isStale,
        projectionPending: 0,
      },
    };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("GET /api/dividend-calendar failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Nie udało się odczytać kalendarza dywidend." }, { status: 500 });
  }
}

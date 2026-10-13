import { after, NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import {
  getGlobalGeneralMeetings,
  getGlobalGeneralMeetingSourceState,
  synchronizeGlobalGeneralMeetings,
} from "@/lib/server/corporate-events";
import { getUserTrackedGpwInstruments } from "@/lib/server/espi";
import type { GeneralMeetingScope, GeneralMeetingsResponse } from "@/lib/corporate-events";

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

const getScope = (value: string | null): GeneralMeetingScope =>
  value === "watchlist" || value === "portfolio" ? value : "all";

export async function GET(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const scope = getScope(searchParams.get("scope"));
  const today = getWarsawDate();

  try {
    const initialState = await getGlobalGeneralMeetingSourceState();
    const projection = await synchronizeGlobalGeneralMeetings({ refreshSource: false });
    const shouldRefreshSource = initialState.isStale && !initialState.isRefreshing;
    if (shouldRefreshSource) {
      after(async () => {
        await synchronizeGlobalGeneralMeetings();
      });
    } else if (projection.pending > 0) {
      // Keep projection backfills moving in bounded batches after responding.
      // The client polls while this state is true, so there is no unbounded
      // background loop on serverless-compatible runtimes.
      after(async () => {
        await synchronizeGlobalGeneralMeetings({ refreshSource: false });
      });
    }
    const tracked = scope === "all" ? [] : await getUserTrackedGpwInstruments(user.id);
    const canonicalKeys = scope === "all"
      ? undefined
      : tracked
          .filter((instrument) => scope === "watchlist" ? instrument.watched : instrument.held)
          .map((instrument) => instrument.canonicalKey);
    const state = await getGlobalGeneralMeetingSourceState();
    const response: GeneralMeetingsResponse = {
      events: await getGlobalGeneralMeetings({
        fromDate: today,
        // WZA is a market-wide calendar: it always shows the next twelve
        // calendar months, rather than a caller-controlled 30/60/90-day slice.
        toDate: addCalendarMonths(today, 12),
        canonicalKeys,
      }),
      scope,
      sourceState: {
        status: state.status,
        lastCheckedAt: state.lastCheckedAt,
        lastSuccessfulSyncAt: state.lastSuccessAt,
        isRefreshing: state.isRefreshing || shouldRefreshSource || projection.pending > 0,
        isStale: state.isStale || projection.pending > 0,
        projectionPending: projection.pending,
      },
    };
    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("GET /api/general-meetings failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Nie udało się odczytać walnych zgromadzeń." }, { status: 500 });
  }
}

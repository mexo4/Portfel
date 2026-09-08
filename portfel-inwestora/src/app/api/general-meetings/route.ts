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

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const getScope = (value: string | null): GeneralMeetingScope =>
  value === "watchlist" || value === "portfolio" ? value : "all";

const getDays = (value: string | null) => {
  const parsed = Number(value ?? 365);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 730) : 365;
};

export async function GET(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const scope = getScope(searchParams.get("scope"));
  const today = getWarsawDate();

  try {
    const initialState = await getGlobalGeneralMeetingSourceState();
    await synchronizeGlobalGeneralMeetings({ refreshSource: false });
    if (initialState.isStale && !initialState.isRefreshing) {
      after(async () => {
        await synchronizeGlobalGeneralMeetings();
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
        toDate: addDays(today, getDays(searchParams.get("days"))),
        canonicalKeys,
      }),
      scope,
      sourceState: {
        status: state.status,
        lastCheckedAt: state.lastCheckedAt,
        isRefreshing: state.isRefreshing,
      },
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("GET /api/general-meetings failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Nie udało się odczytać walnych zgromadzeń." }, { status: 500 });
  }
}

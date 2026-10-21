import { after, NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import {
  getGlobalGeneralMeetings,
  getGlobalGeneralMeetingSourceState,
  synchronizeGlobalGeneralMeetings,
} from "@/lib/server/corporate-events";
import { getUserTrackedGpwInstruments } from "@/lib/server/espi";
import {
  GENERAL_MEETING_WINDOW_DAYS,
  isCalendarWindowDays,
  addCalendarDays,
  getWarsawDate,
  type GeneralMeetingScope,
  type GeneralMeetingsResponse,
} from "@/lib/corporate-events";

export const runtime = "nodejs";

const getScope = (value: string | null): GeneralMeetingScope =>
  value === "watchlist" || value === "portfolio" ? value : "all";

const PROJECTION_CHECK_COOLDOWN_MS = 60_000;
let globalMeetingProjectionInFlight = false;
let globalMeetingProjectionPending = false;
let lastGlobalMeetingProjectionCheckAt = 0;

export async function GET(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const scope = getScope(searchParams.get("scope"));
  const requestedDays = Number(searchParams.get("days") ?? GENERAL_MEETING_WINDOW_DAYS);
  if (!isCalendarWindowDays(requestedDays)) {
    return NextResponse.json({ error: "Nieprawidłowy zakres kalendarza." }, { status: 400 });
  }
  const today = getWarsawDate();

  try {
    const initialState = await getGlobalGeneralMeetingSourceState();
    const shouldRefreshSource = initialState.isStale && !initialState.isRefreshing;
    const projectionCheckDue = Date.now() - lastGlobalMeetingProjectionCheckAt >= PROJECTION_CHECK_COOLDOWN_MS;
    const shouldStartSync = !globalMeetingProjectionInFlight && (
      shouldRefreshSource || globalMeetingProjectionPending || projectionCheckDue
    );
    if (shouldStartSync) {
      globalMeetingProjectionInFlight = true;
      lastGlobalMeetingProjectionCheckAt = Date.now();
      // Never make the calendar's first response wait for projection of up to
      // 100 ESPI reports. Existing WZA records can be rendered immediately;
      // the source refresh and bounded projection batches continue after the
      // response, while the client polls this endpoint for newly saved rows.
      after(async () => {
        try {
          let projection = await synchronizeGlobalGeneralMeetings({
            refreshSource: shouldRefreshSource,
          });
          // Complete a reasonable backlog in the background without turning a
          // user-facing GET into a long-running request. If more remains, the
          // next calendar poll starts another bounded batch.
          for (let batch = 0; batch < 9 && projection.pending > 0; batch += 1) {
            projection = await synchronizeGlobalGeneralMeetings({ refreshSource: false });
          }
          globalMeetingProjectionPending = projection.pending > 0;
        } catch (error) {
          globalMeetingProjectionPending = false;
          console.error("WZA background synchronization failed", {
            error: error instanceof Error ? error.name : "unknown",
          });
        } finally {
          globalMeetingProjectionInFlight = false;
        }
      });
    }
    const tracked = scope === "all" ? [] : await getUserTrackedGpwInstruments(user.id);
    const canonicalKeys = scope === "all"
      ? undefined
      : tracked
          .filter((instrument) => scope === "watchlist" ? instrument.watched : instrument.held)
          .map((instrument) => instrument.canonicalKey);
    const response: GeneralMeetingsResponse = {
      events: await getGlobalGeneralMeetings({
        fromDate: today,
        toDate: addCalendarDays(today, requestedDays),
        canonicalKeys,
      }),
      scope,
      sourceState: {
        status: initialState.status,
        lastCheckedAt: initialState.lastCheckedAt,
        lastSuccessfulSyncAt: initialState.lastSuccessAt,
        isRefreshing: initialState.isRefreshing || shouldRefreshSource || globalMeetingProjectionInFlight,
        isStale: initialState.isStale,
        // Projection backlog is intentionally not counted on the critical
        // request path: its old COUNT over the full candidate horizon made
        // otherwise-cached calendar reads appear stuck.
        projectionPending: 0,
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

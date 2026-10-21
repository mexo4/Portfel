import { after, NextResponse } from "next/server";
import { getCurrentAccountData } from "@/lib/server/auth";
import {
  getGlobalReportSchedules,
  getGlobalReportScheduleSourceState,
  synchronizeGlobalReportSchedules,
} from "@/lib/server/corporate-events";
import { buildTrackedGpwInstruments, getUserTrackedGpwInstruments } from "@/lib/server/espi";
import { getAuthorizedPortfolioScopeIds } from "@/lib/portfolio-selection";
import {
  REPORT_WINDOW_DAYS,
  isCalendarWindowDays,
  addCalendarDays,
  getWarsawDate,
  type GeneralMeetingScope,
  type ReportCalendarResponse,
} from "@/lib/corporate-events";

export const runtime = "nodejs";

const getScope = (value: string | null): GeneralMeetingScope =>
  value === "watchlist" || value === "portfolio" ? value : "all";

const PROJECTION_CHECK_COOLDOWN_MS = 60_000;
let reportProjectionInFlight = false;
let reportProjectionPending = false;
let lastReportProjectionCheckAt = 0;

export async function GET(request: Request) {
  const account = await getCurrentAccountData();
  if (!account) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const scope = getScope(searchParams.get("scope"));
  const days = Number(searchParams.get("days") ?? REPORT_WINDOW_DAYS);
  if (!isCalendarWindowDays(days)) {
    return NextResponse.json({ error: "Nieprawidłowy zakres kalendarza." }, { status: 400 });
  }
  const requestedPortfolio = searchParams.get("portfolio");
  const ownedIds = account.portfolios.map(({ id }) => id);
  let selectedPortfolios = account.portfolios;
  if (scope === "portfolio" && requestedPortfolio === "custom") {
    const requestedIds = searchParams.get("portfolioIds")?.split(",") ?? [];
    const authorized = getAuthorizedPortfolioScopeIds(requestedIds, ownedIds);
    if (!authorized || !authorized.length) {
      return NextResponse.json({ error: "Nieprawidłowy zakres portfeli." }, { status: 403 });
    }
    const selectedIds = new Set(authorized);
    selectedPortfolios = account.portfolios.filter(({ id }) => selectedIds.has(id));
  } else if (scope === "portfolio" && requestedPortfolio && requestedPortfolio !== "all") {
    if (!ownedIds.includes(requestedPortfolio)) {
      return NextResponse.json({ error: "Nieprawidłowy portfel." }, { status: 403 });
    }
    selectedPortfolios = account.portfolios.filter(({ id }) => id === requestedPortfolio);
  }

  try {
    const initialState = await getGlobalReportScheduleSourceState();
    const shouldRefreshSource = initialState.isStale && !initialState.isRefreshing;
    const projectionCheckDue = Date.now() - lastReportProjectionCheckAt >= PROJECTION_CHECK_COOLDOWN_MS;
    if (!reportProjectionInFlight && (shouldRefreshSource || reportProjectionPending || projectionCheckDue)) {
      reportProjectionInFlight = true;
      lastReportProjectionCheckAt = Date.now();
      after(async () => {
        try {
          let projection = await synchronizeGlobalReportSchedules({ refreshSource: shouldRefreshSource });
          for (let batch = 0; batch < 9 && projection.pending > 0; batch += 1) {
            projection = await synchronizeGlobalReportSchedules({ refreshSource: false });
          }
          reportProjectionPending = projection.pending > 0;
        } catch (error) {
          reportProjectionPending = false;
          console.error("GPW report schedule synchronization failed", {
            error: error instanceof Error ? error.name : "unknown",
          });
        } finally {
          reportProjectionInFlight = false;
        }
      });
    }

    const canonicalKeys = scope === "all" ? undefined : scope === "watchlist"
      ? (await getUserTrackedGpwInstruments(account.user.id))
          .filter((instrument) => instrument.watched)
          .map((instrument) => instrument.canonicalKey)
      : buildTrackedGpwInstruments(selectedPortfolios, [])
          .filter((instrument) => instrument.held)
          .map((instrument) => instrument.canonicalKey);
    const today = getWarsawDate();
    const response: ReportCalendarResponse = {
      events: await getGlobalReportSchedules({
        fromDate: today,
        toDate: addCalendarDays(today, days),
        canonicalKeys,
      }),
      scope,
      sourceState: {
        status: initialState.status,
        lastCheckedAt: initialState.lastCheckedAt,
        lastSuccessfulSyncAt: initialState.lastSuccessAt,
        isRefreshing: initialState.isRefreshing || shouldRefreshSource || reportProjectionInFlight,
        isStale: initialState.isStale,
        projectionPending: 0,
        sourceBackfillComplete: initialState.backfillComplete,
      },
    };
    return NextResponse.json(response, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("GET /api/gpw-reports failed", { error: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Nie udało się odczytać kalendarza raportów GPW." }, { status: 500 });
  }
}

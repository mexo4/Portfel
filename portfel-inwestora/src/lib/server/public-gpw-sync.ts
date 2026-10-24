import { after } from "next/server";
import { assessGpwSync } from "@/lib/gpw-sync-health";
import {
  getGlobalDividendSourceState,
  getGlobalGeneralMeetingSourceState,
  getGlobalReportScheduleSourceState,
  synchronizeGlobalDividends,
  synchronizeGlobalGeneralMeetings,
  synchronizeGlobalReportSchedules,
} from "@/lib/server/corporate-events";

const CHECK_COOLDOWN_MS = 5 * 60 * 1_000;
let lastCheckAt = 0;
let inFlight = false;

/** Opportunistic, global refresh; never fetches the market separately for each visitor. */
export const queuePublicGpwCalendarSync = () => {
  if (inFlight || Date.now() - lastCheckAt < CHECK_COOLDOWN_MS) return;
  inFlight = true;
  lastCheckAt = Date.now();
  after(async () => {
    try {
      const lanes = [
        { name: "reports", state: getGlobalReportScheduleSourceState, sync: synchronizeGlobalReportSchedules },
        { name: "meetings", state: getGlobalGeneralMeetingSourceState, sync: synchronizeGlobalGeneralMeetings },
        { name: "dividends", state: getGlobalDividendSourceState, sync: synchronizeGlobalDividends },
      ];
      for (const lane of lanes) {
        try {
          const source = await lane.state();
          let result = await lane.sync({ refreshSource: source.isStale && !source.isRefreshing });
          let batches = 1;
          for (let batch = 0; batch < 3 && result.pending > 0; batch += 1) {
            result = await lane.sync({ refreshSource: false });
            batches += 1;
          }
          const finalSource = await lane.state();
          const sourceSync = result.sourceSync;
          const overlapDue = sourceSync?.overlapDue ?? Boolean(finalSource.overlapIsStale);
          const overlapComplete = sourceSync?.overlapDue
            ? sourceSync.overlapComplete
            : overlapDue ? false : undefined;
          const assessment = assessGpwSync({
            batch: { errors: result.errors, pending: result.pending },
            source: {
              status: finalSource.status,
              lastCheckedAt: finalSource.lastCheckedAt,
              lastSuccessAt: finalSource.lastSuccessAt,
              errors: sourceSync?.errors,
              isStale: finalSource.isStale,
              locked: sourceSync?.locked ?? finalSource.isRefreshing,
              backfillComplete: sourceSync?.backfillComplete ?? (lane.name === "meetings" ? undefined : finalSource.backfillComplete),
              nextBackfillCursor: sourceSync?.nextBackfillPage ?? (lane.name === "meetings" ? undefined : finalSource.nextBackfillPage),
              overlapDue,
              overlapComplete,
            },
            projections: {
              pending: result.pending,
              errors: result.errors,
              unmatched: result.unmatched,
              reviewed: "reviewed" in result ? result.reviewed : undefined,
            },
          });
          console.info("[public-gpw-calendar] sync", {
            lane: lane.name,
            batchStatus: assessment.batchStatus,
            source: assessment.source,
            historicalBackfill: assessment.historicalBackfill,
            overlapRepair: assessment.overlapRepair,
            projectionBatch: assessment.projections.batchStatus,
            dataQuality: assessment.projections.dataQuality,
            calendarCoverage: assessment.coverage.status,
            sourceSync: sourceSync ? {
              status: sourceSync.status,
              pages: sourceSync.pagesRead,
              candidates: sourceSync.candidates,
              fetched: sourceSync.fetched,
              parsed: sourceSync.parsed,
              saved: sourceSync.saved,
              duplicates: sourceSync.duplicates,
              errors: sourceSync.errors,
              overlapDue: sourceSync.overlapDue,
              overlapComplete: sourceSync.overlapComplete,
              backfillComplete: sourceSync.backfillComplete,
              nextBackfillPage: sourceSync.nextBackfillPage,
            } : undefined,
            batches,
            fetched: result.fetched,
            created: result.created,
            duplicates: "duplicates" in result ? result.duplicates : undefined,
            reviewed: "reviewed" in result ? result.reviewed : undefined,
            unmatched: "unmatched" in result ? result.unmatched : undefined,
            pending: assessment.projections.pending,
            errors: assessment.projections.errors,
          });
        } catch (error) {
          console.error("[public-gpw-calendar] background synchronization failed", {
            lane: lane.name, error: error instanceof Error ? error.name : "unknown",
          });
        }
      }
    } finally {
      inFlight = false;
    }
  });
};

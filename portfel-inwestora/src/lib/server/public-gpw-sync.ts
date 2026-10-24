import { after } from "next/server";
import { getGpwSyncHealth } from "@/lib/gpw-sync-health";
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
          console.info("[public-gpw-calendar] sync", {
            lane: lane.name,
            outcome: getGpwSyncHealth({ errors: result.errors, pending: result.pending }),
            batches,
            fetched: result.fetched,
            created: result.created,
            duplicates: "duplicates" in result ? result.duplicates : undefined,
            reviewed: "reviewed" in result ? result.reviewed : undefined,
            unmatched: "unmatched" in result ? result.unmatched : undefined,
            pending: result.pending,
            errors: result.errors,
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

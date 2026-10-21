import { after } from "next/server";
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
          for (let batch = 0; batch < 3 && result.pending > 0; batch += 1) {
            result = await lane.sync({ refreshSource: false });
          }
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

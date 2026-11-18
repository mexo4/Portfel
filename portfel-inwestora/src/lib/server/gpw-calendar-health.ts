import { query, queryOne } from "@/lib/server/db";
import { getEspiSyncState, getGpwReportScheduleSyncState } from "@/lib/server/espi";
import {
  DIVIDEND_PROJECTION_VERSION,
  GENERAL_MEETING_PROJECTION_VERSION,
  REPORT_SCHEDULE_PROJECTION_VERSION,
} from "@/lib/gpw-projection-versions";
import {
  normalizeGpwReviewEntries,
  type GpwActiveRowQuality,
  type GpwCalendarHealth,
  type GpwLaneHealth,
  type GpwProjectionLane,
  type GpwRetirementSummary,
  type GpwReviewDocument,
} from "@/lib/gpw-calendar-health";

/**
 * Read-only view of the GPW events calendar's data quality. Every statement is a SELECT; nothing here repairs,
 * re-projects or deletes anything. Column names come from a fixed table, never from input.
 */
const LANES: Record<GpwProjectionLane, { status: string; version: string; projectedAt: string; current: number }> = {
  reports: {
    status: "report_schedule_projection_status", version: "report_schedule_projection_version",
    projectedAt: "report_schedule_projected_at", current: REPORT_SCHEDULE_PROJECTION_VERSION,
  },
  meetings: {
    status: "corporate_events_projection_status", version: "corporate_events_projection_version",
    projectedAt: "corporate_events_projected_at", current: GENERAL_MEETING_PROJECTION_VERSION,
  },
  dividends: {
    status: "dividend_projection_status", version: "dividend_projection_version",
    projectedAt: "dividend_projected_at", current: DIVIDEND_PROJECTION_VERSION,
  },
};

const REVIEW_QUEUE_LIMIT = 100;
const REPORT_TYPES_SQL = "('QUARTERLY_REPORT', 'HALF_YEAR_REPORT', 'ANNUAL_REPORT')";

type LaneRow = Record<"projected" | "success" | "no_event" | "unmatched" | "parse_error" | "review_required" | "stale_version",
  number | string> & { oldest_stale: string | null; last_projected: string | null };

const getLaneHealth = async (lane: GpwProjectionLane): Promise<GpwLaneHealth> => {
  const { status, version, projectedAt, current } = LANES[lane];
  const row = await queryOne<LaneRow>(
    `SELECT
       COUNT(*) FILTER (WHERE ${status} IS NOT NULL) AS projected,
       COUNT(*) FILTER (WHERE ${status} = 'SUCCESS') AS success,
       COUNT(*) FILTER (WHERE ${status} = 'NO_EVENT') AS no_event,
       COUNT(*) FILTER (WHERE ${status} = 'UNMATCHED') AS unmatched,
       COUNT(*) FILTER (WHERE ${status} = 'PARSE_ERROR') AS parse_error,
       COUNT(*) FILTER (WHERE ${status} = 'REVIEW_REQUIRED') AS review_required,
       COUNT(*) FILTER (WHERE ${status} IS NOT NULL AND ${version} IS DISTINCT FROM $1) AS stale_version,
       MIN(published_at) FILTER (WHERE ${status} IS NOT NULL AND ${version} IS DISTINCT FROM $1) AS oldest_stale,
       MAX(${projectedAt}) AS last_projected
     FROM espi_reports
     WHERE source = 'PAP_ESPI' AND source_id NOT LIKE 'newconnect:%'`,
    [current]
  );
  return {
    lane, version: current,
    projected: Number(row?.projected ?? 0), success: Number(row?.success ?? 0), noEvent: Number(row?.no_event ?? 0),
    unmatched: Number(row?.unmatched ?? 0), parseError: Number(row?.parse_error ?? 0),
    reviewRequired: Number(row?.review_required ?? 0), staleVersion: Number(row?.stale_version ?? 0),
    oldestStalePublishedAt: row?.oldest_stale ?? null, lastProjectedAt: row?.last_projected ?? null,
  };
};

const getActiveRowQuality = async (): Promise<GpwActiveRowQuality> => {
  const incomplete = "(split_part(event.event_identity, ':', 2) = '' OR split_part(event.event_identity, ':', 3) = '')";
  const totals = await queryOne<Record<"total" | "incomplete" | "incomplete_unverified", number | string>>(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE ${incomplete}) AS incomplete,
            COUNT(*) FILTER (WHERE ${incomplete} AND event.status = 'UNKNOWN') AS incomplete_unverified
     FROM corporate_events AS event
     JOIN corporate_event_instruments AS instrument ON instrument.id = event.instrument_id
     WHERE event.active = TRUE AND instrument.market = 'GPW' AND event.event_type IN ${REPORT_TYPES_SQL}`
  );
  const duplicates = await queryOne<Record<"same_day" | "several_dates", number | string>>(
    `SELECT
       (SELECT COUNT(*) FROM (
          SELECT event.instrument_id, event.event_type, event.event_date
          FROM corporate_events AS event
          JOIN corporate_event_instruments AS instrument ON instrument.id = event.instrument_id
          WHERE event.active = TRUE AND instrument.market = 'GPW' AND event.event_type IN ${REPORT_TYPES_SQL}
          GROUP BY event.instrument_id, event.event_type, event.event_date
          HAVING COUNT(DISTINCT event.event_identity) > 1) AS same_day) AS same_day,
       (SELECT COUNT(*) FROM (
          SELECT event.instrument_id, event.event_identity
          FROM corporate_events AS event
          JOIN corporate_event_instruments AS instrument ON instrument.id = event.instrument_id
          WHERE event.active = TRUE AND instrument.market = 'GPW' AND event.event_type IN ${REPORT_TYPES_SQL}
          GROUP BY event.instrument_id, event.event_identity
          HAVING COUNT(DISTINCT event.event_date) > 1) AS several_dates) AS several_dates`
  );
  return {
    activeReportRows: Number(totals?.total ?? 0),
    incompleteIdentity: Number(totals?.incomplete ?? 0),
    incompleteIdentityMarkedUnverified: Number(totals?.incomplete_unverified ?? 0),
    sameTypeAndDateWithDifferentIdentities: Number(duplicates?.same_day ?? 0),
    oneIdentityOnSeveralDates: Number(duplicates?.several_dates ?? 0),
  };
};

const getRetirementSummary = async (days = 14): Promise<GpwRetirementSummary> => {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1_000).toISOString();
  const rows = await query<{ reason: string; count: number | string }>(
    `SELECT reason, COUNT(*) AS count FROM corporate_event_projection_changes
     WHERE reason LIKE 'REPORT_SCHEDULE_REPROJECTION%' AND changed_at >= $1
     GROUP BY reason ORDER BY COUNT(*) DESC`,
    [since]
  );
  const byReason = rows.map((row) => ({ reason: row.reason, count: Number(row.count) }));
  return { since, total: byReason.reduce((total, row) => total + row.count, 0), byReason };
};

const getReviewQueue = async () => {
  const [count, rows] = await Promise.all([
    queryOne<{ count: number | string }>(
      `SELECT COUNT(*) AS count FROM espi_reports
       WHERE source = 'PAP_ESPI' AND source_id NOT LIKE 'newconnect:%' AND report_schedule_projection_status = 'REVIEW_REQUIRED'`
    ),
    query<{
      source_id: string; source_url: string; issuer_name: string | null; title: string | null;
      source_title: string | null; published_at: string; report_schedule_review_reasons: unknown;
    }>(
      `SELECT source_id, source_url, issuer_name, title, source_title, published_at, report_schedule_review_reasons
       FROM espi_reports
       WHERE source = 'PAP_ESPI' AND source_id NOT LIKE 'newconnect:%' AND report_schedule_projection_status = 'REVIEW_REQUIRED'
       ORDER BY published_at DESC, source_id DESC LIMIT ${REVIEW_QUEUE_LIMIT}`
    ),
  ]);
  const items: GpwReviewDocument[] = rows.map((row) => ({
    sourceId: row.source_id, sourceUrl: row.source_url, issuerName: row.issuer_name,
    title: row.title || row.source_title || row.source_id, publishedAt: row.published_at,
    entries: normalizeGpwReviewEntries(row.report_schedule_review_reasons),
  }));
  return { documents: Number(count?.count ?? 0), items };
};

export const getGpwCalendarHealth = async (): Promise<GpwCalendarHealth> => {
  const [lanes, rows, retirements, reviewQueue, reportSource, papSource] = await Promise.all([
    Promise.all((Object.keys(LANES) as GpwProjectionLane[]).map(getLaneHealth)),
    getActiveRowQuality(),
    getRetirementSummary(),
    getReviewQueue(),
    getGpwReportScheduleSyncState(),
    getEspiSyncState(),
  ]);
  // The calendar is only as complete as its least complete source.
  const lagging = !reportSource.backfillComplete ? reportSource : !papSource.backfillComplete ? papSource : reportSource;
  return {
    generatedAt: new Date().toISOString(),
    lanes, rows, retirements, reviewQueue,
    source: {
      status: String(lagging.status),
      lastCheckedAt: lagging.lastCheckedAt,
      lastSuccessAt: lagging.lastSuccessAt,
      isStale: Boolean(reportSource.isStale || papSource.isStale),
      backfillComplete: Boolean(reportSource.backfillComplete && papSource.backfillComplete),
      nextBackfillPage: lagging.nextBackfillPage,
    },
  };
};

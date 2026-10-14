import { unstable_cache } from "next/cache";
import { query } from "@/lib/server/db";
import type { CorporateEventType } from "@/lib/corporate-events";
import {
  expandGpwStoredCalendarEvent,
  getGpwEventCategory,
  type GpwCalendarCategory,
  type PublicGpwCalendarEvent,
  type PublicGpwStoredEventRow,
} from "@/lib/public-gpw-calendar";

/** Public market-event reader. It never queries accounts, transactions or watchlists. */
const MAX_EVENTS_PER_MONTH = 1000;
const ALL_TYPES: CorporateEventType[] = [
  "QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT", "UPCOMING_DIVIDEND", "GENERAL_MEETING",
];
const TYPES: Record<GpwCalendarCategory, CorporateEventType[]> = {
  all: ALL_TYPES,
  reports: ["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT"],
  meetings: ["GENERAL_MEETING"],
  dividends: ["UPCOMING_DIVIDEND"],
};

export type PublicGpwCalendarResult = {
  events: PublicGpwCalendarEvent[];
  latestRecordUpdatedAt?: string;
  truncated: boolean;
};

const readCalendarMonth = unstable_cache(
  async (from: string, to: string, category: GpwCalendarCategory, search: string): Promise<PublicGpwCalendarResult> => {
    const rows = await query<PublicGpwStoredEventRow>(
      `
        SELECT event.id, issuer.ticker, issuer.company_name,
               event.event_type, event.event_date, event.event_time,
               event.fiscal_period, event.fiscal_year, event.general_meeting_type,
               event.registration_date, event.dividend_per_share, event.dividend_currency,
               event.record_date, event.payment_date, event.status, event.updated_at,
               source.source_url, source.source_published_at
        FROM corporate_events AS event
        INNER JOIN corporate_event_instruments AS issuer ON issuer.id = event.instrument_id
        INNER JOIN LATERAL (
          SELECT evidence.source_url, evidence.source_published_at
          FROM corporate_event_sources AS evidence
          WHERE evidence.corporate_event_id = event.id
            AND evidence.source_url LIKE 'https://%'
          ORDER BY evidence.source_priority DESC,
                   evidence.source_published_at DESC NULLS LAST,
                   evidence.discovered_at DESC
          LIMIT 1
        ) AS source ON TRUE
        WHERE issuer.market = 'GPW'
          AND event.active = TRUE
          AND event.status <> 'CANCELLED'
          AND event.event_type = ANY($3::text[])
          AND (
            event.event_date BETWEEN $1 AND $2
            OR (event.event_type = 'UPCOMING_DIVIDEND' AND event.payment_date BETWEEN $1 AND $2)
          )
          AND ($4::text = '' OR issuer.ticker ILIKE '%' || $4 || '%'
               OR issuer.company_name ILIKE '%' || $4 || '%')
        ORDER BY event.event_date ASC, issuer.company_name ASC, event.id ASC
        LIMIT $5
      `,
      [from, to, TYPES[category], search, MAX_EVENTS_PER_MONTH + 1]
    );
    const truncated = rows.length > MAX_EVENTS_PER_MONTH;
    const sourceRows = rows.slice(0, MAX_EVENTS_PER_MONTH);
    const events = sourceRows.flatMap((row) => expandGpwStoredCalendarEvent(row, from, to))
      .filter((event) => category === "all" || getGpwEventCategory(event.kind) === category)
      .sort((a, b) => a.date.localeCompare(b.date) || a.companyName.localeCompare(b.companyName, "pl") || a.kind.localeCompare(b.kind));
    const updatedDates = sourceRows.map((row) => row.updated_at).filter(Boolean).sort();
    return { events, truncated, latestRecordUpdatedAt: updatedDates.at(-1) };
  },
  ["mexo-public-gpw-calendar-v1"],
  { revalidate: 15 * 60 }
);

export const getPublicGpwCalendarMonth = async (
  from: string,
  to: string,
  category: GpwCalendarCategory,
  search: string
) => readCalendarMonth(from, to, category, search);

import { unstable_cache } from "next/cache";
import { query } from "@/lib/server/db";
import {
  ICAL_CATEGORIES,
  toIcalMilestones,
  type IcalCategory,
  type IcalKind,
  type IcalSourceRow,
  type IcalMilestone,
} from "@/lib/gpw-ical";

const ROW_LIMIT = 4000;
const TYPES: Record<IcalCategory, IcalKind[]> = {
  reports: ["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT"],
  dividends: ["UPCOMING_DIVIDEND"],
  meetings: ["GENERAL_MEETING"],
};

/** Reads public GPW issuers only, never account, portfolio, or watchlist tables. */
const loadIcalWindow = unstable_cache(
  async (from: string, to: string, key: string): Promise<IcalMilestone[]> => {
    const categories = key.split(",") as IcalCategory[];
    const types = categories.flatMap((category) => TYPES[category]);
    const rows = await query<IcalSourceRow>(
      `
        SELECT event.id, issuer.ticker, issuer.company_name,
               event.event_type, event.event_date, event.event_time,
               event.fiscal_period, event.fiscal_year, event.general_meeting_type,
               event.dividend_per_share, event.dividend_currency,
               event.record_date, event.payment_date, event.status,
               event.active, event.updated_at,
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
          AND event.event_type = ANY($3::text[])
          AND (event.active = TRUE OR event.status = 'CANCELLED')
          AND (
            event.event_date BETWEEN $1 AND $2
            OR (event.event_type = 'UPCOMING_DIVIDEND' AND
                 (event.record_date BETWEEN $1 AND $2 OR event.payment_date BETWEEN $1 AND $2))
          )
        ORDER BY event.event_date ASC, issuer.ticker ASC, event.id ASC
        LIMIT $4
      `,
      [from, to, types, ROW_LIMIT + 1],
    );
    // Never silently publish a seemingly complete but cut-off subscription feed.
    if (rows.length > ROW_LIMIT) throw new Error("GPW_ICAL_RESULT_LIMIT");
    return rows.flatMap((row) => toIcalMilestones(row, from, to));
  },
  ["mexo-public-gpw-ical-v1"],
  { revalidate: 5 * 60 },
);

export const readPublicIcalEvents = (from: string, to: string, categories: readonly IcalCategory[]) => {
  const key = ICAL_CATEGORIES.filter((category) => categories.includes(category)).join(",");
  if (!key) throw new Error("GPW_ICAL_EMPTY_SELECTION");
  return loadIcalWindow(from, to, key);
};

import { unstable_cache } from "next/cache";
import { query } from "@/lib/server/db";
import { PUBLIC_GPW_EVENTS_CACHE_TAG } from "@/lib/server/public-gpw-cache";
import {
  toPublicDividend,
  type DividendView,
  type PublicDividend,
  type PublicDividendRow,
} from "@/lib/public-dividend-calendar";

const MAX_SOURCE_ROWS = 1500;

export type PublicDividendCalendarResult = {
  dividends: PublicDividend[];
  /** Most recent change among the included source records, not a claim of feed completeness. */
  latestRecordUpdatedAt?: string;
  truncated: boolean;
};

/**
 * Central, public-data-only projection of the existing corporate events DB.
 * No user, session, portfolio, brokerage, watchlist or holdings tables are read.
 * The database should already have been synchronized by the existing ESPI pipeline;
 * opening a public page must not start expensive provider crawling.
 */
const readPublicDividendWindow = unstable_cache(
  async (from: string, to: string, search: string, view: DividendView): Promise<PublicDividendCalendarResult> => {
    const rows = await query<PublicDividendRow>(
      `
        SELECT event.id, issuer.ticker, issuer.company_name,
               event.event_date, event.ex_dividend_date, event.record_date,
               event.payment_date, event.dividend_per_share, event.dividend_currency,
               event.dividend_total_per_share, event.dividend_advance_per_share,
               event.dividend_installment, event.fiscal_year, event.status,
               event.updated_at, source.source_url, source.source_published_at
        FROM corporate_events AS event
        INNER JOIN corporate_event_instruments AS issuer ON issuer.id = event.instrument_id
        INNER JOIN LATERAL (
          SELECT evidence.source_url, evidence.source_published_at
          FROM corporate_event_sources AS evidence
          WHERE evidence.corporate_event_id = event.id
            AND evidence.source_url LIKE 'https://%'
          ORDER BY (evidence.confirms_amount::int + evidence.confirms_record_date::int +
                    evidence.confirms_payment_date::int + evidence.confirms_status::int) DESC,
                   evidence.source_priority DESC,
                   evidence.source_published_at DESC NULLS LAST,
                   evidence.discovered_at DESC
          LIMIT 1
        ) AS source ON TRUE
        WHERE issuer.market = 'GPW'
          AND event.event_type = 'UPCOMING_DIVIDEND'
          AND event.active = TRUE
          AND event.status <> 'CANCELLED'
          AND (
            event.event_date BETWEEN $1 AND $2
            OR event.record_date BETWEEN $1 AND $2
            OR event.payment_date BETWEEN $1 AND $2
            OR event.ex_dividend_date BETWEEN $1 AND $2
          )
          AND (
            $3::text = ''
            OR POSITION(LOWER($3) IN LOWER(issuer.ticker)) > 0
            OR POSITION(LOWER($3) IN LOWER(issuer.company_name)) > 0
          )
        ORDER BY event.event_date ASC, issuer.company_name ASC, event.id ASC
        LIMIT $4
      `,
      [from, to, search, MAX_SOURCE_ROWS + 1]
    );

    const truncated = rows.length > MAX_SOURCE_ROWS;
    const sourceRows = rows.slice(0, MAX_SOURCE_ROWS);
    const dividends = sourceRows.flatMap((row) => {
      const item = toPublicDividend(row, from, to, view);
      return item ? [item] : [];
    });
    const changed = sourceRows
      .map((row) => row.updated_at)
      .filter((date): date is string => typeof date === "string" && !Number.isNaN(Date.parse(date)))
      .sort();

    return { dividends, truncated, latestRecordUpdatedAt: changed.at(-1) };
  },
  ["mexo-public-dividend-calendar-v1"],
  { revalidate: 15 * 60, tags: [PUBLIC_GPW_EVENTS_CACHE_TAG] }
);

export const getPublicDividendCalendar = (
  from: string,
  to: string,
  search: string,
  view: DividendView
) => readPublicDividendWindow(from, to, search, view);

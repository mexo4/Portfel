import { isSubsidiaryOnlyDividendNotice } from "@/lib/corporate-events";
import {
  getAnnouncedDividendDays,
  isAdvanceNoticeText,
  noticeStatesDate,
  type GpwCalendarIntegrity,
  type IntegrityReportMismatch,
} from "@/lib/gpw-calendar-integrity";
import { query } from "@/lib/server/db";

/**
 * Read-only: the GPW calendar against the stored notices and the reports that came out. Every
 * statement is a SELECT. See src/lib/gpw-calendar-integrity.ts for why the checks avoid the parser.
 */

const DIVIDEND_NOTICE_DAYS = 120;
const REPORT_DAYS = 60;
const LIST_LIMIT = 40;

const warsawDay = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw" }).format(new Date(iso));
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const REPORT_EVENT_TYPES: Record<string, string> = {
  PERIODIC_QUARTERLY: "QUARTERLY_REPORT",
  PERIODIC_HALF_YEAR: "HALF_YEAR_REPORT",
  PERIODIC_ANNUAL: "ANNUAL_REPORT",
};

export const getGpwCalendarIntegrity = async (): Promise<GpwCalendarIntegrity> => {
  const today = warsawDay(new Date().toISOString());

  // 1. Dividend notices with a future dividend or payment day, against the issuer's dividend entries.
  const notices = await query<{ issuer_id: string; issuer_name: string; source_url: string; published_at: string; text: string }>(
    `SELECT report.issuer_id, report.issuer_name, report.source_url, report.published_at,
            report.source_title || E'\\n' || report.title || E'\\n' || report.body_text AS text
     FROM espi_reports AS report
     JOIN corporate_event_instruments AS issuer ON issuer.id = report.issuer_id AND issuer.market = 'GPW'
     WHERE report.source = 'PAP_ESPI' AND report.published_at >= $1
       AND (report.source_title ILIKE '%dywidend%' OR report.title ILIKE '%dywidend%'
            OR report.source_title ILIKE '%zaliczk%' OR report.title ILIKE '%zaliczk%')
       AND report.source_title NOT ILIKE '%polityk%dywidend%' AND report.title NOT ILIKE '%polityk%dywidend%'
     ORDER BY report.published_at DESC`,
    [daysAgo(DIVIDEND_NOTICE_DAYS)]
  );
  const dividendDays = await query<{ instrument_id: string; day: string }>(
    `SELECT instrument_id, record_date AS day FROM corporate_events
     WHERE event_type = 'UPCOMING_DIVIDEND' AND active = TRUE AND record_date IS NOT NULL
     UNION
     SELECT instrument_id, payment_date AS day FROM corporate_events
     WHERE event_type = 'UPCOMING_DIVIDEND' AND active = TRUE AND payment_date IS NOT NULL`
  );
  const knownDays = new Set(dividendDays.map((row) => `${row.instrument_id}|${row.day}`));
  const checkedNotices = notices.filter((notice) => !isSubsidiaryOnlyDividendNotice(notice.text));
  // Newest first. A dividend notice speaks for the issuer's dividend until a later one: a general meeting
  // may change the dates a recommendation gave. Advances do not replace each other (two advances taken
  // for one is the fault this check exists for), so every advance notice is checked.
  const claimed = new Set<string>();
  const laterDividendNotice = new Set<string>();
  const missing = checkedNotices.flatMap((notice) => {
    const isAdvance = isAdvanceNoticeText(notice.text);
    const allDays = getAnnouncedDividendDays(notice.text, today);
    if (!isAdvance && laterDividendNotice.has(notice.issuer_id)) return [];
    if (!isAdvance && allDays.length > 0) laterDividendNotice.add(notice.issuer_id);
    const days = allDays.filter((day) => !claimed.has(`${notice.issuer_id}|${day}`));
    days.forEach((day) => claimed.add(`${notice.issuer_id}|${day}`));
    const absent = days.filter((day) => !knownDays.has(`${notice.issuer_id}|${day}`));
    return absent.length > 0
      ? [{ issuer: notice.issuer_name, sourceUrl: notice.source_url, publishedAt: notice.published_at, days: absent }]
      : [];
  });

  // 2. Upcoming dividend entries whose shown notice does not state their days.
  const entries = await query<{ issuer: string; record_date: string | null; payment_date: string | null; source_url: string; text: string | null }>(
    `SELECT issuer.company_name AS issuer, event.record_date, event.payment_date, source.source_url,
            report.source_title || E'\\n' || report.title || E'\\n' || report.body_text AS text
     FROM corporate_events AS event
     JOIN corporate_event_instruments AS issuer ON issuer.id = event.instrument_id AND issuer.market = 'GPW'
     JOIN LATERAL (
       SELECT evidence.source_url FROM corporate_event_sources AS evidence
       WHERE evidence.corporate_event_id = event.id
       -- The same choice as the public calendar's shown link (getStoredEvents in corporate-events.ts).
       ORDER BY (evidence.confirms_amount::int + evidence.confirms_record_date::int +
                 evidence.confirms_payment_date::int + evidence.confirms_status::int) DESC,
                evidence.source_priority DESC, evidence.source_published_at DESC NULLS LAST, evidence.discovered_at DESC
       LIMIT 1
     ) AS source ON TRUE
     LEFT JOIN espi_reports AS report ON report.source_url = source.source_url
     WHERE event.event_type = 'UPCOMING_DIVIDEND' AND event.active = TRUE AND event.status <> 'CANCELLED'
       AND COALESCE(event.payment_date, event.record_date, event.event_date) >= $1`,
    [today]
  );
  // A notice that is not stored (an issuer page) cannot be read here, so it is not judged.
  const readable = entries.filter((entry) => entry.text);
  const unsupported = readable.filter((entry) =>
    ![entry.record_date, entry.payment_date].some((day) => day && noticeStatesDate(entry.text!, day)))
    .map((entry) => ({ issuer: entry.issuer, recordDate: entry.record_date, paymentDate: entry.payment_date, sourceUrl: entry.source_url }));

  // 3. Periodic reports that came out, against the calendar's day for them.
  const reports = await query<{ issuer_id: string; issuer_name: string; report_type: string; published_at: string; source_url: string }>(
    `SELECT report.issuer_id, report.issuer_name, report.report_type, report.published_at, report.source_url
     FROM espi_reports AS report
     JOIN corporate_event_instruments AS issuer ON issuer.id = report.issuer_id AND issuer.market = 'GPW'
     WHERE report.source = 'PAP_ESPI' AND report.source_id LIKE 'gpw:%' AND report.is_correction = FALSE
       AND report.report_type IN ('PERIODIC_QUARTERLY', 'PERIODIC_HALF_YEAR', 'PERIODIC_ANNUAL')
       AND report.published_at >= $1
     ORDER BY report.published_at DESC`,
    [daysAgo(REPORT_DAYS)]
  );
  const scheduled = reports.length === 0 ? [] : await query<{ instrument_id: string; event_type: string; event_date: string }>(
    `SELECT instrument_id, event_type, event_date FROM corporate_events
     WHERE active = TRUE AND status <> 'CANCELLED' AND instrument_id = ANY($1::text[])
       AND event_type IN ('QUARTERLY_REPORT', 'HALF_YEAR_REPORT', 'ANNUAL_REPORT')`,
    [[...new Set(reports.map((report) => report.issuer_id))]]
  );
  // A company files one periodic report per period: its first filing is the one the calendar announced.
  const firstFilings = new Map<string, (typeof reports)[number]>();
  for (const report of [...reports].reverse()) {
    const key = `${report.issuer_id}|${report.report_type}`;
    if (!firstFilings.has(key)) firstFilings.set(key, report);
  }
  let onCalendarDay = 0;
  const differentDay: IntegrityReportMismatch[] = [];
  const notInCalendar: IntegrityReportMismatch[] = [];
  for (const report of firstFilings.values()) {
    const publishedOn = warsawDay(report.published_at);
    const eventType = REPORT_EVENT_TYPES[report.report_type]!;
    const near = scheduled
      .filter((row) => row.instrument_id === report.issuer_id && row.event_type === eventType &&
        Math.abs(Date.parse(row.event_date) - Date.parse(publishedOn)) <= 45 * 86_400_000)
      .sort((left, right) => Math.abs(Date.parse(left.event_date) - Date.parse(publishedOn)) - Math.abs(Date.parse(right.event_date) - Date.parse(publishedOn)));
    const mismatch = { issuer: report.issuer_name, reportType: eventType, publishedOn, calendarDate: near[0]?.event_date ?? null, sourceUrl: report.source_url };
    if (near.some((row) => row.event_date === publishedOn)) onCalendarDay += 1;
    else if (near.length > 0) differentDay.push(mismatch);
    else notInCalendar.push(mismatch);
  }

  return {
    checkedAt: new Date().toISOString(),
    dividends: { noticesChecked: checkedNotices.length, missing: missing.slice(0, LIST_LIMIT), eventsChecked: readable.length, unsupported: unsupported.slice(0, LIST_LIMIT) },
    reports: {
      since: warsawDay(daysAgo(REPORT_DAYS)),
      published: firstFilings.size,
      onCalendarDay,
      differentDay: differentDay.slice(0, LIST_LIMIT),
      notInCalendar: notInCalendar.slice(0, LIST_LIMIT),
    },
  };
};

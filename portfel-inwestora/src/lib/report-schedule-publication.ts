import { getCorporateEventIdentityKey, type ParsedCorporateEvent } from "@/lib/corporate-events";

export type ReportPublicationDecision = {
  event: ParsedCorporateEvent;
  publish: boolean;
  reasons: string[];
  /**
   * The event is published, but its fiscal year was withdrawn because the source contradicts itself
   * about it (a quarter "2025" announced for a date in 2026): the calendar shows the report and its date
   * as unverified instead of an impossible label, and the row waits in the review queue.
   */
  yearWithdrawn?: boolean;
};

const isReport = (event: ParsedCorporateEvent) =>
  event.eventType === "QUARTERLY_REPORT" || event.eventType === "HALF_YEAR_REPORT" ||
  event.eventType === "ANNUAL_REPORT";

const isValidIsoDay = (value: string) => {
  const match = /^(20\d{2})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
};

/** Reasons that say only "the year (or the year/period pair) does not fit the date". */
const YEAR_CONTRADICTION_REASONS = new Set([
  "PUBLICATION_YEAR_CONFLICTS_WITH_PERIOD",
  "REPORT_PERIOD_MAY_BE_OVERDUE",
  "REPORT_DATE_NOT_AFTER_PERIOD_END",
  "FISCAL_YEAR_NOT_EXPLICIT",
]);

export type ReportPublicationContext = {
  /** When the official document was published. A withdrawn-year row needs it: its date must still lie ahead. */
  sourcePublishedAt?: string | null;
};

/** Conservative policy between parsing and persistence. The parser may surface
 * ambiguous candidates for diagnostics; those are not calendar appointments.
 *
 * One exception, by decision of 18.11.2026: a row whose only defect is a contradictory or missing
 * fiscal year (Enter Air, Pharmena, IDM and ERG state "Q3 2025"/"Q3 2029" for a day in November 2026)
 * keeps its report type, period and date and loses the year. It is published as unverified when the
 * date is unambiguous: a unique report type/period in the document, not earlier than the
 * announcement itself, and not a change notice (a change must find the row it moves by identity). */
export function assessReportPublicationBatch(
  events: ParsedCorporateEvent[],
  context: ReportPublicationContext = {}
): ReportPublicationDecision[] {
  const datesByIdentity = new Map<string, Set<string>>();
  const reportsByTypePeriod = new Map<string, number>();
  for (const event of events.filter(isReport)) {
    const identity = getCorporateEventIdentityKey(event);
    const dates = datesByIdentity.get(identity) ?? new Set<string>();
    dates.add(event.eventDate);
    datesByIdentity.set(identity, dates);
    const typePeriod = `${event.eventType}:${event.fiscalPeriod ?? ""}`;
    reportsByTypePeriod.set(typePeriod, (reportsByTypePeriod.get(typePeriod) ?? 0) + 1);
  }
  const announcedOn = context.sourcePublishedAt ? context.sourcePublishedAt.slice(0, 10) : undefined;
  return events.map((event) => {
    const reasons: string[] = [];
    if (isReport(event)) {
      if (event.requiresReview) reasons.push(...(event.reviewReasons?.length ? event.reviewReasons : ["PARSER_REQUIRES_REVIEW"]));
      if (!event.fiscalPeriod) reasons.push("PERIOD_NOT_EXPLICIT");
      if (!event.fiscalYear && !event.fiscalYearLabel) reasons.push("FISCAL_YEAR_NOT_EXPLICIT");
      if ((datesByIdentity.get(getCorporateEventIdentityKey(event))?.size ?? 0) > 1)
        reasons.push("CONFLICTING_DATES_FOR_ONE_REPORT_IDENTITY");
      if (!isValidIsoDay(event.eventDate)) reasons.push("INVALID_PUBLICATION_DATE");
    }
    const unique = [...new Set(reasons)];
    if (unique.length > 0 && isReport(event) && event.fiscalPeriod && !event.isScheduleChange && !event.isCancellation &&
      unique.every((reason) => YEAR_CONTRADICTION_REASONS.has(reason)) &&
      announcedOn && event.eventDate >= announcedOn &&
      reportsByTypePeriod.get(`${event.eventType}:${event.fiscalPeriod}`) === 1) {
      return {
        event: { ...event, fiscalYear: undefined, fiscalYearLabel: undefined, requiresReview: true, reviewReasons: unique },
        publish: true,
        reasons: unique,
        yearWithdrawn: true,
      };
    }
    return { event, publish: unique.length === 0, reasons: unique };
  });
}

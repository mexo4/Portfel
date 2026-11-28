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
  /** A change notice published although its period is far behind its date, because a stored row of that identity confirms it. */
  changeConfirmedByStoredRow?: boolean;
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

/**
 * What one document puts in front of a human: events the policy held back, and events published without
 * a year. Both end up in the review queue (the document becomes REVIEW_REQUIRED), so both count as review
 * items in the sync result that feeds the data-quality health.
 */
export const countReportReviewItems = (decisions: ReportPublicationDecision[]) =>
  decisions.filter((decision) => !decision.publish || decision.yearWithdrawn).length;

/** An active report row of the issuer: its identity ("QUARTERLY_REPORT:Q3:2024") and the date it stands on. */
export type KnownReportRow = { identity: string; date: string };

export type ReportPublicationContext = {
  /** When the official document was published. A withdrawn-year row needs it: its date must still lie ahead. */
  sourcePublishedAt?: string | null;
  /**
   * The issuer's active report rows. A change notice is a re-dating of a row that already exists: when its
   * previous date (or the date it already moved the row to) belongs to a stored row of exactly the same report
   * identity, the period and year are not a typo, however late the period is (a chronically late issuer
   * postpones an H1 2024 report to November 2026 again and again).
   */
  knownRows?: readonly KnownReportRow[];
};

/** Conservative policy between parsing and persistence. The parser may surface
 * ambiguous candidates for diagnostics; those are not calendar appointments.
 *
 * One exception, by decision of 18.11.2026: a row whose only defect is a contradictory or missing
 * fiscal year (Enter Air, Pharmena, IDM and ERG state "Q3 2025"/"Q3 2029" for a day in November 2026)
 * keeps its report type, period and date and loses the year. It is published as unverified when the
 * date is unambiguous: a unique report type/period in the document, not earlier than the
 * announcement itself, and not a change notice (a change must find the row it moves by identity: such a notice is
 * published only when `context.knownRows` holds a row of the same identity on its previous or its new date). */
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
  const knownKeys = new Set((context.knownRows ?? []).map((row) => `${row.identity}:${row.date}`));
  const decisions = events.map((event): ReportPublicationDecision => {
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
    // A change notice that moves a stored row of the very same identity: the label is confirmed by that row, so the
    // "period is far behind the date" signal describes the issuer, not a typo. The new date is the issuer's own.
    if (unique.length > 0 && isReport(event) && event.isScheduleChange && !event.isCancellation &&
      event.fiscalPeriod && (event.fiscalYear || event.fiscalYearLabel) &&
      unique.every((reason) => YEAR_CONTRADICTION_REASONS.has(reason) && reason !== "FISCAL_YEAR_NOT_EXPLICIT") &&
      isValidIsoDay(event.eventDate)) {
      const identity = getCorporateEventIdentityKey(event);
      if ((event.previousEventDate && knownKeys.has(`${identity}:${event.previousEventDate}`)) ||
        knownKeys.has(`${identity}:${event.eventDate}`)) {
        return {
          event: { ...event, requiresReview: false, reviewReasons: undefined },
          publish: true,
          reasons: [],
          changeConfirmedByStoredRow: true,
        };
      }
    }
    // A change notice that moves a row the calendar holds without its year (its schedule contradicted the year:
    // Syn2bio's financial year runs October to September, so "raport roczny za rok finansowy 2025" comes in
    // December 2026): the stored yearless row on the notice's previous date is that report. Move it, still
    // without the year, instead of leaving the replaced date in the calendar.
    if (unique.length > 0 && isReport(event) && event.isScheduleChange && !event.isCancellation &&
      event.fiscalPeriod && (event.fiscalYear || event.fiscalYearLabel) && event.previousEventDate && isValidIsoDay(event.eventDate) &&
      unique.every((reason) => YEAR_CONTRADICTION_REASONS.has(reason) && reason !== "FISCAL_YEAR_NOT_EXPLICIT") &&
      reportsByTypePeriod.get(`${event.eventType}:${event.fiscalPeriod}`) === 1) {
      const yearless = { ...event, fiscalYear: undefined, fiscalYearLabel: undefined };
      if (knownKeys.has(`${getCorporateEventIdentityKey(yearless)}:${event.previousEventDate}`)) {
        return {
          event: { ...yearless, requiresReview: true, reviewReasons: unique },
          publish: true,
          reasons: unique,
          yearWithdrawn: true,
        };
      }
    }
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
  // The same report and date can be read twice from one notice, once with a scope suffix in its identity
  // ("QUARTERLY_REPORT:Q3:2024:CONSOLIDATED" next to "QUARTERLY_REPORT:Q3:2024"). A held reading whose twin is
  // published adds nothing to review: the calendar already carries that appointment.
  const baseKey = (event: ParsedCorporateEvent) =>
    `${getCorporateEventIdentityKey(event).split(":").slice(0, 3).join(":")}:${event.eventDate}`;
  const publishedKeys = new Set(decisions.filter((decision) => decision.publish && isReport(decision.event))
    .map((decision) => baseKey(decision.event)));
  return decisions.filter((decision) =>
    decision.publish || !isReport(decision.event) || !publishedKeys.has(baseKey(decision.event)));
}

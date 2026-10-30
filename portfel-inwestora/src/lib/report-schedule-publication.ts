import { getCorporateEventIdentityKey, type ParsedCorporateEvent } from "@/lib/corporate-events";

export type ReportPublicationDecision = {
  event: ParsedCorporateEvent;
  publish: boolean;
  reasons: string[];
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

/** Conservative policy between parsing and persistence. The parser may surface
 * ambiguous candidates for diagnostics; those are not calendar appointments. */
export function assessReportPublicationBatch(events: ParsedCorporateEvent[]): ReportPublicationDecision[] {
  const datesByIdentity = new Map<string, Set<string>>();
  for (const event of events.filter(isReport)) {
    const identity = getCorporateEventIdentityKey(event);
    const dates = datesByIdentity.get(identity) ?? new Set<string>();
    dates.add(event.eventDate);
    datesByIdentity.set(identity, dates);
  }
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
    return { event, publish: reasons.length === 0, reasons: [...new Set(reasons)] };
  });
}

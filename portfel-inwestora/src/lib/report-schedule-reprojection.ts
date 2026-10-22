import { getCorporateEventIdentityKey, type ParsedCorporateEvent } from "@/lib/corporate-events";

export type StoredReportProjection = {
  id: string;
  event_identity: string;
  event_date: string;
  source_urls: string[];
};

export type ReportReprojectionPlan = {
  deactivateIds: string[];
  retainedIds: string[];
  ambiguousIds: string[];
  missingIdentities: string[];
};

/** Never retire a projection confirmed by another source. An empty/failed
 * parse is inconclusive, so it cannot withdraw previously published events. */
export const planReportScheduleReprojection = (
  existing: StoredReportProjection[],
  parsed: ParsedCorporateEvent[],
  sourceUrl: string,
  parseComplete: boolean
): ReportReprojectionPlan => {
  const reportEvents = parsed.filter((event) =>
    event.eventType === "QUARTERLY_REPORT" || event.eventType === "HALF_YEAR_REPORT" || event.eventType === "ANNUAL_REPORT"
  );
  const identities = new Set(reportEvents.map(getCorporateEventIdentityKey));
  const publishedDates = new Set(reportEvents.map((event) => event.eventDate));
  const oldIdentities = new Set(existing.map((event) => event.event_identity));
  const plan: ReportReprojectionPlan = {
    deactivateIds: [], retainedIds: [], ambiguousIds: [],
    missingIdentities: [...identities].filter((identity) => !oldIdentities.has(identity)),
  };
  for (const event of existing) {
    if (identities.has(event.event_identity) || !parseComplete || reportEvents.length === 0) {
      plan.retainedIds.push(event.id);
      continue;
    }
    if (event.source_urls.length !== 1 || event.source_urls[0] !== sourceUrl) {
      plan.ambiguousIds.push(event.id);
      continue;
    }
    // A partially recognized schedule can omit an unrelated real report.
    // Retire only a false duplicate on a date the same document still confirms;
    // other mismatches require manual review in the dry-run plan.
    if (!publishedDates.has(event.event_date)) {
      plan.ambiguousIds.push(event.id);
      continue;
    }
    plan.deactivateIds.push(event.id);
  }
  return plan;
};

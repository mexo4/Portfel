import { getCorporateEventIdentityKey, type ParsedCorporateEvent } from "@/lib/corporate-events";

export type StoredReportProjection = {
  id: string;
  event_type: ParsedCorporateEvent["eventType"];
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

/** A failed or skipped attachment is inconclusive, even when body text yielded events. */
export const getReportScheduleProjectionStatus = (
  eventCount: number,
  parseComplete: boolean
): "SUCCESS" | "NO_EVENT" | "PARSE_ERROR" =>
  !parseComplete ? "PARSE_ERROR" : eventCount > 0 ? "SUCCESS" : "NO_EVENT";

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
  const explicitCorrections = new Map<string, ParsedCorporateEvent[]>();
  for (const event of reportEvents) {
    if (!event.previousEventDate) continue;
    const key = `${event.eventType}:${event.previousEventDate}`;
    explicitCorrections.set(key, [...(explicitCorrections.get(key) ?? []), event]);
  }
  const correctedProjectionIds = new Set<string>();
  const correctedIdentities = new Set<string>();
  for (const projection of existing) {
    const key = `${projection.event_type}:${projection.event_date}`;
    const corrections = explicitCorrections.get(key) ?? [];
    const candidates = existing.filter((candidate) =>
      candidate.event_type === projection.event_type && candidate.event_date === projection.event_date
    );
    if (corrections.length === 1 && candidates.length === 1 &&
      projection.source_urls.length === 1 && projection.source_urls[0] === sourceUrl) {
      correctedProjectionIds.add(projection.id);
      correctedIdentities.add(getCorporateEventIdentityKey(corrections[0]!));
    }
  }
  const plan: ReportReprojectionPlan = {
    deactivateIds: [], retainedIds: [], ambiguousIds: [],
    missingIdentities: [...identities].filter((identity) =>
      !oldIdentities.has(identity) && !correctedIdentities.has(identity)
    ),
  };
  for (const event of existing) {
    if (identities.has(event.event_identity) || correctedProjectionIds.has(event.id) || !parseComplete || reportEvents.length === 0) {
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

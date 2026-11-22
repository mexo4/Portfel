import {
  getCorporateEventIdentityKey,
  type NonPublicationDate,
  type ParsedCorporateEvent,
} from "@/lib/corporate-events";

export type StoredReportProjection = {
  id: string;
  event_type: ParsedCorporateEvent["eventType"];
  event_identity: string;
  event_date: string;
  source_urls: string[];
};

export type ReportRetirementReason =
  /** The same document now announces that date for the same report under another identity (relabel / duplicate). */
  | "DATE_REPUBLISHED_UNDER_OTHER_IDENTITY"
  /** The document names the stored date only as the boundary of a reporting period. */
  | "PERIOD_BOUNDARY_NOT_PUBLICATION"
  /** The document names the stored date only as the day selected unaudited data are published. */
  | "PRELIMINARY_RESULTS_NOT_PUBLICATION"
  /** The document names the stored date only as the date of the regulation it cites. */
  | "LEGAL_ACT_DATE_NOT_PUBLICATION"
  /** The row came from a notice with a contradictory year that a formal correction has since replaced. */
  | "SUPERSEDED_BY_CORRECTION"
  /** Every source linked to the row now announces its date under another identity. */
  | "ALL_SOURCES_REPUBLISH_UNDER_OTHER_IDENTITY";

export type ReportReprojectionPlan = {
  deactivateIds: string[];
  retainedIds: string[];
  /** Kept active, but nothing in the document confirms or refutes them: they belong in the review queue. */
  ambiguousIds: string[];
  /** Kept active because an event of the same document that the publication policy held back explains them. */
  heldIds: string[];
  /** Why each id in `deactivateIds` is retired; recorded with the reversible change log. */
  retirementReasons: Record<string, ReportRetirementReason>;
  missingIdentities: string[];
};

export type ReportReprojectionOptions = {
  /** Events of this document that the publication policy held back: they are not calendar rows, but they explain stored ones. */
  held?: ParsedCorporateEvent[];
  /** Dates the document mentions without announcing a report publication on them (period ends, preliminary results). */
  nonPublicationDates?: NonPublicationDate[];
};

const hasIncompleteReportIdentity = (identity: string) => {
  const [, period, fiscalYear] = identity.split(":");
  return !period || !fiscalYear;
};

const isReportEvent = (event: ParsedCorporateEvent) =>
  event.eventType === "QUARTERLY_REPORT" || event.eventType === "HALF_YEAR_REPORT" || event.eventType === "ANNUAL_REPORT";

/** A failed or skipped attachment is inconclusive, even when body text yielded events. */
export const getReportScheduleProjectionStatus = (
  eventCount: number,
  parseComplete: boolean
): "SUCCESS" | "NO_EVENT" | "PARSE_ERROR" =>
  !parseComplete ? "PARSE_ERROR" : eventCount > 0 ? "SUCCESS" : "NO_EVENT";

/**
 * Decides what happens to the active rows that were projected from one official
 * document when that document is read again.
 *
 * Never retire a projection confirmed by another source. An empty/failed parse is
 * inconclusive, so it cannot withdraw previously published events. A quarantined
 * event only protects the rows it explains (same report type and date, or same
 * identity): it no longer freezes every other row of the document.
 */
export const planReportScheduleReprojection = (
  existing: StoredReportProjection[],
  parsed: ParsedCorporateEvent[],
  sourceUrl: string,
  parseComplete: boolean,
  options: ReportReprojectionOptions = {}
): ReportReprojectionPlan => {
  const reportEvents = parsed.filter(isReportEvent);
  const heldEvents = (options.held ?? []).filter(isReportEvent);
  const identities = new Set(reportEvents.map(getCorporateEventIdentityKey));
  const publishedDates = new Set(reportEvents.map((event) => event.eventDate));
  const heldTypeDates = new Set(heldEvents.map((event) => `${event.eventType}:${event.eventDate}`));
  const heldIdentities = new Set(heldEvents.map(getCorporateEventIdentityKey));
  const nonPublication = new Map((options.nonPublicationDates ?? []).map(({ date, role }) => [date, role]));
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
  // A legacy row may have been projected before the parser knew its period
  // or fiscal year. If one complete event in this same official document and
  // one source-owned row share type and date, enrich that row in place. Never
  // infer an identity where either side is ambiguous or the source is partial.
  if (parseComplete) {
    for (const projection of existing) {
      if (!hasIncompleteReportIdentity(projection.event_identity) ||
        projection.source_urls.length !== 1 || projection.source_urls[0] !== sourceUrl) continue;
      const candidates = reportEvents.filter((event) =>
        event.eventType === projection.event_type && event.eventDate === projection.event_date &&
        !event.requiresReview && !hasIncompleteReportIdentity(getCorporateEventIdentityKey(event))
      );
      const storedCandidates = existing.filter((event) =>
        event.event_type === projection.event_type && event.event_date === projection.event_date
      );
      if (candidates.length !== 1 || storedCandidates.length !== 1) continue;
      correctedProjectionIds.add(projection.id);
      correctedIdentities.add(getCorporateEventIdentityKey(candidates[0]!));
    }
  }
  const plan: ReportReprojectionPlan = {
    deactivateIds: [], retainedIds: [], ambiguousIds: [], heldIds: [], retirementReasons: {},
    missingIdentities: [...identities].filter((identity) =>
      !oldIdentities.has(identity) && !correctedIdentities.has(identity)
    ),
  };
  for (const event of existing) {
    if (identities.has(event.event_identity) || correctedProjectionIds.has(event.id) || !parseComplete || reportEvents.length === 0) {
      plan.retainedIds.push(event.id);
      continue;
    }
    if (heldTypeDates.has(`${event.event_type}:${event.event_date}`) || heldIdentities.has(event.event_identity)) {
      plan.heldIds.push(event.id);
      continue;
    }
    if (event.source_urls.length !== 1 || event.source_urls[0] !== sourceUrl) {
      plan.ambiguousIds.push(event.id);
      continue;
    }
    // The same document still announces this very date, for another identity:
    // the row is a relabelled duplicate (an old, mistyped period or year).
    if (publishedDates.has(event.event_date)) {
      plan.deactivateIds.push(event.id);
      plan.retirementReasons[event.id] = "DATE_REPUBLISHED_UNDER_OTHER_IDENTITY";
      continue;
    }
    // A partially recognized schedule can omit an unrelated real report, so a
    // missing date alone proves nothing. A date the document names only as a
    // period boundary or as a preliminary-results day is positive evidence that
    // it never was a publication appointment (an older parser read it as one).
    const role = nonPublication.get(event.event_date);
    if (role) {
      plan.deactivateIds.push(event.id);
      plan.retirementReasons[event.id] = role === "PRELIMINARY_RESULTS" ? "PRELIMINARY_RESULTS_NOT_PUBLICATION"
        : role === "LEGAL_ACT" ? "LEGAL_ACT_DATE_NOT_PUBLICATION"
          : role === "SUPERSEDED_BY_CORRECTION" ? "SUPERSEDED_BY_CORRECTION" : "PERIOD_BOUNDARY_NOT_PUBLICATION";
      continue;
    }
    plan.ambiguousIds.push(event.id);
  }
  return plan;
};

/**
 * Rows of any provenance that are exactly the end of a period the document itself closes on that day.
 *
 * "IV kwartał 2026 - od 1 listopada do 31 stycznia 2027" says that Q4 2026 ends on 31 January 2027. A stored
 * row "Q4 2026 on 31 January 2027" is that period end taken for a publication appointment (LPP, projected by
 * an older parser from a PAP page that is not part of the ESPI queue). A report cannot be published on the last
 * day of its own period, so such a row is retired whichever source created it, unless this document itself
 * announces that identity on that day.
 */
export const planPeriodEndRetirements = (
  rows: StoredReportProjection[],
  nonPublicationDates: NonPublicationDate[],
  published: ParsedCorporateEvent[]
): string[] => {
  const closing = nonPublicationDates.filter((entry) => entry.closes);
  if (closing.length === 0) return [];
  const announced = new Set(published.filter(isReportEvent)
    .map((event) => `${getCorporateEventIdentityKey(event)}:${event.eventDate}`));
  return rows.filter((row) => closing.some((entry) =>
    entry.date === row.event_date &&
    entry.closes!.eventType === row.event_type &&
    getCorporateEventIdentityKey(entry.closes!) === row.event_identity
  ) && !announced.has(`${row.event_identity}:${row.event_date}`)).map((row) => row.id);
};

/** What another official source says today: its published events, or `undefined` when it cannot be re-read. */
export type OtherSourceReading = { published: ParsedCorporateEvent[] } | undefined;

/**
 * Rows that stay active only because other sources are linked to them, although every source now says otherwise.
 *
 * A projection confirmed by another source is never retired on one document's say-so. The same ESPI notice is
 * often stored twice (gpw.pl and PAP), and an old row with an incomplete or mistyped identity ends up linked to
 * both. When this document announces the row's date for the same report type under another identity, and every
 * other linked source - re-read now - does not support the row's identity either, no source stands behind the
 * row any more and it is a relabelled duplicate. A source that cannot be re-read keeps the row.
 */
export const planSharedRowRetirements = (
  candidates: StoredReportProjection[],
  sourceUrl: string,
  published: ParsedCorporateEvent[],
  readings: Map<string, OtherSourceReading>
): string[] => {
  const reportEvents = published.filter(isReportEvent);
  return candidates.filter((row) => {
    if (!row.source_urls.includes(sourceUrl) || row.source_urls.length < 2) return false;
    const republished = reportEvents.some((event) => event.eventType === row.event_type &&
      event.eventDate === row.event_date && getCorporateEventIdentityKey(event) !== row.event_identity);
    if (!republished) return false;
    return row.source_urls.filter((url) => url !== sourceUrl).every((url) => {
      const reading = readings.get(url);
      if (!reading) return false;
      return !reading.published.filter(isReportEvent).some((event) => event.eventType === row.event_type &&
        event.eventDate === row.event_date && getCorporateEventIdentityKey(event) === row.event_identity);
    });
  }).map((row) => row.id);
};

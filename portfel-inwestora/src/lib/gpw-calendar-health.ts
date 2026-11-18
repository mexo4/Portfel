/**
 * Health of the GPW events calendar as an operator sees it: how far the stored documents are from the current
 * projection version, what waits in the review queue and whether the active rows break the calendar's own
 * invariants. Pure types and helpers (no I/O) so that the admin API, the admin panel and the tests share them.
 */

export type GpwProjectionLane = "reports" | "meetings" | "dividends";

export type GpwLaneHealth = {
  lane: GpwProjectionLane;
  /** Projection version in code: documents projected under another one are re-evaluated by the sync. */
  version: number;
  projected: number;
  success: number;
  noEvent: number;
  unmatched: number;
  parseError: number;
  reviewRequired: number;
  /** Documents already projected, but under another version: the reprojection backlog. */
  staleVersion: number;
  oldestStalePublishedAt: string | null;
  lastProjectedAt: string | null;
};

/** One line of the review queue, as the sync stores it (strings are the legacy format). */
export type GpwReviewEntry = {
  code: string;
  /** False: held back from the calendar. True: shown without its year. Undefined: not about one event. */
  published?: boolean;
  eventType?: string;
  eventDate?: string;
  fiscalPeriod?: string | null;
  fiscalYearLabel?: string | null;
  rowIds?: string[];
};

export type GpwReviewDocument = {
  sourceId: string;
  sourceUrl: string;
  issuerName: string | null;
  title: string;
  publishedAt: string;
  entries: GpwReviewEntry[];
};

export type GpwActiveRowQuality = {
  activeReportRows: number;
  /** Rows without a period or a year in their identity. */
  incompleteIdentity: number;
  /** Of those, rows the calendar shows as "do weryfikacji" on purpose (status UNKNOWN). */
  incompleteIdentityMarkedUnverified: number;
  /** (issuer, report type, date) with more than one identity: two labels for one appointment. */
  sameTypeAndDateWithDifferentIdentities: number;
  /** One identity on several dates (scope-suffixed identities excluded). */
  oneIdentityOnSeveralDates: number;
};

export type GpwRetirementSummary = {
  since: string;
  total: number;
  byReason: Array<{ reason: string; count: number }>;
};

export type GpwCalendarHealth = {
  generatedAt: string;
  lanes: GpwLaneHealth[];
  rows: GpwActiveRowQuality;
  retirements: GpwRetirementSummary;
  reviewQueue: { documents: number; items: GpwReviewDocument[] };
  source: {
    status: string;
    lastCheckedAt?: string;
    lastSuccessAt?: string;
    isStale: boolean;
    backfillComplete: boolean;
    nextBackfillPage: number;
  };
};

const REVIEW_CODE_LABELS: Record<string, string> = {
  PUBLICATION_YEAR_CONFLICTS_WITH_PERIOD: "Rok okresu sprzeczny z datą publikacji",
  REPORT_PERIOD_MAY_BE_OVERDUE: "Okres zakończył się dawno przed datą publikacji",
  REPORT_DATE_NOT_AFTER_PERIOD_END: "Data publikacji nie jest późniejsza niż koniec okresu",
  FISCAL_YEAR_NOT_EXPLICIT: "Źródło nie podaje roku",
  PERIOD_NOT_EXPLICIT: "Źródło nie podaje okresu",
  CONFLICTING_DATES_FOR_ONE_REPORT_IDENTITY: "Dwie daty dla jednego raportu w jednym dokumencie",
  CONFLICTING_DATE_FROM_DIFFERENT_SOURCE: "Data sprzeczna z innym źródłem",
  INVALID_PUBLICATION_DATE: "Nieprawidłowa data",
  PARSER_REQUIRES_REVIEW: "Parser wymaga przeglądu",
  AMBIGUOUS_REPROJECTION: "Wiersze, których dokument nie potwierdza ani nie obala",
  ROW_HELD_BY_QUARANTINE: "Wiersze wyjaśnione przez zdarzenie wstrzymane do weryfikacji",
};

export const describeGpwReviewCode = (code: string) => REVIEW_CODE_LABELS[code] ?? code;

/** The sync stores strings (legacy) or objects; anything else is ignored rather than trusted. */
export const normalizeGpwReviewEntries = (value: unknown): GpwReviewEntry[] => {
  if (!Array.isArray(value)) return [];
  const entries: GpwReviewEntry[] = [];
  for (const item of value) {
    if (typeof item === "string" && item) { entries.push({ code: item }); continue; }
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.code !== "string" || !record.code) continue;
    entries.push({
      code: record.code,
      ...(typeof record.published === "boolean" ? { published: record.published } : {}),
      ...(typeof record.eventType === "string" ? { eventType: record.eventType } : {}),
      ...(typeof record.eventDate === "string" ? { eventDate: record.eventDate } : {}),
      ...(typeof record.fiscalPeriod === "string" || record.fiscalPeriod === null ? { fiscalPeriod: record.fiscalPeriod } : {}),
      ...(typeof record.fiscalYearLabel === "string" || record.fiscalYearLabel === null ? { fiscalYearLabel: record.fiscalYearLabel } : {}),
      ...(Array.isArray(record.rowIds) ? { rowIds: record.rowIds.filter((id): id is string => typeof id === "string") } : {}),
    });
  }
  return entries;
};

export type GpwCalendarHealthLevel = "OK" | "ATTENTION" | "DEGRADED";

/** A short, honest verdict: what the numbers say, never that the calendar is complete. */
export const assessGpwCalendarHealth = (health: GpwCalendarHealth): { level: GpwCalendarHealthLevel; findings: string[] } => {
  const findings: string[] = [];
  let level: GpwCalendarHealthLevel = "OK";
  const raise = (to: GpwCalendarHealthLevel) => {
    if (to === "DEGRADED" || (to === "ATTENTION" && level === "OK")) level = to;
  };
  for (const lane of health.lanes) {
    if (lane.parseError > 0) { findings.push(`${lane.lane}: ${lane.parseError} dokumentów z błędem odczytu`); raise("DEGRADED"); }
    if (lane.staleVersion > 0) { findings.push(`${lane.lane}: ${lane.staleVersion} dokumentów czeka na ponowną ocenę (wersja ${lane.version})`); raise("ATTENTION"); }
    if (lane.reviewRequired > 0) { findings.push(`${lane.lane}: ${lane.reviewRequired} dokumentów w kolejce przeglądu`); raise("ATTENTION"); }
  }
  if (health.rows.sameTypeAndDateWithDifferentIdentities > 0) {
    findings.push(`${health.rows.sameTypeAndDateWithDifferentIdentities} terminów z dwiema różnymi etykietami`);
    raise("DEGRADED");
  }
  if (health.rows.oneIdentityOnSeveralDates > 0) {
    findings.push(`${health.rows.oneIdentityOnSeveralDates} raportów z kilkoma datami`);
    raise("DEGRADED");
  }
  const silentIncomplete = health.rows.incompleteIdentity - health.rows.incompleteIdentityMarkedUnverified;
  if (silentIncomplete > 0) { findings.push(`${silentIncomplete} wierszy raportów bez okresu lub roku, nieoznaczonych jako niezweryfikowane`); raise("ATTENTION"); }
  if (!health.source.backfillComplete) { findings.push("Archiwum źródła nie jest uzupełnione do końca"); raise("ATTENTION"); }
  if (health.source.isStale) { findings.push("Źródło nie było odświeżane w oczekiwanym czasie"); raise("ATTENTION"); }
  return { level, findings };
};

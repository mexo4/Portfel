export type GpwBatchStatus = "BATCH_COMPLETE" | "BATCH_INCOMPLETE" | "BATCH_FAILED";
export type GpwSourceAvailability = "AVAILABLE" | "DEGRADED" | "UNKNOWN" | "LOCKED";
export type GpwFreshness = "FRESH" | "STALE" | "UNKNOWN";
export type GpwBackfillStatus = "COMPLETE" | "CONTINUING" | "UNKNOWN";
export type GpwOverlapStatus = "COMPLETE" | "INCOMPLETE" | "NOT_DUE" | "UNKNOWN";
export type GpwCoverageStatus = "UNASSESSED" | "PARTIAL" | "VERIFIED_FOR_WINDOW";

export type GpwSyncAssessmentInput = {
  nowMs?: number;
  batch?: { errors?: number; pending?: number };
  source?: {
    status?: string;
    lastCheckedAt?: string;
    lastSuccessAt?: string;
    refreshTtlMs?: number;
    isStale?: boolean;
    locked?: boolean;
    errors?: number;
    backfillComplete?: boolean;
    nextBackfillCursor?: number | string;
    overlapDue?: boolean;
    overlapComplete?: boolean;
  };
  projections?: { pending?: number; errors?: number; unmatched?: number; reviewed?: number };
  /**
   * A coverage claim requires an independently captured inventory for one
   * explicit date window. Queue counters alone are never coverage evidence.
   */
  coverageEvidence?: {
    fromDate: string;
    toDate: string;
    inventorySource: string;
    /** The source operator has verified this is a complete inventory for the window. */
    inventoryComplete: boolean;
    expectedSourceIds: readonly string[];
    observedSourceIds: readonly string[];
  };
};

export type GpwSyncAssessment = {
  batchStatus: GpwBatchStatus;
  source: {
    availability: GpwSourceAvailability;
    freshness: GpwFreshness;
    status: string;
    lastCheckedAt?: string;
    lastSuccessAt?: string;
    errors: number;
    errorCounterValid: boolean;
  };
  historicalBackfill: { status: GpwBackfillStatus; nextCursor?: number | string };
  overlapRepair: GpwOverlapStatus;
  projections: {
    batchStatus: GpwBatchStatus;
    pending: number;
    errors: number;
    unmatched: number;
    reviewed: number;
    dataQuality: "NO_REVIEW_ITEMS" | "REVIEW_REQUIRED";
  };
  coverage: {
    status: GpwCoverageStatus;
    fromDate?: string;
    toDate?: string;
    inventorySource?: string;
    expected: number;
    observed: number;
    missing: number;
  };
};

const isValidCount = (value: number | undefined) =>
  value === undefined || (Number.isSafeInteger(value) && value >= 0);

const countOrZero = (value: number | undefined) =>
  value === undefined ? 0 : Number.isSafeInteger(value) && value >= 0 ? value : 0;

export const getGpwBatchStatus = ({
  errors = 0,
  pending = 0,
}: {
  errors?: number;
  pending?: number;
} = {}): GpwBatchStatus => {
  // An invalid counter is not evidence of a clean batch. Treat it as failed
  // so NaN/negative/overflow values can never silently report COMPLETE.
  if (!isValidCount(errors) || !isValidCount(pending) || countOrZero(errors) > 0) return "BATCH_FAILED";
  if (countOrZero(pending) > 0) return "BATCH_INCOMPLETE";
  return "BATCH_COMPLETE";
};

const getCoverageAssessment = (
  evidence: GpwSyncAssessmentInput["coverageEvidence"],
): GpwSyncAssessment["coverage"] => {
  if (!evidence || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.fromDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(evidence.toDate) || evidence.fromDate > evidence.toDate ||
    !evidence.inventorySource.trim()) {
    return { status: "UNASSESSED", expected: 0, observed: 0, missing: 0 };
  }

  const expectedIds = new Set(evidence.expectedSourceIds.filter(Boolean));
  const observedIds = new Set(evidence.observedSourceIds.filter(Boolean));
  const observed = [...expectedIds].filter((id) => observedIds.has(id)).length;
  const missing = expectedIds.size - observed;
  // Empty inventories are not positive evidence: a source might simply have
  // returned no data or the inventory may itself be incomplete.
  const status = evidence.inventoryComplete && expectedIds.size > 0 && missing === 0
    ? "VERIFIED_FOR_WINDOW"
    : "PARTIAL";
  return {
    status,
    fromDate: evidence.fromDate,
    toDate: evidence.toDate,
    inventorySource: evidence.inventorySource,
    expected: expectedIds.size,
    observed,
    missing,
  };
};

/**
 * Reports independent health dimensions. A complete bounded batch does not
 * claim complete source history, a drained projection queue, or market-wide
 * coverage; those are represented separately.
 */
export const assessGpwSync = (input: GpwSyncAssessmentInput = {}): GpwSyncAssessment => {
  const nowMs = input.nowMs ?? Date.now();
  const source = input.source ?? {};
  const sourceErrorCounterValid = isValidCount(source.errors);
  const sourceErrors = countOrZero(source.errors);
  const status = source.status ?? "NOT_SYNCED";
  const hasCheckedAt = Boolean(source.lastCheckedAt && Number.isFinite(Date.parse(source.lastCheckedAt)));
  const computedStale = !hasCheckedAt || nowMs - Date.parse(source.lastCheckedAt!) > (source.refreshTtlMs ?? 60 * 60 * 1_000);
  const freshness: GpwFreshness = source.isStale === undefined
    ? hasCheckedAt ? (computedStale ? "STALE" : "FRESH") : "UNKNOWN"
    : source.isStale ? "STALE" : "FRESH";

  let availability: GpwSourceAvailability;
  if (source.locked) availability = "LOCKED";
  else if (status === "SUCCESS" && sourceErrorCounterValid && sourceErrors === 0) availability = "AVAILABLE";
  else if (status === "NOT_SYNCED" || status === "NOT_FOUND") availability = "UNKNOWN";
  else availability = "DEGRADED";

  const projectionInput = input.projections ?? {};
  const projectionPending = countOrZero(projectionInput.pending);
  const projectionErrors = countOrZero(projectionInput.errors);
  const unmatched = countOrZero(projectionInput.unmatched);
  const reviewed = countOrZero(projectionInput.reviewed);
  const invalidProjectionCount = !isValidCount(projectionInput.pending) ||
    !isValidCount(projectionInput.errors) || !isValidCount(projectionInput.unmatched) ||
    !isValidCount(projectionInput.reviewed);

  return {
    batchStatus: getGpwBatchStatus(input.batch),
    source: {
      availability,
      freshness,
      status,
      ...(hasCheckedAt ? { lastCheckedAt: source.lastCheckedAt } : {}),
      ...(source.lastSuccessAt ? { lastSuccessAt: source.lastSuccessAt } : {}),
      errors: sourceErrors,
      errorCounterValid: sourceErrorCounterValid,
    },
    historicalBackfill: {
      status: source.backfillComplete === undefined ? "UNKNOWN" : source.backfillComplete ? "COMPLETE" : "CONTINUING",
      ...(source.nextBackfillCursor === undefined ? {} : { nextCursor: source.nextBackfillCursor }),
    },
    overlapRepair: source.overlapDue === undefined
      ? "UNKNOWN"
      : !source.overlapDue ? "NOT_DUE"
      : source.overlapComplete === undefined ? "UNKNOWN"
      : source.overlapComplete ? "COMPLETE" : "INCOMPLETE",
    projections: {
      batchStatus: invalidProjectionCount
        ? "BATCH_FAILED"
        : getGpwBatchStatus({ errors: projectionErrors, pending: projectionPending }),
      pending: projectionPending,
      errors: projectionErrors,
      unmatched,
      reviewed,
      dataQuality: unmatched + reviewed > 0 ? "REVIEW_REQUIRED" : "NO_REVIEW_ITEMS",
    },
    coverage: getCoverageAssessment(input.coverageEvidence),
  };
};

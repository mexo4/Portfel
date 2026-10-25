/**
 * Reserved independent holdout.
 *
 * This array is intentionally empty until each record has two independent,
 * source-based annotations. Do not place a parser-generated expectation here.
 * A valid record must be a normal GPW audit document plus:
 * - reviewStatus: "INDEPENDENTLY_ANNOTATED"
 * - parserFrozenAt: immutable parser revision selected before evaluation
 * - sourceHash: digest of the fetched official source body
 * - reviewers: two distinct annotation records
 * - evidence: a short source-based explanation for every expected event
 */
export const gpwIndependentHoldout = Object.freeze([]);

/**
 * Projection versions of the three GPW calendar lanes.
 *
 * `espi_reports` remembers the version with which each stored ESPI document was last projected; the sync
 * re-evaluates a document only when that number differs from the one below (or on retry/force). Whenever
 * `parseCorporateEventDocument` starts producing different events for a lane, bump that lane's version in the
 * same change, otherwise already-stored documents keep their old projection forever. The guard test
 * `tests/gpw-projection-version-guard.test.mjs` fails when the parser output and these numbers disagree.
 *
 *   node --experimental-strip-types --import ./tests/register-alias-loader.mjs scripts/gpw-projection-fingerprint.mjs --write
 */

/**
 * 11: wrapped rows/headings/corrections (2026-11-18), retirement of rows a re-read document no longer supports,
 * and publication without year for rows whose source year is inconsistent.
 */
export const REPORT_SCHEDULE_PROJECTION_VERSION = 11;

/**
 * 9: the parser changed after version 8 was set (24.10.2026 16:47) without a bump; on the 78-document corpus the
 * parser of that day yields 17 meeting events where the current one yields 19.
 */
export const GENERAL_MEETING_PROJECTION_VERSION = 9;

/**
 * 9: same cause for dividends (version 8 dates from 22.10.2026): 22 events on the 78-document corpus then,
 * 24 now (record/payment dates among them).
 */
export const DIVIDEND_PROJECTION_VERSION = 9;

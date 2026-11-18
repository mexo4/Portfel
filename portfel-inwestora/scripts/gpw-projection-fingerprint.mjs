// Fingerprints of what the GPW event parser extracts from a fixed set of real documents, per projection lane.
//
// The projection queue re-evaluates a stored ESPI document only when its recorded projection version differs
// from the version in code. A parser change that is not followed by a version bump therefore never reaches the
// stored calendar rows (this is how the fixes of PR #17/#18 stayed out of production data). The guard test
// (tests/gpw-projection-version-guard.test.mjs) pins the output of the current parser to these fingerprints and
// to the versions in src/lib/gpw-projection-versions.ts.
//
//   node --experimental-strip-types --import ./tests/register-alias-loader.mjs scripts/gpw-projection-fingerprint.mjs --write
//
// rewrites tests/fixtures/gpw-projection-fingerprints.json after a deliberate parser change. It refuses to record
// a changed fingerprint for an unchanged corpus unless the lane's projection version was bumped first.
// `--force` skips that refusal for a further parser change made within the same, still unreleased, version bump.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FINGERPRINT_FIXTURE = path.join(root, "tests", "fixtures", "gpw-projection-fingerprints.json");

const REPORT_TYPES = new Set(["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT"]);
export const PROJECTION_LANES = {
  reports: (event) => REPORT_TYPES.has(event.eventType),
  meetings: (event) => event.eventType === "GENERAL_MEETING",
  dividends: (event) => event.eventType === "UPCOMING_DIVIDEND",
};

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value)
      // Evidence text is clipped prose kept for humans; it does not decide any projected row.
      .filter((key) => key !== "sourceEvidence" && value[key] !== undefined)
      .sort()
      .map((key) => [key, canonical(value[key])]));
  }
  return value;
};

/** The fixed documents: the reference corpus, the three prospective holdouts and the wrapped-row filings. */
export const loadProjectionCorpus = async () => {
  const fixtures = pathToFileURL(path.join(root, "tests", "fixtures") + path.sep).href;
  const sets = [
    ["reference", "gpw-reference-corpus-2026-10-24.mjs", "gpwReferenceCorpus", "parserInput"],
    ["holdout-D", "gpw-prospective-holdout-D-2026-10-24.mjs", "gpwProspectiveHoldoutD", "parserInput"],
    ["holdout-E", "gpw-prospective-holdout-E-2026-10-24.mjs", "gpwProspectiveHoldoutE", "parserInput"],
    ["holdout-F", "gpw-prospective-holdout-F-2026-10-24.mjs", "gpwProspectiveHoldoutF", "parserInput"],
    ["wrapped", "gpw-wrapped-schedule-rows-2026-11-18.mjs", "gpwWrappedScheduleRows", "text"],
  ];
  const documents = [];
  for (const [group, file, exportName, field] of sets) {
    const module = await import(`${fixtures}${file}`);
    for (const entry of module[exportName]) documents.push({ id: `${group}:${entry.id}`, text: entry[field] });
  }
  return documents;
};

export const computeProjectionFingerprints = (documents, parse) => {
  const result = {};
  for (const [lane, accepts] of Object.entries(PROJECTION_LANES)) {
    const rows = documents.map(({ id, text }) => [id, parse(text).filter(accepts).map(canonical)]);
    result[lane] = {
      documents: documents.length,
      events: rows.reduce((total, [, events]) => total + events.length, 0),
      sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  return result;
};

const main = async () => {
  const args = process.argv.slice(2);
  const parserArg = args.indexOf("--parser");
  const parserPath = parserArg >= 0 ? args[parserArg + 1] : path.join(root, "src", "lib", "corporate-events.ts");
  const { parseCorporateEventDocument } = await import(pathToFileURL(path.resolve(parserPath)).href);
  const versions = await import(pathToFileURL(path.join(root, "src", "lib", "gpw-projection-versions.ts")).href);
  const documents = await loadProjectionCorpus();
  const fingerprints = computeProjectionFingerprints(documents, parseCorporateEventDocument);
  const next = {
    reports: { version: versions.REPORT_SCHEDULE_PROJECTION_VERSION, ...fingerprints.reports },
    meetings: { version: versions.GENERAL_MEETING_PROJECTION_VERSION, ...fingerprints.meetings },
    dividends: { version: versions.DIVIDEND_PROJECTION_VERSION, ...fingerprints.dividends },
  };
  if (!args.includes("--write")) {
    console.log(JSON.stringify(next, null, 2));
    return;
  }
  let recorded = {};
  try { recorded = JSON.parse(readFileSync(FINGERPRINT_FIXTURE, "utf8")); } catch { /* first recording */ }
  const refused = args.includes("--force") ? [] : Object.keys(next).filter((lane) => {
    const before = recorded[lane];
    return before && before.version === next[lane].version && before.documents === next[lane].documents &&
      before.sha256 !== next[lane].sha256;
  });
  if (refused.length) {
    console.error(`The parser output for ${refused.join(", ")} changed on an unchanged corpus while its projection version did not.\n` +
      "Bump the matching *_PROJECTION_VERSION in src/lib/gpw-projection-versions.ts so that stored documents are re-evaluated, then run this again.");
    process.exitCode = 1;
    return;
  }
  writeFileSync(FINGERPRINT_FIXTURE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Recorded ${FINGERPRINT_FIXTURE}`);
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();

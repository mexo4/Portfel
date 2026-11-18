import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import {
  DIVIDEND_PROJECTION_VERSION,
  GENERAL_MEETING_PROJECTION_VERSION,
  REPORT_SCHEDULE_PROJECTION_VERSION,
} from "../src/lib/gpw-projection-versions.ts";
import {
  FINGERPRINT_FIXTURE,
  computeProjectionFingerprints,
  loadProjectionCorpus,
} from "../scripts/gpw-projection-fingerprint.mjs";

// Why this test exists: the projection queue re-evaluates a stored ESPI document only when its recorded
// projection version differs from the version in code. PR #17/#18 changed the parser three times after the
// last bump, so no stored document was ever re-read and the production calendar kept the old rows.
// If this test fails you changed what the parser extracts: bump the lane's version in
// src/lib/gpw-projection-versions.ts and record the new fingerprint with
//   node --experimental-strip-types --import ./tests/register-alias-loader.mjs scripts/gpw-projection-fingerprint.mjs --write

const versions = {
  reports: REPORT_SCHEDULE_PROJECTION_VERSION,
  meetings: GENERAL_MEETING_PROJECTION_VERSION,
  dividends: DIVIDEND_PROJECTION_VERSION,
};
const recorded = JSON.parse(readFileSync(FINGERPRINT_FIXTURE, "utf8"));
const current = computeProjectionFingerprints(await loadProjectionCorpus(), parseCorporateEventDocument);

for (const lane of Object.keys(versions)) {
  test(`${lane}: the recorded projection version is the one in code`, () => {
    assert.equal(recorded[lane]?.version, versions[lane],
      `${lane} projection version in code (${versions[lane]}) differs from the recorded one (${recorded[lane]?.version}); re-record the fingerprint`);
  });

  test(`${lane}: parser output on the fixed corpus matches the recorded fingerprint`, () => {
    assert.equal(current[lane].documents, recorded[lane]?.documents, "corpus size changed; re-record the fingerprint");
    assert.equal(current[lane].sha256, recorded[lane]?.sha256,
      `The parser now extracts different ${lane} events from the same documents. Stored documents are only ` +
      "re-evaluated when their projection version differs: bump the version in src/lib/gpw-projection-versions.ts " +
      "and re-record the fingerprint (scripts/gpw-projection-fingerprint.mjs --write).");
  });
}

test("versions are positive integers", () => {
  for (const [lane, version] of Object.entries(versions)) {
    assert.ok(Number.isInteger(version) && version > 0, lane);
  }
});

test("the fingerprint corpus is not trivially empty for any lane", () => {
  for (const [lane, fingerprint] of Object.entries(current)) {
    assert.ok(fingerprint.events >= 10, `${lane}: ${fingerprint.events} events`);
  }
});

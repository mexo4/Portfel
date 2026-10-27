import assert from "node:assert/strict";
import test from "node:test";
import { selectGpwHoldoutIntake } from "../scripts/gpw-holdout-intake.mjs";

const document = (id, issuer, isin, title = "Komunikat") => ({
  id, issuer, sourceIsin: isin, title, parseStatus: "PARSED", fetchStatus: "FETCHED",
  sourceUrl: `https://www.gpw.pl/komunikat?geru_id=${id}`, publishedAt: "2026-10-25T09:00:00Z",
  bodyHash: `public-body-${id}`, eventCount: 99,
});

test("holdout intake is issuer-disjoint, deterministic and has no invented expected labels", () => {
  const documents = [
    document("1", "Issuer Alpha S.A.", "PL0000000001", "Harmonogram raportów okresowych"),
    document("2", "Issuer Alpha", "PL0000000002", "Komunikat"),
    document("3", "Issuer Beta", "PL0000000003", "Walne zgromadzenie akcjonariuszy"),
    document("4", "Issuer Gamma", "PL0000000004", "Dywidenda"),
    document("5", "Issuer Delta", "PL0000000005", "Komunikat"),
    document("6", "Issuer Epsilon", "PL0000000006", "Komunikat"),
    document("7", "Prior Known", "PL0000000007", "Komunikat"),
    document("8", "Different name", "PL0000000008", "Komunikat"),
  ];
  const options = { knownCorpus: [{ issuer: "Prior Known", sourceIsin: "PL0000000007" }],
    priorQueue: [{ issuer: "Another name", issuerIsin: "PL0000000008" }],
    target: 4, seed: "regression-seed" };
  const first = selectGpwHoldoutIntake({ documents, ...options });
  const reversed = selectGpwHoldoutIntake({ documents: [...documents].reverse(), ...options });
  assert.deepEqual(first.documents, reversed.documents);
  assert.equal(first.selectedCount, 4);
  assert.equal(first.status, "ANNOTATION_PENDING");
  assert.equal(new Set(first.documents.map((item) => item.issuer)).size, 4);
  assert.equal(first.documents.some((item) => item.issuer === "Prior Known"), false);
  assert.equal(first.documents.some((item) => item.issuer === "Different name"), false);
  assert.ok(first.documents.every((item) => item.expectedEvents === null && item.reviewers.length === 0 &&
    item.reviewStatus === "PENDING_INDEPENDENT_SOURCE_ANNOTATION"));
  assert.ok(first.documents.every((item) => !("eventCount" in item)));

  const issuerDisjoint = selectGpwHoldoutIntake({ documents: documents.slice(0, 6), target: 6 });
  assert.equal(issuerDisjoint.selectedCount, 5);
  assert.equal(issuerDisjoint.status, "INSUFFICIENT_ISSUER_DIVERSE_POOL");
});

test("holdout intake reports an insufficient pool rather than inflating the sample", () => {
  const selected = selectGpwHoldoutIntake({ documents: [document("1", "Only one", "PL0000000001")],
    target: 30 });
  assert.equal(selected.status, "INSUFFICIENT_ISSUER_DIVERSE_POOL");
  assert.equal(selected.selectedCount, 1);
});

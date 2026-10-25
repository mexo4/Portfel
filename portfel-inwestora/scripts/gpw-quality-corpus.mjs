import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { gpwReferenceCorpus } from "../tests/fixtures/gpw-reference-corpus-2026-10-24.mjs";
import { gpwProspectiveHoldoutD } from "../tests/fixtures/gpw-prospective-holdout-D-2026-10-24.mjs";
import { gpwProspectiveHoldoutE } from "../tests/fixtures/gpw-prospective-holdout-E-2026-10-24.mjs";
import { gpwProspectiveHoldoutF } from "../tests/fixtures/gpw-prospective-holdout-F-2026-10-24.mjs";
import { gpwIndependentHoldout } from "../tests/fixtures/gpw-independent-holdout-2026-10-24.mjs";

export { gpwIndependentHoldout };

const appRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

/**
 * These fixtures are source-annotated regression evidence. Some were used in
 * prior parser work, so they are intentionally not labelled an independent
 * holdout by this module or its reports.
 */
export const gpwKnownAnnotatedCorpus = Object.freeze([
  ...gpwReferenceCorpus,
  ...gpwProspectiveHoldoutD,
  ...gpwProspectiveHoldoutE,
  ...gpwProspectiveHoldoutF,
]);

/**
 * Validates that a source-set aside for final evaluation really is independent
 * evidence instead of a renamed development fixture. Invalid entries are
 * excluded and returned as explicit review findings by the audit command.
 */
export const validateIndependentHoldout = (documents = gpwIndependentHoldout) => {
  const valid = [];
  const invalid = [];
  for (const document of documents) {
    const reasons = [];
    if (document.reviewStatus !== "INDEPENDENTLY_ANNOTATED") reasons.push("reviewStatus");
    if (!/^https:\/\//.test(document.sourceUrl ?? "")) reasons.push("sourceUrl");
    if (typeof document.sourceHash !== "string" || document.sourceHash.length < 16) reasons.push("sourceHash");
    if (typeof document.parserFrozenAt !== "string" || document.parserFrozenAt.length < 7) reasons.push("parserFrozenAt");
    if (!Array.isArray(document.reviewers) || new Set(document.reviewers.map((review) => review.reviewerId)).size < 2) reasons.push("twoIndependentReviewers");
    if (!Array.isArray(document.expectedEvents)) reasons.push("expectedEvents");
    if (!Array.isArray(document.evidence) || document.evidence.length < document.expectedEvents?.length) reasons.push("evidence");
    if (reasons.length) invalid.push({ id: document.id ?? "unknown", reasons });
    else valid.push(document);
  }
  return { valid, invalid };
};

export const loadGpwSourceReviewQueue = async () => JSON.parse(await readFile(
  path.join(appRoot, "docs", "gpw-source-review-queue-2026-10-24.json"),
  "utf8",
));

export const summarizeGpwCorpus = (documents = gpwKnownAnnotatedCorpus, independentDocuments = []) => ({
  documents: documents.length,
  issuers: new Set(documents.map((document) => document.issuer)).size,
  expectedEvents: documents.reduce((total, document) => total + (document.expectedEvents?.length ?? 0), 0),
  sourceLinkedDocuments: documents.filter((document) => /^https:\/\//.test(document.sourceUrl ?? "")).length,
  groups: Object.fromEntries([...new Set(documents.map((document) => document.group))]
    .sort().map((group) => [group, documents.filter((document) => document.group === group).length])),
  independentlyAnnotatedDocuments: independentDocuments.length,
  independentlyAnnotatedIssuers: new Set(independentDocuments.map((document) => document.issuer)).size,
  independentlyExpectedEvents: independentDocuments.reduce((total, document) => total + (document.expectedEvents?.length ?? 0), 0),
});

/** Full evaluation needs a broad reference corpus plus a genuinely untouched
 * holdout. Holdout evidence cannot make up for an undersized reference corpus. */
export const meetsIndependentAuditThreshold = ({
  referenceDocuments,
  independentDocuments,
  invalidHoldoutDocuments,
}) => referenceDocuments >= 100 && independentDocuments >= 30 && invalidHoldoutDocuments === 0;

export const sourceQueueSummary = (queue) => ({
  discoveredDocuments: queue.documents?.length ?? 0,
  statusCounts: Object.fromEntries(Object.entries((queue.documents ?? []).reduce((counts, document) => {
    counts[document.reviewStatus] = (counts[document.reviewStatus] ?? 0) + 1;
    return counts;
  }, {})).sort(([left], [right]) => left.localeCompare(right))),
  uniqueIssuers: new Set((queue.documents ?? []).map((document) => document.issuer)).size,
  note: queue.note,
});

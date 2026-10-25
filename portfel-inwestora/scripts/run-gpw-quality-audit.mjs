import { basename } from "node:path";
import { readFile } from "node:fs/promises";

import { auditGpwDocuments, auditGpwProjectionSnapshots, auditGpwSourceInventory } from "../src/lib/gpw-quality-audit.ts";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { scanGpwParserPolicy } from "./gpw-parser-policy.mjs";
import {
  gpwIndependentHoldout,
  gpwKnownAnnotatedCorpus,
  loadGpwSourceReviewQueue,
  sourceQueueSummary,
  summarizeGpwCorpus,
  validateIndependentHoldout,
} from "./gpw-quality-corpus.mjs";
import { getAuditOutputDirectory, getOption, printArtifactSummary, renderGpwAuditMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const readSnapshotArray = async (option, label) => {
  const inputPath = getOption(option);
  if (!inputPath) return { values: undefined, file: undefined };
  const parsed = JSON.parse(await readFile(inputPath, "utf8"));
  const values = Array.isArray(parsed) ? parsed : parsed.items;
  if (!Array.isArray(values)) throw new Error(`${label} must be a JSON array or an object with an items array.`);
  return { values, file: basename(inputPath) };
};

const report = auditGpwDocuments(gpwKnownAnnotatedCorpus, parseCorporateEventDocument);
const independentHoldout = validateIndependentHoldout(gpwIndependentHoldout);
const independentReport = independentHoldout.valid.length
  ? auditGpwDocuments(independentHoldout.valid, parseCorporateEventDocument)
  : undefined;
const [policy, sourceQueue] = await Promise.all([scanGpwParserPolicy(), loadGpwSourceReviewQueue()]);
const [providedInventory, sourceEventsSnapshot, projectionEventsSnapshot, cacheEventsSnapshot] = await Promise.all([
  readSnapshotArray("source-inventory", "source inventory"),
  readSnapshotArray("source-events", "source event snapshot"),
  readSnapshotArray("projection-events", "projection event snapshot"),
  readSnapshotArray("cache-events", "cache event snapshot"),
]);
if (Boolean(sourceEventsSnapshot.values) !== Boolean(projectionEventsSnapshot.values)) {
  throw new Error("--source-events and --projection-events must be supplied together for a read-only projection comparison.");
}
if (cacheEventsSnapshot.values && !sourceEventsSnapshot.values) {
  throw new Error("--cache-events requires --source-events and --projection-events.");
}
const corpus = summarizeGpwCorpus(gpwKnownAnnotatedCorpus, independentHoldout.valid);
const sourceIndex = sourceQueueSummary(sourceQueue);
const defaultSourceInventory = [
  ...gpwKnownAnnotatedCorpus.map((document) => ({
    id: document.id,
    issuer: document.issuer,
    sourceUrl: document.sourceUrl,
    fetchStatus: document.fetchStatus ?? "FETCHED",
    parseStatus: "PARSED",
    parsedEventCount: document.expectedEvents?.length ?? 0,
  })),
  ...(sourceQueue.documents ?? []).map((document) => ({
    id: document.id,
    issuer: document.issuer,
    sourceUrl: document.sourceUrl,
    fetchStatus: "DISCOVERED",
    parseStatus: "NOT_ATTEMPTED",
  })),
];
const sourceInventory = auditGpwSourceInventory(providedInventory.values ?? defaultSourceInventory);
const projectionFindings = sourceEventsSnapshot.values
  ? auditGpwProjectionSnapshots(sourceEventsSnapshot.values, projectionEventsSnapshot.values, cacheEventsSnapshot.values ?? [])
  : [];
const projectionComparison = {
  status: sourceEventsSnapshot.values ? (projectionFindings.length ? "FINDINGS_REQUIRING_REVIEW" : "PASS") : "NOT_RUN",
  sourceEvents: sourceEventsSnapshot.values?.length ?? 0,
  projectedEvents: projectionEventsSnapshot.values?.length ?? 0,
  cachedEvents: cacheEventsSnapshot.values?.length ?? 0,
  findings: projectionFindings,
  note: sourceEventsSnapshot.values
    ? "Read-only snapshot comparison; findings are review items, never direct repair instructions."
    : "No source/projection snapshots were supplied. Fixture-level API/ICS contracts still run in gpw:e2e.",
};
const parserRegressionFree = report.totals.falsePositives === 0 && report.totals.falseNegatives === 0;
const fullIndependentAuditReady =
  corpus.documents + corpus.independentlyAnnotatedDocuments >= 100 &&
  corpus.independentlyAnnotatedDocuments >= 30 &&
  independentHoldout.invalid.length === 0;
const status = policy.status === "FAIL" || !parserRegressionFree ? "FAIL" : "PASS_WITH_LIMITATIONS";

const output = {
  ...report,
  independentHoldout: {
    status: independentReport ? "MEASURED" : "NOT_READY",
    documents: independentHoldout.valid.length,
    rejectedDocuments: independentHoldout.invalid,
    report: independentReport,
    note: "Holdout metrics are reported separately and are never merged into the development-regression metric set.",
  },
  sourceIndex,
  sourceInventory,
  projectionComparison,
  suppliedInputs: {
    sourceInventory: providedInventory.file,
    sourceEvents: sourceEventsSnapshot.file,
    projectionEvents: projectionEventsSnapshot.file,
    cacheEvents: cacheEventsSnapshot.file,
  },
  corpus,
  antiTickerPolicy: policy,
  qualityGate: {
    status,
    parserRegressionFree,
    fullIndependentAuditReady,
    reason: fullIndependentAuditReady
      ? "The configured independent-corpus threshold is met."
      : "The deterministic fixture gate passed, but the repository does not yet contain 100 independently source-annotated documents and a 30-document untouched holdout.",
  },
};
output.scope.limitations = [
  ...output.scope.limitations,
  "The source-review queue is discovery evidence only; it is excluded from precision, recall and F1 until independently annotated.",
  "PASS_WITH_LIMITATIONS never means GPW-wide completeness or production projection correctness.",
];

const artifacts = await writeGpwQualityArtifacts({
  outputDir: getAuditOutputDirectory(),
  basename: "audit",
  report: output,
  markdown: `${renderGpwAuditMarkdown("GPW parser quality audit", output)}

## Quality gate

- Status: **${output.qualityGate.status}**
- Parser regression-free fixture set: ${output.qualityGate.parserRegressionFree ? "yes" : "no"}
- Full independent audit threshold met: ${output.qualityGate.fullIndependentAuditReady ? "yes" : "no"}
- Reason: ${output.qualityGate.reason}

## Source-review intake

- Newly indexed official-source leads: ${sourceIndex.discoveredDocuments}
- Distinct issuers in source-review intake: ${sourceIndex.uniqueIssuers}
- Review statuses: ${Object.entries(sourceIndex.statusCounts).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}
- Inventory rows requiring retry/resume: ${sourceInventory.resyncRequiredDocumentIds.length}

## Projection/cache comparison

- Status: **${projectionComparison.status}**
- Source events: ${projectionComparison.sourceEvents}; projections: ${projectionComparison.projectedEvents}; cache rows: ${projectionComparison.cachedEvents}
- Findings: ${projectionComparison.findings.length}
- ${projectionComparison.note}

## Independent holdout

- Status: **${output.independentHoldout.status}**
- Valid independently annotated documents: ${output.independentHoldout.documents}
- Invalid/rejected holdout records: ${output.independentHoldout.rejectedDocuments.length}
- Holdout metrics are separate from the 57-document development regression corpus.

## Anti-ticker policy

- Status: **${policy.status}**
- Production parser decisions found: ${policy.findings.length}
- Documented source-seed metadata: ${policy.documentedExceptions.length}
`,
});

printArtifactSummary({
  name: "gpw:audit",
  status,
  artifacts,
  summary: {
    documents: corpus.documents,
    expectedEvents: corpus.expectedEvents,
    precision: report.totals.precision,
    recall: report.totals.recall,
    f1: report.totals.f1,
    policyFindings: policy.findings.length,
    independentHoldoutDocuments: independentHoldout.valid.length,
    fullIndependentAuditReady,
  },
});

if (status === "FAIL") process.exitCode = 1;

import { auditGpwDocuments } from "../src/lib/gpw-quality-audit.ts";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { gpwKnownAnnotatedCorpus, summarizeGpwCorpus } from "./gpw-quality-corpus.mjs";
import { getAuditOutputDirectory, printArtifactSummary, renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const parserAudit = auditGpwDocuments(gpwKnownAnnotatedCorpus, parseCorporateEventDocument);
const byCode = Object.fromEntries([...new Set(parserAudit.findings.map((finding) => finding.code))]
  .sort().map((code) => [code, parserAudit.findings.filter((finding) => finding.code === code).length]));
const byClassification = Object.fromEntries([...new Set(parserAudit.findings.map((finding) => finding.classification))]
  .sort().map((classification) => [classification, parserAudit.findings.filter((finding) => finding.classification === classification).length]));
const report = {
  schemaVersion: 1,
  scope: {
    ...parserAudit.scope,
    coverage: "FIXTURE_ONLY",
    limitations: [
      ...parserAudit.scope.limitations,
      "This command never fetches sources or writes projections. It detects anomalies only in the explicit fixture scope.",
      "A source/projection inventory may be supplied to auditGpwProjectionSnapshots separately for a read-only completeness comparison.",
    ],
  },
  corpus: summarizeGpwCorpus(),
  findings: parserAudit.findings,
  counts: { byCode, byClassification },
  status: parserAudit.findings.some((finding) => finding.confidence === "CONFIRMED")
    ? "FINDINGS_REQUIRING_ACTION"
    : parserAudit.findings.length ? "REVIEW_FINDINGS" : "NO_FIXTURE_ANOMALIES",
};

const findingRows = report.findings.length
  ? report.findings.map((finding) => `| ${finding.code} | ${finding.classification} | ${finding.confidence} | ${finding.issuer} | ${finding.documentId} |`).join("\n")
  : "| none | n/a | n/a | n/a | n/a |";
const artifacts = await writeGpwQualityArtifacts({
  outputDir: getAuditOutputDirectory(),
  basename: "anomalies",
  report,
  markdown: renderGenericMarkdown("GPW parser anomaly report", [
    { heading: "Scope", body: `- Documents: ${report.scope.documents}\n- Expected events: ${report.corpus.expectedEvents}\n- Status: **${report.status}**` },
    { heading: "Counts by code", body: Object.keys(byCode).length ? Object.entries(byCode).map(([key, value]) => `- ${key}: ${value}`).join("\n") : "- No detected fixture anomalies." },
    { heading: "Findings", body: `| Code | Classification | Confidence | Issuer | Document |\n| --- | --- | --- | --- | --- |\n${findingRows}` },
    { heading: "Limitations", body: report.scope.limitations.map((limit) => `- ${limit}`).join("\n") },
  ]),
});

printArtifactSummary({
  name: "gpw:anomalies",
  status: report.status,
  artifacts,
  summary: { findings: report.findings.length, byCode },
});

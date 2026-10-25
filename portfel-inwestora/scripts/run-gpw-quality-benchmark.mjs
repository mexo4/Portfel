import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { gpwKnownAnnotatedCorpus, summarizeGpwCorpus } from "./gpw-quality-corpus.mjs";
import { getAuditOutputDirectory, printArtifactSummary, renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const rounds = 9;
const warmupRounds = 3;
const orderedInputs = [...gpwKnownAnnotatedCorpus]
  .sort((left, right) => left.id.localeCompare(right.id))
  .map((document) => document.parserInput ?? "");

const runOnce = () => {
  const start = process.hrtime.bigint();
  let eventCount = 0;
  for (const input of orderedInputs) eventCount += parseCorporateEventDocument(input).length;
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  return { elapsedMs, eventCount };
};

for (let index = 0; index < warmupRounds; index += 1) runOnce();
const samples = Array.from({ length: rounds }, runOnce).sort((left, right) => left.elapsedMs - right.elapsedMs);
const percentile = (fraction) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * fraction) - 1)]?.elapsedMs ?? null;
const eventCounts = [...new Set(samples.map((sample) => sample.eventCount))];
const report = {
  schemaVersion: 1,
  scope: {
    ...summarizeGpwCorpus(),
    parser: "parseCorporateEventDocument",
    order: "lexicographic fixture id",
    warmupRounds,
    measuredRounds: rounds,
    limitations: [
      "Wall-clock parser timing is runner-dependent and is reported as an observation, not a cross-machine pass/fail threshold.",
      "The benchmark uses checked-in source excerpts only and performs no network or database I/O.",
    ],
  },
  result: {
    eventCounts,
    deterministicOutputCount: eventCounts.length === 1,
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    minMs: samples[0]?.elapsedMs ?? null,
    maxMs: samples.at(-1)?.elapsedMs ?? null,
    samples,
  },
  status: eventCounts.length === 1 ? "MEASURED" : "NONDETERMINISTIC_EVENT_COUNT",
};
const artifacts = await writeGpwQualityArtifacts({
  outputDir: getAuditOutputDirectory(),
  basename: "benchmark",
  report,
  markdown: renderGenericMarkdown("GPW parser benchmark", [
    { heading: "Method", body: `- Corpus documents: ${report.scope.documents}\n- Warmup rounds: ${warmupRounds}\n- Measured rounds: ${rounds}\n- Input order: ${report.scope.order}` },
    { heading: "Result", body: `- Status: **${report.status}**\n- Median: ${report.result.medianMs?.toFixed(3) ?? "n/a"} ms\n- P95: ${report.result.p95Ms?.toFixed(3) ?? "n/a"} ms\n- Event counts: ${eventCounts.join(", ") || "n/a"}` },
    { heading: "Limitations", body: report.scope.limitations.map((limit) => `- ${limit}`).join("\n") },
  ]),
});

printArtifactSummary({
  name: "gpw:benchmark",
  status: report.status,
  artifacts,
  summary: { medianMs: report.result.medianMs, p95Ms: report.result.p95Ms, eventCounts },
});

if (report.status !== "MEASURED") process.exitCode = 1;

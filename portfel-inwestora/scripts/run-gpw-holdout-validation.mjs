import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateGpwHoldout } from "./gpw-holdout-validation.mjs";
import { getAuditOutputDirectory, getOption, printArtifactSummary,
  renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const outputDir = getAuditOutputDirectory();
const intake = JSON.parse(await readFile(path.join(outputDir, "holdout-intake.json"), "utf8"));
const sources = JSON.parse(await readFile(path.join(outputDir, "sources.json"), "utf8"));
const reviewAPath = getOption("review-a");
const reviewBPath = getOption("review-b");
const reviewerA = reviewAPath ? JSON.parse(await readFile(reviewAPath, "utf8")) : null;
const reviewerB = reviewBPath ? JSON.parse(await readFile(reviewBPath, "utf8")) : null;
const report = evaluateGpwHoldout({ intake, reviewerA, reviewerB, parserEvents: sources.sourceEvents });
const artifacts = await writeGpwQualityArtifacts({ outputDir, basename: "holdout-validation", report,
  markdown: renderGenericMarkdown("GPW independent holdout validation", [
    { heading: "Decision", body: `**${report.status}**. ${report.reason ?? report.limitation ?? ""}` },
    { heading: "Per-category metrics", body: report.metrics
      ? Object.entries(report.metrics).map(([name, metric]) => `- ${name}: TP=${metric.tp}, FP=${metric.fp}, FN=${metric.fn}, precision=${metric.precision ?? "n/a"}, recall=${metric.recall ?? "n/a"}, field accuracy=${metric.fieldAccuracy ?? "n/a"}`).join("\n")
      : "No independent metrics may be reported before both source reviews agree." },
  ]) });
printArtifactSummary({ name: "gpw:holdout:validate", status: report.status, artifacts,
  summary: { documents: report.documents ?? intake.selectedCount,
    incompleteSources: report.incompleteSources?.length ?? 0,
    disagreements: report.disagreements?.length ?? 0 } });

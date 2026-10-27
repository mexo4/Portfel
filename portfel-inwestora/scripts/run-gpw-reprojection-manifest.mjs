import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildGpwReprojectionManifest } from "./gpw-reprojection-manifest.mjs";
import { getAuditOutputDirectory, getOption, printArtifactSummary,
  renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const outputDir = getAuditOutputDirectory();
const projectionFile = getOption("projections") ?? path.join(outputDir, "projections.json");
const snapshot = JSON.parse(await readFile(projectionFile, "utf8"));
const report = buildGpwReprojectionManifest(snapshot);
const artifacts = await writeGpwQualityArtifacts({
  outputDir, basename: "reprojection-manifest", report,
  markdown: renderGenericMarkdown("GPW reprojection: source-reviewed read-only manifest", [
    { heading: "Status", body: `- ${report.status}\n- Safe to apply: **NO**\n- Unresolved: ${report.unresolved}\n- Findings resolved: ${report.summary.findingsResolved}/${report.findingAssessments.length}\n- Anomalies assessed: ${report.summary.anomalyAssessmentsResolved}/${report.anomalyAssessments.length}` },
    { heading: "Proposed event actions", body: `| Event ID | Current | Proposed | Official source |\n| --- | --- | --- | --- |\n${report.actions.map((item) => `| ${item.eventId ?? "—"} | ${item.current?.identity ?? item.current?.documentId ?? "—"} · ${item.current?.eventDate ?? "—"} | ${item.proposedAction} ${item.proposedState?.identity ?? ""} ${item.proposedState?.eventDate ?? ""} | ${(item.evidence?.officialUrls ?? []).map((url) => `[GPW](${url})`).join(", ")} |`).join("\n")}` },
    { heading: "Apply gate", body: report.limitations.map((item) => `- ${item}`).join("\n") },
  ]),
});
printArtifactSummary({ name: "gpw:reprojection:manifest", status: report.status, artifacts,
  summary: { unresolved: report.unresolved, safeToApply: report.safeToApply,
    actions: report.actions.length, findingsResolved: report.summary.findingsResolved,
    anomaliesResolved: report.summary.anomalyAssessmentsResolved } });

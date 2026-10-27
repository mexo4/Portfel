import { readFile } from "node:fs/promises";
import path from "node:path";
import { assessGpwQualityGate } from "./gpw-quality-gate.mjs";
import { assessGpwReadiness } from "./gpw-readiness.mjs";
import { getAuditOutputDirectory, printArtifactSummary, renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const outputDir = getAuditOutputDirectory();
const readReport = async (name) => {
  try { return JSON.parse(await readFile(path.join(outputDir, `${name}.json`), "utf8")); }
  catch { return undefined; }
};
const [audit, sources, projections, e2e, manifest, httpE2e] = await Promise.all(
  ["audit", "sources", "projections", "e2e", "reprojection-manifest", "http-e2e"].map(readReport));
const decision = assessGpwQualityGate({ audit, sources, projections, e2e });
const readiness = assessGpwReadiness({ audit, sources, projections, e2e, manifest, httpE2e,
  strictGate: decision });
const report = { schemaVersion: 2, ...decision, readiness, evaluatedAt: new Date().toISOString() };
const artifacts = await writeGpwQualityArtifacts({ outputDir, basename: "quality-gate", report,
  markdown: renderGenericMarkdown("GPW strict quality gate", [
    { heading: "Decision", body: `**${decision.status}**. This gate never deploys or mutates production data.` },
    { heading: "Stages", body: Object.entries(decision.stages).map(([name, status]) => `- ${name}: ${status}`).join("\n") },
    { heading: "Independent readiness decisions", body: [
      ...["codeReview", "parser", "reprojection", "synchronization", "deployment"]
        .map((name) => `- ${name}: ${readiness[name].status}`),
      `- source publications: ${readiness.sourceCompleteness.publication.status} (${readiness.sourceCompleteness.publication.daysAudited} days)`,
      `- future event dates: ${readiness.sourceCompleteness.futureEvents.status}`,
    ].join("\n") },
    { heading: "NO-GO reasons", body: decision.reasons.length ? decision.reasons.map((item) => `- ${item}`).join("\n") : "- None within the defined evidence scope." },
  ]),
});
printArtifactSummary({ name: "gpw:quality:gate", status: decision.status, artifacts,
  summary: { reasons: decision.reasons.length, stages: decision.stages,
    readiness: Object.fromEntries(Object.entries(readiness)
      .filter(([name]) => name !== "sourceCompleteness").map(([name, item]) => [name, item.status])) } });
if (decision.status !== "FULL_AUDIT_PASS") process.exitCode = 1;

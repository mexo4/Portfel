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
const [audit, sources, projections, e2e, manifest, httpE2e, isolatedReplay, holdoutValidation] = await Promise.all(
  ["audit", "sources", "projections", "e2e", "reprojection-manifest", "http-e2e",
    "reprojection-replay", "holdout-validation"].map(readReport));
const strictGate = assessGpwQualityGate({ audit, sources, projections, e2e });
const readiness = assessGpwReadiness({ audit, sources, projections, e2e, manifest, httpE2e,
  isolatedReplay, holdoutValidation, strictGate });
const report = { schemaVersion: 1, evaluatedAt: new Date().toISOString(),
  scope: { productionWrites: false, deploys: false,
    note: "Independent evidence dimensions; producing this report does not authorize a database mutation or deploy." },
  ...readiness };
const decisions = ["codeReview", "parser", "reprojection", "synchronization", "deployment"];
const artifacts = await writeGpwQualityArtifacts({ outputDir, basename: "readiness", report,
  markdown: renderGenericMarkdown("GPW independent readiness decisions", [
    ...decisions.map((name) => ({ heading: name, body: `**${readiness[name].status}**\n${readiness[name].reasons.map((reason) => `- ${reason}`).join("\n")}` })),
    { heading: "Source publication horizon", body: `**${readiness.sourceCompleteness.publication.status}** · ${readiness.sourceCompleteness.publication.daysAudited} days\n${readiness.sourceCompleteness.publication.reason}` },
    { heading: "Future event horizon", body: `**${readiness.sourceCompleteness.futureEvents.status}**\n${readiness.sourceCompleteness.futureEvents.reason}` },
  ]),
});
printArtifactSummary({ name: "gpw:readiness", status: readiness.deployment.status, artifacts,
  summary: { decisions: Object.fromEntries(decisions.map((name) => [name, readiness[name].status])),
    sourcePublication: readiness.sourceCompleteness.publication.status,
    futureEvents: readiness.sourceCompleteness.futureEvents.status } });

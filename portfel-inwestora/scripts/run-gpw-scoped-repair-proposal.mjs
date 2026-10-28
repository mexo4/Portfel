import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildScopedRepairProposal } from "./gpw-scoped-repair-proposal.mjs";
import { getAuditOutputDirectory, printArtifactSummary, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const outputDir = getAuditOutputDirectory();
const manifest = JSON.parse(await readFile(path.join(outputDir, "reprojection-manifest.json"), "utf8"));
const snapshot = JSON.parse(await readFile(path.join(outputDir, "reprojection-snapshot.json"), "utf8"));
const proposal = buildScopedRepairProposal(manifest, snapshot);
const expected = { UPDATE: 15, DEACTIVATE: 15, LINK_SOURCE: 2 };
if (proposal.counts.mutations !== 32 || proposal.counts.unchangedControls !== 10 ||
    proposal.counts.excludedReviews !== 1 || Object.entries(expected).some(([type, count]) =>
      proposal.counts.byAction[type] !== count)) throw new Error("SCOPED_REPAIR_UNEXPECTED_MANIFEST_COUNTS");
const rows = proposal.actions.map((action) =>
  `| ${action.decision} | ${action.eventId} | ${action.issuerId} | ${action.before.eventDate}; ${action.before.identity}; ${action.before.status}; ${action.before.active} | ${action.after.eventDate}; ${action.after.identity}; ${action.after.status}; ${action.after.active} | ${action.officialUrls.map((url) => `[GPW](${url})`).join(", ")} | ${action.existingSourceIds.join(", ") || "—"} | ${action.sourceClaim.replaceAll("|", "\\|")} | ${action.relatedActionIds.join(", ") || "—"} | ${action.independentSourceReview.status} |`).join("\n");
const markdown = `# GPW scoped repair — proposal only

**NOT APPROVED. NO AIVEN WRITE.** Snapshot: \`${proposal.sourceSnapshotFingerprint}\`.
The 32 changes and 10 NO_CHANGE controls remain one atomic scope. The unresolved
\`gpw:499257\` is excluded by event/source ID, not silently resolved.

| Decision | Event ID | Issuer ID | Current date; identity; status; active | Proposed date; identity; status; active | Official source | Existing linked source IDs | Manifest source claim (not independent proof) | Same-issuer dependencies | Independent review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

For each row, the JSON artifact includes source claim, existing source IDs,
related same-issuer actions, full-row baseline fingerprint, preconditions,
rollback requirements, and blank independent-review fields. A reviewer must
open the official source and quote the exact evidence for date/period/status;
the parser conclusion is not a second reviewer. All checks must be repeated
against a fresh production snapshot before any separately authorized write.
`;
const artifacts = await writeGpwQualityArtifacts({ outputDir, basename: "scoped-repair-proposal",
  report: proposal, markdown });
printArtifactSummary({ name: "gpw:scoped-repair:proposal", status: "PENDING_INDEPENDENT_REVIEW",
  artifacts, summary: proposal.counts });

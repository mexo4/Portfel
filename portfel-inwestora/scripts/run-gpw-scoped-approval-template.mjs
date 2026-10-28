import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAuditOutputDirectory } from "./gpw-quality-io.mjs";
import { assertScopedManifest } from "./gpw-scoped-repair-executor.mjs";

const directory = getAuditOutputDirectory();
const manifest = JSON.parse(await readFile(path.join(directory, "reprojection-manifest.json"), "utf8"));
const snapshot = JSON.parse(await readFile(path.join(directory, "reprojection-snapshot.json"), "utf8"));
assertScopedManifest(manifest, snapshot);
const template = { schemaVersion: 1, manifestFingerprint: snapshot.manifestFingerprint,
  snapshotFingerprint: snapshot.fingerprint,
  rows: manifest.actions.filter((action) => action.proposedAction !== "REVIEW").map((action) => ({
    eventId: action.eventId, action: action.proposedAction,
    decision: null, reviewer: null, reviewedAt: null,
    sourceUrl: null, exactEvidence: null, reason: null,
    secondReviewer: null, secondReviewedAt: null, retainedEventEvidence: null,
  })) };
const target = path.join(directory, "scoped-repair-decisions.template.json");
await writeFile(target, JSON.stringify(template, null, 2) + "\n", { flag: "wx" });
process.stdout.write(`Created unapproved local review template: ${target}\n`);

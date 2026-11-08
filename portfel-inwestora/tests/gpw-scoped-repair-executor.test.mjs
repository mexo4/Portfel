import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertIndependentDecisions, assertOperatorPrerequisites, assertRestoredBackup,
  assertProductionConnectionString, assertScopedManifest } from "../scripts/gpw-scoped-repair-executor.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const official = "https://www.gpw.pl/komunikat?geru_id=499304";
const input = () => {
  const actions = [
    ...Array.from({ length: 15 }, (_, i) => ({ eventId: `update-${i}`, proposedAction: "UPDATE",
      evidence: { officialUrls: [official] } })),
    ...Array.from({ length: 15 }, (_, i) => ({ eventId: `deactivate-${i}`, proposedAction: "DEACTIVATE",
      evidence: { officialUrls: [official] } })),
    ...Array.from({ length: 2 }, (_, i) => ({ eventId: `link-${i}`, proposedAction: "LINK_SOURCE",
      evidence: { officialUrls: [official] } })),
    ...Array.from({ length: 10 }, (_, i) => ({ eventId: `control-${i}`, proposedAction: "NO_CHANGE",
      evidence: { officialUrls: [official] } })),
    { eventId: null, proposedAction: "REVIEW", current: { documentId: "gpw:499257" },
      evidence: { officialUrls: ["https://www.gpw.pl/komunikat?geru_id=499257"] } },
  ];
  const manifest = { actions };
  const payload = { manifestFingerprint: hash(actions), instruments: [], events: [], sources: [],
    reports: [], history: [], projectionChanges: [] };
  const now = Date.now();
  const snapshot = { schemaVersion: 1, capturedAt: new Date(now - 30_000).toISOString(),
    source: "AIVEN_READ_ONLY_PUBLIC_MARKET_ROWS", actionCount: 42,
    fingerprint: hash(payload), ...payload };
  const decisions = { schemaVersion: 1, manifestFingerprint: snapshot.manifestFingerprint,
    snapshotFingerprint: snapshot.fingerprint, rows: actions.filter((action) => action.eventId)
      .map((action) => ({ eventId: action.eventId, action: action.proposedAction,
        decision: action.proposedAction === "NO_CHANGE" ? "CONFIRM_UNCHANGED" : "APPROVE",
        reviewer: "Reviewer One", reviewedAt: new Date(now - 60_000).toISOString(),
        sourceUrl: official, exactEvidence: "Official report states the exact date and fiscal period.",
        reason: "Verified against the original official document.",
        secondReviewer: "Reviewer Two", secondReviewedAt: new Date(now - 50_000).toISOString(),
        retainedEventEvidence: "The correct source-backed event remains active." })) };
  const proof = { schemaVersion: 1, snapshotFingerprint: snapshot.fingerprint, operator: "Operator One",
    backup: { path: "C:/private/backup.dump", sha256: "a".repeat(64) },
    restoreDrill: { passed: true, snapshotFingerprint: snapshot.fingerprint, targetEvents: 42,
      completedAt: new Date(now - 60_000).toISOString() },
    syncPause: { allWritersStopped: true, operator: "Operator One",
      sources: ["GPW_REPORT_SCHEDULES", "GPW_WZA", "GPW_DIVIDENDS"],
      pausedAt: new Date(now - 30_000).toISOString() } };
  return { manifest, snapshot, decisions, proof, now };
};

test("only the exact 32+10 scoped manifest is accepted; REVIEW stays excluded", () => {
  const { manifest, snapshot } = input();
  assert.doesNotThrow(() => assertScopedManifest(manifest, snapshot));
  const modified = structuredClone(manifest);
  modified.actions.at(-1).current.documentId = "gpw:other";
  const payload = { manifestFingerprint: hash(modified.actions), instruments: [], events: [], sources: [],
    reports: [], history: [], projectionChanges: [] };
  const changedSnapshot = { ...snapshot, fingerprint: hash(payload), ...payload };
  assert.throws(() => assertScopedManifest(modified, changedSnapshot), /REVIEW_DOCUMENT_CHANGED/);
});

test("all human decisions and second reviewer for deactivation are mandatory", () => {
  const { manifest, snapshot, decisions } = input();
  assert.doesNotThrow(() => assertIndependentDecisions(manifest, snapshot, decisions));
  const missing = structuredClone(decisions);
  missing.rows.pop();
  assert.throws(() => assertIndependentDecisions(manifest, snapshot, missing), /APPROVAL_ROW_COUNT/);
  const rejected = structuredClone(decisions);
  rejected.rows[0].decision = "REJECT";
  assert.throws(() => assertIndependentDecisions(manifest, snapshot, rejected), /APPROVAL_NOT_GRANTED/);
  const noEvidence = structuredClone(decisions);
  noEvidence.rows[0].exactEvidence = "";
  assert.throws(() => assertIndependentDecisions(manifest, snapshot, noEvidence), /EXACT_SOURCE_EVIDENCE_MISSING/);
  const noSecond = structuredClone(decisions);
  noSecond.rows[15].secondReviewer = noSecond.rows[15].reviewer;
  assert.throws(() => assertIndependentDecisions(manifest, snapshot, noSecond), /SECOND_REVIEWER_MISSING/);
});

test("fresh snapshot, restore drill and stopped sync are required", () => {
  const { snapshot, proof, now } = input();
  assert.doesNotThrow(() => assertOperatorPrerequisites(snapshot, proof, now));
  assert.throws(() => assertOperatorPrerequisites({ ...snapshot,
    capturedAt: new Date(now - 11 * 60_000).toISOString() }, proof, now), /SNAPSHOT_NOT_FRESH/);
  assert.throws(() => assertOperatorPrerequisites(snapshot, { ...proof,
    restoreDrill: { ...proof.restoreDrill, passed: false } }, now), /BACKUP_RESTORE_NOT_TESTED/);
  assert.throws(() => assertOperatorPrerequisites(snapshot, { ...proof,
    syncPause: { ...proof.syncPause, allWritersStopped: false } }, now), /SYNC_PAUSE_NOT_CONFIRMED/);
});

test("production URL requires Aiven, dedicated role and SSL", () => {
  const uri = "postgresql://mexo_gpw_repair:opaque@db.aivencloud.com:1234/defaultdb?sslmode=require";
  assert.doesNotThrow(() => assertProductionConnectionString(uri));
  assert.throws(() => assertProductionConnectionString(uri.replace("db.aivencloud.com", "127.0.0.1")), /AIVEN_HOST_REQUIRED/);
  assert.throws(() => assertProductionConnectionString(uri.replace("mexo_gpw_repair", "app")), /DEDICATED_REPAIR_ROLE_REQUIRED/);
  assert.throws(() => assertProductionConnectionString(uri.replace("sslmode=require", "sslmode=disable")), /SSL_REQUIRE_REQUIRED/);
});

test("restored backup verification compares database rows and rejects drift", async () => {
  const { manifest, snapshot } = input();
  const client = { connectionParameters: { host: "127.0.0.1", user: "mexo_gpw_test",
    database: "mexo_gpw_test" }, query: async (sql) => {
    if (sql.includes("inet_server_addr")) return { rows: [{ host: "127.0.0.1",
      database: "mexo_gpw_test", role: "mexo_gpw_test" }] };
    return { rows: [] };
  } };
  await assert.doesNotReject(assertRestoredBackup(client, manifest, snapshot));
  await assert.rejects(assertRestoredBackup(client, manifest, { ...snapshot,
    events: [{ id: "missing" }] }), /RESTORED_BACKUP_DRIFT:events/);
  await assert.rejects(assertRestoredBackup({ ...client,
    connectionParameters: { ...client.connectionParameters, host: "remote.example" } },
  manifest, snapshot), /loopback/);
});

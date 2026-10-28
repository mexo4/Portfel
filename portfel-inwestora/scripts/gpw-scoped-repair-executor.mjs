import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { assertIsolatedReplayClient, assertIsolatedReplayDatabase,
  executeApprovedManifestTransaction, readIsolatedMarketState,
  verifyReplayInputs } from "./gpw-reprojection-replay.mjs";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const stable = (value) => Array.isArray(value) ? value.map(stable)
  : value instanceof Date ? value.toISOString()
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort()
      .map((key) => [key, stable(value[key])])) : value;
const equal = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const lanes = ["GPW_REPORT_SCHEDULES", "GPW_WZA", "GPW_DIVIDENDS"];
const modifications = new Set(["UPDATE", "DEACTIVATE", "LINK_SOURCE"]);
const validTime = (value) => Number.isFinite(Date.parse(value));

export function assertScopedManifest(manifest, snapshot) {
  verifyReplayInputs(manifest, snapshot);
  const count = (type) => manifest.actions.filter((action) => action.proposedAction === type).length;
  assert.equal(count("UPDATE"), 15, "SCOPED_UPDATE_COUNT");
  assert.equal(count("DEACTIVATE"), 15, "SCOPED_DEACTIVATE_COUNT");
  assert.equal(count("LINK_SOURCE"), 2, "SCOPED_LINK_COUNT");
  assert.equal(count("NO_CHANGE"), 10, "SCOPED_CONTROL_COUNT");
  assert.equal(count("REVIEW"), 1, "SCOPED_REVIEW_COUNT");
  const review = manifest.actions.find((action) => action.proposedAction === "REVIEW");
  assert.equal(review.eventId, null, "REVIEW_MUST_NOT_TARGET_EVENT");
  assert.equal(review.current?.documentId, "gpw:499257", "REVIEW_DOCUMENT_CHANGED");
  const excludedSources = new Set((review.evidence?.officialUrls ?? []).map((url) =>
    new URL(url).searchParams.get("geru_id")));
  assert.ok(manifest.actions.filter((action) => action !== review).every((action) =>
    (action.evidence?.officialUrls ?? []).every((url) =>
      !excludedSources.has(new URL(url).searchParams.get("geru_id")))),
  "REVIEW_SOURCE_OVERLAP");
}

/** All 42 decisions are explicit. The parser's claim cannot fill a human field. */
export function assertIndependentDecisions(manifest, snapshot, decisions) {
  assert.equal(decisions?.schemaVersion, 1, "APPROVAL_SCHEMA");
  assert.equal(decisions.manifestFingerprint, snapshot.manifestFingerprint, "APPROVAL_MANIFEST_DRIFT");
  assert.equal(decisions.snapshotFingerprint, snapshot.fingerprint, "APPROVAL_SNAPSHOT_DRIFT");
  assert.equal(decisions.rows?.length, 42, "APPROVAL_ROW_COUNT");
  const byId = new Map(decisions.rows.map((row) => [row.eventId, row]));
  assert.equal(byId.size, 42, "DUPLICATE_APPROVAL");
  for (const action of manifest.actions.filter((item) => item.proposedAction !== "REVIEW")) {
    const row = byId.get(action.eventId);
    assert.ok(row, `APPROVAL_MISSING:${action.eventId}`);
    assert.equal(row.action, action.proposedAction, `APPROVAL_ACTION_DRIFT:${action.eventId}`);
    assert.equal(row.decision, modifications.has(action.proposedAction) ? "APPROVE" : "CONFIRM_UNCHANGED",
      `APPROVAL_NOT_GRANTED:${action.eventId}`);
    assert.ok(typeof row.reviewer === "string" && row.reviewer.trim().length >= 3 &&
      validTime(row.reviewedAt) && Date.parse(row.reviewedAt) <= Date.now(),
    `REVIEWER_MISSING:${action.eventId}`);
    if (modifications.has(action.proposedAction)) {
      assert.ok((action.evidence?.officialUrls ?? []).includes(row.sourceUrl),
        `APPROVAL_SOURCE_MISMATCH:${action.eventId}`);
      assert.ok(typeof row.exactEvidence === "string" && row.exactEvidence.trim().length >= 20,
        `EXACT_SOURCE_EVIDENCE_MISSING:${action.eventId}`);
      assert.ok(typeof row.reason === "string" && row.reason.trim().length >= 12,
        `APPROVAL_REASON_MISSING:${action.eventId}`);
    }
    if (action.proposedAction === "DEACTIVATE") {
      assert.ok(typeof row.secondReviewer === "string" && row.secondReviewer.trim().length >= 3 &&
        row.secondReviewer !== row.reviewer && validTime(row.secondReviewedAt) &&
        Date.parse(row.secondReviewedAt) <= Date.now(),
      `SECOND_REVIEWER_MISSING:${action.eventId}`);
      assert.ok(typeof row.retainedEventEvidence === "string" && row.retainedEventEvidence.trim().length >= 20,
        `RETAINED_EVENT_EVIDENCE_MISSING:${action.eventId}`);
    }
  }
}

export function assertOperatorPrerequisites(snapshot, proof, now = Date.now()) {
  assert.ok(validTime(snapshot.capturedAt) && now >= Date.parse(snapshot.capturedAt) &&
    now - Date.parse(snapshot.capturedAt) <= 10 * 60_000, "SNAPSHOT_NOT_FRESH");
  assert.equal(proof?.schemaVersion, 1, "OPERATOR_PROOF_SCHEMA");
  assert.equal(proof.snapshotFingerprint, snapshot.fingerprint, "OPERATOR_SNAPSHOT_DRIFT");
  assert.ok(typeof proof.operator === "string" && proof.operator.trim().length >= 3,
    "OPERATOR_ID_MISSING");
  assert.ok(proof.backup?.sha256?.match(/^[a-f0-9]{64}$/) &&
    typeof proof.backup.path === "string" && proof.backup.path.length > 0,
  "VERIFIED_BACKUP_MISSING");
  assert.equal(proof.restoreDrill?.passed, true, "BACKUP_RESTORE_NOT_TESTED");
  assert.equal(proof.restoreDrill?.snapshotFingerprint, snapshot.fingerprint, "RESTORE_SNAPSHOT_DRIFT");
  assert.equal(proof.restoreDrill?.targetEvents, 42, "RESTORE_TARGET_MISMATCH");
  assert.ok(validTime(proof.restoreDrill?.completedAt) &&
    now >= Date.parse(proof.restoreDrill.completedAt) &&
    now - Date.parse(proof.restoreDrill.completedAt) <= 24 * 60 * 60_000,
  "RESTORE_DRILL_STALE");
  assert.equal(proof.syncPause?.allWritersStopped, true, "SYNC_PAUSE_NOT_CONFIRMED");
  assert.equal(proof.syncPause?.operator, proof.operator, "SYNC_PAUSE_OPERATOR_MISMATCH");
  assert.ok(equal([...proof.syncPause.sources].sort(), [...lanes].sort()), "SYNC_PAUSE_LANES_INCOMPLETE");
  assert.ok(validTime(proof.syncPause.pausedAt) &&
    now >= Date.parse(proof.syncPause.pausedAt) &&
    now - Date.parse(proof.syncPause.pausedAt) <= 10 * 60_000,
  "SYNC_PAUSE_STALE");
}

export async function assertBackupFile(proof) {
  const data = await readFile(proof.backup.path);
  assert.ok(data.length > 0, "BACKUP_FILE_EMPTY");
  assert.equal(sha256(data), proof.backup.sha256, "BACKUP_FILE_HASH_MISMATCH");
}

/** The backup must actually have been restored to a dedicated loopback DB.
 * This check reads market rows only and never touches Aiven. */
export async function assertRestoredBackup(client, manifest, snapshot) {
  assertIsolatedReplayClient(client);
  const server = (await client.query(`SELECT host(inet_server_addr()) AS host,
    current_database() AS database, current_user AS role`)).rows[0];
  assert.ok(["127.0.0.1", "::1"].includes(server?.host), "RESTORE_SERVER_NOT_LOOPBACK");
  assert.equal(server?.database, "mexo_gpw_test", "RESTORE_DATABASE_MISMATCH");
  assert.equal(server?.role, "mexo_gpw_test", "RESTORE_ROLE_MISMATCH");
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const state = await readIsolatedMarketState(client, snapshot);
    for (const key of ["instruments", "events", "sources", "history", "projectionChanges"]) {
      assert.ok(equal(state[key], snapshot[key]), `RESTORED_BACKUP_DRIFT:${key}`);
    }
    const sourceIds = [...new Set(manifest.actions.flatMap((action) =>
      (action.evidence?.officialUrls ?? []).map((url) =>
        `gpw:${new URL(url).searchParams.get("geru_id")}`)))];
    const reports = (await client.query(`SELECT source_id, source_url, published_at, source_title, issuer_id, market
      FROM espi_reports WHERE source_id = ANY($1::text[]) ORDER BY source_id`, [sourceIds])).rows;
    assert.ok(equal(reports, snapshot.reports), "RESTORED_BACKUP_DRIFT:reports");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export { assertIsolatedReplayDatabase };

export function assertProductionConnectionString(value) {
  assert.ok(value, "MEXO_GPW_REPAIR_DATABASE_URL_REQUIRED");
  const url = new URL(value);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol), "POSTGRES_URI_REQUIRED");
  assert.equal(decodeURIComponent(url.username), "mexo_gpw_repair", "DEDICATED_REPAIR_ROLE_REQUIRED");
  assert.ok(url.hostname.endsWith(".aivencloud.com"), "AIVEN_HOST_REQUIRED");
  assert.equal(url.searchParams.get("sslmode"), "require", "SSL_REQUIRE_REQUIRED");
}

const assertProductionServer = async (client) => {
  assert.ok(client?.connectionParameters?.host?.endsWith(".aivencloud.com"), "AIVEN_CLIENT_HOST_REQUIRED");
  assert.equal(client?.connectionParameters?.user, "mexo_gpw_repair", "REPAIR_CLIENT_ROLE_MISMATCH");
  const session = (await client.query(`SELECT current_user AS role, current_database() AS database,
    current_setting('transaction_read_only') AS read_only, ssl.ssl AS ssl,
    roles.rolsuper AS superuser, roles.rolcreatedb AS create_database,
    roles.rolcreaterole AS create_role, roles.rolbypassrls AS bypass_rls
    FROM pg_stat_ssl ssl JOIN pg_roles roles ON roles.rolname = current_user
    WHERE ssl.pid = pg_backend_pid()`)).rows[0];
  assert.equal(session?.role, "mexo_gpw_repair", "REPAIR_ROLE_MISMATCH");
  assert.equal(session?.ssl, true, "SSL_NOT_ACTIVE");
  assert.equal(session?.superuser, false, "SUPERUSER_FORBIDDEN");
  assert.equal(session?.create_database, false, "CREATEDB_FORBIDDEN");
  assert.equal(session?.create_role, false, "CREATEROLE_FORBIDDEN");
  assert.equal(session?.bypass_rls, false, "BYPASSRLS_FORBIDDEN");
  const mustRead = ["corporate_event_instruments", "corporate_events", "corporate_event_sources",
    "corporate_event_history", "corporate_event_projection_changes", "espi_reports", "espi_sync_state"];
  for (const table of mustRead) {
    const allowed = (await client.query("SELECT has_table_privilege(current_user, $1, 'SELECT') AS allowed",
      [`public.${table}`])).rows[0]?.allowed;
    assert.equal(allowed, true, `REPAIR_SELECT_DENIED:${table}`);
  }
  const write = [["corporate_events", "UPDATE"], ["corporate_event_sources", "INSERT"],
    ["corporate_event_history", "INSERT"], ["corporate_event_projection_changes", "INSERT"]];
  for (const [table, privilege] of write) {
    const allowed = (await client.query("SELECT has_table_privilege(current_user, $1, $2) AS allowed",
      [`public.${table}`, privilege])).rows[0]?.allowed;
    assert.equal(allowed, true, `REPAIR_WRITE_DENIED:${table}:${privilege}`);
  }
  const forbidden = [["users", ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]],
    ["core_operations", ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]],
    ["corporate_events", ["DELETE", "TRUNCATE"]],
    ...["corporate_event_sources", "corporate_event_history", "corporate_event_projection_changes"]
      .map((table) => [table, ["UPDATE", "DELETE", "TRUNCATE"]])];
  for (const [table, privileges] of forbidden) for (const privilege of privileges) {
    const allowed = (await client.query("SELECT has_table_privilege(current_user, $1, $2) AS allowed",
      [`public.${table}`, privilege])).rows[0]?.allowed;
    assert.equal(allowed, false, `OVERPRIVILEGED_REPAIR_ROLE:${table}:${privilege}`);
  }
};

const assertLivePreconditions = async (client, manifest, snapshot, apply) => {
  const transaction = (await client.query(
    "SELECT current_setting('transaction_read_only') AS mode")).rows[0]?.mode;
  assert.equal(transaction, apply ? "off" : "on", "TRANSACTION_MODE_MISMATCH");
  const acquired = (await client.query(
    "SELECT pg_try_advisory_xact_lock(hashtext('mexo:gpw:scoped-repair')) AS acquired")).rows[0]?.acquired;
  assert.equal(acquired, true, "REPAIR_ALREADY_RUNNING");
  const sync = (await client.query(`SELECT source, status, lock_token, lock_expires_at
    FROM espi_sync_state WHERE source = ANY($1::text[])`, [lanes])).rows;
  assert.equal(sync.length, lanes.length, "SYNC_STATE_INCOMPLETE");
  assert.ok(sync.every((row) => row.status !== "RUNNING" &&
    (!row.lock_token || (row.lock_expires_at && Date.parse(row.lock_expires_at) <= Date.now()))),
  "SYNC_STILL_ACTIVE");
  const sourceIds = [...new Set(manifest.actions.flatMap((action) =>
    (action.evidence?.officialUrls ?? []).map((url) =>
      `gpw:${new URL(url).searchParams.get("geru_id")}`)))];
  const reports = (await client.query(`SELECT source_id, source_url, published_at, source_title, issuer_id, market
    FROM espi_reports WHERE source_id = ANY($1::text[]) ORDER BY source_id`, [sourceIds])).rows;
  assert.ok(equal(reports, snapshot.reports), "SOURCE_REPORT_DRIFT");
};

/** Aiven access is impossible without all human and operator prerequisites.
 * Dry-run uses a database-enforced read-only SERIALIZABLE transaction. */
export async function runApprovedScopedRepair(client, manifest, snapshot, decisions, proof, { apply = false } = {}) {
  assertScopedManifest(manifest, snapshot);
  assertIndependentDecisions(manifest, snapshot, decisions);
  assertOperatorPrerequisites(snapshot, proof);
  await assertBackupFile(proof);
  return executeApprovedManifestTransaction(client, manifest, snapshot, {
    dryRun: !apply, assertServer: assertProductionServer,
    beforeSnapshot: async (connection) => {
      await connection.query("SET LOCAL lock_timeout = '5s'");
      if (apply) await connection.query("LOCK TABLE corporate_events IN SHARE ROW EXCLUSIVE MODE");
    },
    beforeActions: (connection) => assertLivePreconditions(connection, manifest, snapshot, apply),
  });
}

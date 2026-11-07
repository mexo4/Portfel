import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertBackupFile, assertIndependentDecisions, assertOperatorPrerequisites,
  assertProductionConnectionString, assertRestoredBackup, assertScopedManifest,
  assertIsolatedReplayDatabase, runApprovedScopedRepair } from "./gpw-scoped-repair-executor.mjs";

async function main() {
const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
const apply = args.includes("--apply");
const allowed = new Set(["--manifest", "--snapshot", "--decisions", "--proof", "--apply",
  "--confirm-fingerprint", "--operator"]);
const paths = ["--manifest", "--snapshot", "--decisions", "--proof"];
for (const arg of args) if (arg.startsWith("--")) assert.ok(allowed.has(arg), "UNSUPPORTED_ARGUMENT");
for (const name of paths) assert.ok(value(name), `REQUIRED_FILE:${name}`);
if (apply) {
  assert.ok(value("--confirm-fingerprint"), "EXPLICIT_APPLY_CONFIRMATION_REQUIRED");
  assert.ok(value("--operator"), "EXPLICIT_OPERATOR_REQUIRED");
} else {
  assert.ok(!value("--confirm-fingerprint") && !value("--operator"), "CONFIRMATION_WITHOUT_APPLY");
}

const [manifest, snapshot, decisions, proof] = await Promise.all(paths.map(async (name) =>
  JSON.parse(await readFile(value(name), "utf8"))));
if (apply) assert.equal(value("--confirm-fingerprint"), snapshot.fingerprint,
  "APPLY_SNAPSHOT_CONFIRMATION_MISMATCH");
if (apply) assert.equal(value("--operator"), proof.operator, "APPLY_OPERATOR_MISMATCH");
assertScopedManifest(manifest, snapshot);
assertIndependentDecisions(manifest, snapshot, decisions);
assertOperatorPrerequisites(snapshot, proof);
await assertBackupFile(proof);
const restoreUrl = process.env.MEXO_GPW_RESTORE_TEST_DATABASE_URL;
assertIsolatedReplayDatabase(restoreUrl);
const restore = new pg.Client({ connectionString: restoreUrl,
  application_name: "mexo-gpw-scoped-backup-verify", connectionTimeoutMillis: 10_000 });
try {
  await restore.connect();
  await assertRestoredBackup(restore, manifest, snapshot);
} finally {
  await restore.end().catch(() => undefined);
}
const url = process.env.MEXO_GPW_REPAIR_DATABASE_URL;
assertProductionConnectionString(url);
const ca = process.env.POSTGRES_CA_CERT_BASE64
  ? Buffer.from(process.env.POSTGRES_CA_CERT_BASE64, "base64").toString("utf8")
  : process.env.POSTGRES_CA_CERT_PATH ? await readFile(process.env.POSTGRES_CA_CERT_PATH, "utf8") : null;
assert.ok(ca?.includes("-----BEGIN CERTIFICATE-----"), "VERIFIED_CA_REQUIRED");
const verifiedUrl = new URL(url);
verifiedUrl.searchParams.delete("sslmode");
const client = new pg.Client({ connectionString: verifiedUrl.toString(),
  ssl: { ca, rejectUnauthorized: true }, application_name: "mexo-gpw-scoped-repair",
  connectionTimeoutMillis: 10_000 });
try {
  await client.connect();
  const result = await runApprovedScopedRepair(client, manifest, snapshot, decisions, proof, { apply });
  const counts = Object.fromEntries(["UPDATE", "DEACTIVATE", "LINK_SOURCE", "NO_CHANGE"].map((type) =>
    [type, result.processed.filter((row) => row.decision === type).length]));
  process.stdout.write(JSON.stringify({ status: apply ? "APPLIED" : "DRY_RUN_NO_WRITE",
    snapshotFingerprint: snapshot.fingerprint, counts, excludedReview: "gpw:499257" }) + "\n");
} finally {
  await client.end().catch(() => undefined);
}
}

// Never print a connection string, host, SQL parameters or private proof,
// including failures during argument parsing, CA loading and connection.
await main().catch((error) => {
  const code = typeof error?.message === "string" && /^[A-Z][A-Z0-9_:]+$/.test(error.message)
    ? error.message : "PRECONDITION_FAILED";
  process.stderr.write(`GPW_SCOPED_REPAIR_BLOCKED:${code}\n`);
  process.exitCode = 1;
});

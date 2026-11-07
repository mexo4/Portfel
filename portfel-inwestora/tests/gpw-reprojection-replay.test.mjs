import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertIsolatedReplayClient, assertIsolatedReplayDatabase,
  verifyReplayInputs } from "../scripts/gpw-reprojection-replay.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const input = () => {
  const manifest = { actions: [
    { eventId: "event-1", proposedAction: "NO_CHANGE" },
    { eventId: null, proposedAction: "REVIEW" },
  ] };
  const payload = { manifestFingerprint: hash(manifest.actions), instruments: [], events: [], sources: [],
    reports: [], history: [], projectionChanges: [] };
  return { manifest, snapshot: { schemaVersion: 1, capturedAt: "2026-10-28T00:00:00Z",
    source: "AIVEN_READ_ONLY_PUBLIC_MARKET_ROWS", actionCount: 1, fingerprint: hash(payload), ...payload } };
};

test("replay refuses a remote database, normal user or non-dedicated database", () => {
  const local = "postgresql://mexo_gpw_test@127.0.0.1:55439/mexo_gpw_test?sslmode=disable";
  assert.doesNotThrow(() => assertIsolatedReplayDatabase(local));
  assert.throws(() => assertIsolatedReplayDatabase(local.replace("127.0.0.1", "remote.example")), /Loopback/);
  assert.throws(() => assertIsolatedReplayDatabase(local.replace("mexo_gpw_test@", "app_user@")), /Dedicated PostgreSQL role/);
  assert.throws(() => assertIsolatedReplayDatabase(local.replace("/mexo_gpw_test?", "/defaultdb?")), /Dedicated PostgreSQL database/);
  assert.throws(() => assertIsolatedReplayDatabase(undefined), /required/);
  const client = { connectionParameters: { host: "127.0.0.1", user: "mexo_gpw_test", database: "mexo_gpw_test" } };
  assert.doesNotThrow(() => assertIsolatedReplayClient(client));
  assert.throws(() => assertIsolatedReplayClient({ connectionParameters: { ...client.connectionParameters,
    host: "db.example.com" } }), /loopback/);
  assert.throws(() => assertIsolatedReplayClient({ connectionParameters: { ...client.connectionParameters,
    database: "defaultdb" } }), /dedicated database/);
});

test("snapshot and manifest fingerprints fail closed on changed decisions or rows", () => {
  const { manifest, snapshot } = input();
  assert.equal(verifyReplayInputs(manifest, snapshot), snapshot.fingerprint);
  assert.throws(() => verifyReplayInputs({ actions: [...manifest.actions, { eventId: "extra", proposedAction: "UPDATE" }] }, snapshot),
    /MANIFEST_FINGERPRINT_CHANGED/);
  assert.throws(() => verifyReplayInputs(manifest, { ...snapshot, events: [{ id: "extra" }] }),
    /SNAPSHOT_FINGERPRINT_CHANGED/);
  assert.throws(() => verifyReplayInputs(manifest, { ...snapshot, source: "UNVERIFIED" }));
});

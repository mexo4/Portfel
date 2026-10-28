import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import bcrypt from "bcryptjs";
import pg from "pg";
import { assertIsolatedReplayDatabase, readIsolatedMarketState,
  replayGpwManifest, seedIsolatedMarketSnapshot, verifyReplayInputs } from "./gpw-reprojection-replay.mjs";
import { getAuditOutputDirectory, printArtifactSummary, renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const outputDir = getAuditOutputDirectory();
const appRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const require = createRequire(import.meta.url);
const manifest = JSON.parse(await readFile(path.join(outputDir, "reprojection-manifest.json"), "utf8"));
const snapshot = JSON.parse(await readFile(path.join(outputDir, "reprojection-snapshot.json"), "utf8"));
const databaseUrl = process.env.MEXO_GPW_TEST_DATABASE_URL;
assertIsolatedReplayDatabase(databaseUrl);
verifyReplayInputs(manifest, snapshot);
process.env.DATABASE_URL = databaseUrl;
process.env.POSTGRES_CA_CERT_BASE64 = "";
process.env.POSTGRES_CA_CERT_PATH = "";
const { initializeDatabase } = await import("../src/lib/server/db.ts");
await initializeDatabase();
const client = new pg.Client({ connectionString: databaseUrl, application_name: "mexo-gpw-isolated-replay" });
const eventIds = snapshot.events.map((item) => item.id);
const issuerIds = snapshot.instruments.map((item) => item.id);
const actionableCount = manifest.actions.filter((item) => item.proposedAction !== "REVIEW").length;
const reviewCount = manifest.actions.length - actionableCount;
const sourceLanes = ["GPW_REPORT_SCHEDULES", "GPW_WZA", "GPW_DIVIDENDS"];
let seeded = false;
let server;
let temporaryUserId;
let originalSourceStates;
let report = { schemaVersion: 1, status: "ISOLATED_REPLAY_FAIL", snapshotFingerprint: snapshot.fingerprint,
  manifestFingerprint: snapshot.manifestFingerprint, testedActions: 0, blockedReviews: 0,
  checks: [], failure: null, productionWrites: false };
const check = (name, passed) => {
  assert.ok(passed, name);
  report.checks.push({ name, status: "PASS" });
};
const compareSnapshotState = async () => {
  const current = await readIsolatedMarketState(client, snapshot);
  // Object key order differs between PostgreSQL's JSONB serialization and
  // the source artifact; semantic equality is the intended contract.
  const mismatch = ["instruments", "events", "sources", "history", "projectionChanges"]
    .find((name) => !isDeepStrictEqual(current[name], snapshot[name]));
  if (mismatch) throw new Error(`ISOLATED_SNAPSHOT_MISMATCH:${mismatch}`);
  return true;
};
const freePort = async () => {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
};
const stopServer = async () => {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
};
const verifyLocalHttp = async (client, manifest, snapshot) => {
  assert.ok(existsSync(path.join(appRoot, ".next", "BUILD_ID")), "Run a local production build before HTTP replay verification");
  const now = new Date().toISOString();
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Warsaw",
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const candidate = manifest.actions.filter((item) => item.proposedAction === "UPDATE" &&
    item.proposedState.eventDate >= today && item.proposedState.eventDate <= "2027-10-27")
    .find((item) => item.current.eventDate !== item.proposedState.eventDate) ??
    manifest.actions.find((item) => item.proposedAction === "UPDATE" && item.proposedState.eventDate >= today);
  assert.ok(candidate, "No future source-reviewed report is available for local HTTP verification");
  const event = snapshot.events.find((item) => item.id === candidate.eventId);
  const ticker = snapshot.instruments.find((item) => item.id === event.instrument_id)?.ticker;
  assert.ok(ticker);
  temporaryUserId = `replay-http-user-${randomUUID()}`;
  const email = `${temporaryUserId}@example.invalid`;
  const password = randomUUID();
  const hash = await bcrypt.hash(password, 4);
  await client.query(`INSERT INTO users
    (id, email, password_hash, display_name, email_verified_at, subscription_plan,
     subscription_status, profile_json, portfolio_json, portfolio_revision,
     portfolio_core_revision, created_at, updated_at)
    VALUES ($1, $2, $3, 'GPW replay fixture', $4, 'tester', 'active', $5, $6, 0, 0, $4, $4)`,
  [temporaryUserId, email, hash, now, JSON.stringify({ displayName: "GPW replay fixture", email }),
    JSON.stringify({ assets: [], sales: [], realizedAdjustments: [] })]);
  originalSourceStates = (await client.query(
    "SELECT * FROM espi_sync_state WHERE source = ANY($1::text[])", [sourceLanes])).rows;
  for (const source of sourceLanes) {
    await client.query(`INSERT INTO espi_sync_state
      (source, status, last_checked_at, last_success_at, last_overlap_at,
       next_backfill_page, backfill_complete, created_at, updated_at)
      VALUES ($1, 'SUCCESS', $2, $2, $2, 1, TRUE, $2, $2)
      ON CONFLICT (source) DO UPDATE SET last_checked_at = EXCLUDED.last_checked_at,
        last_success_at = EXCLUDED.last_success_at, last_overlap_at = EXCLUDED.last_overlap_at,
        status = EXCLUDED.status, backfill_complete = TRUE, updated_at = EXCLUDED.updated_at`, [source, now]);
  }
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start",
    "--hostname", "127.0.0.1", "--port", String(port)],
  { cwd: appRoot, env: { ...process.env, DATABASE_URL: databaseUrl,
    POSTGRES_CA_CERT_BASE64: "", POSTGRES_CA_CERT_PATH: "", NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.resume();
  server.stderr.resume();
  const request = (route, options = {}) => fetch(`${base}${route}`,
    { ...options, signal: AbortSignal.timeout(12_000) });
  const deadline = Date.now() + 45_000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    if (server.exitCode !== null) throw new Error("Local Next exited before HTTP replay verification");
    try { ready = (await request("/api/system/revision")).ok; } catch { /* startup */ }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Local Next HTTP startup timeout");
  const login = await request("/api/auth/login", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("portfel_inwestora_session="));
  const api = await request("/api/gpw-reports?scope=all", { headers: { cookie } });
  assert.equal(api.status, 200);
  const apiEvents = (await api.json()).events;
  assert.ok(apiEvents.some((item) => item.id === candidate.eventId &&
    item.eventDate === candidate.proposedState.eventDate));
  if (candidate.current.eventDate !== candidate.proposedState.eventDate) {
    assert.ok(!apiEvents.some((item) => item.id === candidate.eventId &&
      item.eventDate === candidate.current.eventDate));
  }
  const month = candidate.proposedState.eventDate.slice(0, 7);
  const page = await request(`/kalendarz-gpw?miesiac=${month}&typ=reports&spolka=${ticker}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes(ticker) && html.includes(candidate.proposedState.eventDate));
  const feed = await request(`/api/calendar/gpw.ics?categories=reports&tickers=${ticker}`);
  assert.equal(feed.status, 200);
  const ics = await feed.text();
  assert.ok(ics.includes(candidate.proposedState.eventDate.replaceAll("-", "")));
  if (candidate.current.eventDate !== candidate.proposedState.eventDate) {
    assert.ok(!ics.includes(candidate.current.eventDate.replaceAll("-", "")));
  }
  return { eventId: candidate.eventId, ticker, api: "PASS", page: "PASS", ics: "PASS" };
};

try {
  await client.connect();
  await seedIsolatedMarketSnapshot(client, snapshot);
  seeded = true;
  check("isolated-market-snapshot-exact", await compareSnapshotState());

  const updated = manifest.actions.find((item) => item.proposedAction === "UPDATE");
  const original = snapshot.events.find((item) => item.id === updated.eventId);
  await client.query("UPDATE corporate_events SET event_date = '2030-01-01' WHERE id = $1", [updated.eventId]);
  await assert.rejects(replayGpwManifest(client, manifest, snapshot), /SNAPSHOT_DRIFT/);
  await client.query("UPDATE corporate_events SET event_date = $2 WHERE id = $1", [updated.eventId, original.event_date]);
  check("snapshot-drift-fail-closed", await compareSnapshotState());

  const linkedSource = snapshot.sources.find((item) => item.corporate_event_id === updated.eventId);
  await client.query("UPDATE corporate_event_sources SET source_priority = 299 WHERE id = $1", [linkedSource.id]);
  await assert.rejects(replayGpwManifest(client, manifest, snapshot), /SOURCE_OR_PROVENANCE_SNAPSHOT_DRIFT/);
  await client.query("UPDATE corporate_event_sources SET source_priority = $2 WHERE id = $1",
    [linkedSource.id, linkedSource.source_priority]);
  check("source-priority-drift-fail-closed", await compareSnapshotState());

  const prioritySnapshot = structuredClone(snapshot);
  prioritySnapshot.events.find((item) => item.id === updated.eventId).source_priority = 999;
  const priorityPayload = Object.fromEntries(["manifestFingerprint", "instruments", "events",
    "sources", "reports", "history", "projectionChanges"].map((name) => [name, prioritySnapshot[name]]));
  prioritySnapshot.fingerprint = createHash("sha256").update(JSON.stringify(priorityPayload)).digest("hex");
  await client.query("UPDATE corporate_events SET source_priority = 999 WHERE id = $1", [updated.eventId]);
  await assert.rejects(replayGpwManifest(client, manifest, prioritySnapshot), /LOWER_PRIORITY_OR_FOREIGN_SOURCE/);
  await client.query("UPDATE corporate_events SET source_priority = $2 WHERE id = $1",
    [updated.eventId, original.source_priority]);
  check("lower-priority-source-cannot-override", await compareSnapshotState());

  const collisionId = `replay-collision-${randomUUID()}`;
  await client.query(`INSERT INTO corporate_events
    (id, instrument_id, event_type, event_date, event_identity, status, active,
     source_priority, discovered_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', TRUE, 300, $6, $6)`,
  [collisionId, original.instrument_id, original.event_type, original.event_date,
    updated.proposedState.identity, new Date().toISOString()]);
  await assert.rejects(replayGpwManifest(client, manifest, snapshot), /IDENTITY_COLLISION/);
  await client.query("DELETE FROM corporate_events WHERE id = $1", [collisionId]);
  check("logical-identity-collision-fail-closed", await compareSnapshotState());

  await assert.rejects(replayGpwManifest(client, manifest, snapshot, { interruptAfter: 16 }),
    /INJECTED_REPLAY_INTERRUPTION/);
  check("interruption-rolls-back-all-actions", await compareSnapshotState());

  const first = await replayGpwManifest(client, manifest, snapshot);
  check("resume-after-rollback", first.processed.length === actionableCount);
  check("all-approved-actions-replayed", first.processed.length === actionableCount &&
    first.blocked.length === reviewCount);
  if (reviewCount) check("unresolved-official-source-stays-blocked",
    first.blocked.some((item) => item.documentId === "gpw:499257"));
  report.testedActions = first.processed.length;
  report.blockedReviews = first.blocked.length;

  const state = await readIsolatedMarketState(client, snapshot);
  const byId = new Map(state.events.map((item) => [item.id, item]));
  for (const action of manifest.actions) {
    if (!action.eventId) continue;
    const event = byId.get(action.eventId);
    check(`action-${action.eventId}`, action.proposedAction === "DEACTIVATE" ? event.active === false
      : action.proposedAction === "UPDATE" ? event.active &&
        event.event_date === action.proposedState.eventDate && event.event_identity === action.proposedState.identity
        : action.proposedAction === "LINK_SOURCE" ? state.sources.some((source) =>
          source.corporate_event_id === event.id && source.source_url === action.proposedState.linkSource)
          : event.active === action.current.active && event.event_identity === action.current.identity);
  }
  const actionIds = new Set(manifest.actions.filter((item) => item.eventId &&
    item.proposedAction !== "REVIEW").map((item) => item.eventId));
  check("non-manifest-events-unchanged", isDeepStrictEqual(
    state.events.filter((item) => !actionIds.has(item.id)),
    snapshot.events.filter((item) => !actionIds.has(item.id))));
  check("original-event-ids-stable", state.events.length === snapshot.events.length &&
    state.events.every((event) => snapshot.events.some((originalEvent) => originalEvent.id === event.id)));
  const mutatingCount = manifest.actions.filter((item) =>
    ["UPDATE", "DEACTIVATE", "LINK_SOURCE"].includes(item.proposedAction)).length;
  const dateChanges = manifest.actions.filter((item) => item.proposedAction === "UPDATE" &&
    item.current.eventDate !== item.proposedState.eventDate).length;
  check("history-records-written", state.history.length === snapshot.history.length + dateChanges &&
    state.projectionChanges.length === snapshot.projectionChanges.length + mutatingCount);
  const getin = manifest.actions.find((item) => item.source?.sourceId === "gpw:499304");
  check("getin-corrected-date-history", state.history.some((item) =>
    item.corporate_event_id === getin.eventId && item.previous_event_date === "2026-11-30" &&
    item.next_event_date === "2026-10-28") &&
    state.events.find((item) => item.id === getin.eventId)?.id === getin.eventId);
  for (const [sourceId, expectedDate] of [["gpw:499122", "2026-11-20"],
    ["gpw:499072", "2026-11-25"]]) {
    const action = manifest.actions.find((item) => item.source?.sourceId === sourceId);
    check(`existing-report-linked-${sourceId}`, action?.proposedAction === "LINK_SOURCE" &&
      state.events.find((item) => item.id === action.eventId)?.event_date === expectedDate &&
      state.sources.some((item) => item.corporate_event_id === action.eventId &&
        item.source_url === action.proposedState.linkSource));
  }
  check("no-change-events-bytewise-unchanged", manifest.actions
    .filter((item) => item.proposedAction === "NO_CHANGE")
    .every((item) => isDeepStrictEqual(state.events.find((event) => event.id === item.eventId),
      snapshot.events.find((event) => event.id === item.eventId))));
  const replayedUpdate = state.events.find((item) => item.id === updated.eventId);
  await client.query("UPDATE corporate_events SET source_priority = source_priority + 1 WHERE id = $1",
    [updated.eventId]);
  await assert.rejects(replayGpwManifest(client, manifest, snapshot,
    { idempotentRun: true, expectedPostState: state }), /IDEMPOTENT_POST_STATE_DRIFT/);
  await client.query("UPDATE corporate_events SET source_priority = $2 WHERE id = $1",
    [updated.eventId, replayedUpdate.source_priority]);
  check("idempotent-rerun-rejects-hidden-row-drift", isDeepStrictEqual(
    await readIsolatedMarketState(client, snapshot), state));
  const second = await replayGpwManifest(client, manifest, snapshot,
    { idempotentRun: true, expectedPostState: state });
  const afterSecond = await readIsolatedMarketState(client, snapshot);
  check("identical-manifest-idempotent", second.processed.length === actionableCount &&
    isDeepStrictEqual(afterSecond, state));
  const http = await verifyLocalHttp(client, manifest, snapshot);
  report.http = http;
  check("local-api-page-and-ics-match-replay", http.api === "PASS" && http.page === "PASS" && http.ics === "PASS");
  report.status = reviewCount === 0 ? "ISOLATED_REPLAY_PASS" :
    "ISOLATED_REPLAY_PASS_WITH_REVIEW_BLOCKED";
} catch (error) {
  report.failure = error instanceof Error ? error.message : "unknown";
} finally {
  await stopServer();
  if (temporaryUserId) {
    try { await client.query("DELETE FROM users WHERE id = $1", [temporaryUserId]); }
    catch { report.status = "ISOLATED_REPLAY_FAIL"; report.failure = "ISOLATED_USER_CLEANUP_FAILED"; }
  }
  if (originalSourceStates) {
    try {
      await client.query("DELETE FROM espi_sync_state WHERE source = ANY($1::text[])", [sourceLanes]);
      for (const row of originalSourceStates) {
        await client.query(`INSERT INTO espi_sync_state
          (source, status, last_checked_at, last_success_at, last_overlap_at,
           last_error_code, next_backfill_page, backfill_complete, lock_token,
           lock_expires_at, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [row.source, row.status, row.last_checked_at, row.last_success_at, row.last_overlap_at,
          row.last_error_code, row.next_backfill_page, row.backfill_complete, row.lock_token,
          row.lock_expires_at, row.created_at, row.updated_at]);
      }
    } catch { report.status = "ISOLATED_REPLAY_FAIL"; report.failure = "ISOLATED_SYNC_STATE_CLEANUP_FAILED"; }
  }
  if (seeded) {
    try {
      // The dedicated database was verified to have none of these issuer IDs
      // before import; remove only rows introduced by this isolated run.
      await client.query("DELETE FROM corporate_event_instruments WHERE id = ANY($1::text[])", [issuerIds]);
      const remaining = await client.query("SELECT COUNT(*)::int AS count FROM corporate_events WHERE id = ANY($1::text[])", [eventIds]);
      if (remaining.rows[0]?.count !== 0) throw new Error("ISOLATED_FIXTURE_CLEANUP_FAILED");
    } catch (error) {
      report.status = "ISOLATED_REPLAY_FAIL";
      report.failure = `CLEANUP:${error instanceof Error ? error.message : "unknown"}`;
    }
  }
  await client.end().catch(() => undefined);
  if (globalThis.portfelPostgresPool) await globalThis.portfelPostgresPool.end().catch(() => undefined);
}
const artifacts = await writeGpwQualityArtifacts({ outputDir, basename: "reprojection-replay", report,
  markdown: renderGenericMarkdown("GPW isolated PostgreSQL reprojection replay", [
    { heading: "Result", body: `**${report.status}**; ${report.testedActions} actionable rows evaluated; ${report.blockedReviews} REVIEW remains blocked. ${report.failure ?? "No failure."}` },
    { heading: "Safety", body: `Dedicated loopback mexo_gpw_test only. Aiven snapshot fingerprint: ${snapshot.fingerprint}. No production database, cache, sync, timer or Oracle change.` },
    { heading: "Checks", body: report.checks.map((item) => `- ${item.name}: ${item.status}`).join("\n") },
  ]) });
printArtifactSummary({ name: "gpw:reprojection:replay", status: report.status, artifacts,
  summary: { testedActions: report.testedActions, blockedReviews: report.blockedReviews,
    checks: report.checks.length, failure: report.failure } });
if (!["ISOLATED_REPLAY_PASS", "ISOLATED_REPLAY_PASS_WITH_REVIEW_BLOCKED"].includes(report.status)) process.exitCode = 1;

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { getAuditOutputDirectory, printArtifactSummary, renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

export const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Only public GPW market rows needed by the manifest, never users/portfolios. */
export const snapshotPayload = ({ manifestFingerprint, instruments, events, sources, reports, history, projectionChanges }) => ({
  manifestFingerprint,
  instruments: [...instruments].sort((a, b) => a.id.localeCompare(b.id)),
  events: [...events].sort((a, b) => a.id.localeCompare(b.id)),
  sources: [...sources].sort((a, b) => a.id.localeCompare(b.id)),
  reports: [...reports].sort((a, b) => a.source_id.localeCompare(b.source_id)),
  history: [...history].sort((a, b) => a.id.localeCompare(b.id)),
  projectionChanges: [...projectionChanges].sort((a, b) => a.id.localeCompare(b.id)),
});

const outputDir = getAuditOutputDirectory();
const manifest = JSON.parse(await readFile(path.join(outputDir, "reprojection-manifest.json"), "utf8"));
const url = process.env.MEXO_GPW_AUDIT_READONLY_DATABASE_URL;
if (!url || !new URL(url).hostname.endsWith("aivencloud.com")) {
  throw new Error("Aiven read-only audit URL is required; no application DB fallback exists.");
}
const caBase64 = process.env.POSTGRES_CA_CERT_BASE64;
const caPath = process.env.POSTGRES_CA_CERT_PATH;
const ca = caBase64 ? Buffer.from(caBase64, "base64").toString("utf8")
  : caPath ? await readFile(caPath, "utf8") : undefined;
const verifiedUrl = new URL(url);
if (ca) verifiedUrl.searchParams.delete("sslmode");
const client = new pg.Client({ connectionString: verifiedUrl.toString(),
  ssl: ca ? { ca, rejectUnauthorized: true } : undefined,
  application_name: "mexo-gpw-reprojection-readonly-snapshot", connectionTimeoutMillis: 10_000 });
const actionIds = manifest.actions.filter((action) => action.eventId && action.proposedAction !== "REVIEW")
  .map((action) => action.eventId);
const sourceIds = [...new Set(manifest.actions.flatMap((action) =>
  (action.evidence?.officialUrls ?? []).map((item) => {
    try { return `gpw:${new URL(item).searchParams.get("geru_id")}`; } catch { return null; }
  }).filter((item) => item && item !== "gpw:null")))];
let payload;
try {
  await client.connect();
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '15s'");
  const mode = await client.query("SELECT current_setting('transaction_read_only') AS mode");
  if (mode.rows[0]?.mode !== "on") throw new Error("Read-only transaction was not enforced.");
  const targetRows = (await client.query(
    "SELECT id, instrument_id FROM corporate_events WHERE id = ANY($1::text[])", [actionIds])).rows;
  if (targetRows.length !== actionIds.length) throw new Error("A manifest event is missing from the current Aiven snapshot.");
  const issuerIds = [...new Set(targetRows.map((row) => row.instrument_id))];
  // One pg.Client carries the repeatable-read transaction; issue its queries
  // sequentially (concurrent query() calls on one client are deprecated).
  const instruments = await client.query("SELECT * FROM corporate_event_instruments WHERE id = ANY($1::text[]) ORDER BY id", [issuerIds]);
  const events = await client.query("SELECT * FROM corporate_events WHERE instrument_id = ANY($1::text[]) ORDER BY id", [issuerIds]);
  const sources = await client.query(`SELECT source.* FROM corporate_event_sources AS source
      JOIN corporate_events AS event ON event.id = source.corporate_event_id
      WHERE event.instrument_id = ANY($1::text[]) ORDER BY source.id`, [issuerIds]);
  const reports = await client.query(`SELECT source_id, source_url, published_at, source_title, issuer_id, market
      FROM espi_reports WHERE source_id = ANY($1::text[]) ORDER BY source_id`, [sourceIds]);
  const history = await client.query(`SELECT history.* FROM corporate_event_history AS history
      JOIN corporate_events AS event ON event.id = history.corporate_event_id
      WHERE event.instrument_id = ANY($1::text[]) ORDER BY history.id`, [issuerIds]);
  const projectionChanges = await client.query(`SELECT change.* FROM corporate_event_projection_changes AS change
      JOIN corporate_events AS event ON event.id = change.corporate_event_id
      WHERE event.instrument_id = ANY($1::text[]) ORDER BY change.id`, [issuerIds]);
  payload = snapshotPayload({ manifestFingerprint: fingerprint(manifest.actions),
    instruments: instruments.rows, events: events.rows, sources: sources.rows,
    reports: reports.rows, history: history.rows, projectionChanges: projectionChanges.rows });
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw new Error(`Read-only market snapshot failed: ${error?.code ?? "UNKNOWN"}`);
} finally {
  await client.end().catch(() => undefined);
}
const snapshot = { schemaVersion: 1, capturedAt: new Date().toISOString(),
  source: "AIVEN_READ_ONLY_PUBLIC_MARKET_ROWS", actionCount: actionIds.length,
  fingerprint: fingerprint(payload), ...payload };
const artifacts = await writeGpwQualityArtifacts({ outputDir, basename: "reprojection-snapshot", report: snapshot,
  markdown: renderGenericMarkdown("GPW read-only reprojection source snapshot", [
    { heading: "Scope", body: `Actions: ${actionIds.length}; issuers: ${payload.instruments.length}; market events: ${payload.events.length}; source links: ${payload.sources.length}; ESPI metadata rows: ${payload.reports.length}. No user or portfolio table was read.` },
    { heading: "Fingerprint", body: `Snapshot SHA-256: ${snapshot.fingerprint}. Manifest SHA-256: ${snapshot.manifestFingerprint}. Both must match before isolated replay.` },
    { heading: "Safety", body: "Aiven was accessed inside a REPEATABLE READ, READ ONLY transaction. This artifact is ignored by Git and does not authorize a production write." },
  ]) });
printArtifactSummary({ name: "gpw:reprojection:snapshot", status: "READ_ONLY_SNAPSHOT_PASS", artifacts,
  summary: { events: payload.events.length, sources: payload.sources.length,
    reports: payload.reports.length, targetActions: actionIds.length, fingerprint: snapshot.fingerprint } });

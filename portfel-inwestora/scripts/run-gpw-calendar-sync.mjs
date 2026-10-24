/** Central GPW sync entry point for a future systemd timer. Not installed by this change. */
import { readFileSync } from "node:fs";
import pg from "pg";
import nextEnv from "@next/env";

if (!process.argv.includes("--run")) {
  throw new Error("Use --run to execute the central GPW synchronization.");
}
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const certificate = process.env.POSTGRES_CA_CERT_BASE64
  ? Buffer.from(process.env.POSTGRES_CA_CERT_BASE64, "base64").toString("utf8")
  : process.env.POSTGRES_CA_CERT_PATH
    ? readFileSync(process.env.POSTGRES_CA_CERT_PATH, "utf8")
    : undefined;
if (certificate && !certificate.includes("-----BEGIN CERTIFICATE-----")) {
  throw new Error("Invalid PostgreSQL CA certificate.");
}
const parsedUrl = new URL(process.env.DATABASE_URL);
if (certificate) parsedUrl.searchParams.delete("sslmode");
const lockClient = new pg.Client({
  connectionString: parsedUrl.toString(),
  ...(certificate ? { ssl: { ca: certificate, rejectUnauthorized: true } } : {}),
  connectionTimeoutMillis: 10_000,
});
const lockKey = "mexo:gpw:central-sync:v1";
let locked = false;
let failed = false;
try {
  await lockClient.connect();
  const lock = await lockClient.query("SELECT pg_try_advisory_lock(hashtext($1)) AS acquired", [lockKey]);
  locked = lock.rows[0]?.acquired === true;
  if (!locked) {
    console.info("[GPW SCHEDULED SYNC] another run is active");
  } else {
    const { synchronizePapEspi } = await import("../src/lib/server/espi.ts");
    const { getGpwSyncHealth } = await import("../src/lib/gpw-sync-health.ts");
    const {
      synchronizeGlobalReportSchedules,
      synchronizeGlobalGeneralMeetings,
      synchronizeGlobalDividends,
    } = await import("../src/lib/server/corporate-events.ts");
    const source = await synchronizePapEspi({ backfillPages: 1 });
    const sourceHealth = getGpwSyncHealth({
      errors: (source.errors ?? 0) + (source.status === "SUCCESS" ? 0 : 1),
      pending: Number(!source.backfillComplete) + Number(source.overlapComplete === false),
    });
    console.info("[GPW SCHEDULED SYNC] source", {
      status: sourceHealth,
      sourceStatus: source.status,
      parsed: source.parsed,
      saved: source.insertedOrUpdated,
      pages: source.pagesRead,
      errors: source.errors ?? 0,
      backfill: source.backfillComplete ? "COMPLETE" : "CONTINUING",
      nextBackfillPage: source.nextBackfillPage,
      overlap: source.overlapComplete === undefined ? "NOT_DUE" : source.overlapComplete ? "COMPLETE" : "INCOMPLETE",
    });
    // A bounded historical backfill intentionally advances its durable cursor
    // over multiple scheduled runs. Keep that run visibly INCOMPLETE without
    // treating the expected continuation as an infrastructure failure.
    failed ||= sourceHealth === "FAILED" || source.overlapComplete === false;
    for (const [name, synchronize] of [
      ["reports", synchronizeGlobalReportSchedules],
      ["meetings", synchronizeGlobalGeneralMeetings],
      ["dividends", synchronizeGlobalDividends],
    ]) {
      try {
        let result = await synchronize({ refreshSource: true });
        let batches = 1;
        while (result.pending > 0 && batches < 3) {
          result = await synchronize({ refreshSource: false });
          batches += 1;
        }
        console.info("[GPW SCHEDULED SYNC] projection", { name, batches, pending: result.pending,
          fetched: result.fetched, created: result.created, errors: result.errors,
          outcome: getGpwSyncHealth({ errors: result.errors, pending: result.pending }) });
        failed ||= getGpwSyncHealth({ errors: result.errors, pending: result.pending }) !== "COMPLETE";
      } catch (error) {
        failed = true;
        console.error("[GPW SCHEDULED SYNC] projection failed", {
          name, error: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  }
} finally {
  if (locked) await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]).catch(() => undefined);
  await lockClient.end().catch(() => undefined);
  await globalThis.portfelPostgresPool?.end().catch(() => undefined);
}
if (failed) process.exitCode = 1;

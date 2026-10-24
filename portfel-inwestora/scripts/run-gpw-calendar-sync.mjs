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
    const { assessGpwSync } = await import("../src/lib/gpw-sync-health.ts");
    const {
      synchronizeGlobalReportSchedules,
      getGlobalReportScheduleSourceState,
      synchronizeGlobalGeneralMeetings,
      getGlobalGeneralMeetingSourceState,
      synchronizeGlobalDividends,
      getGlobalDividendSourceState,
    } = await import("../src/lib/server/corporate-events.ts");
    const { getEspiSyncState } = await import("../src/lib/server/espi.ts");
    const source = await synchronizePapEspi({ backfillPages: 1 });
    const sourceState = await getEspiSyncState();
    const sourceAssessment = assessGpwSync({
      batch: { errors: source.errors ?? 0, pending: Number(source.locked || source.overlapComplete === false) },
      source: {
        status: source.status,
        lastCheckedAt: sourceState.lastCheckedAt,
        lastSuccessAt: sourceState.lastSuccessAt,
        locked: source.locked,
        errors: source.errors,
        backfillComplete: source.backfillComplete,
        nextBackfillCursor: source.nextBackfillPage,
        overlapDue: source.overlapComplete !== undefined,
        overlapComplete: source.overlapComplete,
      },
    });
    console.info("[GPW SCHEDULED SYNC] source", {
      batchStatus: sourceAssessment.batchStatus,
      availability: sourceAssessment.source.availability,
      freshness: sourceAssessment.source.freshness,
      sourceStatus: source.status,
      parsed: source.parsed,
      saved: source.insertedOrUpdated,
      pages: source.pagesRead,
      errors: source.errors ?? 0,
      historicalBackfill: sourceAssessment.historicalBackfill,
      overlapRepair: sourceAssessment.overlapRepair,
      calendarCoverage: sourceAssessment.coverage.status,
    });
    // A bounded historical backfill intentionally advances its durable cursor
    // over multiple scheduled runs. Keep that run visibly INCOMPLETE without
    // treating the expected continuation as an infrastructure failure.
    failed ||= sourceAssessment.batchStatus !== "BATCH_COMPLETE" || source.status !== "SUCCESS" || source.locked;
    for (const [name, synchronize, getSourceState] of [
      ["reports", synchronizeGlobalReportSchedules, getGlobalReportScheduleSourceState],
      ["meetings", synchronizeGlobalGeneralMeetings, getGlobalGeneralMeetingSourceState],
      ["dividends", synchronizeGlobalDividends, getGlobalDividendSourceState],
    ]) {
      try {
        let result = await synchronize({ refreshSource: true });
        const sourceSync = result.sourceSync;
        let batches = 1;
        while (result.pending > 0 && batches < 3) {
          result = await synchronize({ refreshSource: false });
          batches += 1;
        }
        const laneState = await getSourceState();
        const overlapDue = sourceSync?.overlapDue ?? Boolean(laneState.overlapIsStale);
        const assessment = assessGpwSync({
          batch: { errors: result.errors, pending: result.pending },
          source: {
            status: sourceSync?.status ?? laneState.status,
            lastCheckedAt: laneState.lastCheckedAt,
            lastSuccessAt: laneState.lastSuccessAt,
            errors: sourceSync?.errors,
            isStale: laneState.isStale,
            locked: sourceSync?.locked ?? laneState.isRefreshing,
            backfillComplete: sourceSync?.backfillComplete ?? (name === "meetings" ? undefined : laneState.backfillComplete),
            nextBackfillCursor: sourceSync?.nextBackfillPage ?? (name === "meetings" ? undefined : laneState.nextBackfillPage),
            overlapDue,
            overlapComplete: sourceSync?.overlapDue ? sourceSync.overlapComplete : overlapDue ? false : undefined,
          },
          projections: { pending: result.pending, errors: result.errors,
            unmatched: result.unmatched, reviewed: result.reviewed },
        });
        console.info("[GPW SCHEDULED SYNC] projection", {
          name, batches, fetched: result.fetched, created: result.created,
          batchStatus: assessment.batchStatus,
          source: assessment.source,
          historicalBackfill: assessment.historicalBackfill,
          overlapRepair: assessment.overlapRepair,
          projections: assessment.projections,
          calendarCoverage: assessment.coverage.status,
          sourceSync: sourceSync ? {
            status: sourceSync.status,
            pages: sourceSync.pagesRead,
            candidates: sourceSync.candidates,
            fetched: sourceSync.fetched,
            parsed: sourceSync.parsed,
            saved: sourceSync.saved,
            duplicates: sourceSync.duplicates,
            errors: sourceSync.errors,
            overlapDue: sourceSync.overlapDue,
            overlapComplete: sourceSync.overlapComplete,
            backfillComplete: sourceSync.backfillComplete,
            nextBackfillPage: sourceSync.nextBackfillPage,
          } : undefined,
        });
        failed ||= assessment.batchStatus !== "BATCH_COMPLETE" ||
          Boolean(sourceSync && (sourceSync.status !== "SUCCESS" || sourceSync.errors > 0 || sourceSync.locked ||
            (sourceSync.overlapDue && !sourceSync.overlapComplete)));
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

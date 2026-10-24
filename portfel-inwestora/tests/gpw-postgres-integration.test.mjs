import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { execute, initializeDatabase, query } from "../src/lib/server/db.ts";
import { synchronizeGlobalReportSchedules } from "../src/lib/server/corporate-events.ts";

const databaseUrl = process.env.MEXO_GPW_TEST_DATABASE_URL;

test("PostgreSQL: schedule projection is idempotent, correction-safe, and preserves reviewed data", {
  skip: !databaseUrl,
}, async () => {
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(url.hostname),
    "integration tests may only write to a loopback PostgreSQL instance");
  assert.equal(decodeURIComponent(url.pathname.slice(1)), "mexo_gpw_test",
    "integration tests require the dedicated mexo_gpw_test database");

  process.env.DATABASE_URL = databaseUrl;
  await initializeDatabase();

  const runId = randomUUID();
  const ticker = `IT${runId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const instrumentId = `corporate-event-instrument:gpw:ticker:${ticker}`;
  const canonicalKey = `gpw:ticker:${ticker}`;
  const now = new Date();
  const publishedAt = new Date(now.getTime() - 60_000).toISOString();
  const scheduleUrl = `https://fixture.invalid/${runId}/schedule`;
  const duplicateUrl = `https://fixture.invalid/${runId}/schedule-copy`;
  const anomalyUrl = `https://fixture.invalid/${runId}/late-report`;
  const scheduleBody = [
    "Harmonogram publikacji raportów okresowych za 2026 rok:",
    "Raport półroczny za I półrocze 2026 r. zostanie opublikowany 30 lipca 2026 r.",
    "Raport kwartalny za III kwartał 2026 r. zostanie opublikowany 26 października 2026 r.",
  ].join("\n");
  const anomalyBody = "Raport kwartalny za III kwartał 2025 r. zostanie opublikowany 18 listopada 2026 r.";
  const reportRows = [
    { id: `fixture-${runId}-schedule-a`, sourceId: `fixture:schedule:${runId}:a`, sourceUrl: scheduleUrl, title: "Harmonogram publikacji raportów okresowych za 2026 rok", body: scheduleBody, publishedAt },
    { id: `fixture-${runId}-schedule-b`, sourceId: `fixture:schedule:${runId}:b`, sourceUrl: duplicateUrl, title: "Harmonogram publikacji raportów okresowych za 2026 rok", body: scheduleBody, publishedAt },
    { id: `fixture-${runId}-anomaly`, sourceId: `fixture:anomaly:${runId}`, sourceUrl: anomalyUrl, title: "Harmonogram terminów raportów okresowych", body: anomalyBody, publishedAt },
  ];

  try {
    await execute(
      `INSERT INTO corporate_event_instruments
        (id, canonical_key, market, ticker, company_name, created_at, updated_at)
       VALUES ($1, $2, 'GPW', $3, $4, $5, $5)`,
      [instrumentId, canonicalKey, ticker, `Fixture ${ticker}`, now.toISOString()],
    );

    const existingEventId = `fixture-event-${runId}`;
    const existingSourceId = `fixture-event-source-${runId}`;
    await execute(
      `INSERT INTO corporate_events
        (id, instrument_id, event_type, event_date, fiscal_period, fiscal_year,
         event_identity, status, active, source_published_at, source_type,
         source_priority, discovered_at, updated_at)
       VALUES ($1, $2, 'QUARTERLY_REPORT', '2026-11-18', 'Q3', 2025,
         'QUARTERLY_REPORT:Q3:2025', 'CONFIRMED', TRUE, $3,
         'ISSUER_CURRENT_REPORT', 300, $4, $4)`,
      [existingEventId, instrumentId, publishedAt, now.toISOString()],
    );
    await execute(
      `INSERT INTO corporate_event_sources
        (id, corporate_event_id, source_type, source_url, source_priority, discovered_at)
       VALUES ($1, $2, 'ISSUER_CURRENT_REPORT', $3, 300, $4)`,
      [existingSourceId, existingEventId, `https://fixture.invalid/${runId}/existing-confirmed`, now.toISOString()],
    );

    for (const report of reportRows) {
      await execute(
        `INSERT INTO espi_reports
          (id, source, source_id, issuer_id, issuer_name, market, source_ticker,
           report_type, published_at, source_title, title, body_text, category,
           source_url, discovered_at, updated_at)
         VALUES ($1, 'PAP_ESPI', $2, $3, $4, 'GPW', $5, 'CURRENT', $6,
           $7, $7, $8, 'OTHER', $9, $10, $10)`,
        [report.id, report.sourceId, instrumentId, `Fixture ${ticker}`, ticker,
          report.publishedAt, report.title, report.body, report.sourceUrl, now.toISOString()],
      );
    }

    const first = await synchronizeGlobalReportSchedules({ refreshSource: false, force: true });
    assert.equal(first.fetched, 3);
    assert.equal(first.errors, 0);
    assert.ok(first.reviewed >= 1, "late schedule should be surfaced for review");

    let events = await query(
      `SELECT event_type, event_date, fiscal_period, fiscal_year, event_identity,
              status, active
       FROM corporate_events WHERE instrument_id = $1 ORDER BY event_identity`,
      [instrumentId],
    );
    assert.equal(events.length, 3, "two schedule entries plus the existing reviewed period");
    assert.deepEqual(events.filter((event) => event.fiscal_year === 2026)
      .map(({ fiscal_period, event_date }) => [fiscal_period, event_date]), [
      ["H1", "2026-07-30"],
      ["Q3", "2026-10-26"],
    ]);
    const preserved = events.find((event) => event.event_identity === "QUARTERLY_REPORT:Q3:2025");
    assert.deepEqual([preserved?.event_date, preserved?.status, preserved?.active], ["2026-11-18", "CONFIRMED", true]);

    await synchronizeGlobalReportSchedules({ refreshSource: false, force: true });
    let countRows = await query(
      "SELECT COUNT(*)::text AS count FROM corporate_events WHERE instrument_id = $1 AND active = TRUE",
      [instrumentId],
    );
    assert.equal(Number(countRows[0]?.count), 3, "repeat projection must not create duplicate active events");

    const correctedAt = new Date(now.getTime() + 60_000).toISOString();
    const correctedBody = [
      "Harmonogram publikacji raportów okresowych za 2026 rok:",
      "Raport półroczny za I półrocze 2026 r. zostanie opublikowany 30 lipca 2026 r.",
      "Raport kwartalny za III kwartał 2026 r. zostanie opublikowany 27 października 2026 r.",
    ].join("\n");
    await execute(
      `UPDATE espi_reports SET body_text = $1, published_at = $2, source_checked_at = $2, updated_at = $2 WHERE id = $3`,
      [correctedBody, correctedAt, reportRows[0].id],
    );
    await synchronizeGlobalReportSchedules({ refreshSource: false, force: true });

    events = await query(
      `SELECT event_date, event_identity FROM corporate_events
       WHERE instrument_id = $1 AND active = TRUE AND event_identity = 'QUARTERLY_REPORT:Q3:2026'`,
      [instrumentId],
    );
    assert.deepEqual(events.map(({ event_date }) => event_date), ["2026-10-27"],
      "a newer source correction updates the one stable quarter identity");
    const history = await query(
      `SELECT previous_event_date, next_event_date FROM corporate_event_history
       WHERE corporate_event_id = (SELECT id FROM corporate_events WHERE instrument_id = $1
         AND event_identity = 'QUARTERLY_REPORT:Q3:2026' AND active = TRUE)`,
      [instrumentId],
    );
    assert.ok(history.some(({ previous_event_date, next_event_date }) =>
      previous_event_date === "2026-10-26" && next_event_date === "2026-10-27"),
    "date changes must remain auditable");

    countRows = await query(
      "SELECT COUNT(*)::text AS count FROM corporate_events WHERE instrument_id = $1 AND active = TRUE",
      [instrumentId],
    );
    assert.equal(Number(countRows[0]?.count), 3);
  } finally {
    await execute("DELETE FROM espi_reports WHERE source_id LIKE $1", [`%${runId}%`]);
    await execute("DELETE FROM corporate_event_instruments WHERE id = $1", [instrumentId]);
    await globalThis.portfelPostgresPool?.end();
    globalThis.portfelPostgresPool = undefined;
    globalThis.portfelSchemaInitialization = undefined;
  }
});

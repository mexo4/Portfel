import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { execute, initializeDatabase, query, withTransaction } from "../src/lib/server/db.ts";
import {
  getGlobalGeneralMeetings,
  synchronizeGlobalGeneralMeetings,
  synchronizeGlobalReportSchedules,
} from "../src/lib/server/corporate-events.ts";
import { expandGpwStoredCalendarEvent } from "../src/lib/public-gpw-calendar.ts";
import { toIcalMilestones } from "../src/lib/gpw-ical.ts";

const databaseUrl = process.env.MEXO_GPW_TEST_DATABASE_URL;

test("PostgreSQL: schedule projection is idempotent, correction-safe, and preserves reviewed data", {
  skip: !databaseUrl,
}, async () => {
  const url = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(url.hostname),
    "integration tests may only write to a loopback PostgreSQL instance");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol),
    "integration tests require a PostgreSQL URI");
  assert.equal(decodeURIComponent(url.username), "mexo_gpw_test",
    "integration tests require the dedicated mexo_gpw_test role");
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
  const genericTitleUrl = `https://fixture.invalid/${runId}/selected-data`;
  const plannedDateUrl = `https://fixture.invalid/${runId}/preliminary-sales`;
  const wrappedPublicationUrl = `https://fixture.invalid/${runId}/preliminary-results`;
  const ordinaryReportUrl = `https://fixture.invalid/${runId}/ordinary-results`;
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
    { id: `fixture-${runId}-generic-body`, sourceId: `fixture:generic:${runId}`, sourceUrl: genericTitleUrl,
      title: "Szacunkowe wybrane dane operacyjne za III kwartał 2026 roku",
      body: "Szacunkowe wybrane dane operacyjne za III kwartał 2026 roku. Ostateczny raport kwartalny za III kwartał 2026 roku zostanie opublikowany 26 października 2026 roku.",
      publishedAt },
    { id: `fixture-${runId}-planned-date`, sourceId: `fixture:planned-date:${runId}`,
      sourceUrl: plannedDateUrl, title: "Wstępne dane o sprzedaży za III kwartał 2026 roku",
      body: "Wstępne dane za III kwartał 2026 roku. Planowany termin publikacji raportu okresowego za III kwartał 2026 przypada\nw dniu 26 października 2026 r.",
      publishedAt },
    { id: `fixture-${runId}-wrapped-publication`, sourceId: `fixture:wrapped-publication:${runId}`,
      sourceUrl: wrappedPublicationUrl, title: "Wstępne wyniki po 3 kwartałach 2026 roku",
      body: "Wyniki są szacunkowe. Ostateczne wyniki zostaną przedstawione w raporcie kwartalnym Spółki, który zostanie\nopublikowany w dniu 26.10.2026 roku.",
      publishedAt },
    { id: `fixture-${runId}-ordinary`, sourceId: `fixture:ordinary:${runId}`, sourceUrl: ordinaryReportUrl,
      title: "Wyniki finansowe za trzeci kwartał 2026 roku",
      body: "Spółka opublikowała raport kwartalny za trzeci kwartał 2026 roku. Dane zostały przekazane akcjonariuszom 26 października 2026 roku.",
      publishedAt },
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
    const firstStatuses = await query(
      "SELECT source_id, report_schedule_projection_status FROM espi_reports WHERE id = ANY($1::text[]) ORDER BY source_id",
      [reportRows.map((report) => report.id)],
    );
    assert.equal(first.fetched, 6,
      `formal publication dates in generic preliminary-result bodies must enter the projection queue: ${JSON.stringify(firstStatuses)}`);
    assert.equal(first.errors, 0);
    const genericProjection = await query(
      "SELECT report_schedule_projection_status FROM espi_reports WHERE id = $1",
      [reportRows[3].id],
    );
    assert.equal(genericProjection[0]?.report_schedule_projection_status, "SUCCESS");
    const preliminaryProjections = await query(
      "SELECT source_id, report_schedule_projection_status FROM espi_reports WHERE id = ANY($1::text[])",
      [reportRows.slice(4, 6).map((report) => report.id)],
    );
    assert.deepEqual(preliminaryProjections.map((report) => report.report_schedule_projection_status),
      ["SUCCESS", "SUCCESS"], "line-wrapped formal dates should be projected from generic-title ESPI reports");
    const ordinaryProjection = await query(
      "SELECT report_schedule_projection_status FROM espi_reports WHERE id = $1",
      [reportRows[6].id],
    );
    assert.equal(ordinaryProjection[0]?.report_schedule_projection_status, null,
      "an already published results report is not a future publication schedule candidate");
    assert.ok(first.reviewed >= 1, "late schedule should be surfaced for review");
    const quarantined = await query(
      "SELECT report_schedule_projection_status, report_schedule_review_reasons FROM espi_reports WHERE id = $1",
      [reportRows[2].id],
    );
    assert.equal(quarantined[0]?.report_schedule_projection_status, "REVIEW_REQUIRED");
    assert.ok(quarantined[0]?.report_schedule_review_reasons?.length > 0,
      "an uncertain source must retain machine-readable reasons, not look successfully published");

    let events = await query(
      `SELECT id, event_type, event_date, fiscal_period, fiscal_year, event_identity,
              status, active
       FROM corporate_events WHERE instrument_id = $1 ORDER BY event_identity`,
      [instrumentId],
    );
    assert.equal(events.length, 3,
      `two schedule entries plus the existing reviewed period: ${JSON.stringify(events)}`);
    assert.deepEqual(events.filter((event) => event.fiscal_year === 2026)
      .map(({ fiscal_period, event_date }) => [fiscal_period, event_date]), [
      ["H1", "2026-07-30"],
      ["Q3", "2026-10-26"],
    ]);
    const preserved = events.find((event) => event.event_identity === "QUARTERLY_REPORT:Q3:2025");
    assert.deepEqual([preserved?.event_date, preserved?.status, preserved?.active], ["2026-11-18", "CONFIRMED", true]);
    const initialIds = new Map(events.map((event) => [event.event_identity, event.id]));
    const q3Sources = await query(
      `SELECT COUNT(DISTINCT source.source_url)::int AS count
       FROM corporate_event_sources AS source
       JOIN corporate_events AS event ON event.id = source.corporate_event_id
       WHERE event.instrument_id = $1 AND event.event_identity = 'QUARTERLY_REPORT:Q3:2026'`,
      [instrumentId],
    );
    assert.ok(q3Sources[0]?.count >= 2,
      "semantically identical publications must share one event while preserving distinct provenance");

    const checkpoint = await synchronizeGlobalReportSchedules({ refreshSource: false });
    assert.equal(checkpoint.fetched, 0, "completed source checkpoints should not be reprocessed");
    assert.equal(checkpoint.pending, 0, "a complete isolated queue must have no pending source reports");

    const [concurrentA, concurrentB] = await Promise.all([
      synchronizeGlobalReportSchedules({ refreshSource: false, force: true }),
      synchronizeGlobalReportSchedules({ refreshSource: false, force: true }),
    ]);
    assert.strictEqual(concurrentA, concurrentB,
      "concurrent sync requests should share one in-flight projection pass");
    let countRows = await query(
      "SELECT COUNT(*)::text AS count FROM corporate_events WHERE instrument_id = $1 AND active = TRUE",
      [instrumentId],
    );
    assert.equal(Number(countRows[0]?.count), 3, "repeat projection must not create duplicate active events");
    const repeatedIds = await query(
      "SELECT id, event_identity FROM corporate_events WHERE instrument_id = $1 AND active = TRUE",
      [instrumentId],
    );
    assert.deepEqual(new Map(repeatedIds.map((event) => [event.event_identity, event.id])), initialIds,
      "idempotent reimport must preserve stable event and ICS identities");

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
      `SELECT id, event_date, event_identity FROM corporate_events
       WHERE instrument_id = $1 AND active = TRUE AND event_identity = 'QUARTERLY_REPORT:Q3:2026'`,
      [instrumentId],
    );
    assert.deepEqual(events.map(({ event_date }) => event_date), ["2026-10-27"],
      "a newer source correction updates the one stable quarter identity");
    assert.equal(events[0]?.id, initialIds.get("QUARTERLY_REPORT:Q3:2026"),
      "a date correction must not change the event and ICS identity");
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

    const correctedEventId = events[0].id;
    await assert.rejects(
      withTransaction(async (transaction) => {
        await transaction.execute("UPDATE corporate_events SET event_date = '2030-01-01' WHERE id = $1", [correctedEventId]);
        throw new Error("INJECTED_TEST_ROLLBACK");
      }),
      /INJECTED_TEST_ROLLBACK/,
    );
    const afterRollback = await query("SELECT event_date FROM corporate_events WHERE id = $1", [correctedEventId]);
    assert.equal(afterRollback[0]?.event_date, "2026-10-27",
      "a failed transaction must leave the last confirmed projection untouched");

    const publicRows = await query(
      `SELECT event.id, issuer.ticker, issuer.company_name, event.event_type,
              event.event_date, event.event_time, event.fiscal_period, event.fiscal_year,
              event.fiscal_year_label, event.general_meeting_type, event.registration_date,
              event.dividend_per_share, event.dividend_currency, event.record_date,
              event.payment_date, event.status, event.active, event.updated_at,
              source.source_url, source.source_published_at
       FROM corporate_events AS event
       JOIN corporate_event_instruments AS issuer ON issuer.id = event.instrument_id
       JOIN LATERAL (
         SELECT source_url, source_published_at FROM corporate_event_sources
         WHERE corporate_event_id = event.id ORDER BY source_published_at DESC NULLS LAST LIMIT 1
       ) AS source ON TRUE
       WHERE event.id = $1 AND event.active = TRUE`,
      [correctedEventId],
    );
    assert.equal(publicRows.length, 1);
    const calendar = expandGpwStoredCalendarEvent(publicRows[0], "2026-01-01", "2027-12-31");
    const ical = toIcalMilestones(publicRows[0], "2026-01-01", "2027-12-31");
    assert.deepEqual(calendar.map(({ id, date }) => [id, date]), [[correctedEventId, "2026-10-27"]]);
    assert.deepEqual(ical.map(({ uid, date }) => [uid, date]),
      [[`${correctedEventId}:report@mexo.com.pl`, "2026-10-27"]],
      "public-calendar and ICS converters must use the same corrected persisted date");

    const periodReportId = `fixture-${runId}-period`;
    const periodSourceUrl = `https://fixture.invalid/${runId}/period`;
    const periodTitle = "Harmonogram terminów raportów okresowych za 2026 rok";
    const periodBody = (period) => `${periodTitle}. Raport kwartalny za ${period} kwartał 2026 r. zostanie opublikowany 21 sierpnia 2026 r.`;
    await execute(
      `INSERT INTO espi_reports
        (id, source, source_id, issuer_id, issuer_name, market, source_ticker,
         report_type, published_at, source_title, title, body_text, category,
         source_url, discovered_at, updated_at)
       VALUES ($1, 'PAP_ESPI', $2, $3, $4, 'GPW', $5, 'CURRENT', $6,
         $7, $7, $8, 'OTHER', $9, $10, $10)`,
      [periodReportId, `fixture:period:${runId}`, instrumentId, `Fixture ${ticker}`, ticker,
        publishedAt, periodTitle, periodBody("I"), periodSourceUrl, now.toISOString()],
    );
    const firstPeriod = await synchronizeGlobalReportSchedules({ refreshSource: false, force: true });
    assert.equal(firstPeriod.errors, 0);
    const q1Rows = await query(
      `SELECT id, active FROM corporate_events WHERE instrument_id = $1
       AND event_identity = 'QUARTERLY_REPORT:Q1:2026'`, [instrumentId],
    );
    assert.equal(q1Rows.length, 1);
    assert.equal(q1Rows[0].active, true);
    await execute(
      `UPDATE espi_reports SET body_text = $1, published_at = $2,
       source_checked_at = $2, updated_at = $2 WHERE id = $3`,
      [periodBody("II"), new Date(now.getTime() + 120_000).toISOString(), periodReportId],
    );
    const correctedPeriod = await synchronizeGlobalReportSchedules({ refreshSource: false, force: true });
    assert.equal(correctedPeriod.errors, 0);
    const periodRows = await query(
      `SELECT event_identity, event_date, active FROM corporate_events
       WHERE instrument_id = $1 AND event_date = '2026-08-21'
         AND event_identity IN ('QUARTERLY_REPORT:Q1:2026', 'QUARTERLY_REPORT:Q2:2026')
       ORDER BY event_identity`, [instrumentId],
    );
    assert.deepEqual(periodRows.map(({ event_identity, active }) => [event_identity, active]), [
      ["QUARTERLY_REPORT:Q1:2026", false],
      ["QUARTERLY_REPORT:Q2:2026", true],
    ], "a corrected fiscal period must retire only the false source-exclusive projection");
    await synchronizeGlobalReportSchedules({ refreshSource: false, force: true });
    const activePeriodRows = await query(
      `SELECT event_identity FROM corporate_events WHERE instrument_id = $1
         AND event_date = '2026-08-21' AND active = TRUE`, [instrumentId],
    );
    assert.deepEqual(activePeriodRows.map(({ event_identity }) => event_identity),
      ["QUARTERLY_REPORT:Q2:2026"], "reprojection must remain idempotent");

    const legacyId = `fixture-${runId}-legacy-label`;
    const legacySourceUrl = `https://fixture.invalid/${runId}/legacy-label-schedule`;
    const legacyReportId = `fixture-${runId}-legacy-label-report`;
    await execute(
      `INSERT INTO corporate_events
        (id, instrument_id, event_type, event_date, event_identity, status, active,
         source_published_at, source_type, source_priority, discovered_at, updated_at)
       VALUES ($1, $2, 'QUARTERLY_REPORT', '2027-04-12', 'QUARTERLY_REPORT::',
         'CONFIRMED', TRUE, $3, 'ISSUER_CURRENT_REPORT', 300, $3, $3)`,
      [legacyId, instrumentId, publishedAt],
    );
    await execute(
      `INSERT INTO corporate_event_sources
        (id, corporate_event_id, source_type, source_url, source_published_at,
         source_priority, discovered_at)
       VALUES ($1, $2, 'ISSUER_CURRENT_REPORT', $3, $4, 300, $4)`,
      [`${legacyId}-source`, legacyId, legacySourceUrl, publishedAt],
    );
    await execute(
      `INSERT INTO espi_reports
        (id, source, source_id, issuer_id, issuer_name, market, source_ticker,
         report_type, published_at, source_title, title, body_text, category,
         source_url, discovered_at, updated_at)
       VALUES ($1, 'PAP_ESPI', $2, $3, $4, 'GPW', $5, 'CURRENT', $6,
         $7, $7, $8, 'OTHER', $9, $10, $10)`,
      [legacyReportId, `fixture:legacy-label:${runId}`, instrumentId,
        `Fixture ${ticker}`, ticker, publishedAt,
        "Harmonogram publikacji raportów okresowych za 2027 rok",
        "Raport kwartalny za I kwartał 2027 roku zostanie opublikowany 12 kwietnia 2027 roku.",
        legacySourceUrl, now.toISOString()],
    );
    const legacySync = await synchronizeGlobalReportSchedules({ refreshSource: false, force: true });
    assert.equal(legacySync.errors, 0);
    const enrichedLegacy = await query(
      `SELECT id, event_identity, fiscal_period, fiscal_year, active
       FROM corporate_events WHERE instrument_id = $1 AND event_date = '2027-04-12'`,
      [instrumentId],
    );
    assert.deepEqual(enrichedLegacy.map(({ id, event_identity, fiscal_period, fiscal_year, active }) =>
      [id, event_identity, fiscal_period, Number(fiscal_year), active]),
    [[legacyId, "QUARTERLY_REPORT:Q1:2027", "Q1", 2027, true]],
    "one complete source should enrich a legacy report label without changing its event/ICS ID");
    await synchronizeGlobalReportSchedules({ refreshSource: false, force: true });
    const legacyReplay = await query(
      "SELECT COUNT(*)::int AS count FROM corporate_events WHERE instrument_id = $1 AND event_date = '2027-04-12' AND active = TRUE",
      [instrumentId],
    );
    assert.equal(legacyReplay[0].count, 1, "replaying the source must not duplicate an enriched legacy event");

    const meetingDate = "2026-11-18";
    const meetingReportId = `fixture-${runId}-meeting`;
    const meetingTitle = "Zwołanie Nadzwyczajnego Walnego Zgromadzenia";
    await execute(
      `INSERT INTO espi_reports
        (id, source, source_id, issuer_id, issuer_name, market, source_ticker,
         report_type, published_at, source_title, title, body_text, category,
         source_url, discovered_at, updated_at)
       VALUES ($1, 'PAP_ESPI', $2, $3, $4, 'GPW', $5, 'CURRENT', $6,
         $7, $7, $8, 'GENERAL_MEETING', $9, $10, $10)`,
      [meetingReportId, `fixture:meeting:${runId}`, instrumentId, `Fixture ${ticker}`, ticker,
        publishedAt, meetingTitle,
        `Zarząd Spółki zwołuje Nadzwyczajne Walne Zgromadzenie na dzień 18 listopada 2026 roku o godzinie 10:00.`,
        `https://fixture.invalid/${runId}/meeting`, now.toISOString()],
    );
    const meetingSync = await synchronizeGlobalGeneralMeetings({ refreshSource: false, force: true });
    assert.equal(meetingSync.errors, 0);
    const meetingRows = await query(
      `SELECT id, status, active FROM corporate_events WHERE instrument_id = $1
       AND event_type = 'GENERAL_MEETING' AND event_date = $2`, [instrumentId, meetingDate],
    );
    assert.deepEqual(meetingRows.map(({ status, active }) => [status, active]), [["CONFIRMED", true]]);
    const meetingEventId = meetingRows[0].id;
    const cancellationReportId = `fixture-${runId}-meeting-cancel`;
    const cancellationTitle = "Odwołanie Nadzwyczajnego Walnego Zgromadzenia";
    const cancellationBody = [
      `Fixture ${ticker} (1/2026) ${cancellationTitle}`,
      `Fixture ${ticker} z dnia 18.11.2026 r.`,
      "Data publikacji: 27.10.2026, 08:32",
      `Fixture ${ticker}, w nawiązaniu do raportu bieżącego nr 47/2026 z dnia`,
      "22 października 2026 r., w którym zwołał Nadzwyczajne Walne Zgromadzenie Spółki",
      "na dzień 18 listopada 2026 r., niniejszym informuje o odwołaniu tego Zgromadzenia.",
    ].join("\n");
    await execute(
      `INSERT INTO espi_reports
        (id, source, source_id, issuer_id, issuer_name, market, source_ticker,
         report_type, published_at, source_title, title, body_text, category,
         source_url, discovered_at, updated_at)
       VALUES ($1, 'PAP_ESPI', $2, $3, $4, 'GPW', $5, 'CURRENT', $6,
         $7, $7, $8, 'GENERAL_MEETING', $9, $10, $10)`,
      [cancellationReportId, `fixture:meeting-cancel:${runId}`, instrumentId,
        `Fixture ${ticker}`, ticker, new Date(now.getTime() + 180_000).toISOString(),
        cancellationTitle, cancellationBody, `https://fixture.invalid/${runId}/meeting-cancel`,
        now.toISOString()],
    );
    const cancelledSync = await synchronizeGlobalGeneralMeetings({ refreshSource: false, force: true });
    assert.equal(cancelledSync.errors, 0);
    const cancelledRows = await query(
      `SELECT id, status, active FROM corporate_events WHERE instrument_id = $1
       AND event_type = 'GENERAL_MEETING' AND event_date = $2`, [instrumentId, meetingDate],
    );
    assert.deepEqual(cancelledRows.map(({ id, status, active }) => [id, status, active]),
      [[meetingEventId, "CANCELLED", false]], "cancellation must not create a second meeting");
    const publicMeetings = await getGlobalGeneralMeetings({
      fromDate: "2026-11-01", toDate: "2026-11-30", canonicalKeys: [canonicalKey],
    });
    assert.equal(publicMeetings.length, 0, "the shared active-meeting read model must omit cancellations");
    await synchronizeGlobalGeneralMeetings({ refreshSource: false, force: true });
    const afterMeetingReplay = await query(
      `SELECT id, status, active FROM corporate_events WHERE instrument_id = $1
       AND event_type = 'GENERAL_MEETING' AND event_date = $2`, [instrumentId, meetingDate],
    );
    assert.deepEqual(afterMeetingReplay, cancelledRows,
      "replaying older and newer notices must not resurrect a cancelled meeting");
  } finally {
    await execute("DELETE FROM espi_reports WHERE source_id LIKE $1", [`%${runId}%`]);
    await execute("DELETE FROM corporate_event_instruments WHERE id = $1", [instrumentId]);
    await globalThis.portfelPostgresPool?.end();
    globalThis.portfelPostgresPool = undefined;
    globalThis.portfelSchemaInitialization = undefined;
  }
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

const appRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const require = createRequire(import.meta.url);
const nextBinary = require.resolve("next/dist/bin/next");
const outputDir = path.join(appRoot, "artifacts", "gpw-quality");
const dateCase = process.argv.find((arg) => arg.startsWith("--date-case="))?.split("=")[1] ?? "same-month";
assert.ok(["same-month", "cross-month"].includes(dateCase), "Unsupported --date-case");
const outputPath = path.join(outputDir, `http-e2e-${dateCase}.json`);
const databaseUrl = process.env.MEXO_GPW_TEST_DATABASE_URL;
const holdOpenMs = Number(process.argv.find((arg) => arg.startsWith("--hold-open-ms="))?.split("=")[1] ?? 0);
assert.ok(Number.isInteger(holdOpenMs) && holdOpenMs >= 0 && holdOpenMs <= 120_000,
  "--hold-open-ms must be between 0 and 120000");
const checks = [];
const sourceLanes = ["GPW_REPORT_SCHEDULES", "GPW_WZA", "GPW_DIVIDENDS"];
const runId = randomUUID();
const prefix = `gpw-http-${runId}`;
let server;
let pool;
let originalSourceStates;
let userId;
let instrumentId;
let listenerPort;
let status = "HTTP_E2E_FAIL";
let failure = null;

const assertIsolatedDatabase = (value) => {
  assert.ok(value, "MEXO_GPW_TEST_DATABASE_URL is required; no application DB fallback is allowed");
  const parsed = new URL(value);
  assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol));
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname));
  assert.equal(decodeURIComponent(parsed.username), "mexo_gpw_test");
  assert.equal(decodeURIComponent(parsed.pathname.slice(1)), "mexo_gpw_test");
};

const addDays = (value, days) => {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const today = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

const freePort = async () => {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  const port = typeof address === "object" ? address.port : null;
  await new Promise((resolve) => listener.close(resolve));
  assert.ok(port);
  return port;
};

const request = async (base, route, options = {}) => {
  const response = await fetch(`${base}${route}`, { ...options, signal: AbortSignal.timeout(12_000) });
  return response;
};

const waitForServer = async (base) => {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error("Next.js process exited before becoming ready");
    try {
      const response = await request(base, "/api/system/revision");
      if (response.ok) return;
    } catch { /* Startup is still in progress. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Next.js HTTP startup timeout");
};

const startServer = async (base) => {
  server = spawn(process.execPath,
    [nextBinary, "start", "--hostname", "127.0.0.1", "--port", String(listenerPort)],
    { cwd: appRoot, env: { ...process.env, DATABASE_URL: databaseUrl,
      POSTGRES_CA_CERT_BASE64: "", POSTGRES_CA_CERT_PATH: "", NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.resume();
  server.stderr.resume();
  await waitForServer(base);
};

const stopServer = async () => {
  if (!server) return;
  if (server.exitCode !== null) { server = undefined; return; }
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
  server = undefined;
};

const polishDate = (isoDate) => new Intl.DateTimeFormat("pl-PL", {
  timeZone: "UTC", day: "numeric", month: "long", year: "numeric",
}).format(new Date(`${isoDate}T12:00:00.000Z`));

const fixtureDate = () => {
  const firstOfThisMonth = `${today().slice(0, 7)}-01`;
  const firstOfNextMonth = new Date(`${firstOfThisMonth}T12:00:00.000Z`);
  firstOfNextMonth.setUTCMonth(firstOfNextMonth.getUTCMonth() + 1);
  const nextMonthStart = firstOfNextMonth.toISOString().slice(0, 10);
  if (dateCase === "same-month") return nextMonthStart;
  const endOfThisMonth = addDays(nextMonthStart, -1);
  if (endOfThisMonth > today()) return endOfThisMonth;
  const firstOfFollowingMonth = new Date(firstOfNextMonth);
  firstOfFollowingMonth.setUTCMonth(firstOfFollowingMonth.getUTCMonth() + 1);
  return addDays(firstOfFollowingMonth.toISOString().slice(0, 10), -1);
};

const renderedEventCards = (html, eventId) => [...html.matchAll(/<article\b[^>]*>/gu)]
  .map(([tag]) => Object.fromEntries([...tag.matchAll(/\b(data-gpw-[\w-]+)="([^"]*)"/gu)]
    .map((match) => [match[1], match[2]])))
  .filter((card) => card["data-gpw-event-id"] === eventId);

const reportIcsEvents = (ics, eventId) => [...ics.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/gu)]
  .map(([, body]) => ({ uid: body.match(/^UID:(.+)$/mu)?.[1]?.trim(),
    date: body.match(/^DTSTART;VALUE=DATE:(\d{8})$/mu)?.[1] }))
  .filter((event) => event.uid === `${eventId}:report@mexo.com.pl`);

const waitForCorrectedProjection = async (client, eventId, correctedDate) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { rows } = await client.query(
      "SELECT event_date, active FROM corporate_events WHERE id = $1", [eventId]);
    if (rows[0]?.event_date === correctedDate && rows[0]?.active === true) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Corrected ESPI schedule did not reach the isolated projection within 30 seconds");
};

const addFixture = async (client) => {
  const now = new Date().toISOString();
  const ticker = `HT${runId.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const eventDate = fixtureDate();
  const correctedDate = addDays(eventDate, 1);
  const paymentDate = addDays(eventDate, 5);
  const registrationDate = addDays(eventDate, -16);
  userId = `${prefix}-user`;
  instrumentId = `${prefix}-instrument`;
  const email = `${prefix}@example.invalid`;
  const password = randomUUID();
  const passwordHash = await bcrypt.hash(password, 4);
  await client.query(`INSERT INTO users
    (id, email, password_hash, display_name, email_verified_at, subscription_plan,
     subscription_status, profile_json, portfolio_json, portfolio_revision,
     portfolio_core_revision, created_at, updated_at)
    VALUES ($1, $2, $3, 'GPW HTTP fixture', $4, 'tester', 'active', $5, $6, 0, 0, $4, $4)`,
    [userId, email, passwordHash, now, JSON.stringify({ displayName: "GPW HTTP fixture", email }),
      JSON.stringify({ assets: [], sales: [], realizedAdjustments: [] })]);
  await client.query(`INSERT INTO corporate_event_instruments
    (id, canonical_key, market, ticker, company_name, created_at, updated_at)
    VALUES ($1, $2, 'GPW', $3, 'GPW HTTP Fixture', $4, $4)`,
    [instrumentId, `gpw:ticker:${ticker}`, ticker, now]);
  const fiscalYear = Number(today().slice(0, 4));
  const rows = [
    { suffix: "report", type: "QUARTERLY_REPORT", date: eventDate,
      identity: `QUARTERLY_REPORT:Q3:${fiscalYear}`, extra: { fiscal_period: "Q3", fiscal_year: fiscalYear } },
    { suffix: "meeting", type: "GENERAL_MEETING", date: eventDate, identity: `GENERAL_MEETING:NWZ:${eventDate}`, extra: { general_meeting_type: "NWZ", registration_date: registrationDate } },
    { suffix: "dividend", type: "UPCOMING_DIVIDEND", date: eventDate,
      identity: `UPCOMING_DIVIDEND:${fiscalYear}`, extra: { dividend_per_share: 1.18, dividend_currency: "PLN", record_date: eventDate, payment_date: paymentDate } },
  ];
  for (const row of rows) {
    const id = `${prefix}-${row.suffix}`;
    const sourceUrl = `https://example.invalid/${prefix}/${row.suffix}`;
    await client.query(`INSERT INTO corporate_events
      (id, instrument_id, event_type, event_date, fiscal_period, fiscal_year,
       general_meeting_type, registration_date, dividend_per_share,
       dividend_currency, record_date, payment_date, event_identity, status,
       active, source_published_at, source_type, source_priority, discovered_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
              'CONFIRMED', TRUE, $14, 'ISSUER_CURRENT_REPORT', 300, $14, $14)`,
      [id, instrumentId, row.type, row.date, row.extra.fiscal_period ?? null,
        row.extra.fiscal_year ?? null, row.extra.general_meeting_type ?? null,
        row.extra.registration_date ?? null, row.extra.dividend_per_share ?? null,
        row.extra.dividend_currency ?? null, row.extra.record_date ?? null,
        row.extra.payment_date ?? null, row.identity, now]);
    await client.query(`INSERT INTO corporate_event_sources
      (id, corporate_event_id, source_type, source_url, source_published_at,
       source_priority, discovered_at)
      VALUES ($1, $2, 'ISSUER_CURRENT_REPORT', $3, $4, 300, $4)`,
      [`${id}-source`, id, sourceUrl, now]);
  }
  // These rows keep the opportunistic GET refresh lanes from contacting live
  // sources during the isolated HTTP test. The real routes remain unchanged.
  for (const source of sourceLanes) {
    await client.query(`INSERT INTO espi_sync_state
      (source, status, last_checked_at, last_success_at, last_overlap_at,
       next_backfill_page, backfill_complete, created_at, updated_at)
      VALUES ($1, 'SUCCESS', $2, $2, $2, 1, TRUE, $2, $2)
      ON CONFLICT (source) DO UPDATE SET last_checked_at = EXCLUDED.last_checked_at,
        last_success_at = EXCLUDED.last_success_at, last_overlap_at = EXCLUDED.last_overlap_at,
        status = EXCLUDED.status, backfill_complete = TRUE, updated_at = EXCLUDED.updated_at`,
      [source, now]);
  }
  return { ticker, eventDate, correctedDate, paymentDate, fiscalYear, email, password,
    reportEventId: `${prefix}-report` };
};

const addCorrectedSource = async (client, fixture) => {
  const fiscalYear = fixture.fiscalYear;
  const now = new Date(Date.now() + 60_000).toISOString();
  const title = `Harmonogram publikacji raportów okresowych za ${fiscalYear} rok`;
  const body = `Raport kwartalny za III kwartał ${fiscalYear} r. zostanie opublikowany ${polishDate(fixture.correctedDate)}.`;
  await client.query(`INSERT INTO espi_reports
    (id, source, source_id, issuer_id, issuer_name, market, source_ticker,
     report_type, published_at, source_title, title, body_text, category,
     source_url, discovered_at, updated_at)
    VALUES ($1, 'PAP_ESPI', $2, $3, 'GPW HTTP Fixture', 'GPW', $4,
      'CURRENT', $5, $6, $6, $7, 'OTHER', $8, $5, $5)`,
  [`${prefix}-corrected-source`, `gpw:fixture:${runId}`, instrumentId, fixture.ticker,
    now, title, body, `https://example.invalid/${prefix}/corrected-source`]);
};

try {
  assertIsolatedDatabase(databaseUrl);
  assert.ok(existsSync(path.join(appRoot, ".next", "BUILD_ID")), "Run a production build before HTTP E2E");
  process.env.DATABASE_URL = databaseUrl;
  delete process.env.POSTGRES_CA_CERT_BASE64;
  delete process.env.POSTGRES_CA_CERT_PATH;
  const { initializeDatabase } = await import("../src/lib/server/db.ts");
  await initializeDatabase();
  pool = new Pool({ connectionString: databaseUrl, max: 1 });
  originalSourceStates = (await pool.query(
    "SELECT * FROM espi_sync_state WHERE source = ANY($1::text[])", [sourceLanes])).rows;
  const fixture = await addFixture(pool);
  listenerPort = await freePort();
  const base = `http://127.0.0.1:${listenerPort}`;
  await startServer(base);
  checks.push({ name: "isolated-next-ready", status: "PASS" });

  const login = await request(base, "/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: fixture.email, password: fixture.password }),
  });
  assert.equal(login.status, 200, "test user must log in through the real API");
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("portfel_inwestora_session="));
  checks.push({ name: "real-login", status: "PASS" });

  const report = await request(base, "/api/gpw-reports?scope=all", { headers: { cookie } });
  assert.equal(report.status, 200);
  assert.ok((await report.json()).events.some((event) =>
    event.ticker === fixture.ticker && event.eventDate === fixture.eventDate));
  checks.push({ name: "authenticated-report-api", status: "PASS" });

  const meetings = await request(base, "/api/general-meetings?scope=all", { headers: { cookie } });
  assert.equal(meetings.status, 200);
  assert.ok((await meetings.json()).events.some((event) => event.ticker === fixture.ticker));
  checks.push({ name: "authenticated-wza-api", status: "PASS" });

  const month = fixture.eventDate.slice(0, 7);
  const calendarRoute = `/kalendarz-gpw?miesiac=${month}&typ=reports&spolka=${fixture.ticker}`;
  const calendar = await request(base, calendarRoute);
  assert.equal(calendar.status, 200);
  const initialCalendarHtml = await calendar.text();
  assert.deepEqual(renderedEventCards(initialCalendarHtml, fixture.reportEventId), [
    { "data-gpw-event-id": fixture.reportEventId, "data-gpw-event-date": fixture.eventDate,
      "data-gpw-agenda-date": fixture.eventDate },
  ]);
  checks.push({ name: "rendered-public-calendar", status: "PASS" });

  const appPage = await request(base, "/market/events", { headers: { cookie } });
  assert.equal(appPage.status, 200);
  assert.ok((await appPage.text()).includes("Wydarzenia"));
  checks.push({ name: "authenticated-app-read-surface", status: "PASS" });

  const feed = await request(base,
    `/api/calendar/gpw.ics?categories=reports,dividends,meetings&tickers=${fixture.ticker}`);
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get("content-type") ?? "", /text\/calendar/);
  const ics = await feed.text();
  assert.ok(ics.includes("BEGIN:VCALENDAR") && ics.includes(fixture.ticker));
  assert.ok((ics.match(/BEGIN:VEVENT/g) ?? []).length >= 3);
  checks.push({ name: "http-ics-three-categories", status: "PASS" });

  const reportFeedRoute = `/api/calendar/gpw.ics?categories=reports&tickers=${fixture.ticker}`;
  const initialReportIcs = await (await request(base, reportFeedRoute)).text();
  assert.deepEqual(reportIcsEvents(initialReportIcs, fixture.reportEventId), [
    { uid: `${fixture.reportEventId}:report@mexo.com.pl`, date: fixture.eventDate.replaceAll("-", "") },
  ]);

  // Prime the public caches, then submit one synthetic ESPI date correction.
  // Restarting only the isolated Next process resets its in-memory sync cooldown;
  // the durable DB and .next data cache are deliberately retained. The real
  // report GET schedules projection via `after()`, which must invalidate both
  // cached read models when the canonical event changes.
  await stopServer();
  await addCorrectedSource(pool, fixture);
  await startServer(base);
  const trigger = await request(base, "/api/gpw-reports?scope=all", { headers: { cookie } });
  assert.equal(trigger.status, 200);
  await waitForCorrectedProjection(pool, fixture.reportEventId, fixture.correctedDate);
  const correctedReport = await request(base, "/api/gpw-reports?scope=all", { headers: { cookie } });
  assert.equal(correctedReport.status, 200);
  const correctedEvents = (await correctedReport.json()).events
    .filter((event) => event.ticker === fixture.ticker && event.eventType === "QUARTERLY_REPORT");
  assert.deepEqual(correctedEvents.map((event) => event.eventDate), [fixture.correctedDate]);
  assert.ok(correctedEvents.every((event) => event.id === fixture.reportEventId && event.status === "CONFIRMED"));
  checks.push({ name: "corrected-date-api-stable-identity-old-date-absent", status: "PASS" });

  const correctedMonth = fixture.correctedDate.slice(0, 7);
  const correctedCalendar = await request(base,
    `/kalendarz-gpw?miesiac=${correctedMonth}&typ=reports&spolka=${fixture.ticker}`);
  assert.equal(correctedCalendar.status, 200);
  const correctedHtml = await correctedCalendar.text();
  assert.deepEqual(renderedEventCards(correctedHtml, fixture.reportEventId), [
    { "data-gpw-event-id": fixture.reportEventId, "data-gpw-event-date": fixture.correctedDate,
      "data-gpw-agenda-date": fixture.correctedDate },
  ]);
  if (dateCase === "same-month") {
    assert.equal(month, correctedMonth);
    assert.ok(correctedHtml.includes(fixture.eventDate),
      "The old date also occurs as the serialized month start; card-level assertions distinguish it");
  } else {
    assert.notEqual(month, correctedMonth);
    const oldMonthAfterCorrection = await request(base, calendarRoute);
    assert.equal(oldMonthAfterCorrection.status, 200);
    assert.deepEqual(renderedEventCards(await oldMonthAfterCorrection.text(), fixture.reportEventId), [],
      "The original month must not retain a cached copy of the corrected report");
  }
  checks.push({ name: "corrected-date-public-calendar-cache", status: "PASS" });

  const correctedFeed = await request(base, reportFeedRoute);
  assert.equal(correctedFeed.status, 200);
  const correctedIcs = await correctedFeed.text();
  assert.deepEqual(reportIcsEvents(correctedIcs, fixture.reportEventId), [
    { uid: `${fixture.reportEventId}:report@mexo.com.pl`, date: fixture.correctedDate.replaceAll("-", "") },
  ]);
  assert.equal((correctedIcs.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  checks.push({ name: "corrected-date-ics-cache-old-entry-absent", status: "PASS" });

  if (holdOpenMs) {
    console.log(`GPW_HTTP_E2E_PUBLIC_URL=${base}/kalendarz-gpw?miesiac=${correctedMonth}&typ=reports&spolka=${fixture.ticker}`);
    await new Promise((resolve) => setTimeout(resolve, holdOpenMs));
  }
  status = "HTTP_E2E_PASS";
} catch (error) {
  failure = error instanceof Error ? `${error.name}: ${error.message}` : "unknown";
} finally {
  await stopServer();
  if (pool) {
    try {
      await pool.query("DELETE FROM espi_reports WHERE id = $1", [`${prefix}-corrected-source`]);
      if (userId) await pool.query("DELETE FROM users WHERE id = $1", [userId]);
      if (instrumentId) await pool.query("DELETE FROM corporate_event_instruments WHERE id = $1", [instrumentId]);
      if (originalSourceStates) {
        await pool.query("DELETE FROM espi_sync_state WHERE source = ANY($1::text[])", [sourceLanes]);
        for (const row of originalSourceStates) {
          await pool.query(`INSERT INTO espi_sync_state
            (source, status, last_checked_at, last_success_at, last_overlap_at,
             last_error_code, next_backfill_page, backfill_complete, lock_token,
             lock_expires_at, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [row.source, row.status, row.last_checked_at, row.last_success_at, row.last_overlap_at,
            row.last_error_code, row.next_backfill_page, row.backfill_complete, row.lock_token,
            row.lock_expires_at, row.created_at, row.updated_at]);
        }
      }
    } catch { status = "HTTP_E2E_FAIL"; failure ??= "Fixture cleanup failed"; }
    await pool.end();
  }
  if (globalThis.portfelPostgresPool) await globalThis.portfelPostgresPool.end();
  mkdirSync(outputDir, { recursive: true });
  const report = {
    schemaVersion: 1, status, checks, failure, dateCase,
    scope: {
      database: "dedicated loopback mexo_gpw_test only",
      next: "local production build over HTTP",
      fixture: "synthetic GPW report, WZA and dividend; not a live-source truth test",
      readOnlyEndpoints: ["/api/system/revision", "/api/calendar/gpw.ics"],
      sideEffectEndpoints: ["/api/gpw-reports", "/api/general-meetings", "/kalendarz-gpw"],
      isolatedWrites: ["synthetic fixture", "login test session", "ESPI correction projection"],
      cacheInvalidation: checks.some((check) => check.name === "corrected-date-public-calendar-cache")
        && checks.some((check) => check.name === "corrected-date-ics-cache-old-entry-absent")
        ? "PASS_AFTER_PROJECTION" : "NOT_TESTED",
      correctedDate: checks.some((check) => check.name === "corrected-date-api-stable-identity-old-date-absent")
        ? "PASS" : "NOT_TESTED",
      noProductionDatabase: true,
    },
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ name: "gpw:http:e2e", dateCase, status, checks: checks.length,
    failure: failure?.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[redacted]") ?? null }));
}
if (status !== "HTTP_E2E_PASS") process.exitCode = 1;

// The archive walk's plan, the completeness assessment and the scheduler of the ESPI reports.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { planEspiWalk } = await import("../src/lib/espi-walk.ts");
const { assessEspiCompleteness } = await import("../src/lib/espi-completeness.ts");
const { isEspiSchedulerEnabled, startEspiScheduler } = await import("../src/lib/server/espi-scheduler.ts");

const now = Date.parse("2026-05-20T12:00:00.000Z");
const today = "2026-05-20";
const ago = (hours) => new Date(now - hours * 3_600_000).toISOString();
const plan = (state) => planEspiWalk({ now, today, force: false, lastWalkAt: ago(30), lastFullWalkAt: ago(48), ...state });

test("the archive is walked a week back daily and a year back once a week", () => {
  assert.deepEqual(plan({}), { kind: "recent", from: "2026-05-13" });
  assert.equal(plan({ lastWalkAt: ago(23) }), null, "a walk today is enough");
  assert.deepEqual(plan({ lastWalkAt: ago(5), lastFullWalkAt: ago(7 * 24) }), { kind: "full", from: "2025-05-15" });
  assert.deepEqual(plan({ lastFullWalkAt: null }), { kind: "full", from: "2025-05-15" }, "a new marker asks for a full walk");
  assert.equal(plan({ lastWalkAt: ago(1), lastFullWalkAt: ago(6 * 24) }), null);
});

test("after a longer break the walk reaches back to where the last one ended, a year at most", () => {
  assert.deepEqual(plan({ lastWalkAt: "2026-04-02T08:00:00.000Z" }), { kind: "recent", from: "2026-03-30" });
  assert.deepEqual(plan({ lastWalkAt: "2024-01-01T08:00:00.000Z" }), { kind: "recent", from: "2025-05-15" });
  assert.deepEqual(plan({ lastWalkAt: null }), { kind: "recent", from: "2025-05-15" });
});

test("a failed walk waits before it is tried again, unless an administrator asks", () => {
  assert.equal(plan({ lastFailedWalkAt: ago(1) }), null);
  assert.equal(plan({ lastFullWalkAt: null, lastFailedWalkAt: ago(1) }), null);
  assert.equal(plan({ lastFailedWalkAt: ago(3) }).kind, "recent");
  assert.deepEqual(plan({ force: true, lastWalkAt: ago(1), lastFailedWalkAt: ago(1) }), { kind: "recent", from: "2026-05-13" });
  assert.equal(plan({ force: true, lastFullWalkAt: ago(8 * 24) }).kind, "full");
});

const check = (overrides = {}) => ({
  kind: "full", checkedAt: ago(2), from: "2025-05-15", walkComplete: true, listed: 100, missingCount: 0, missing: [],
  markets: [{ market: "GPW", listed: 80, oldestDate: "2025-05-14", reached: true }, { market: "NEWCONNECT", listed: 20, oldestDate: "2025-05-14", reached: true }],
  ...overrides,
});
const assess = (...checks) => assessEspiCompleteness(checks, now);

test("complete lists need no attention", () => {
  assert.deepEqual(assess(check(), check({ kind: "recent", checkedAt: ago(1) })), { level: "OK", findings: [] });
});

test("missing reports, a walk that stopped early and a silent sync are each named", () => {
  const missing = assess(check({ missingCount: 3, missing: [{ reason: "UNEXPLAINED" }, { reason: "UNREADABLE" }, { reason: "UNAVAILABLE" }] }));
  assert.equal(missing.level, "ATTENTION");
  assert.match(missing.findings.join("\n"), /Brakuje raportów z list: 3 z 100 \(pełne sprawdzenie\), w tym bez znanej przyczyny: 1/);

  // The fault found on 2026-11-28: the NewConnect walk ended after a few days.
  const early = assess(check({ markets: [{ market: "NEWCONNECT", listed: 20, oldestDate: "2026-05-17", reached: false }] }));
  assert.match(early.findings.join("\n"), /NewConnect: przegląd listy skończył się na 2026-05-17, a miał sięgnąć przed 2025-05-15/);

  assert.match(assess(check({ walkComplete: false })).findings.join("\n"), /Błędy listy przerwały przegląd/);
  assert.match(assess(check({ checkedAt: ago(40) })).findings.join("\n"), /Od ponad 36 godzin/);
  assert.match(assess(check({ checkedAt: ago(9 * 24) }), check({ kind: "recent", checkedAt: ago(1) })).findings.join("\n"), /ma ponad 8 dni/);
  assert.match(assess(check({ kind: "recent" })).findings.join("\n"), /Nie wykonano jeszcze pełnego sprawdzenia/);
  assert.equal(assess().level, "ATTENTION");
});

test("the scheduler runs only in a production server with a database and can be turned off", () => {
  const production = { NODE_ENV: "production", DATABASE_URL: "postgres://x" };
  assert.equal(isEspiSchedulerEnabled(production), true);
  assert.equal(isEspiSchedulerEnabled({ ...production, NODE_ENV: "development" }), false);
  assert.equal(isEspiSchedulerEnabled({ ...production, NEXT_PHASE: "phase-production-build" }), false);
  assert.equal(isEspiSchedulerEnabled({ ...production, DATABASE_URL: "" }), false);
  assert.equal(isEspiSchedulerEnabled({ ...production, MEXO_ESPI_SCHEDULER: "off" }), false);
});

test("each run is planned after the previous one ends, also after a failed one, and only once", async () => {
  globalThis.mexoEspiSchedulerStarted = false;
  const planned = [];
  const schedule = (task, delayMs) => planned.push({ task, delayMs });
  let runs = 0;
  let release;
  const synchronize = () => {
    runs += 1;
    return runs === 1 ? new Promise((resolve) => { release = resolve; }) : Promise.reject(new Error("source down"));
  };
  const environment = { NODE_ENV: "production", DATABASE_URL: "postgres://x" };
  assert.equal(startEspiScheduler({ environment, synchronize, schedule }), true);
  assert.equal(startEspiScheduler({ environment, synchronize, schedule }), false, "one timer in a server");
  assert.deepEqual(planned.map((item) => item.delayMs), [60_000]);

  planned.shift().task();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(planned.length, 0, "nothing is planned while a run is working");
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(planned.map((item) => item.delayMs), [600_000]);

  planned.shift().task();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 2);
  assert.deepEqual(planned.map((item) => item.delayMs), [600_000], "a failed run does not stop the timer");
  globalThis.mexoEspiSchedulerStarted = false;
});

test("the server starts the scheduler, the HTTP test turns it off and the admin sees the checks", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  assert.match(await read("src/instrumentation.ts"), /process\.env\.NEXT_RUNTIME === "nodejs"[\s\S]*startEspiScheduler\(\{ synchronize: \(\) => synchronizePapEspi\(\) \}\)/);
  assert.match(await read("scripts/run-gpw-quality-http-e2e.mjs"), /MEXO_ESPI_SCHEDULER: "off"/);
  assert.match(await read("src/app/admin/page.tsx"), /<AdminEspiCompleteness checks=\{espiChecks\} \/>/);
  const sync = await read("src/lib/server/espi.ts");
  // The check compares by the lists' own ids, not through the rules that merge rows.
  const body = sync.slice(sync.indexOf("const recordEspiCompleteness"), sync.indexOf("export const getEspiCompletenessChecks"));
  assert.doesNotMatch(body, /sameFilingSql|getStoredSourceState|hasOwnEspiReportNumber/);
  // Recent reports are re-read for a week, not for three months.
  assert.match(sync, /const detailRefreshBoundary = addDays\(today, -ESPI_REREAD_DAYS\);/);
});

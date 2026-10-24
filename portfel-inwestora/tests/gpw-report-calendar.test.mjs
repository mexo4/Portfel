import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTrackedGpwInstruments } from "../src/lib/server/espi.ts";
import { getAuthorizedPortfolioScopeIds } from "../src/lib/portfolio-selection.ts";
import {
  REPORT_WINDOW_DAYS,
  GENERAL_MEETING_WINDOW_DAYS,
  isCalendarWindowDays,
} from "../src/lib/corporate-events.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("report calendar has an independent 365-day default and only bounded ranges", () => {
  assert.equal(REPORT_WINDOW_DAYS, 365);
  assert.notEqual(REPORT_WINDOW_DAYS, GENERAL_MEETING_WINDOW_DAYS);
  for (const days of [60, 180, 365]) assert.equal(isCalendarWindowDays(days), true);
  for (const days of [0, 30, 366, 9999]) assert.equal(isCalendarWindowDays(days), false);
});

test("report route selects only official GPW report event types at the read layer", () => {
  const route = read("../src/app/api/gpw-reports/route.ts");
  const service = read("../src/lib/server/corporate-events.ts");
  assert.match(route, /getGlobalReportSchedules\(/);
  assert.match(route, /getAuthorizedPortfolioScopeIds\(/);
  assert.match(route, /getUserTrackedGpwInstruments\(/);
  assert.match(route, /buildTrackedGpwInstruments\(/);
  assert.match(route, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.match(service, /WHERE market = 'GPW'/);
  assert.match(service, /\["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT"\]/);
  assert.doesNotMatch(route, /getGlobalGeneralMeetings\(/);
});

test("report schedule pending count uses contiguous PostgreSQL parameter indexes", () => {
  const service = read("../src/lib/server/corporate-events.ts");
  assert.match(service, /REPORT_SCHEDULE_PROJECTION_VERSION = 9/);
  const start = service.indexOf("export const synchronizeGlobalReportSchedules");
  const end = service.indexOf("export const getGlobalReportScheduleSourceState", start);
  const sync = service.slice(start, end);
  assert.match(sync, /const pendingCountWhere = `\([\s\S]*?report_schedule_projection_version IS DISTINCT FROM \$2[\s\S]*?report_schedule_projected_at < \$4[\s\S]*?\)`;/);
  assert.match(sync, /WHERE \$\{candidateWhere\} AND \$\{pendingCountWhere\}`,[\s\S]*?\[publishedAfter, REPORT_SCHEDULE_PROJECTION_VERSION, unmatchedRetryBefore, parseRetryBefore\]/);
});

test("portfolio report scope excludes closed holdings and refuses foreign portfolio ids", () => {
  const now = "2026-10-21T10:00:00.000Z";
  const asset = (symbol, quantity) => ({ id: symbol, symbol, name: symbol, quantity,
    marketCurrency: "PLN", kind: "stock", provider: "stooq",
    purchaseDate: "2026-01-02", purchasePrice: 10, purchaseCurrency: "PLN",
    feePln: 0, createdAt: now });
  const portfolio = (id, assets) => ({ id, name: id, assets, sales: [],
    realizedAdjustments: [], createdAt: now, updatedAt: now });
  const owned = [portfolio("held", [asset("DNP.PL", 2)]),
    portfolio("closed", [asset("CDR.PL", 0)]),
    portfolio("other", [asset("PKN.PL", 1)])];
  assert.deepEqual(getAuthorizedPortfolioScopeIds(["held", "closed"], owned.map(({ id }) => id)),
    ["held", "closed"]);
  assert.equal(getAuthorizedPortfolioScopeIds(["someone-else"], owned.map(({ id }) => id)), null);
  const keys = buildTrackedGpwInstruments(owned.slice(0, 2), [])
    .filter((instrument) => instrument.held).map((instrument) => instrument.ticker);
  assert.deepEqual(keys, ["DNP"]);
});

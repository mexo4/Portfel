import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessGpwCalendarHealth,
  describeGpwReviewCode,
  normalizeGpwReviewEntries,
} from "../src/lib/gpw-calendar-health.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const lane = (overrides = {}) => ({
  lane: "reports", version: 11, projected: 600, success: 500, noEvent: 90, unmatched: 0, parseError: 0,
  reviewRequired: 0, staleVersion: 0, oldestStalePublishedAt: null, lastProjectedAt: "2026-11-18T10:00:00.000Z",
  ...overrides,
});
const health = (overrides = {}) => ({
  generatedAt: "2026-11-18T12:00:00.000Z",
  lanes: [lane()],
  rows: { activeReportRows: 1500, incompleteIdentity: 0, incompleteIdentityMarkedUnverified: 0,
    sameTypeAndDateWithDifferentIdentities: 0, oneIdentityOnSeveralDates: 0 },
  retirements: { since: "2026-11-04T00:00:00.000Z", total: 0, byReason: [] },
  reviewQueue: { documents: 0, items: [] },
  source: { status: "SUCCESS", isStale: false, backfillComplete: true, nextBackfillPage: 1 },
  ...overrides,
});

test("review entries accept the legacy string format and structured objects, and drop anything else", () => {
  assert.deepEqual(normalizeGpwReviewEntries(["AMBIGUOUS_REPROJECTION", "", 7, null, { nope: true }]),
    [{ code: "AMBIGUOUS_REPROJECTION" }]);
  assert.deepEqual(normalizeGpwReviewEntries([{
    code: "REPORT_PERIOD_MAY_BE_OVERDUE", published: true, eventType: "QUARTERLY_REPORT", eventDate: "2026-11-26",
    fiscalPeriod: "Q3", fiscalYearLabel: null, rowIds: ["a", 3, "b"], injected: "<script>",
  }]), [{
    code: "REPORT_PERIOD_MAY_BE_OVERDUE", published: true, eventType: "QUARTERLY_REPORT", eventDate: "2026-11-26",
    fiscalPeriod: "Q3", fiscalYearLabel: null, rowIds: ["a", "b"],
  }]);
  assert.deepEqual(normalizeGpwReviewEntries("not an array"), []);
  assert.deepEqual(normalizeGpwReviewEntries(undefined), []);
});

test("review codes have a Polish description and unknown codes are shown as they are", () => {
  assert.match(describeGpwReviewCode("PUBLICATION_YEAR_CONFLICTS_WITH_PERIOD"), /sprzeczny/);
  assert.equal(describeGpwReviewCode("SOMETHING_NEW"), "SOMETHING_NEW");
});

test("a calendar with nothing to report is OK, but the verdict never claims completeness", () => {
  const verdict = assessGpwCalendarHealth(health());
  assert.deepEqual(verdict, { level: "OK", findings: [] });
});

test("the reprojection backlog and the review queue ask for attention", () => {
  const verdict = assessGpwCalendarHealth(health({ lanes: [lane({ staleVersion: 400, reviewRequired: 12 })] }));
  assert.equal(verdict.level, "ATTENTION");
  assert.equal(verdict.findings.length, 2);
});

test("read errors and contradictory active rows degrade the verdict", () => {
  assert.equal(assessGpwCalendarHealth(health({ lanes: [lane({ parseError: 3 })] })).level, "DEGRADED");
  const rows = { activeReportRows: 10, incompleteIdentity: 0, incompleteIdentityMarkedUnverified: 0,
    sameTypeAndDateWithDifferentIdentities: 2, oneIdentityOnSeveralDates: 0 };
  assert.equal(assessGpwCalendarHealth(health({ rows })).level, "DEGRADED");
});

test("rows without period or year are tolerated only when they are marked as unverified", () => {
  const marked = { activeReportRows: 10, incompleteIdentity: 4, incompleteIdentityMarkedUnverified: 4,
    sameTypeAndDateWithDifferentIdentities: 0, oneIdentityOnSeveralDates: 0 };
  assert.equal(assessGpwCalendarHealth(health({ rows: marked })).level, "OK");
  assert.equal(assessGpwCalendarHealth(health({ rows: { ...marked, incompleteIdentityMarkedUnverified: 1 } })).level, "ATTENTION");
});

test("an incomplete archive or a stale source is reported", () => {
  const verdict = assessGpwCalendarHealth(health({ source: { status: "SUCCESS", isStale: true, backfillComplete: false, nextBackfillPage: 9 } }));
  assert.equal(verdict.level, "ATTENTION");
  assert.equal(verdict.findings.length, 2);
});

test("the health endpoint is admin-only, uncached and the data module only reads", () => {
  const route = read("../src/app/api/admin/gpw-calendar-health/route.ts");
  assert.match(route, /accountData\.user\.role !== "admin"/);
  assert.match(route, /status: 403/);
  assert.match(route, /private, no-store, max-age=0/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  const server = read("../src/lib/server/gpw-calendar-health.ts");
  assert.doesNotMatch(server, /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE)\b/i);
  assert.doesNotMatch(server, /\b(execute|withTransaction)\b/);
});

test("the admin page renders the panel only inside the admin gate and tolerates a failed read", () => {
  const page = read("../src/app/admin/page.tsx");
  assert.match(page, /notFound\(\)/);
  assert.match(page, /getGpwCalendarHealth\(\)\.catch\(\(\) => null\)/);
  assert.match(page, /calendarHealth \? <AdminGpwCalendarHealth/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGpwCalendarGrid,
  expandGpwStoredCalendarEvent,
  getCalendarMonth,
  getGpwCalendarHref,
  getGpwEventCategory,
  getGpwEventLabel,
  getGpwEventStatusLabel,
  getSafeGpwSourceUrl,
  groupGpwEventsByDate,
  normalizeCompanySearch,
  parseCalendarCategory,
} from "../src/lib/public-gpw-calendar.ts";

const dividend = {
  id: "div-1", ticker: "PKN", company_name: "Orlen", event_type: "UPCOMING_DIVIDEND",
  event_date: "2026-10-15", event_time: null, fiscal_period: null, fiscal_year: 2025,
  general_meeting_type: null, registration_date: null,
  dividend_per_share: "6.00", dividend_currency: "PLN",
  record_date: "2026-10-15", payment_date: "2026-10-29",
  status: "CONFIRMED", updated_at: "2026-10-10T00:00:00Z",
  source_url: "https://www.gpw.pl/przyklad", source_published_at: "2026-10-10T00:00:00Z",
};

test("October 2026 boundaries, Polish label and month navigation", () => {
  assert.deepEqual(
    (({key,start,end,prevKey,nextKey}) => ({key,start,end,prevKey,nextKey}))(getCalendarMonth("2026-10", "2026-10")),
    { key: "2026-10", start: "2026-10-01", end: "2026-10-31", prevKey: "2026-09", nextKey: "2026-11" }
  );
});

test("leap years and year rollover have correct date boundaries", () => {
  assert.equal(getCalendarMonth("2028-02", "2028-02").end, "2028-02-29");
  assert.equal(getCalendarMonth("2026-12", "2026-10").nextKey, "2027-01");
  assert.equal(getCalendarMonth("2026-01", "2026-10").prevKey, "2025-12");
});

test("reject invalid, massive or distant date windows", () => {
  for (const param of ["2026-00", "2026-13", "2026-10-01", "2038-05", "0000-01", "zzzz-12"]) {
    assert.equal(getCalendarMonth(param, "2026-10").key, "2026-10");
  }
});

test("category and search normalization are bounded", () => {
  assert.equal(parseCalendarCategory("dividends"), "dividends");
  assert.equal(parseCalendarCategory("__proto__"), "all");
  assert.equal(normalizeCompanySearch("    Dino      Polska   "), "Dino Polska");
  assert.equal(normalizeCompanySearch("X".repeat(500)).length, 64);
});

test("month grid begins on Monday and only marks dates in month", () => {
  const month = getCalendarMonth("2026-10", "2026-10");
  const grid = buildGpwCalendarGrid(month, []);
  assert.equal(grid[0].date, "2026-09-28");
  assert.equal(grid[3].date, "2026-10-01");
  assert.equal(grid.at(-1).date, "2026-11-01");
  assert.equal(grid.length % 7, 0);
  assert.equal(grid.filter((entry) => entry.inMonth).length, 31);
});

test("payment day and record day create separate calendar milestones, not a duplicate payout", () => {
  const events = expandGpwStoredCalendarEvent(dividend, "2026-10-01", "2026-10-31");
  assert.deepEqual(events.map(({id,date,kind}) => ({id,date,kind})), [
    { id: "div-1", date: "2026-10-15", kind: "UPCOMING_DIVIDEND" },
    { id: "div-1:payment", date: "2026-10-29", kind: "DIVIDEND_PAYMENT" },
  ]);
  assert.equal(getGpwEventLabel(events[0]), "Dzień dywidendy");
  assert.equal(getGpwEventLabel(events[1]), "Wypłata dywidendy");
  assert.equal(events[0].dividendPerShare, 6);
});

test("payment date is not lost when original dividend record date is in a previous month", () => {
  const events = expandGpwStoredCalendarEvent(dividend, "2026-10-25", "2026-10-31");
  assert.equal(events.length, 1);
  assert.equal(events[0].date, "2026-10-29");
  assert.equal(events[0].kind, "DIVIDEND_PAYMENT");
});

test("meeting subtype labels, categories and proposed status are accurate", () => {
  const meeting = expandGpwStoredCalendarEvent({
    ...dividend, id: "meet-1", event_type: "GENERAL_MEETING", general_meeting_type: "NWZ",
    payment_date: null, record_date: null, status: "CHANGED",
  }, "2026-10-01", "2026-10-31")[0];
  assert.equal(getGpwEventLabel(meeting), "Nadzwyczajne walne zgromadzenie");
  assert.equal(getGpwEventCategory(meeting.kind), "meetings");
  assert.equal(getGpwEventStatusLabel(meeting.status), "Termin zmieniony");
  assert.equal(getGpwEventStatusLabel("PROPOSED"), "Propozycja");
});

test("unverified or cancelled sources cannot create public calendar entries", () => {
  for (const source_url of ["javascript:alert(1)", "http://example.org", "https://localhost/test", "https://127.0.0.1/x", "https://10.0.0.2/path", "https://u:p@example.com/path", "garbage"]) {
    assert.equal(expandGpwStoredCalendarEvent({ ...dividend, source_url }, "2026-10-01", "2026-10-31").length, 0);
  }
  assert.equal(expandGpwStoredCalendarEvent({ ...dividend, status: "CANCELLED" }, "2026-10-01", "2026-10-31").length, 0);
  assert.equal(getSafeGpwSourceUrl("https://www.gpw.pl/komunikat"), "https://www.gpw.pl/komunikat");
});

test("grouping is chronological, calendar dots link to real dates", () => {
  const events = expandGpwStoredCalendarEvent(dividend, "2026-10-01", "2026-10-31");
  assert.deepEqual(groupGpwEventsByDate(events).map(item=>item.date), ["2026-10-15", "2026-10-29"]);
  const grid = buildGpwCalendarGrid(getCalendarMonth("2026-10", "2026-10"), events);
  assert.equal(grid.find(day=>day.date==="2026-10-29").events.length, 1);
});

test("month navigation retains category and search safely", () => {
  assert.equal(getGpwCalendarHref("2026-11","dividends","Dino Polska"), "/kalendarz-gpw?miesiac=2026-11&typ=dividends&spolka=Dino+Polska");
});

test("public reader selects only GPW issuer events and never queries private holdings", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/lib/server/public-gpw-calendar.ts", import.meta.url), "utf8");
  assert.match(source, /issuer\.market = 'GPW'/);
  assert.match(source, /event\.active = TRUE/);
  assert.match(source, /event\.status <> 'CANCELLED'/);
  assert.match(source, /event\.event_type = ANY\(\$3::text\[\]\)/);
  assert.match(source, /INNER JOIN LATERAL/);
  assert.match(source, /unstable_cache/);
  assert.doesNotMatch(source, /getCurrentAccountData|getUserWatchlist|user_id|JOIN\s+users\b/i);
});

test("public page is not indexed by default without explicit approved rights setting", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../src/app/kalendarz-gpw/page.tsx", import.meta.url), "utf8");
  const sitemap = await readFile(new URL("../src/app/sitemap.ts", import.meta.url), "utf8");
  assert.match(page, /MEXO_PUBLIC_GPW_CALENDAR_INDEXABLE === "true"/);
  assert.match(sitemap, /MEXO_PUBLIC_GPW_CALENDAR_INDEXABLE === "true"/);
  assert.doesNotMatch(page, /getCurrentAuthenticatedUser|getCurrentAccountData/);
});

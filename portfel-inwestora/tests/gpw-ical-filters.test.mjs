import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ICAL_CATEGORIES, parseIcalTickers, getIcalSubscriptionUrl,
  toIcalMilestones, serializeIcal,
} from "../src/lib/gpw-ical.ts";

const baseline = {
  id: "market-event-1", ticker: "DNP", company_name: "Dino Polska",
  event_type: "QUARTERLY_REPORT", event_date: "2026-11-05", event_time: null,
  fiscal_period: "Q3", fiscal_year: 2026, general_meeting_type: null,
  dividend_per_share: null, dividend_currency: null, record_date: null,
  payment_date: null, status: "CONFIRMED", active: true,
  updated_at: "2026-10-19T09:00:00Z", source_url: "https://example.com/dnp",
  source_published_at: null,
};
const unfold = (value) => value.replace(/\r\n /g, "");

test("missing ticker param means all issuers; explicit invalid ticker never broadens to all", () => {
  assert.deepEqual(parseIcalTickers(null), []);
  for (const invalid of ["", "DNP,", ",DNP", "DNP;DROP", "DNP%2CPKN", "POL.PL", "DNP 1", "a".repeat(400), Array.from({length:31},(_,i)=>`A${i}`).join(",")]) {
    assert.equal(parseIcalTickers(invalid), null, invalid);
  }
  assert.deepEqual(parseIcalTickers(" pkn , dnp ,DNP "), ["DNP", "PKN"]);
  assert.deepEqual(parseIcalTickers("11B,CDR"), ["11B", "CDR"]);
});

test("existing category-only subscription URLs remain stable", () => {
  assert.equal(getIcalSubscriptionUrl(["reports", "dividends", "meetings"]),
    "https://mexo.com.pl/api/calendar/gpw.ics?categories=reports,dividends,meetings");
});

test("issuer-limited subscription is deterministic and preserves category selection", () => {
  assert.equal(getIcalSubscriptionUrl(["meetings", "reports"], ["PKN", "DNP", "PKN"]),
    "https://mexo.com.pl/api/calendar/gpw.ics?categories=reports,meetings&tickers=DNP,PKN");
  assert.throws(() => getIcalSubscriptionUrl(["reports"], ["DNP;DROP"]));
  assert.throws(() => getIcalSubscriptionUrl([], ["DNP"]));
});

test("each event uses RFC 7986 COLOR and distinct category mapping", () => {
  const report = toIcalMilestones(baseline, "2026-10-01", "2026-12-31");
  const dividend = toIcalMilestones({ ...baseline, id:"2", event_type:"UPCOMING_DIVIDEND", record_date:"2026-11-05", payment_date:"2026-11-20" }, "2026-10-01", "2026-12-31");
  const meeting = toIcalMilestones({ ...baseline, id:"3", event_type:"GENERAL_MEETING" }, "2026-10-01", "2026-12-31");
  const output = unfold(serializeIcal([...report, ...dividend, ...meeting], ICAL_CATEGORIES));
  assert.match(output, /COLOR:royalblue/);
  assert.match(output, /COLOR:mediumseagreen/);
  assert.match(output, /COLOR:darkorange/);
  assert.equal((output.match(/BEGIN:VEVENT/g)||[]).length, 4);
});

test("single category gets calendar color and Apple hint; mixed calendars use neutral base", () => {
  const event = toIcalMilestones(baseline, "2026-10-01", "2026-12-31");
  const single = unfold(serializeIcal(event, ["reports"], ["DNP"]));
  assert.match(single, /\r\nCOLOR:royalblue\r\n/);
  assert.match(single, /X-APPLE-CALENDAR-COLOR:#4169e1/);
  assert.match(single, /SOURCE;VALUE=URI:https:\/\/mexo.com.pl\/api\/calendar\/gpw.ics\?categories=reports&tickers=DNP/);
  const mixed = unfold(serializeIcal(event, ["reports", "meetings"]));
  assert.match(mixed, /\r\nCOLOR:slategray\r\n/);
  assert.doesNotMatch(mixed, /X-APPLE-CALENDAR-COLOR/);
});

test("new route validates ticker input and filters before database LIMIT", async () => {
  const route = await readFile(new URL("../src/app/api/calendar/gpw.ics/route.ts", import.meta.url), "utf8");
  const reader = await readFile(new URL("../src/lib/server/public-gpw-ical.ts", import.meta.url), "utf8");
  assert.match(route, /parseIcalTickers/);
  assert.match(route, /!categories \|\| tickers === null/);
  assert.match(reader, /UPPER\(issuer.ticker\) = ANY\(\$5::text\[\]\)/);
  assert.match(reader, /tickerKey/);
  assert.match(reader, /mexo-public-gpw-ical-v3/);
  assert.doesNotMatch(reader, /\bJOIN\s+(?:users|portfolio_assets|watchlist)\b/i);
});

test("public issuer search is bounded to GPW market and contains no user data", async () => {
  const source = await readFile(new URL("../src/app/api/calendar/issuers/route.ts", import.meta.url), "utf8");
  assert.match(source, /issuer.market = 'GPW'/);
  assert.match(source, /LIMIT 12/);
  assert.match(source, /POSITION\(LOWER\(\$1\)/);
  assert.doesNotMatch(source, /\bJOIN\s+(?:users|portfolio_assets|watchlist)\b/i);
});

test("selected issuers, color legend and workspace tab are exposed in UI", async () => {
  const component = await readFile(new URL("../src/components/PublicCalendarSubscription.tsx", import.meta.url), "utf8");
  const workspace = await readFile(new URL("../src/components/GpwEventsWorkspace.tsx", import.meta.url), "utf8");
  assert.match(component, /\/api\/calendar\/issuers\?search=/);
  assert.match(component, /getIcalSubscriptionUrl\(selected, tickers\)/);
  assert.match(component, /Oddzielne kalendarze/);
  assert.match(component, /Apple Calendar/);
  assert.match(component, /Google Calendar/);
  assert.match(component, /Outlook/);
  assert.match(workspace, /Subskrypcje kalendarza/);
  assert.match(workspace, /PublicCalendarSubscription embedded/);
});

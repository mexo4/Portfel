import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ICAL_CATEGORIES, parseIcalCategories, getIcalSubscriptionUrl,
  isValidIcalDate, escapeIcalText, foldIcalLine, toIcalMilestones,
  serializeIcal,
} from "../src/lib/gpw-ical.ts";

const row = (overrides = {}) => ({
  id: "issuer-event-42", ticker: "DNP", company_name: "Dino Polska",
  event_type: "QUARTERLY_REPORT", event_date: "2026-11-05", event_time: null,
  fiscal_period: "Q3", fiscal_year: 2026, general_meeting_type: null,
  dividend_per_share: null, dividend_currency: null, record_date: null, payment_date: null,
  status: "CONFIRMED", active: true, updated_at: "2026-09-30T09:11:12.000Z",
  source_url: "https://grupadino.pl/inwestorzy/raporty", source_published_at: null,
  ...overrides,
});
const getItems = (overrides = {}) => toIcalMilestones(row(overrides), "2026-10-01", "2027-12-31");
const makeIcal = (overrides = {}) => serializeIcal(getItems(overrides), ICAL_CATEGORIES);

const unfolded = (ics) => ics.replace(/\r\n /g, "");
const values = (ics, prop) => unfolded(ics).split("\r\n").filter((line) => line.startsWith(`${prop}:`));

test("defaults to all categories and rejects invalid parameter without accidentally broadening scope", () => {
  assert.deepEqual(parseIcalCategories(null), ["reports", "dividends", "meetings"]);
  assert.deepEqual(parseIcalCategories("meetings,reports,meetings"), ["reports", "meetings"]);
  for (const value of ["", "all", "reports,admin", "dividends;drop", "x".repeat(200)])
    assert.equal(parseIcalCategories(value), null);
});
test("canonical URL encodes chosen categories deterministically", () => {
  assert.equal(getIcalSubscriptionUrl(["meetings", "reports"]),
    "https://mexo.com.pl/api/calendar/gpw.ics?categories=reports,meetings");
  assert.throws(() => getIcalSubscriptionUrl([]));
});
test("validates real ISO calendar dates", () => {
  assert.equal(isValidIcalDate("2028-02-29"), true);
  assert.equal(isValidIcalDate("2026-02-29"), false);
  assert.equal(isValidIcalDate("2026-11-31"), false);
  assert.equal(isValidIcalDate("2026-11-05"), true);
});
test("quarterly report produces a correct all-day event and exclusive DTEND", () => {
  const ics = makeIcal();
  assert.match(ics, /SUMMARY:Dino Polska \(DNP\) — Raport kwartalny Q3 2026/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261105\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261106\r\n/);
  assert.match(ics, /TRANSP:TRANSPARENT\r\n/);
});
test("year rollover and leap date produce valid next-day ranges", () => {
  assert.match(makeIcal({ event_date: "2026-12-31" }), /DTEND;VALUE=DATE:20270101/);
  const ics = serializeIcal(toIcalMilestones(row({event_date:"2028-02-29"}), "2028-01-01", "2028-12-31"), ["reports"]);
  assert.match(ics, /DTEND;VALUE=DATE:20280301/);
});
test("two separate dividend milestones, with individual UIDs and dates", () => {
  const items = getItems({event_type:"UPCOMING_DIVIDEND", event_date:"2026-10-22",record_date:"2026-10-22",payment_date:"2026-11-20", dividend_per_share:"6.50",dividend_currency:"PLN"});
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(e=>e.uid), ["issuer-event-42:record@mexo.com.pl", "issuer-event-42:payment@mexo.com.pl"]);
  assert.deepEqual(items.map(e=>e.date), ["2026-10-22", "2026-11-20"]);
  assert.match(items[0].description,/Kwota: 6,5 PLN\/akcję/);
});
test("date change updates same UID and increases SEQUENCE based on updatedAt", () => {
  const first = makeIcal({event_date:"2026-11-05",updated_at:"2026-09-30T00:00:00Z"});
  const changed = makeIcal({event_date:"2026-11-08",updated_at:"2026-10-10T00:00:00Z"});
  assert.deepEqual(values(first, "UID"), values(changed,"UID"));
  assert.notDeepEqual(values(first,"SEQUENCE"),values(changed,"SEQUENCE"));
  assert.match(changed,/DTSTART;VALUE=DATE:20261108/);
});
test("proposal is tentative, cancelled event retains its UID and signals cancellation", () => {
  assert.match(makeIcal({status:"PROPOSED"}),/STATUS:TENTATIVE/);
  assert.match(makeIcal({status:"CANCELLED",active:false}),/STATUS:CANCELLED/);
  assert.match(makeIcal({status:"CANCELLED"}),/UID:issuer-event-42:report@mexo.com.pl/);
});
test("no invented record date: unknown dividend date is clearly unclassified", () => {
  const items=getItems({event_type:"UPCOMING_DIVIDEND",event_date:"2026-11-10",record_date:null,payment_date:null});
  assert.equal(items.length,1);
  assert.match(items[0].summary,/nieustalony rodzaj/);
});
test("when payment is next month, listing one-month range emits only that milestone", () => {
  const items=toIcalMilestones(row({event_type:"UPCOMING_DIVIDEND",record_date:"2026-10-22",payment_date:"2026-11-20"}),"2026-11-01","2026-11-30");
  assert.equal(items.length,1);
  assert.match(items[0].uid,/:payment@/);
});
test("report time remains descriptive rather than fabricating clock timezone", () => {
  const ics=makeIcal({event_time:"08:30"});
  assert.match(unfolded(ics),/Godzina podana przez emitenta: 08:30/);
  assert.doesNotMatch(ics,/DTSTART;TZID=/);
});
test("safe URLs omit malicious schemes and local network addresses", () => {
  for(const source_url of ["http://example.com", "javascript:alert(1)", "https://localhost/x", "https://127.0.0.1/report", "https://192.168.1.1/report", "https://user:pass@example.com/a"])
    assert.equal(getItems({source_url}).length,0);
});
test("invalid dates and missing issuer identity never leak to subscriptions", () => {
  assert.equal(getItems({event_date:"2026-02-30"}).length,0);
  assert.equal(getItems({ticker:""}).length,0);
  assert.equal(getItems({company_name:" "}).length,0);
});
test("special ICS characters are properly escaped", () => {
  assert.equal(escapeIcalText("X, Y; Z\\R\nK"), "X\\, Y\\; Z\\\\R\\nK");
  const ics = makeIcal({company_name:"Spółka, A;B\\C"});
  assert.match(unfolded(ics),/Spółka\\, A\\;B\\\\C/);
});
test("folds at 75 UTF-8 octets; all lines CRLF, multibyte codepoints intact", () => {
  const line="DESCRIPTION:"+"Łódź 😀".repeat(30);
  const folded=foldIcalLine(line);
  assert.equal(folded.replace(/\r\n /g,""),line);
  for(const segment of folded.split("\r\n"))assert.ok(Buffer.byteLength(segment,"utf8")<=75);
  assert.equal(folded.includes("\n "),true);
});
test("outputs RFC 5545 envelope and RFC 7986 refresh interval", () => {
  const ics=makeIcal();
  assert.match(ics,/^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/);
  assert.match(ics,/REFRESH-INTERVAL;VALUE=DURATION:PT6H\r\n/);
  assert.match(ics,/SOURCE;VALUE=URI:https:\/\/mexo.com.pl/);
  assert.match(ics,/\r\nEND:VCALENDAR\r\n$/);
  assert.doesNotMatch(ics,/(?<!\r)\n/);
});
test("one UID is emitted only once when source records duplicate", () => {
  const item=getItems()[0];
  assert.equal(values(serializeIcal([item,item],ICAL_CATEGORIES),"UID").length,1);
});
test("unknown status and missing updated_at use deterministic fallbacks", () => {
  const ics=makeIcal({status:"UNKNOWN", updated_at:"invalid",source_published_at:null});
  assert.match(ics,/DTSTAMP:20000101T000000Z/);
  assert.match(ics,/STATUS:TENTATIVE/);
});
test("public endpoint is bounded, cacheable, and avoids user/portfolio data", async () => {
  const source=await readFile(new URL("../src/lib/server/public-gpw-ical.ts",import.meta.url),"utf8");
  const route=await readFile(new URL("../src/app/api/calendar/gpw.ics/route.ts",import.meta.url),"utf8");
  assert.match(source,/FROM corporate_events AS event/);
  assert.match(source,/issuer.market = 'GPW'/);
  assert.match(source,/LIMIT \$4/);
  assert.match(source,/ROW_LIMIT/);
  assert.match(source,/unstable_cache/);
  assert.doesNotMatch(source,/\bJOIN\s+(?:users|watchlist|portfolio_assets)\b/i);
  assert.match(route,/text\/calendar/);
  assert.match(route,/503/);
  assert.match(route,/s-maxage=300/);
});
test("subscriber UI includes all categories and supports Apple, Google and Outlook", async () => {
  const source=await readFile(new URL("../src/components/PublicCalendarSubscription.tsx",import.meta.url),"utf8");
  assert.match(source,/getIcalSubscriptionUrl/);
  assert.match(source,/webcal:/);
  assert.match(source,/calendar.google.com/);
  assert.match(source,/Outlook/);
  assert.match(source,/navigator.clipboard.writeText/);
});

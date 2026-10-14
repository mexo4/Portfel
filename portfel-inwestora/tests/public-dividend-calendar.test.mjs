import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getDividendDateKindLabel,
  getDividendDisplayDate,
  getDividendHref,
  getDividendStatusLabel,
  getDividendWindow,
  getDividendYear,
  getWarsawDividendToday,
  isIsoCalendarDate,
  matchesDividendStatus,
  normalizeDividendCompanySearch,
  parseDividendSort,
  parseDividendStatus,
  parseDividendView,
  safeDividendSourceUrl,
  sortPublicDividends,
  toPublicDividend,
} from "../src/lib/public-dividend-calendar.ts";

const row = (overrides = {}) => ({
  id: "payment-1",
  ticker: "ABC",
  company_name: "Przykładowa Spółka SA",
  event_date: "2026-09-16",
  ex_dividend_date: "2026-09-15",
  record_date: "2026-09-16",
  payment_date: "2026-10-20",
  dividend_per_share: "1.2550",
  dividend_currency: "PLN",
  dividend_total_per_share: null,
  dividend_advance_per_share: null,
  dividend_installment: null,
  fiscal_year: 2025,
  status: "CONFIRMED",
  updated_at: "2026-10-03T09:00:00.000Z",
  source_url: "https://example.org/raport/123",
  source_published_at: "2026-09-09T10:00:00.000Z",
  ...overrides,
});

test("accepts only valid calendar dates including leap years", () => {
  assert.equal(isIsoCalendarDate("2024-02-29"), true);
  assert.equal(isIsoCalendarDate("2026-02-29"), false);
  assert.equal(isIsoCalendarDate("2026-04-31"), false);
  assert.equal(isIsoCalendarDate("2026-12-04"), true);
  assert.equal(isIsoCalendarDate("2026-13-01"), false);
  assert.equal(isIsoCalendarDate("2026-10-14T12:00:00Z"), false);
});

test("Warsaw-local day is unaffected by server timezone and crosses midnight in summer/winter", () => {
  assert.equal(getWarsawDividendToday(new Date("2026-07-04T22:30:00.000Z")), "2026-07-05");
  assert.equal(getWarsawDividendToday(new Date("2026-12-04T23:30:00.000Z")), "2026-12-05");
});

test("validates public view, status, sort and year query parameters", () => {
  assert.equal(parseDividendView("history"), "history");
  assert.equal(parseDividendView("/admin"), "upcoming");
  assert.equal(parseDividendStatus("proposed"), "proposed");
  assert.equal(parseDividendStatus("cancelled"), "all");
  assert.equal(parseDividendSort("amount"), "amount");
  assert.equal(parseDividendSort("sqlite"), "date");
  assert.equal(getDividendYear("2021", "2026-10-14"), 2021);
  assert.equal(getDividendYear("2001", "2026-10-14"), 2016);
  assert.equal(getDividendYear("9999", "2026-10-14"), 2026);
  assert.equal(getDividendYear("2032", "2026-10-14"), 2028);
  assert.equal(normalizeDividendCompanySearch("   Dino    Polska "), "Dino Polska");
});

test("ranges cover 12 future months, past year and a selected full calendar year", () => {
  assert.deepEqual(getDividendWindow("upcoming", 2026, "2026-10-14"), {
    from: "2026-10-14", to: "2027-10-14", title: "Nadchodzące 12 miesięcy",
  });
  assert.deepEqual(getDividendWindow("history", 2026, "2026-10-14"), {
    from: "2025-10-14", to: "2026-10-13", title: "Poprzednie 12 miesięcy",
  });
  assert.deepEqual(getDividendWindow("year", 2024, "2026-10-14"), {
    from: "2024-01-01", to: "2024-12-31", title: "Dywidendy w 2024 roku",
  });
});

test("a dividend whose record date passed remains upcoming if payment is in the future", () => {
  const item = toPublicDividend(row(), "2026-10-14", "2027-10-14", "upcoming");
  assert.equal(item?.displayDate, "2026-10-20");
  assert.equal(item?.displayDateKind, "payment");
  assert.equal(item?.recordDate, "2026-09-16");
  assert.equal(item?.paymentDate, "2026-10-20");
  assert.equal(getDividendDateKindLabel(item.displayDateKind), "Termin wypłaty");
});

test("record date is preferred over later payment within the upcoming window", () => {
  const item = toPublicDividend(row({ record_date: "2026-10-22", event_date: "2026-10-22", payment_date: "2026-11-20" }),
    "2026-10-14", "2027-10-14", "upcoming");
  assert.equal(item?.displayDate, "2026-10-22");
  assert.equal(item?.displayDateKind, "record");
});

test("history date selection does not hide an already completed payment", () => {
  const item = toPublicDividend(row(), "2026-01-01", "2026-10-13", "history");
  assert.equal(item?.displayDate, "2026-09-16");
  assert.equal(item?.displayDateKind, "record");
});

test("an event without declared record/payment date remains explicitly unclassified", () => {
  const item = toPublicDividend(row({ record_date: null, payment_date: null, ex_dividend_date: null }),
    "2026-01-01", "2026-12-31", "year");
  assert.equal(item?.displayDateKind, "event");
  assert.equal(getDividendDateKindLabel(item.displayDateKind), "Termin zdarzenia");
  assert.equal(item?.recordDate, undefined);
});

test("an event with neither valid event nor explicit dates is omitted", () => {
  assert.equal(toPublicDividend(row({ event_date: "2026-02-30", record_date: null, payment_date: null, ex_dividend_date: null }),
    "2026-01-01", "2026-12-31", "year"), null);
});

test("a future payment is not mistaken for a historical event when no matching historical date exists", () => {
  const result = getDividendDisplayDate(row({ record_date: "2024-03-12", event_date: "2024-03-12", payment_date: "2027-01-15" }),
    "2026-01-01", "2026-12-31", "year");
  assert.equal(result, null);
});

test("parses numeric amounts safely; never estimates missing payments", () => {
  const dividend = toPublicDividend(row({ dividend_per_share: "1.2550", dividend_advance_per_share: "0.50" }),
    "2026-01-01", "2026-12-31", "year");
  assert.equal(dividend?.amount, 1.255);
  assert.equal(dividend?.advancePerShare, 0.5);
  assert.equal(toPublicDividend(row({ dividend_per_share: null }), "2026-01-01", "2026-12-31", "year")?.amount, undefined);
  assert.equal(toPublicDividend(row({ dividend_per_share: -7 }), "2026-01-01", "2026-12-31", "year")?.amount, undefined);
});

test("tranches remain distinct records and never get incorrectly summed", () => {
  const a = toPublicDividend(row({ id: "r1", dividend_installment: 1, dividend_per_share: "1.0" }),
    "2026-01-01", "2026-12-31", "year");
  const b = toPublicDividend(row({ id: "r2", dividend_installment: 2, dividend_per_share: "1.2", payment_date: "2026-12-15" }),
    "2026-01-01", "2026-12-31", "year");
  assert.equal(a?.installment, 1);
  assert.equal(b?.installment, 2);
  assert.notEqual(a?.id, b?.id);
  assert.equal(a.amount, 1);
  assert.equal(b.amount, 1.2);
});

test("proposals and unknown status are never silently marked confirmed", () => {
  const proposed = toPublicDividend(row({ status: "PROPOSED" }), "2026-01-01", "2026-12-31", "year");
  const unknown = toPublicDividend(row({ status: "UNDETERMINED" }), "2026-01-01", "2026-12-31", "year");
  assert.equal(proposed?.status, "PROPOSED");
  assert.equal(unknown?.status, "UNKNOWN");
  assert.equal(getDividendStatusLabel(proposed.status), "Propozycja");
  assert.equal(matchesDividendStatus(proposed, "confirmed"), false);
  assert.equal(matchesDividendStatus(proposed, "proposed"), true);
  assert.equal(matchesDividendStatus(unknown, "other"), true);
});

test("invalid and cancelled events are never shown publicly", () => {
  assert.equal(toPublicDividend(row({ status: "CANCELLED" }), "2026-01-01", "2026-12-31", "year"), null);
  assert.equal(toPublicDividend(row({ ticker: " " }), "2026-01-01", "2026-12-31", "year"), null);
  assert.equal(toPublicDividend(row({ source_url: "javascript:alert(1)" }), "2026-01-01", "2026-12-31", "year"), null);
});

test("unsafe protocol, local network, credentials and malformed source URLs are rejected", () => {
  assert.equal(safeDividendSourceUrl("http://example.org/report"), null);
  assert.equal(safeDividendSourceUrl("https://127.0.0.1/secret"), null);
  assert.equal(safeDividendSourceUrl("https://192.168.0.20/report"), null);
  assert.equal(safeDividendSourceUrl("https://user:pass@example.org/"), null);
  assert.equal(safeDividendSourceUrl("not-a-url"), null);
  assert.equal(safeDividendSourceUrl("https://example.org/report"), "https://example.org/report");
});

test("sorts with stable date fallback, and puts missing amounts last", () => {
  const base = [
    toPublicDividend(row({ id: "A", ticker: "A", company_name: "Alfa", dividend_per_share: "1.3", payment_date: "2026-11-15", record_date: null, event_date: "2026-11-15" }), "2026-10-14", "2027-10-14", "upcoming"),
    toPublicDividend(row({ id: "B", ticker: "B", company_name: "Beta", dividend_per_share: "2.4", payment_date: "2026-10-25", record_date: null, event_date: "2026-10-25" }), "2026-10-14", "2027-10-14", "upcoming"),
    toPublicDividend(row({ id: "C", ticker: "C", company_name: "Ceta", dividend_per_share: null, payment_date: "2026-10-20", record_date: null, event_date: "2026-10-20" }), "2026-10-14", "2027-10-14", "upcoming"),
  ];
  const valid = base.filter(Boolean);
  assert.deepEqual(sortPublicDividends(valid, "date", "upcoming").map((item) => item.id), ["C", "B", "A"]);
  assert.deepEqual(sortPublicDividends(valid, "amount", "upcoming").map((item) => item.id), ["B", "A", "C"]);
  assert.deepEqual(sortPublicDividends(valid, "company", "upcoming").map((item) => item.id), ["A", "B", "C"]);
});

test("filter URLs are encoded and keep applied view, year and search", () => {
  assert.equal(getDividendHref({}), "/kalendarz-dywidend");
  const url = getDividendHref({ view: "year", year: 2025, status: "proposed", sort: "amount", company: "P&G" });
  const parsed = new URL(`https://mexo.com.pl${url}`);
  assert.equal(parsed.searchParams.get("widok"), "year");
  assert.equal(parsed.searchParams.get("rok"), "2025");
  assert.equal(parsed.searchParams.get("spolka"), "P&G");
  assert.equal(parsed.searchParams.get("status"), "proposed");
});

test("server query reads only public corporate event tables and is not an ESPI crawler", async () => {
  const source = await readFile(new URL("../src/lib/server/public-dividend-calendar.ts", import.meta.url), "utf8");
  assert.match(source, /FROM corporate_events AS event/);
  assert.match(source, /issuer\.market = 'GPW'/);
  assert.match(source, /event\.event_type = 'UPCOMING_DIVIDEND'/);
  assert.match(source, /event\.active = TRUE/);
  assert.match(source, /source\.source_url|source\.source_published_at/);
  assert.match(source, /unstable_cache/);
  assert.doesNotMatch(source, /\bFROM\s+(users|portfolio_assets|portfolio_operations|watchlist)\b/i);
  assert.doesNotMatch(source, /synchronizePapEspi|fetch\(|getCurrentAccountData|getCurrentAuthenticatedUser/);
});

test("public page has safe defaults, SEO metadata, working filters and original source links", async () => {
  const page = await readFile(new URL("../src/app/kalendarz-dywidend/page.tsx", import.meta.url), "utf8");
  const sitemap = await readFile(new URL("../src/app/sitemap.ts", import.meta.url), "utf8");
  assert.match(page, /MEXO_PUBLIC_DIVIDENDS_INDEXABLE === "true"/);
  assert.match(page, /canonical:/);
  assert.match(page, /getPublicDividendCalendar/);
  assert.match(page, /getDividendStatusLabel/);
  assert.match(page, /href=\{dividend\.sourceUrl\}/);
  assert.match(page, /rel="noopener noreferrer nofollow"/);
  assert.match(page, /action=\{PATH\}/);
  assert.match(page, /role="search"/);
  assert.match(sitemap, /MEXO_PUBLIC_DIVIDENDS_INDEXABLE === "true"/);
  assert.doesNotMatch(page, /getCurrentAccountData|getCurrentAuthenticatedUser|redirect\("\/login"\)/);
});

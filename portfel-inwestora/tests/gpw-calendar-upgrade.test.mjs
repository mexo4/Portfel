import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  addCalendarDays,
  getStatutoryMeetingRegistrationDate,
  getWarsawDate,
  isCalendarWindowDays,
  parseCorporateEventDocument,
} from "../src/lib/corporate-events.ts";
import { isTrustedMeetingPdfUrl } from "../src/lib/server/general-meeting-pdf.ts";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("statutory WZA dates are exact calendar days, including Sundays and year boundaries", () => {
  assert.equal(getStatutoryMeetingRegistrationDate("2026-11-03"), "2026-10-18"); // PZU, Sunday
  assert.equal(getStatutoryMeetingRegistrationDate("2026-10-28"), "2026-10-12"); // KGHM
  assert.equal(getStatutoryMeetingRegistrationDate("2026-10-29"), "2026-10-13"); // Bogdanka
  assert.equal(getStatutoryMeetingRegistrationDate("2026-11-16"), "2026-10-31"); // PCC Rokita, Saturday
  assert.equal(getStatutoryMeetingRegistrationDate("2027-01-08"), "2026-12-23");
  assert.equal(getStatutoryMeetingRegistrationDate("2026-02-30"), undefined);
});

test("official WZA registration date is extracted separately from meeting date", () => {
  const [event] = parseCorporateEventDocument(`
    Zarząd spółki zwołuje Nadzwyczajne Walne Zgromadzenie na dzień 3 listopada 2026 roku.
    Dzień 18 października 2026 roku jest dniem rejestracji uczestnictwa w NWZ.
  `).filter((item) => item.eventType === "GENERAL_MEETING");
  assert.equal(event?.eventDate, "2026-11-03");
  assert.equal(event?.registrationDate, "2026-10-18");
  const [notice] = parseCorporateEventDocument(`
    Ogłoszenie o zwołaniu Nadzwyczajnego Walnego Zgromadzenia PZU SA na dzień 3 listopada 2026 roku.
    Dzień Rejestracji uczestnictwa w NWZ, tj. na dzień 18 października 2026 roku.
  `).filter((item) => item.eventType === "GENERAL_MEETING");
  assert.equal(notice?.registrationDate, "2026-10-18");
});

test("ranges are limited to 60/180/365 and use Warsaw date", () => {
  for (const days of [60, 180, 365]) assert.equal(isCalendarWindowDays(days), true);
  for (const days of [0, 59, 366, NaN]) assert.equal(isCalendarWindowDays(days), false);
  assert.equal(addCalendarDays("2026-10-21", 365), "2027-10-21");
  assert.equal(getWarsawDate(new Date("2026-10-20T22:30:00Z")), "2026-10-21");
});

test("meeting PDFs accept only public official HTTPS hosts", () => {
  assert.equal(isTrustedMeetingPdfUrl("https://espiebi.pap.pl/espi/pl/reports/view/attachment/123"), true);
  assert.equal(isTrustedMeetingPdfUrl("http://espiebi.pap.pl/attachment/123"), false);
  assert.equal(isTrustedMeetingPdfUrl("https://espiebi.pap.pl.evil.test/attachment/123"), false);
  assert.equal(isTrustedMeetingPdfUrl("https://127.0.0.1/attachment/123"), false);
});

test("API and UI keep WZA and reporting horizons independent; saved events remain in ICS", async () => {
  const [api, panel, publicReader, projection] = await Promise.all([
    source("src/app/api/corporate-events/route.ts"),
    source("src/components/CorporateEventsPanel.tsx"),
    source("src/lib/server/public-gpw-calendar.ts"),
    source("src/lib/server/corporate-events.ts"),
  ]);
  assert.match(api, /meetingDaysValue/);
  assert.match(api, /reportDaysValue/);
  assert.match(api, /event\.eventType === "GENERAL_MEETING" \? meetingDays/);
  assert.match(panel, /mexo-gpw-meeting-days/);
  assert.match(panel, /mexo-gpw-report-days/);
  assert.match(publicReader, /event\.event_date BETWEEN \$1 AND \$2/);
  assert.doesNotMatch(publicReader, /meetingDays|reportDays/);
  assert.match(api, /event\.paymentDate \?\? event\.eventDate/);
  assert.match(projection, /events\.length === 0 \|\| events\.some\(\(event\) => !event\.registrationDate\)/);
  assert.match(projection, /events\.push\(\.\.\.pdfEvents\)/);
  assert.match(projection, /WHEN event_date IS DISTINCT FROM \$1 THEN NULL/);
});

test("dividend reader keeps two dated installments and payment-after-record events", () => {
  const events = parseCorporateEventDocument(`
    Walne Zgromadzenie podjęło uchwałę o wypłacie dywidendy za 2025 rok.
    Dywidenda w wysokości 0,13 zł na akcję. Dzień nabycia prawa do dywidendy: 14.09.2026 r.
    Termin wypłaty dywidendy: 27.10.2026 r. (0,06 zł) i 26.11.2026 (0,07 zł).
  `).filter((item) => item.eventType === "UPCOMING_DIVIDEND");
  assert.deepEqual(events.map((event) => [event.dividendPerShare, event.paymentDate, event.recordDate, event.dividendInstallment]), [
    [0.06, "2026-10-27", "2026-09-14", 1],
    [0.07, "2026-11-26", "2026-09-14", 2],
  ]);
});

test("dividend layout uses six stable desktop columns and safe nonempty source labels", async () => {
  const [css, component] = await Promise.all([source("src/app/globals.css"), source("src/components/DividendCalendarPanel.tsx")]);
  const desktopColumns = css.match(/\.dividend-calendar-row\s*\{[\s\S]*?grid-template-columns:\s*([^;]+);/)?.[1] ?? "";
  assert.equal((desktopColumns.match(/minmax\(/g) ?? []).length, 6);
  assert.match(desktopColumns, /minmax\(94px,\s*\.8fr\)/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.dividend-calendar-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(component, /getSourceLabel/);
  assert.match(component, /noopener noreferrer/);
  assert.match(component, /new Map\(/);
});

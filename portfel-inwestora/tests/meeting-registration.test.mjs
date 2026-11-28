import assert from "node:assert/strict";
import test from "node:test";
import {
  getStatutoryMeetingRegistrationDate,
  isPolishIssuerIsin,
  resolveMeetingRegistrationDate,
} from "../src/lib/meeting-registration.ts";
import { expandGpwStoredCalendarEvent } from "../src/lib/public-gpw-calendar.ts";

// On 28.11.2026 87 of 98 general meetings on the public calendar showed no registration day: their notices
// state it in a PDF the ESPI attachment server does not hand to automated readers. For a company
// registered in Poland the law fixes the day; a foreign issuer's day comes only from its notice.
test("the registration day: the notice's own, else 16 days before the meeting for a Polish issuer", () => {
  assert.equal(getStatutoryMeetingRegistrationDate("2026-12-04"), "2026-11-18");
  assert.equal(getStatutoryMeetingRegistrationDate("2027-01-15"), "2026-12-30");
  assert.equal(getStatutoryMeetingRegistrationDate("2026-02-30"), undefined);
  assert.deepEqual(resolveMeetingRegistrationDate("2026-12-04", null, "PLCOMP000017"), { date: "2026-11-18", source: "STATUTORY_CALCULATION" });
  assert.deepEqual(resolveMeetingRegistrationDate("2026-12-04", "2026-11-17", "PLCOMP000017"), { date: "2026-11-17", source: "OFFICIAL" });
  assert.deepEqual(resolveMeetingRegistrationDate("2026-11-18", null, "LU2237380790"), { source: "UNKNOWN" });
  assert.deepEqual(resolveMeetingRegistrationDate("2026-11-18", "2026-11-04", "LU2237380790"), { date: "2026-11-04", source: "OFFICIAL" });
  assert.deepEqual(resolveMeetingRegistrationDate("2026-11-18", null, null), { source: "UNKNOWN" });
  assert.equal(isPolishIssuerIsin("plcomp000017"), true);
  assert.equal(isPolishIssuerIsin("AU000000GRX6"), false);
  assert.equal(isPolishIssuerIsin("PL123"), false);
});

const meeting = (overrides) => ({
  id: "m", ticker: "TST", company_name: "Spółka Testowa", event_type: "GENERAL_MEETING",
  event_date: "2026-12-04", event_time: "10:00", fiscal_period: null, fiscal_year: null, fiscal_year_label: null,
  general_meeting_type: "NWZ", registration_date: null, registration_date_source: null, issuer_isin: "PLTEST000014",
  dividend_per_share: null, dividend_currency: null, record_date: null, payment_date: null, status: "CONFIRMED",
  updated_at: "2026-11-06", source_url: "https://www.gpw.pl/komunikat?geru_id=1", source_published_at: null,
  ...overrides,
});

test("the public calendar shows the day and says where it comes from", () => {
  const [statutory] = expandGpwStoredCalendarEvent(meeting({}), "2026-12-01", "2026-12-31");
  assert.equal(statutory.registrationDate, "2026-11-18");
  assert.equal(statutory.registrationDateSource, "STATUTORY_CALCULATION");
  const [official] = expandGpwStoredCalendarEvent(meeting({ registration_date: "2026-11-17", registration_date_source: "OFFICIAL" }), "2026-12-01", "2026-12-31");
  assert.equal(official.registrationDate, "2026-11-17");
  assert.equal(official.registrationDateSource, "OFFICIAL");
  const [foreign] = expandGpwStoredCalendarEvent(meeting({ issuer_isin: "LU2237380790" }), "2026-12-01", "2026-12-31");
  assert.equal(foreign.registrationDate, undefined);
  const [report] = expandGpwStoredCalendarEvent(meeting({ event_type: "QUARTERLY_REPORT", general_meeting_type: null }), "2026-12-01", "2026-12-31");
  assert.equal(report.registrationDate, undefined);
});

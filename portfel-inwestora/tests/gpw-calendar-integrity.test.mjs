import assert from "node:assert/strict";
import test from "node:test";
import {
  assessGpwCalendarIntegrity,
  getAnnouncedDividendDays,
  isAdvanceNoticeText,
  noticeStatesDate,
  polishCount,
} from "../src/lib/gpw-calendar-integrity.ts";
import { gpwDividendNotices } from "./fixtures/gpw-calendar-faults-2026-11-28.mjs";

// The integrity check reads dates on its own, without the calendar parser. On the real notices that
// broke the calendar it must find every dividend and payment day the parser should have published:
// that is what lets it catch the next parser fault.
test("the integrity check finds each dividend and payment day of the real dividend notices", () => {
  for (const entry of gpwDividendNotices) {
    const days = getAnnouncedDividendDays(entry.text, "2026-01-01");
    for (const [identity, recordDate, paymentDate] of entry.expected) {
      for (const day of [recordDate, paymentDate].filter(Boolean)) {
        assert.ok(days.includes(day), `${entry.id} ${identity}: ${day} not among ${days.join(", ")}`);
      }
    }
  }
});

test("advance notices are told apart by their words", () => {
  const advances = gpwDividendNotices.filter((entry) => entry.expected.some(([identity]) => identity.includes(":advance:")));
  assert.ok(advances.length > 0);
  for (const entry of advances) assert.equal(isAdvanceNoticeText(entry.text), true, entry.id);
  assert.equal(isAdvanceNoticeText("Zwyczajne Walne Zgromadzenie postanowiło przeznaczyć zysk na wypłatę dywidendy."), false);
});

test("each published dividend's own notice states its dates", () => {
  for (const entry of gpwDividendNotices) {
    for (const [identity, recordDate, paymentDate] of entry.expected) {
      assert.ok([recordDate, paymentDate].some((day) => day && noticeStatesDate(entry.text, day)), `${entry.id} ${identity}`);
    }
  }
});

test("dates are read in every common form and only after dividend words", () => {
  const text = `Zarząd informuje o wypłacie zaliczki. Dzień dywidendy: 9 grudnia 2026 r., termin wypłaty: 16.12.2026.
    Walne zgromadzenie odbędzie się 2027-01-20. Uprawnieni są akcjonariusze z dnia 2027-02-03.`;
  assert.deepEqual(getAnnouncedDividendDays(text, "2026-11-28"), ["2026-12-09", "2026-12-16", "2027-02-03"]);
  assert.deepEqual(getAnnouncedDividendDays(text, "2026-12-10"), ["2026-12-16", "2027-02-03"]);
  assert.deepEqual(
    getAnnouncedDividendDays("Dzień dywidendy i dzień wypłaty ustalono odpowiednio na 9 grudnia 2026 r. i 16 grudnia 2026 r.", "2026-11-28"),
    ["2026-12-09", "2026-12-16"],
  );
  assert.equal(noticeStatesDate("wypłata nastąpi 5 stycznia 2027 r.", "2027-01-05"), true);
  assert.equal(noticeStatesDate("wypłata nastąpi 05.01.2027", "2027-01-05"), true);
  assert.equal(noticeStatesDate("wypłata nastąpi 15.01.2027", "2027-01-05"), false);
});

test("the assessment names each kind of fault and stays quiet when there is none", () => {
  const clean = {
    checkedAt: "2026-11-28T12:00:00.000Z",
    dividends: { noticesChecked: 4, missing: [], eventsChecked: 3, unsupported: [] },
    reports: { since: "2026-09-29", published: 20, onCalendarDay: 19, differentDay: [], notInCalendar: [] },
  };
  assert.deepEqual(assessGpwCalendarIntegrity(clean), { level: "OK", findings: [] });
  const report = { issuer: "Spółka Testowa", reportType: "QUARTERLY_REPORT", publishedOn: "2026-11-20", calendarDate: null, sourceUrl: "https://example.test/r" };
  const faulty = {
    ...clean,
    dividends: {
      ...clean.dividends,
      missing: [{ issuer: "Spółka Testowa", sourceUrl: "https://example.test/d", publishedAt: "2026-11-20T10:00:00Z", days: ["2026-12-16"] }],
      unsupported: [{ issuer: "Spółka Testowa", recordDate: "2026-12-09", paymentDate: "2026-12-16", sourceUrl: "https://example.test/e" }],
    },
    reports: { ...clean.reports, onCalendarDay: 10, notInCalendar: [report] },
  };
  const assessment = assessGpwCalendarIntegrity(faulty);
  assert.equal(assessment.level, "ATTENTION");
  assert.equal(assessment.findings.length, 3);
  assert.match(assessment.findings[0], /^Dywidendy: 1 komunikat podaje /);
  assert.equal(assessment.findings[2], "Raporty: tylko 10 z 20 wyszło w dniu z kalendarza.");
  // A late filer alone, or a quiet month with few filings, raises no alarm.
  assert.equal(assessGpwCalendarIntegrity({ ...clean, reports: { ...clean.reports, onCalendarDay: 18, notInCalendar: [report] } }).level, "OK");
  assert.equal(assessGpwCalendarIntegrity({ ...clean, reports: { ...clean.reports, published: 6, onCalendarDay: 2 } }).level, "OK");
});

test("counts take the right Polish form", () => {
  assert.equal(polishCount(1, "raport", "raporty", "raportów"), "1 raport");
  assert.equal(polishCount(3, "raport", "raporty", "raportów"), "3 raporty");
  assert.equal(polishCount(12, "raport", "raporty", "raportów"), "12 raportów");
  assert.equal(polishCount(22, "raport", "raporty", "raportów"), "22 raporty");
  assert.equal(polishCount(25, "raport", "raporty", "raportów"), "25 raportów");
});

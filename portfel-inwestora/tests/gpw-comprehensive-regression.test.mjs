import assert from "node:assert/strict";
import test from "node:test";
import { getDividendAmendmentEvidence, parseCorporateEventDocument, isNonBindingDividendDraftNotice } from "../src/lib/corporate-events.ts";
import {
  isDividendReportSuperseded,
  planDividendFinalResolution,
  planDividendRejectedAmendment,
  planDividendSourceReprojection,
} from "../src/lib/dividend-reprojection.ts";
import { expandGpwStoredCalendarEvent, getGpwEventLabel } from "../src/lib/public-gpw-calendar.ts";

const dividends = (text) => parseCorporateEventDocument(text).filter((event) => event.eventType === "UPCOMING_DIVIDEND");
const old = (id, identity, record, installment, source = "https://www.gpw.pl/komunikat?geru_id=1") => ({
  id, event_identity: identity, event_date: record, record_date: record,
  payment_date: "2026-11-06", dividend_installment: installment,
  dividend_per_share: installment === null ? 49.05 : installment === 3 ? 32.64 : 16.33,
  status: "CONFIRMED", source_published_at: "2026-06-18T16:12:09.000Z", source_urls: [source],
});

test("official AB wrapped schedule uses publication dates, never period-end/legal citation dates", () => {
  const document = `Terminy przekazywania raportów okresowych w roku obrotowym 2026/2027
  Raporty kwartalne:
  Raport jednostkowy jako część raportu skonsolidowanego zgodnie z Rozporządzeniem Ministra Finansów z dnia 6 czerwca 2025 roku.
  - Raport za I kwartał _01-10-2026 - 31-12-2026_ roku obrotowego 2026/2027 _wyniki
  skonsolidowane i jednostkowe_ zostanie opublikowany w dniu 22-02-2027 r.
  - Raport za III kwartał _01-04-2027 - 30-06-2027_ roku obrotowego 2026/2027 _wyniki
  skonsolidowane i jednostkowe_ zostanie opublikowany w dniu 23-08-2027 r.
  Raporty półroczne:
  Raport za I półrocze _01-10-2026 - 31-03-2027_ roku obrotowego 2026/2027 _wyniki skonsolidowane
  i jednostkowe_ zostanie opublikowany w dniu 08-06-2027 r.
  Raporty roczne:
  Raport jednostkowy za rok obrotowy 2026/2027 _01-10-2026 - 30-09-2027_ zostanie opublikowany
  w dniu 07-01-2028 r.`;
  const events = parseCorporateEventDocument(document).filter((event) => event.eventType.endsWith("REPORT"));
  assert.deepEqual(events.map((event) => event.eventDate).sort(),
    ["2027-02-22", "2027-06-08", "2027-08-23", "2028-01-07"]);
});

test("non-calendar fiscal schedules keep the announced half-year publication date", () => {
  const examples = [
    ["Grodno", "15.12.2026"],
    ["Komputronik", "15.12.2026"],
    ["Betacom", "11.12.2026"],
    ["Intersport Polska", "17.12.2026"],
  ];
  for (const [issuer, publication] of examples) {
    const schedule = `Terminy publikacji raportów ${issuer} w roku obrotowym 2026/2027.\n` +
      `- Raport półroczny za I półrocze 01.04.2026 - 30.09.2026 roku obrotowego 2026/2027\n` +
      `  zostanie opublikowany w dniu ${publication} r.`;
    const events = parseCorporateEventDocument(schedule).filter((event) => event.eventType === "HALF_YEAR_REPORT");
    assert.equal(events.length, 1, issuer);
    assert.equal(events[0].eventDate, `2026-12-${publication.slice(0, 2)}`, issuer);
    assert.equal(events[0].fiscalYearLabel, "2026/2027", issuer);
  }
});

test("an unvoted quoted draft cannot create a second Instal Kraków payment", () => {
  const events = dividends(`Uchwały podjęte na ZWZ. Uchwała nr 7 w sprawie podziału zysku za 2025 rok.
    Zwyczajne Walne Zgromadzenie podjęło uchwałę: 2,50 zł na jedną akcję.
    Dzień dywidendy 24 sierpnia 2026 r.; dzień wypłaty 6 listopada 2026 r.
    Nie poddano pod głosowanie projektu uchwały o treści: 1,50 zł na jedną akcję,
    dzień dywidendy 24 sierpnia 2026 r.; dzień wypłaty 6 listopada 2026 r.`);
  assert.equal(events.length, 1);
  assert.equal(events[0].dividendPerShare, 2.5);
  assert.equal(events[0].dividendInstallment, undefined);
});

test("a shareholder amendment is not P.A. Nova's adopted dividend", () => {
  const amendment = `Akcjonariusz zgłosiła następujące zmiany do uchwały nr 7 o wypłacie dywidendy:
    0,80 zł na akcję zastępuje 1,00 zł na akcję, termin 10 grudnia 2026 r.`;
  assert.equal(isNonBindingDividendDraftNotice(amendment), true);
  assert.deepEqual(dividends(amendment), []);
  assert.equal(isNonBindingDividendDraftNotice(`${amendment}\nWalne Zgromadzenie podjęło uchwałę o wypłacie dywidendy 1,00 zł na akcję.`), false);
  const final = dividends(`Walne Zgromadzenie podjęło uchwałę o wypłacie dywidendy
    1,00 zł na akcję. Dzień dywidendy 6 lipca 2026 r., dzień wypłaty 31 lipca 2026 r.`);
  assert.equal(final.length, 1);
  assert.equal(final[0].paymentDate, "2026-07-31");
});

test("VRG and Dębica dates preceding labels do not borrow payment date", () => {
  const [vrg] = dividends(`Dywidenda 0,05 zł na akcję. Na dzień 19 września 2026 r. _dzień dywidendy_. Dniem wypłaty jest 15 grudnia 2026 r.`);
  assert.equal(vrg.recordDate, "2026-09-19");
  assert.equal(vrg.paymentDate, "2026-12-15");
  const [debica] = dividends(`Informacja na temat wypłaty dywidendy za rok 2025.
    Zwyczajne Walne Zgromadzenie Spółki podjęło - zgodnie z propozycją Zarządu Spółki -
    uchwałę dotyczącą podziału zysku: 6,79 zł na jedną akcję,
    ustalając dzień 21 września 2026 r. jako dzień nabycia praw do dywidendy oraz
    dzień 17 grudnia 2026 r. jako termin wypłaty dywidendy.`);
  assert.equal(debica.dividendStatus, "CONFIRMED");
  assert.equal(debica.recordDate, "2026-09-21");
  assert.equal(debica.paymentDate, "2026-12-17");
});

test("same-source reprojection retires only exclusively sourced false installments", () => {
  const source = "https://www.gpw.pl/komunikat?geru_id=491836";
  const previous = [old("first", "dividend:2025:1", "2026-08-24", 1, source),
    old("second", "dividend:2025:2", "2026-08-24", 2, source),
    { ...old("shared", "dividend:2025:3", "2026-08-24", 3, source), source_urls: [source, "https://issuer.example/final"] }];
  const final = dividends(`Uchwała o wypłacie dywidendy za 2025 rok: 2,50 zł na jedną akcję.
    Dzień dywidendy 24 sierpnia 2026 r.; wypłata dywidendy 6 listopada 2026 r.`);
  const plan = planDividendSourceReprojection(previous, final, source, true, false);
  assert.deepEqual(plan.deactivateIds, ["first", "second"]);
  assert.deepEqual(plan.ambiguousIds, ["shared"]);
  assert.deepEqual(planDividendSourceReprojection(previous, [], source, false, true).deactivateIds, []);
});

test("a non-binding no-event report retires its own stale projection, not a shared one", () => {
  const source = "https://www.gpw.pl/komunikat?geru_id=492936";
  const previous = [old("false", "dividend:2026:1", "2026-12-10", 1, source),
    { ...old("shared", "dividend:2026:2", "2026-12-10", 2, source), source_urls: [source, "https://issuer.example/resolution"] }];
  assert.deepEqual(planDividendSourceReprojection(previous, [], source, true, true).deactivateIds, ["false"]);
});

test("an unavailable proposal PDF never retires rows without an independent final resolution", () => {
  const source = "https://www.gpw.pl/komunikat?geru_id=492936";
  const notice = `Akcjonariusz zgłosiła następujące zmiany do uchwały nr 7:
    1. podwyższenie dywidendy z 0,80 zł na jedną akcję do 1,00 zł na jedną akcję,
    2. dzień dywidendy z 18.09.2026 r. na 06.07.2026 r.,
    3. termin wypłaty dywidendy z dnia 10.12.2026 r. na 31.07.2026 r.`;
  const falseRows = [
    { ...old("old-amount", "dividend:2026:1", "2026-12-10", 1, source), record_date: null,
      dividend_per_share: 0.8, payment_date: "2026-12-10" },
    { ...old("new-amount-old-date", "dividend:2026:2", "2026-12-10", 2, source), record_date: null,
      dividend_per_share: 1, payment_date: "2026-12-10" },
  ];
  const final = dividends(`Walne Zgromadzenie podjęło uchwałę o wypłacie dywidendy
    1,00 zł na akcję. Dzień dywidendy 6 lipca 2026 r., dzień wypłaty 31 lipca 2026 r.`);
  const evidence = getDividendAmendmentEvidence(notice);
  assert.deepEqual(planDividendRejectedAmendment(falseRows, evidence, source, []).deactivateIds, []);
  assert.deepEqual(planDividendRejectedAmendment(falseRows, evidence, source, final).deactivateIds,
    ["old-amount", "new-amount-old-date"]);
  const shared = { ...falseRows[0], source_urls: [source, "https://issuer.example/final"] };
  assert.deepEqual(planDividendRejectedAmendment([shared], evidence, source, final).deactivateIds, []);
  assert.deepEqual(planDividendRejectedAmendment(falseRows, evidence, source,
    [{ ...final[0], dividendPerShare: 0.8 }]).deactivateIds, []);
});

test("confirmed installments replace a stale single and excess installments, but preserve two real payments", () => {
  const final = dividends(`Dywidenda za 2025 rok. Zwyczajne Walne Zgromadzenie podjęło uchwałę.
    Łączna dywidenda wynosi 48,97 zł na akcję i będzie wypłacana w dwóch ratach.
    Dzień dywidendy 19 sierpnia 2026 r. Pierwsza rata 16,33 zł na akcję, wypłata 3 września 2026 r.;
    druga rata 32,64 zł na akcję, wypłata 4 listopada 2026 r.`);
  assert.equal(final.length, 2);
  assert.equal(final[0].dividendStatus, "CONFIRMED", JSON.stringify(final));
  assert.equal(final[0].recordDate, "2026-08-19", JSON.stringify(final));
  assert.equal(final[1].dividendStatus, "CONFIRMED", JSON.stringify(final));
  assert.equal(final[1].recordDate, "2026-08-19", JSON.stringify(final));
  const previous = [{ ...old("single", "dividend:2025:single", "2026-08-19", null),
    source_published_at: "2026-04-20T16:08:59.000Z" },
    old("one", "dividend:2025:1", "2026-08-19", 1),
    old("two", "dividend:2025:2", "2026-08-19", 2),
    old("third", "dividend:2025:3", "2026-08-19", 3)];
  const plan = planDividendFinalResolution(previous, final, "2026-06-18T15:42:50Z");
  assert.deepEqual(plan.deactivateIds, ["single", "third"]);
  assert.deepEqual(plan.retainedIds, ["one", "two"]);
  const newer = [{ ...previous[0], source_published_at: "2026-07-01T00:00:00Z" }];
  // A later correction of only one tranche cannot hide the other tranche
  // while historical reports are replayed newest-first.
  assert.equal(isDividendReportSuperseded(newer, final, "2026-06-18T15:42:50Z"), false);
  const correctedFirst = { ...old("corrected-first", final[0].eventIdentity, "2026-08-19", 1),
    source_published_at: "2026-07-01T00:00:00Z" };
  assert.equal(isDividendReportSuperseded([correctedFirst], [final[0]], "2026-06-18T15:42:50Z"), true);
  const unrelated = { ...old("other-year", "dividend:2024:single", "2026-08-19", null),
    source_published_at: "2026-05-01T00:00:00Z" };
  assert.deepEqual(planDividendFinalResolution([unrelated], final, "2026-06-18T15:42:50Z").deactivateIds, []);
});

test("a final multi-rate dividend retires only the older prior-year proposal with the same record date", () => {
  const final = dividends(`Zarząd Grupy Kęty informuje, że Zwyczajne Walne Zgromadzenie
    podjęło uchwałę w sprawie wypłaty dywidendy. Jako dzień dywidendy określono
    19 sierpnia 2026 r., termin wypłaty ustalono na 3 września 2026 r. i 4 listopada 2026 r.
    Dywidenda wynosi 48,97 zł na akcję, w tym pierwsza rata 16,33 zł na akcję,
    druga rata 32,64 zł na akcję.`);
  assert.equal(final.length, 2);
  const proposal = { ...old("proposal", "dividend:2025:single", "2026-08-19", null,
    "https://www.gpw.pl/komunikat?geru_id=486015&title=Wniosek+Zarzadu+w+sprawie+dywidendy"),
    payment_date: null, source_published_at: "2026-04-20T16:08:59Z" };
  const sameAmountButUnrelated = { ...proposal, id: "unrelated", source_urls: ["https://example.org/other"] };
  const newer = { ...proposal, id: "newer", source_published_at: "2026-07-01T00:00:00Z" };
  const wrongDate = { ...proposal, id: "wrong-date", record_date: "2026-08-20" };
  const plan = planDividendFinalResolution([proposal, sameAmountButUnrelated, newer, wrongDate],
    final, "2026-06-18T15:42:50Z");
  assert.deepEqual(plan.deactivateIds, ["proposal"]);
});

test("an older board recommendation cannot recreate a distribution after the shareholders decide", () => {
  const proposal = dividends(`Wniosek Zarządu w sprawie podziału zysku za 2025 rok.
    Zarząd podjął uchwałę, w której postanowił zarekomendować Walnemu Zgromadzeniu
    dywidendę 49,05 zł na akcję. Dzień dywidendy: 19 sierpnia 2026 r.
    Ostateczna decyzja dotycząca podziału zysku i wypłaty dywidendy podjęta zostanie
    przez Zwyczajne Walne Zgromadzenie.`);
  assert.equal(proposal.length, 1);
  assert.equal(proposal[0].dividendStatus, "PROPOSED");
  const finalRate = { ...old("confirmed", "dividend:2026:1", "2026-08-19", 1),
    source_published_at: "2026-06-18T15:42:50Z" };
  assert.equal(isDividendReportSuperseded([finalRate], proposal, "2026-04-20T12:00:00Z"), true);
  assert.equal(isDividendReportSuperseded([{ ...finalRate, record_date: "2026-08-20" }], proposal,
    "2026-04-20T12:00:00Z"), false);
});

test("a stored dividend whose event date is its payment date is labeled as payment", () => {
  const row = {
    id: "test", ticker: "KTY", company_name: "Grupa Kęty", event_type: "UPCOMING_DIVIDEND",
    event_date: "2026-11-04", event_time: null, fiscal_period: null, fiscal_year: 2025,
    fiscal_year_label: null, general_meeting_type: null, registration_date: null,
    dividend_per_share: 32.64, dividend_currency: "PLN", record_date: "2026-08-19",
    payment_date: "2026-11-04", status: "CONFIRMED", updated_at: "2026-10-22",
    source_url: "https://www.gpw.pl/komunikat?geru_id=491794", source_published_at: null,
  };
  const [event] = expandGpwStoredCalendarEvent(row, "2026-11-01", "2026-11-30");
  assert.equal(event.kind, "DIVIDEND_PAYMENT");
  assert.equal(getGpwEventLabel(event), "Wypłata dywidendy");
});

import assert from "node:assert/strict";
import test from "node:test";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { parseGpwIssuerCard } from "../src/lib/server/gpw-catalog.ts";

test("official GK IMMOBILE resolution retains two payment tranches after the record day", () => {
  const events = parseCorporateEventDocument(`Informacje na temat dywidendy. Raport bieżący 17/2026.
    Zarząd spółki informuje, że zgodnie z podjętą przez Zwyczajne Walne Zgromadzenie uchwałą
    za 2025 r. przeznaczono na dywidendę 0,13 zł na akcję.
    Dniem nabycia prawa do dywidendy jest dzień 14.09.2026 r.
    Ustalono terminy wypłaty przez Spółkę dywidendy w 2 ratach w dniach:
    - 27.10.2026 r. - wypłata 0,06 zł na jedną akcję;
    - 26.11.2026 r. - wypłata 0,07 zł na jedną akcję.`)
    .filter((event) => event.eventType === "UPCOMING_DIVIDEND");
  assert.deepEqual(events.map((event) => ({ amount: event.dividendPerShare,
    record: event.recordDate, payment: event.paymentDate, installment: event.dividendInstallment })), [
    { amount: 0.06, record: "2026-09-14", payment: "2026-10-27", installment: 1 },
    { amount: 0.07, record: "2026-09-14", payment: "2026-11-26", installment: 2 },
  ]);
});

test("official Instal Kraków distribution has one confirmed future payment", () => {
  const events = parseCorporateEventDocument(`Zwyczajne Walne Zgromadzenie Instal Kraków S.A. podjęło w dniu 19 czerwca 2026 roku
    uchwałę o wypłacie dywidendy z zysku za 2025 rok. Na każdą akcję przypada 2,50 zł.
    Dzień prawa do dywidendy ustalono na 24 sierpnia 2026 roku, a dzień wypłaty dywidendy na 6 listopada 2026 roku.`)
    .filter((event) => event.eventType === "UPCOMING_DIVIDEND");
  assert.equal(events.length, 1);
  assert.equal(events[0].dividendPerShare, 2.5);
  assert.equal(events[0].recordDate, "2026-08-24");
  assert.equal(events[0].paymentDate, "2026-11-06");
  assert.equal(events[0].dividendStatus, "CONFIRMED");
});

test("official CPD meeting notice is not lost or assigned the publication date", () => {
  const events = parseCorporateEventDocument(`Ogłoszenie o zwołaniu Zwyczajnego Walnego Zgromadzenia CPD S.A.
    Zarząd spółki CPD S.A. informuje o zwołaniu Zwyczajnego Walnego Zgromadzenia Spółki na dzień
    4 listopada 2026 roku, na godz. 13.00. Walne Zgromadzenie odbędzie się w Warszawie.`)
    .filter((event) => event.eventType === "GENERAL_MEETING");
  assert.equal(events.length, 1);
  assert.equal(events[0].eventDate, "2026-11-04");
  assert.equal(events[0].eventTime, "13:00");
  assert.equal(events[0].generalMeetingType, "ZWZ");
});

test("official CPD time shorthand 'na g. 13.00' is preserved", () => {
  const meetings = parseCorporateEventDocument(`Zarząd CPD S.A. informuje o zwołaniu Zwyczajnego Walnego Zgromadzenia
    Spółki na dzień 4 listopada 2026 roku, na g. 13.00.`)
    .filter((event) => event.eventType === "GENERAL_MEETING");
  assert.equal(meetings[0]?.eventTime, "13:00");
  assert.equal(meetings[0]?.isCancellation, false);
});

test("Grodno adopted distribution in official report 31/2026 supersedes earlier proposal", () => {
  const events = parseCorporateEventDocument(`Uchwała Zwyczajnego Walnego Zgromadzenia z dnia 20 października 2026 r.
    w sprawie podziału zysku netto. ZWZ podjęło uchwałę: kwota 2 614 916,37 zł zostanie
    przekazana na wypłatę dywidendy, tj. 0,17 zł za akcję.
    ZWZ ustaliło dzień dywidendy na dzień 27 października 2026 r. oraz termin wypłaty
    dywidendy na dzień 19 listopada 2026 r.`)
    .filter((event) => event.eventType === "UPCOMING_DIVIDEND");
  assert.equal(events.length, 1);
  assert.equal(events[0].dividendPerShare, 0.17);
  assert.equal(events[0].recordDate, "2026-10-27");
  assert.equal(events[0].paymentDate, "2026-11-19");
  assert.equal(events[0].dividendStatus, "CONFIRMED");
});

test("official GPW issuer card supplies a missing catalogue ticker only for matching ISIN", () => {
  const card = `<h1>08OCTAVA (PLNFI0800016)</h1><input type="hidden" value="08N" id="glsSkrot">`;
  assert.equal(parseGpwIssuerCard(card, "PLNFI0800016")?.symbol, "08N.WA");
  assert.equal(parseGpwIssuerCard(card, "PLCELPD00013"), null);
  assert.equal(parseGpwIssuerCard(`<h1>08OCTAVA (PLNFI0800016)</h1>`, "PLNFI0800016"), null);
});

test("one issuer schedule keeps Q1 and Q3 on their distinct announced dates", () => {
  const events = parseCorporateEventDocument(`Terminy przekazywania raportów:
    2. Skonsolidowane raporty kwartalne Grupy Budimex:
    - za I kwartał 2026 r. - 6 maja 2026 r.
    - za III kwartał 2026 r. - 27 października 2026 r.`)
    .filter((event) => event.eventType === "QUARTERLY_REPORT");
  assert.deepEqual(events.map((event) => [event.fiscalPeriod, event.eventDate]), [
    ["Q1", "2026-05-06"], ["Q3", "2026-10-27"],
  ]);
});

test("LPP fiscal-period end is not invented as an extra Q4 publication", () => {
  const events = parseCorporateEventDocument(`Skonsolidowane raporty kwartalne:
    - Rozszerzony skonsolidowany raport za III kwartał 2026: 03 grudnia 2026 roku.
    Okresy sprawozdawcze w 2026 będą przedstawiać się następująco:
    IV kwartał 2026 - od 1 listopada do 31 stycznia 2027.`)
    .filter((event) => event.eventType === "QUARTERLY_REPORT");
  assert.deepEqual(events.map((event) => [event.fiscalPeriod, event.eventDate]), [["Q3", "2026-12-03"]]);
});

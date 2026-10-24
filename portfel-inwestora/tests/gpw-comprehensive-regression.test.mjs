import assert from "node:assert/strict";
import test from "node:test";
import { getDividendAmendmentEvidence, parseCorporateEventDocument, isNonBindingDividendDraftNotice, resolveCorporateEventStatus } from "../src/lib/corporate-events.ts";
import {
  isDividendReportSuperseded,
  planDividendFinalResolution,
  planDividendRejectedAmendment,
  planDividendSourceReprojection,
} from "../src/lib/dividend-reprojection.ts";
import { expandGpwStoredCalendarEvent, getGpwEventLabel } from "../src/lib/public-gpw-calendar.ts";
import { gpwReferenceCorpus } from "./fixtures/gpw-reference-corpus-2026-10-24.mjs";
import { gpwProspectiveHoldoutF } from "./fixtures/gpw-prospective-holdout-F-2026-10-24.mjs";

const dividends = (text) => parseCorporateEventDocument(text).filter((event) => event.eventType === "UPCOMING_DIVIDEND");
const old = (id, identity, record, installment, source = "https://www.gpw.pl/komunikat?geru_id=1") => ({
  id, event_identity: identity, event_date: record, record_date: record,
  payment_date: "2026-11-06", dividend_installment: installment,
  dividend_per_share: installment === null ? 49.05 : installment === 3 ? 32.64 : 16.33,
  status: "CONFIRMED", source_published_at: "2026-06-18T16:12:09.000Z", source_urls: [source],
});

test("report schedule correction pairs a previously scheduled date with the replacement publication date", () => {
  const source = gpwProspectiveHoldoutF.find((document) => document.id === "EQUNICO-69-2026");
  assert.ok(source);
  const event = parseCorporateEventDocument(source.parserInput).find((item) => item.eventType === "QUARTERLY_REPORT");
  assert.ok(event);
  assert.deepEqual(
    [event.eventDate, event.previousEventDate, event.fiscalPeriod, event.fiscalYear, event.isScheduleChange],
    ["2026-11-16", "2026-11-27", "Q3", 2026, true],
  );
});

test("general meeting eligibility cross-reference is parsed as its registration date", () => {
  const source = gpwProspectiveHoldoutF.find((document) => document.id === "FASING-30-2026");
  assert.ok(source);
  const event = parseCorporateEventDocument(source.parserInput).find((item) => item.eventType === "GENERAL_MEETING");
  assert.ok(event);
  assert.equal(event.eventDate, "2026-11-10");
  assert.equal(event.registrationDate, "2026-10-25");
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

test("realistic LPP section heading does not swallow its Q3 bullet or legal citation", () => {
  const events = parseCorporateEventDocument(`Terminy publikacji raportów okresowych w 2026 roku
    3. Skonsolidowane raporty kwartalne:
    - Rozszerzony skonsolidowany raport za I kwartał 2026: 11 czerwca 2026 roku;
    - Rozszerzony skonsolidowany raport za III kwartał 2026: 03 grudnia 2026 roku.
    Na podstawie § 62 Rozporządzenia Ministra Finansów z dnia 29 marca 2018 roku
    spółka nie będzie publikowała odrębnych raportów.`);
  const quarters = events.filter((event) => event.eventType === "QUARTERLY_REPORT");
  assert.deepEqual(quarters.map((event) => [event.fiscalPeriod, event.eventDate]),
    [["Q1", "2026-06-11"], ["Q3", "2026-12-03"]]);
});

test("realistic GreenX PDF text retains wrapped publication year and fiscal quarters", () => {
  const events = parseCorporateEventDocument(`Harmonogram publikacji raportów okresowych za rok obrotowy 2027.
    - Raport kwartalny za okres lipiec-wrzesień 2026 r. _pierwszy kwartał_ - 30 października 2026 r.
    - Raport kwartalny za okres październik-grudzień 2026 r. _drugi kwartał_ - 29 stycznia 2027 r.
    - Raport kwartalny za okres styczeń-marzec 2027 r. _trzeci kwartał_ - 30 kwietnia 2027 r.
    - Raport kwartalny za okres kwiecień-czerwiec 2027 r. _czwarty kwartał_ - 30 lipca 2027 r.
    - Raport roczny 2027 _za rok obrotowy kończący się 30 czerwca 2027 r._ - 30 września
    2027 r.`);
  assert.deepEqual(events.filter((event) => event.eventType === "QUARTERLY_REPORT")
    .map((event) => event.fiscalPeriod), ["Q1", "Q2", "Q3", "Q4"]);
  assert.ok(events.some((event) => event.eventType === "ANNUAL_REPORT" &&
    event.eventDate === "2027-09-30"));
  assert.equal(events.some((event) => event.eventDate === "2027-06-30"), false);
});

test("selected Budimex financial data are not a second half-year report", () => {
  const events = parseCorporateEventDocument(`Terminy przekazywania raportów:
    3. Skonsolidowany raport Grupy Budimex za I półrocze 2026 r. - 21 sierpnia 2026 r.
    Jednocześnie Zarząd informuje, że wybrane dane finansowe ze skonsolidowanego
    raportu półrocznego Grupy Budimex za I półrocze 2026 r. zostaną opublikowane
    28 lipca 2026 roku.`);
  assert.deepEqual(events.filter((event) => event.eventType === "HALF_YEAR_REPORT")
    .map((event) => event.eventDate), ["2026-08-21"]);
});

test("wrapped mBank correction keeps new and previous dates, not selected Q4 data", () => {
  const events = parseCorporateEventDocument(`Zmiana terminu publikacji raportu finansowego za III kwartał 2026 r.
    W nawiązaniu do raportu bieżącego nr 59/2025 Zarząd informuje o zmianie terminu publikacji
    Skonsolidowanego raportu kwartalnego za III kwartał 2026
    r. zostanie opublikowany 28 października 2026 r. zamiast 29 października 2026 r.,
    zaś wybrane niezaudytowane dane finansowe za IV kwartał 2026 r. zostaną opublikowane
    4 lutego 2027 r. zamiast 5 lutego 2027 r.`);
  assert.deepEqual(events.filter((event) => event.eventType === "QUARTERLY_REPORT")
    .map((event) => [event.fiscalPeriod, event.eventDate, event.previousEventDate]),
    [["Q3", "2026-10-28", "2026-10-29"]]);
});

test("real DGA wording binds the explicitly original date to the corrected date", () => {
  const [event] = parseCorporateEventDocument(`DGA SA (16/2026) Zmiana terminu publikacji raportu za I półrocze 2026 r.
    Data określona pierwotnie na dzień 30 września 2026 r. zostaje zmieniona na dzień 24 września 2026 roku.`);
  assert.deepEqual([event?.eventType, event?.fiscalPeriod, event?.fiscalYear,
    event?.previousEventDate, event?.eventDate],
  ["HALF_YEAR_REPORT", "H1", 2026, "2026-09-30", "2026-09-24"]);
});

test("real MCR correction selects the publication date pair, not the quarter's period-end", () => {
  const [event] = parseCorporateEventDocument(`MCR SA (27/2026) Zmiana terminu publikacji skonsolidowanego raportu kwartalnego
    za pierwszy kwartał roku obrotowego obejmujący okres od 01.04.2026 do 30.06.2026.
    Termin publikacji zostaje przesunięty z dnia 21.08.2026 r. na dzień 20.08.2026 r.`);
  assert.deepEqual([event?.eventType, event?.fiscalPeriod, event?.previousEventDate, event?.eventDate],
    ["QUARTERLY_REPORT", "Q1", "2026-08-21", "2026-08-20"]);
  assert.deepEqual([event?.periodStart, event?.periodEnd], ["2026-04-01", "2026-06-30"]);
  assert.equal(event?.fiscalYear, undefined, "do not infer fiscal-year label when the issuer gives only the period boundaries");
  assert.ok(event?.requiresReview, "the missing explicit fiscal-year label remains visible for review");
});

test("real NPL Nova replacement schedule is parsed from the corrected section only", () => {
  const events = parseCorporateEventDocument(`NPL NOVA SA (9/2026) Zmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku.
    Zgodnie z treścią raportu bieżącego nr 1/2026 pierwotny termin raportu był 24 września 2026 roku.
    Jednocześnie Zarząd koryguje informacje zawarte w treści raportu bieżącego nr 1/2026 i informuje,
    że kolejne raporty okresowe w 2026 roku będą przekazywane do publicznej wiadomości w następujących terminach i zakresie:
    - rozszerzony jednostkowy raport za I półrocze 2026 r. - 30 września 2026 r.
    - rozszerzony jednostkowy raport kwartalny za III kwartał 2026 r. - 26 listopada 2026 r.`)
    .filter((event) => event.eventType.endsWith("REPORT"));
  assert.deepEqual(events.map(({ eventType, fiscalPeriod, eventDate }) => [eventType, fiscalPeriod, eventDate]), [
    ["HALF_YEAR_REPORT", "H1", "2026-09-30"],
    ["QUARTERLY_REPORT", "Q3", "2026-11-26"],
  ]);
  assert.ok(events.every((event) => event.isScheduleChange));
  assert.equal(events.some((event) => event.eventDate === "2026-09-24"), false,
    "the replaced H1 date must not leak from the superseded paragraph");
});

test("ZPC Otmuchow change cue earlier in sentence binds the explicitly anchored date pair", () => {
  const [event] = parseCorporateEventDocument(`Zarząd ZPC OTMUCHÓW S.A. informuje o zmianie terminu przekazania przez Spółkę do publicznej wiadomości rozszerzonego skonsolidowanego raportu za I półrocze 2026 roku z pierwotnie deklarowanego terminu publikacji, tj. z dnia 30 września 2026 roku, na nowy termin publikacji tj. na dzień 28 września 2026 r.`);
  assert.deepEqual([
    event?.eventType,
    event?.eventDate,
    event?.previousEventDate,
    event?.fiscalPeriod,
    event?.fiscalYear,
    event?.isScheduleChange,
  ], ["HALF_YEAR_REPORT", "2026-09-28", "2026-09-30", "H1", 2026, true]);
});

test("ESPI correction wording binds a prior appointment followed by a new term", () => {
  // Source: https://pap-mediaroom.pl/biznes-i-finanse/inter-cars-sa-252026-zmiana-terminu-publikacji-raportu-okresowego-za-i-polrocze
  const [interCars] = parseCorporateEventDocument(`INTER CARS SA (25/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 roku.
    Zarząd Inter Cars S.A. informuje o zmianie terminu przekazania do publicznej wiadomości raportu okresowego za I półrocze 2026 roku ("Raport"), wyznaczonego zgodnie z raportem bieżącym nr 2/2026 z dnia 26 stycznia 2026 roku, na dzień 10 września 2026 roku. Nowy termin publikacji Raportu ustala się na dzień 8 września 2026 roku.`);
  assert.deepEqual([interCars?.eventType, interCars?.eventDate, interCars?.previousEventDate,
    interCars?.fiscalPeriod, interCars?.fiscalYear, interCars?.isScheduleChange],
  ["HALF_YEAR_REPORT", "2026-09-08", "2026-09-10", "H1", 2026, true]);

  // Source: https://pap-mediaroom.pl/biznes-i-finanse/gpw-sa-82026-zmiana-terminu-publikacji-skonsolidowanego-raportu-za-i-polrocze-2026
  const [gpw] = parseCorporateEventDocument(`GPW SA (8/2026) Zmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 r.
    W nawiązaniu do raportu bieżącego nr 1/2026 z 22 stycznia 2026 r., Zarząd Giełdy Papierów Wartościowych w Warszawie S.A. informuje, iż podjął decyzję o zmianie terminu publikacji skonsolidowanego raportu półrocznego Grupy GPW za I półrocze 2026 roku, z 14 września 2026 roku na 3 września 2026 roku.`);
  assert.deepEqual([gpw?.eventType, gpw?.eventDate, gpw?.previousEventDate,
    gpw?.fiscalPeriod, gpw?.fiscalYear, gpw?.isScheduleChange],
  ["HALF_YEAR_REPORT", "2026-09-03", "2026-09-14", "H1", 2026, true]);
});

test("official ATREM dividend with three identical per-share rates keeps all three payment dates", () => {
  const events = dividends(`ATREM SA (16/2026) Informacje na temat dywidendy.
    Zwyczajne Walne Zgromadzenie Spółki w dniu 24.06.2026 r. uchwałą w sprawie przeznaczenia zysku
    ustaliło 2,16 zł na jedną akcję na wypłatę dywidendy.
    Dniem nabycia prawa do dywidendy jest dzień 10.08.2026 r.
    Terminy wypłaty przez Spółkę dywidendy ustala się w 3 równych ratach w dniach:
    - 18.08.2026 r. - wypłata 6.645.656,88 zł tj. 0,72 zł na jedną akcję;
    - 22.09.2026 r. - wypłata 6.645.656,88 zł tj. 0,72 zł na jedną akcję;
    - 20.10.2026 r. - wypłata 6.645.656,88 zł tj. 0,72 zł na jedną akcję.`);
  assert.deepEqual(events.map(({ recordDate, paymentDate, dividendPerShare, dividendInstallment }) =>
    [recordDate, paymentDate, dividendPerShare, dividendInstallment]), [
    ["2026-08-10", "2026-08-18", 0.72, 1],
    ["2026-08-10", "2026-09-22", 0.72, 2],
    ["2026-08-10", "2026-10-20", 0.72, 3],
  ]);
  assert.ok(events.every((event) => event.dividendStatus === "CONFIRMED"));
});

test("TEXT approved dividend subtracts already-paid advances and keeps only the remaining payment", () => {
  // Source: https://pap-mediaroom.pl/biznes-i-finanse/text-sa-122026-decyzja-zwz-w-sprawie-wyplaty-dywidendy-z-zysku-za-202526-rok
  const events = dividends(`TEXT SA (12/2026) Decyzja ZWZ w sprawie wypłaty dywidendy z zysku za 2025/26 rok finansowy.
    Zwyczajne Walne Zgromadzenie podjęło uchwałę dotyczącą podziału zysku za rok obrotowy zakończony 31 marca 2026 r.
    Wartość dywidendy na jedną akcję wyniesie 4,26 zł.
    Przy uwzględnieniu zaliczek na poczet dywidendy, wypłaconych 1 grudnia 2025 r. i 29 lipca 2026 r.,
    pozostająca do wypłaty dywidenda zostanie wypłacona w kwocie 54.847.500 zł,
    to jest w kwocie 2,13 zł na jedną akcję.
    Dzień ustalenia akcjonariuszy uprawnionych do dywidendy - 8 października 2026 r.
    Dzień wypłaty dywidendy - 15 października 2026 r.`);

  assert.equal(events.length, 1, JSON.stringify(events, null, 2));
  assert.deepEqual([
    events[0]?.dividendPerShare,
    events[0]?.dividendTotalPerShare,
    events[0]?.dividendAdvancePerShare,
    events[0]?.recordDate,
    events[0]?.paymentDate,
    events[0]?.dividendStatus,
  ], [2.13, 4.26, 2.13, "2026-10-08", "2026-10-15", "CONFIRMED"]);
});

test("LPP approved dividend treats the prior advance as paid and only schedules the remainder", () => {
  // Source: https://pap-mediaroom.pl/biznes-i-finanse/lpp-sa-162026
  const events = dividends(`LPP SA (16/2026)
    Zarząd LPP SA informuje, iż Zwyczajne Walne Zgromadzenie Spółki w dniu dzisiejszym podjęło uchwałę w sprawie wypłaty akcjonariuszom dywidendy za rok obrotowy od 1 lutego 2025 do 31 stycznia 2026 wg następujących założeń:
    - kwota dywidendy na akcję: 900 PLN;
    - łączna kwota dywidendy wyniesie 1 672 837 200 PLN;
    - dzień dywidendy (dzień na który zostanie ustalona liczba uprawnionych akcjonariuszy) - 9 października 2026 r.;
    - termin wypłaty dywidendy - 30 października 2026 r.
    Faktycznie wypłacona dywidenda na akcję będzie pomniejszona o kwotę uprzednio wypłaconej zaliczki na poczet dywidendy za rok obrotowy zakończony 31 stycznia 2026 r., która wyniosła 743 483 200 PLN, tj. 400 PLN na akcję. Zaliczka została wypłacona na 1 858 708 akcji, dniem ustalenia uprawnionych do udziału w zaliczce był 23 kwietnia 2026 r.`);

  assert.equal(events.length, 1, JSON.stringify(events, null, 2));
  assert.deepEqual([
    events[0]?.dividendPerShare,
    events[0]?.dividendTotalPerShare,
    events[0]?.dividendAdvancePerShare,
    events[0]?.recordDate,
    events[0]?.paymentDate,
    events[0]?.dividendInstallment,
  ], [500, 900, 400, "2026-10-09", "2026-10-30", undefined]);
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

test("a linked dividend correction without restated approval preserves confirmed status only on update", () => {
  const source = gpwReferenceCorpus.find((document) => document.id === "KETY-31-2026");
  assert.ok(source);
  const corrections = dividends(source.parserInput);
  assert.equal(corrections.length, 2);
  assert.deepEqual(corrections.map((item) => item.dividendTotalPerShare), [48.96, 48.96]);
  assert.ok(corrections.every((item) => item.dividendStatus === "UNKNOWN"));
  assert.equal(resolveCorporateEventStatus("CONFIRMED", corrections[0]), "CONFIRMED");
  assert.equal(resolveCorporateEventStatus(undefined, corrections[0]), "UNKNOWN");
  assert.equal(resolveCorporateEventStatus("CONFIRMED", { ...corrections[0], dividendStatus: "PROPOSED" }), "PROPOSED");
});

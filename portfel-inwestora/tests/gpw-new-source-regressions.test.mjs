import assert from "node:assert/strict";
import test from "node:test";

import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";

test("a conditional advance with an explicit per-share amount and entitlement date remains a proposal", () => {
  // Structure and wording follow an official GPW advance notice, but contain
  // no issuer-specific identifiers so this exercises the general rule.
  const events = parseCorporateEventDocument(`Temat: Wypłata zaliczki na poczet dywidendy za 2026 rok
    Zarząd informuje, że zatwierdzono sprawozdanie za rok obrotowy 2025.
    Podjął uchwałę o wypłacie zaliczki w wysokości 0,18 zł (osiemnaście groszy)
    na poczet dywidendy za rok obrotowy 2026, na każdą z 34.469.086 akcji Spółki.
    Zarząd jako dzień, według stanu na który ustala się uprawnionych do Zaliczki
    wskazał datę 1 grudnia 2026 roku, natomiast jako dzień wypłaty Zaliczki
    ustalono dzień 3 grudnia 2026 roku.
    Warunkiem wypłaty Zaliczki jest udzielenie przez Radę Nadzorczą zgody.`);

  assert.deepEqual(events.map(({ eventType }) => eventType), ["UPCOMING_DIVIDEND"]);
  assert.equal(events[0].fiscalYear, 2026);
  assert.equal(events[0].recordDate, "2026-12-01");
  assert.equal(events[0].paymentDate, "2026-12-03");
  assert.equal(events[0].dividendPerShare, 0.18);
  assert.equal(events[0].dividendStatus, "PROPOSED");
});

test("a subsidiary-only distribution never becomes a dividend of its listed parent", () => {
  const events = parseCorporateEventDocument(`Temat: Uchwała spółki zależnej o wypłacie zaliczki
    Zarząd Emitenta informuje, że Zarząd Spółka Autostradowa S.A.
    (spółki zależnej Emitenta) podjął uchwałę w sprawie wypłaty akcjonariuszom
    Spółka Autostradowa S.A. zaliczki na poczet dywidendy za 2026 rok.
    Na jedną akcję spółki zależnej przypada 0,25 PLN.
    Dzień dywidendy ustalono na 30 listopada 2026, a wypłata nastąpi 15 grudnia 2026.`);

  assert.equal(events.some(({ eventType }) => eventType === "UPCOMING_DIVIDEND"), false);
});

test("a prose correction replaces the former report date, not its source citation date", () => {
  const events = parseCorporateEventDocument(`Temat: Zmiana terminu przekazania raportu okresowego
    Raport kwartalny za III kwartał 2026, którego termin przekazania do publicznej
    wiadomości został wyznaczony w raporcie bieżącym nr 1/2026 z dnia 22.01.2026 r.
    na dzień 30.11.2026 r., zostanie opublikowany w dniu 28.10.2026 r.`);

  assert.deepEqual(events.filter(({ eventType }) => eventType === "QUARTERLY_REPORT").map((event) => ({
    eventDate: event.eventDate,
    previousEventDate: event.previousEventDate,
    fiscalPeriod: event.fiscalPeriod,
    fiscalYear: event.fiscalYear,
    isScheduleChange: event.isScheduleChange,
  })), [{
    eventDate: "2026-10-28",
    previousEventDate: "2026-11-30",
    fiscalPeriod: "Q3",
    fiscalYear: 2026,
    isScheduleChange: true,
  }]);
});

test("preliminary result processing date is not the formal quarterly publication date", () => {
  const events = parseCorporateEventDocument(`Temat: Wstępne wyniki finansowe po 3 kwartałach 2026 roku
    Zarząd informuje, że w związku z
    zakończeniem w dniu 20.10.2026 roku procesu rozliczania wyniku finansowego po 3 kwartałach
    2026 roku, powziął informację o wstępnych wynikach finansowych.
    Zaprezentowane wyniki nie są ostateczne i mogą ulec zmianie.
    Ostateczne wyniki zostaną przedstawione w raporcie kwartalnym Spółki, który zostanie
    opublikowany w dniu 20.11.2026 roku.`);

  assert.deepEqual(events.filter((event) => event.eventType === "QUARTERLY_REPORT")
    .map((event) => event.eventDate), ["2026-11-20"]);
});

test("an informational report heading does not turn a processing date into a publication", () => {
  const events = parseCorporateEventDocument(`Informacje o raporcie kwartalnym:
    Dane za III kwartał 2026: 20.10.2026 roku proces zamknięto.`);

  assert.equal(events.some((event) => event.eventType === "QUARTERLY_REPORT"), false);
});

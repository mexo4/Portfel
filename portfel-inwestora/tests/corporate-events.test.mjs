import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractPolishDates,
  getCorporateEventIdentityKey,
  getDaysUntilCorporateEvent,
  getUpcomingDividendDatesForDisplay,
  getUpcomingDividendRelevantDate,
  isCorporateEventSourceUnavailable,
  parseCorporateEventDocument,
} from "../src/lib/corporate-events.ts";
import {
  classifyCorporateEventHttpStatus,
  getGpwCorporateEventCanonicalKey,
  isGpwCorporateEventInstrument,
  PapEspiCorporateEventProvider,
  shouldApplyEvent,
} from "../src/lib/server/corporate-events.ts";

const sourceFixtures = {
  dino: `
    Raport bieżący nr 1/2026 – Terminy publikacji raportów okresowych DINO POLSKA S.A. w 2026 r.
    Skonsolidowany raport kwartalny za I kwartał 2026 r. – 14 maja 2026 r.
    Skonsolidowany raport półroczny za I półrocze 2026 r. – 20 sierpnia 2026 r.
    Skonsolidowany raport kwartalny za III kwartał 2026 r. – 5 listopada 2026 r.
  `,
  orlen: `
    Terminy przekazywania raportów okresowych ORLEN S.A. w 2026 roku.
    Skonsolidowany raport półroczny za 2026 rok: 6 sierpnia 2026 roku.
    Skonsolidowany raport kwartalny za 3. kwartał 2026 roku:
    19 listopada 2026 roku.
  `,
  lpp: `
    Terminy raportów okresowych w 2026 roku:
    Skonsolidowany raport za I półrocze 2026: 17 września 2026 roku.
    Rozszerzony skonsolidowany raport za III kwartał 2026: 03 grudnia 2026 roku.
  `,
  cdp: `
    Skonsolidowany raport półroczny za I półrocze 2026 – 2 września 2026 roku.
    Skonsolidowany raport kwartalny za III kwartał 2026 – 24 listopada 2026 roku.
  `,
  diagnostyka: `
    skonsolidowany raport półroczny za pierwsze półrocze 2026 roku –10 września 2026 r.
    skonsolidowany raport kwartalny za trzeci kwartał 2026 roku – 26 listopada 2026 r.
  `,
  scheduleChange: `
    Zmiana terminu publikacji raportu okresowego za I kwartał 2026 roku.
    Data publikacji wskazanego raportu została ustalona na dzień 5 maja 2026 roku.
    Nowy termin publikacji skonsolidowanego raportu kwartalnego za I kwartał 2026 r.
    został wyznaczony na dzień 18 maja 2026 roku.
  `,
};

const findEvent = (events, eventType, fiscalPeriod, eventDate) =>
  events.find(
    (event) =>
      event.eventType === eventType &&
      event.fiscalPeriod === fiscalPeriod &&
      event.eventDate === eventDate
  );

test("parses the verified GPW schedules from the POC without production hardcoded events", () => {
  assert.ok(findEvent(parseCorporateEventDocument(sourceFixtures.dino), "HALF_YEAR_REPORT", "H1", "2026-08-20"));
  assert.ok(findEvent(parseCorporateEventDocument(sourceFixtures.dino), "QUARTERLY_REPORT", "Q3", "2026-11-05"));
  assert.ok(findEvent(parseCorporateEventDocument(sourceFixtures.orlen), "QUARTERLY_REPORT", "Q3", "2026-11-19"));
  assert.ok(findEvent(parseCorporateEventDocument(sourceFixtures.lpp), "HALF_YEAR_REPORT", "H1", "2026-09-17"));
  assert.ok(findEvent(parseCorporateEventDocument(sourceFixtures.lpp), "QUARTERLY_REPORT", "Q3", "2026-12-03"));
  assert.ok(findEvent(parseCorporateEventDocument(sourceFixtures.cdp), "HALF_YEAR_REPORT", "H1", "2026-09-02"));
  assert.ok(findEvent(parseCorporateEventDocument(sourceFixtures.cdp), "QUARTERLY_REPORT", "Q3", "2026-11-24"));
  assert.ok(findEvent(parseCorporateEventDocument(sourceFixtures.diagnostyka), "HALF_YEAR_REPORT", "H1", "2026-09-10"));
  assert.ok(findEvent(parseCorporateEventDocument(sourceFixtures.diagnostyka), "QUARTERLY_REPORT", "Q3", "2026-11-26"));
});

test("an official annual schedule yields separate FY, H1 and Q3 events including December", () => {
  const document = `
    Terminy publikacji raportów okresowych w roku finansowym 2026:
    Jednostkowy i skonsolidowany raport za 2025: 26 marca 2026 roku.
    Skonsolidowany raport za I półrocze 2026: 17 września 2026 roku.
    Rozszerzony skonsolidowany raport za I kwartał 2026: 11 czerwca 2026 roku.
    Rozszerzony skonsolidowany raport za III kwartał 2026: 03 grudnia 2026 roku.
  `;
  const events = parseCorporateEventDocument(document);
  assert.ok(findEvent(events, "ANNUAL_REPORT", "FY", "2026-03-26"));
  assert.ok(findEvent(events, "HALF_YEAR_REPORT", "H1", "2026-09-17"));
  assert.ok(findEvent(events, "QUARTERLY_REPORT", "Q1", "2026-06-11"));
  assert.ok(findEvent(events, "QUARTERLY_REPORT", "Q3", "2026-12-03"));
  assert.equal(new Set(events.map(getCorporateEventIdentityKey)).size, 4);
});

test("fiscal-year H1 schedules preserve December dates without inventing payment events", () => {
  const cases = [
    "Skonsolidowany raport za I półrocze roku obrotowego 2026/2027: 10 grudnia 2026 roku.",
    "Półroczny skonsolidowany raport za półrocze roku obrotowego 2026/2027 – termin publikacji 15 grudnia 2026 roku.",
    "Raport półroczny za I półrocze roku obrotowego 2026/2027 – zostanie opublikowany 17 grudnia 2026 r.",
  ];
  for (const [index, document] of cases.entries()) {
    const expected = ["2026-12-10", "2026-12-15", "2026-12-17"][index];
    assert.ok(findEvent(parseCorporateEventDocument(document), "HALF_YEAR_REPORT", "H1", expected));
  }
});

test("a newer formal PAP report schedule supersedes an old generic IR page", () => {
  const existing = {
    status: "CONFIRMED", source_type: "ISSUER_IR", source_priority: 200,
    source_published_at: "2023-03-31T11:21:52.000Z",
  };
  const source = {
    sourceType: "PAP_ESPI", sourceUrl: "https://pap-mediaroom.pl/official-report",
    sourcePublishedAt: "2026-01-15T07:22:00.000Z",
  };
  assert.equal(shouldApplyEvent(existing, source, {
    eventType: "QUARTERLY_REPORT", eventDate: "2026-12-03", fiscalPeriod: "Q3", fiscalYear: 2026,
    isScheduleChange: false,
  }), true);
});

test("supports Polish word dates, dotted dates and dashed dates", () => {
  assert.deepEqual(extractPolishDates("20 sierpnia 2026, 20.08.2026, 20-08-2026"), ["2026-08-20"]);
});

test("treats an official schedule change as one Q1 identity with old and new dates", () => {
  const [change] = parseCorporateEventDocument(sourceFixtures.scheduleChange);
  assert.deepEqual(
    {
      type: change.eventType,
      period: change.fiscalPeriod,
      year: change.fiscalYear,
      oldDate: change.previousEventDate,
      newDate: change.eventDate,
      changed: change.isScheduleChange,
    },
    {
      type: "QUARTERLY_REPORT",
      period: "Q1",
      year: 2026,
      oldDate: "2026-05-05",
      newDate: "2026-05-18",
      changed: true,
    }
  );
  assert.equal(
    getCorporateEventIdentityKey(change),
    getCorporateEventIdentityKey({
      eventType: "QUARTERLY_REPORT",
      fiscalPeriod: "Q1",
      fiscalYear: 2026,
    })
  );
});

test("does not create a report event from unrelated dates", () => {
  assert.deepEqual(parseCorporateEventDocument("Walne zgromadzenie odbędzie się 20 sierpnia 2026 roku."), []);
});

test("associates each date with the nearest report when a schedule is one paragraph", () => {
  const events = parseCorporateEventDocument(
    "Raport półroczny za I półrocze 2026: 20 sierpnia 2026; raport kwartalny za III kwartał 2026: 5 listopada 2026."
  );

  assert.ok(findEvent(events, "HALF_YEAR_REPORT", "H1", "2026-08-20"));
  assert.ok(findEvent(events, "QUARTERLY_REPORT", "Q3", "2026-11-05"));
  assert.equal(events.length, 2);
});

test("Kęty and Budimex official rows keep Q1 and Q3 separate", () => {
  const kety = parseCorporateEventDocument(`Skonsolidowany raport kwartalny:\n-za I kwartał 2026 r. - 22 kwietnia 2026 roku,\n-za III kwartał 2026 r. - 26 października 2026 roku,`);
  assert.ok(findEvent(kety, "QUARTERLY_REPORT", "Q1", "2026-04-22"));
  assert.ok(findEvent(kety, "QUARTERLY_REPORT", "Q3", "2026-10-26"));
  assert.equal(kety.length, 2);
  const budimex = parseCorporateEventDocument(`Skonsolidowane raporty kwartalne Grupy Budimex:\n- za I kwartał 2026 r. - 6 maja 2026 r.\n- za III kwartał 2026 r. - 27 października 2026 r.`);
  assert.ok(findEvent(budimex, "QUARTERLY_REPORT", "Q1", "2026-05-06"));
  assert.ok(findEvent(budimex, "QUARTERLY_REPORT", "Q3", "2026-10-27"));
  assert.equal(budimex.length, 2);
});

test("Synektik and Syn2Bio use financial, not calendar quarters", () => {
  const synektik = parseCorporateEventDocument(`Zarząd informuje o terminach raportów w roku obrotowym 2026, trwającym od 1 października 2026 r. do 30 września 2027 r.:\n- skonsolidowany raport kwartalny za IV kwartał roku finansowego 2025 (a III kwartał roku kalendarzowego 2026) - 18 listopada 2026 r.\n- skonsolidowany raport kwartalny za I kwartał roku finansowego 2026 (a IV kwartał roku kalendarzowego 2026) - 24 lutego 2027 r.\n- skonsolidowany raport półroczny za I półrocze roku finansowego 2026 (okres: IV kwartał roku kalendarzowego 2026 i I kwartał roku kalendarzowego 2027) - 23 czerwca 2027 r.\n- skonsolidowany raport kwartalny za III kwartał roku finansowego 2026 (a II kwartał roku kalendarzowego 2027) - 4 sierpnia 2027 r.`);
  assert.deepEqual(synektik.map(({ fiscalPeriod, fiscalYear, eventDate }) => [fiscalPeriod, fiscalYear, eventDate]), [
    ["Q4", 2025, "2026-11-18"], ["Q1", 2026, "2027-02-24"],
    ["H1", 2026, "2027-06-23"], ["Q3", 2026, "2027-08-04"],
  ]);
  const syn2bio = parseCorporateEventDocument(`- jednostkowy raport kwartalny za I kwartał roku finansowego 2026 (a IV kwartał roku kalendarzowego 2026) – 17 lutego 2027 r.\n- jednostkowy raport półroczny za I półrocze roku finansowego 2026 (okres: IV kwartał roku kalendarzowego 2026 i I kwartał roku kalendarzowego 2027) – 30 czerwca 2027 r.\n- jednostkowy raport kwartalny za III kwartał roku finansowego 2026 (a II kwartał roku kalendarzowego 2027) – 11 sierpnia 2027 r.`);
  assert.deepEqual(syn2bio.map(({ fiscalPeriod, fiscalYear, eventDate }) => [fiscalPeriod, fiscalYear, eventDate]), [
    ["Q1", 2026, "2027-02-17"], ["H1", 2026, "2027-06-30"], ["Q3", 2026, "2027-08-11"],
  ]);
});

test("wrapped ESPI schedule bullets preserve fiscal quarters and dates", () => {
  const events = parseCorporateEventDocument(`Spółka w roku obrotowym 2026, trwającym od 1 października 2026 r. do 30 września 2027 r.:
- skonsolidowany raport kwartalny _SA-QSr_ za IV kwartał roku finansowego 2025 _a
III kwartał roku kalendarzowego 2026_ - 18 listopada 2026 r.
- skonsolidowany raport roczny za rok finansowy 2025 - 22 grudnia 2026 r.
- skonsolidowany raport kwartalny _SA-QSr_ za I kwartał roku finansowego 2026 _a IV
kwartał roku kalendarzowego 2026_ - 24 lutego 2027 r.
- skonsolidowany raport półroczny _SA-PSr_ za I półrocze roku finansowego 2026 _okres:
IV kwartał roku kalendarzowego 2026 i I kwartał roku kalendarzowego 2027_ - 23 czerwca
2027 r.
- skonsolidowany raport kwartalny _SA-QSr_ za III kwartał roku finansowego 2026 _a
II kwartał roku kalendarzowego 2027_ - 4 sierpnia 2027 r.`);
  assert.deepEqual(events.map(({ eventType, fiscalPeriod, fiscalYear, eventDate }) =>
    [eventType, fiscalPeriod, fiscalYear, eventDate]), [
    ["QUARTERLY_REPORT", "Q4", 2025, "2026-11-18"],
    ["ANNUAL_REPORT", "FY", 2025, "2026-12-22"],
    ["QUARTERLY_REPORT", "Q1", 2026, "2027-02-24"],
    ["HALF_YEAR_REPORT", "H1", 2026, "2027-06-23"],
    ["QUARTERLY_REPORT", "Q3", 2026, "2027-08-04"],
  ]);
});

test("a newly announced 2028 fiscal schedule needs no year-specific registry", () => {
  const schedule = parseCorporateEventDocument(`Terminy przekazywania raportów okresowych w roku obrotowym 2027/2028:
- raport kwartalny za I kwartał roku finansowego 2027/2028 - 24 lutego 2028 r.
- raport półroczny za I półrocze roku finansowego 2027/2028 - 20 czerwca 2028 r.
- raport roczny za rok finansowy 2027/2028 - 27 września 2028 r.`);
  assert.deepEqual(schedule.map(({ eventType, fiscalPeriod, fiscalYearLabel, eventDate }) =>
    [eventType, fiscalPeriod, fiscalYearLabel, eventDate]), [
    ["QUARTERLY_REPORT", "Q1", "2027/2028", "2028-02-24"],
    ["HALF_YEAR_REPORT", "H1", "2027/2028", "2028-06-20"],
    ["ANNUAL_REPORT", "FY", "2027/2028", "2028-09-27"],
  ]);
  const correction = parseCorporateEventDocument(`Zmiana terminu publikacji raportu kwartalnego za I kwartał roku finansowego 2027/2028.
Raport kwartalny za I kwartał roku finansowego 2027/2028 zostanie opublikowany 23 lutego 2028 r. zamiast 24 lutego 2028 r.`);
  assert.equal(correction.length, 1);
  assert.equal(correction[0].eventDate, "2028-02-23");
  assert.equal(correction[0].previousEventDate, "2028-02-24");
});

test("period boundaries, selected data and old corrected dates are not report appointments", () => {
  assert.deepEqual(parseCorporateEventDocument("Raport za IV kwartał 2026 roku zakończony na dzień 31 stycznia 2027 r."), []);
  const lpp = parseCorporateEventDocument(`Skonsolidowany raport za III kwartał 2026: 03 grudnia 2026 roku.\nW związku z tym rok finansowy trwa od 1 lutego 2026 roku do 31 stycznia 2027 roku.\nIV kwartał 2026 - od 1 listopada 2026 do 31 stycznia 2027.`);
  assert.equal(lpp.length, 1);
  assert.ok(findEvent(lpp, "QUARTERLY_REPORT", "Q3", "2026-12-03"));
  const mbank = parseCorporateEventDocument(`Zmiana terminu publikacji Skonsolidowanego raportu kwartalnego za III kwartał 2026 r. oraz wybranych niezaudytowanych danych finansowych za IV kwartał 2026 r.\nSkonsolidowany raport kwartalny za III kwartał 2026 r. zostanie opublikowany 28 października 2026 r. zamiast 29 października 2026 r., zaś wybrane niezaudytowane dane finansowe za IV kwartał 2026 r. zostaną opublikowane 4 lutego 2027 r. zamiast 5 lutego 2027 r.`);
  assert.deepEqual(mbank.map(({ fiscalPeriod, eventDate, previousEventDate }) => [fiscalPeriod, eventDate, previousEventDate]), [["Q3", "2026-10-28", "2026-10-29"]]);
});

test("GreenX and AB use publication dates, never fiscal period ends", () => {
  const greenx = parseCorporateEventDocument(`Harmonogram publikacji raportów za rok obrotowy kończący się w 2027 r. (tj. od 1 lipca 2026 do 30 czerwca 2027 r.).\n- Raport kwartalny za okres lipiec-wrzesień 2026 r. (pierwszy kwartał) - 30 października 2026 r.\n- Raport roczny 2027 (za rok obrotowy kończący się 30 czerwca 2027 r.) - 30 września 2027 r.`);
  assert.ok(findEvent(greenx, "QUARTERLY_REPORT", "Q1", "2026-10-30"));
  assert.ok(findEvent(greenx, "ANNUAL_REPORT", "FY", "2027-09-30"));
  assert.equal(greenx.some((event) => event.eventDate === "2027-06-30"), false);
  const ab = parseCorporateEventDocument(`- Raport za I kwartał (01-10-2026 - 31-12-2026) roku obrotowego 2026/2027 zostanie opublikowany w dniu 22-02-2027 r.\n- Raport za III kwartał (01-04-2027 - 30-06-2027) roku obrotowego 2026/2027 zostanie opublikowany w dniu 23-08-2027 r.`);
  assert.deepEqual(ab.map(({ fiscalPeriod, fiscalYearLabel, eventDate, periodStart, periodEnd }) =>
    [fiscalPeriod, fiscalYearLabel, eventDate, periodStart, periodEnd]), [
    ["Q1", "2026/2027", "2027-02-22", "2026-10-01", "2026-12-31"],
    ["Q3", "2026/2027", "2027-08-23", "2027-04-01", "2027-06-30"],
  ]);
});

test("standalone and consolidated reports share a calendar event only when their dates agree", () => {
  const together = parseCorporateEventDocument(`Raport jednostkowy za 2025 rok - 26 marca 2026 r.\nSkonsolidowany raport roczny za 2025 rok - 26 marca 2026 r.`);
  assert.equal(together.length, 1);
  const separately = parseCorporateEventDocument(`Raport jednostkowy za 2025 rok - 26 marca 2026 r.\nSkonsolidowany raport roczny za 2025 rok - 27 marca 2026 r.`);
  assert.equal(separately.length, 2);
  assert.equal(new Set(separately.map(getCorporateEventIdentityKey)).size, 2);
});

test("official Orange, PKO BP, KGHM and PZU schedule formats stay discoverable", () => {
  const orange = parseCorporateEventDocument(`Rozszerzone skonsolidowane raporty kwartalne:\n- za I kwartał 2026 r. - w dniu 22.04.2026 r.\n- za III kwartał 2026 r. - w dniu 26.10.2026 r.\nRaport roczny za 2026 r. - w dniu 05.03.2027 r.`);
  assert.ok(findEvent(orange, "QUARTERLY_REPORT", "Q3", "2026-10-26"));
  assert.ok(findEvent(orange, "ANNUAL_REPORT", "FY", "2027-03-05"));
  const pko = parseCorporateEventDocument(`4) skonsolidowany raport kwartalny GKB za III kwartał 2026 r. - 5 listopada 2026 r.`);
  assert.ok(findEvent(pko, "QUARTERLY_REPORT", "Q3", "2026-11-05"));
  const kghm = parseCorporateEventDocument(`Skonsolidowane raporty kwartalne:\n- za I kwartał 2026 roku - 13 maja 2026 r.\n- za III kwartał 2026 roku - 18 listopada 2026 r.`);
  assert.ok(findEvent(kghm, "QUARTERLY_REPORT", "Q3", "2026-11-18"));
  const pzu = parseCorporateEventDocument(`- skonsolidowany raport kwartalny za III kwartał 2026 r. - 19 listopada 2026 r.`);
  assert.ok(findEvent(pzu, "QUARTERLY_REPORT", "Q3", "2026-11-19"));
});

test("PDF-extracted wrapped publication year does not disappear", () => {
  const events = parseCorporateEventDocument(`Harmonogram raportów za rok obrotowy kończący się w 2027 r.\n• Raport kwartalny za okres lipiec–wrzesień 2026 r. (pierwszy kwartał) – 30 października\n2026 r.\n• Raport roczny 2027 (za rok obrotowy kończący się 30 czerwca 2027 r.) – 30 września 2027 r.`);
  assert.ok(findEvent(events, "QUARTERLY_REPORT", "Q1", "2026-10-30"));
  assert.ok(findEvent(events, "ANNUAL_REPORT", "FY", "2027-09-30"));
});

test("December H1 reports from official issuer schedules keep publication dates", () => {
  const betacom = parseCorporateEventDocument(`Skonsolidowany raport półroczny zawierający skrócone jednostkowe informacje finansowe:
– za I półrocze roku obrotowego kończącego się 31 marca 2027 r., tj. na dzień 30 września 2026 r. – 11 grudnia 2026 r.`);
  assert.ok(findEvent(betacom, "HALF_YEAR_REPORT", "H1", "2026-12-11"), JSON.stringify(betacom));
  assert.equal(betacom[0]?.fiscalYearLabel, "2026/2027");
  assert.equal(betacom[0]?.periodEnd, "2026-09-30");
  assert.equal(betacom.some((item) => item.eventDate === "2026-09-30"), false);

  const komputronik = parseCorporateEventDocument(`Półroczny skonsolidowany raport za półrocze roku obrotowego 2026/2027 zakończone w dniu 30 września 2026 roku - termin publikacji 15 grudnia 2026 roku.`);
  assert.ok(findEvent(komputronik, "HALF_YEAR_REPORT", "H1", "2026-12-15"));
  assert.equal(komputronik.some((item) => item.eventDate === "2026-09-30"), false);

  const intersport = parseCorporateEventDocument(`Raport półroczny:
- za I półrocze roku obrotowego 2026/2027 trwające od 1 kwietnia 2026 r. do 30 września 2026 r. - zostanie opublikowany 17 grudnia 2026 r.`);
  assert.ok(findEvent(intersport, "HALF_YEAR_REPORT", "H1", "2026-12-17"));
  assert.equal(intersport.some((item) => item.eventDate === "2026-09-30"), false);
});

test("uses a market-scoped GPW canonical identity, never a bare global ticker", () => {
  const dinoFirstUser = {
    id: "portfolio-a:instrument:stock:DNP",
    assetKind: "stock",
    symbol: "DNP.PL",
    name: "Dino Polska",
    marketCurrency: "PLN",
  };
  const dinoSecondUser = { ...dinoFirstUser, id: "portfolio-b:instrument:stock:DNP" };

  assert.equal(isGpwCorporateEventInstrument(dinoFirstUser), true);
  assert.equal(getGpwCorporateEventCanonicalKey(dinoFirstUser), "gpw:ticker:DNP");
  assert.equal(getGpwCorporateEventCanonicalKey(dinoFirstUser), getGpwCorporateEventCanonicalKey(dinoSecondUser));
  assert.equal(isGpwCorporateEventInstrument({ ...dinoFirstUser, symbol: "DNP", marketCurrency: "USD" }), false);
});

test("uses one market-scoped identity when portfolio copies differ only by optional ISIN", () => {
  const withoutIsin = {
    id: "portfolio-a:instrument:stock:KPL",
    assetKind: "stock",
    symbol: "KPL.PL",
    name: "Kino Polska TV",
    marketCurrency: "PLN",
  };
  const withIsin = {
    ...withoutIsin,
    id: "portfolio-b:instrument:stock:KPL",
    isin: "PLKNOPL00014",
  };

  assert.equal(getGpwCorporateEventCanonicalKey(withoutIsin), "gpw:ticker:KPL");
  assert.equal(
    getGpwCorporateEventCanonicalKey(withoutIsin),
    getGpwCorporateEventCanonicalKey(withIsin)
  );
  assert.notEqual(
    getGpwCorporateEventCanonicalKey(withoutIsin),
    getGpwCorporateEventCanonicalKey({ ...withIsin, symbol: "KTY.PL" })
  );
});

test("classifies source failures without confusing them with no event", () => {
  assert.equal(classifyCorporateEventHttpStatus(403), "ACCESS_DENIED");
  assert.equal(classifyCorporateEventHttpStatus(404), "NOT_FOUND");
  assert.equal(classifyCorporateEventHttpStatus(429), "TEMPORARILY_UNAVAILABLE");
  assert.equal(classifyCorporateEventHttpStatus(500), "TEMPORARILY_UNAVAILABLE");
  assert.equal(classifyCorporateEventHttpStatus(502), "TEMPORARILY_UNAVAILABLE");
  assert.equal(isCorporateEventSourceUnavailable("ACCESS_DENIED"), true);
  assert.equal(isCorporateEventSourceUnavailable("TEMPORARILY_UNAVAILABLE"), true);
  assert.equal(isCorporateEventSourceUnavailable("NOT_FOUND"), false);
});

test("PAP/ESPI adapter returns an explicit unavailable status and never manufactures an event", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("", { status: 502 });

  try {
    const provider = new PapEspiCorporateEventProvider({ DNP: "https://example.test/espi/dnp" });
    const result = await provider.fetchEvents({ id: "shared-dnp", ticker: "DNP", canonical_key: "gpw:ticker:DNP", company_name: "Dino Polska", isin: null, last_checked_at: null, last_source_status: null });
    assert.equal(result.status, "TEMPORARILY_UNAVAILABLE");
    assert.deepEqual(result.events, []);
    assert.equal(result.source?.sourceType, "PAP_ESPI");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("source timeout is explicit and does not turn into a guessed event", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new DOMException("The operation timed out", "TimeoutError");
  };

  try {
    const provider = new PapEspiCorporateEventProvider({ DNP: "https://example.test/espi/dnp" });
    const result = await provider.fetchEvents({ id: "shared-dnp", ticker: "DNP", canonical_key: "gpw:ticker:DNP", company_name: "Dino Polska", isin: null, last_checked_at: null, last_source_status: null });
    assert.equal(result.status, "TEMPORARILY_UNAVAILABLE");
    assert.deepEqual(result.events, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the same report confirmed by IR and PAP has one event identity with two sources", () => {
  const [irEvent] = parseCorporateEventDocument(sourceFixtures.dino).filter(
    (event) => event.eventType === "HALF_YEAR_REPORT" && event.fiscalPeriod === "H1"
  );
  const eventIdentity = `gpw:ticker:DNP:${getCorporateEventIdentityKey(irEvent)}`;
  const sources = new Map();
  sources.set("ISSUER_CURRENT_REPORT:https://issuer.example/dino", eventIdentity);
  sources.set("PAP_ESPI:https://pap.example/dino", eventIdentity);

  assert.equal(new Set(sources.values()).size, 1);
  assert.equal(sources.size, 2);
});

test("two portfolios holding the same GPW company share one refresh key", () => {
  const first = getGpwCorporateEventCanonicalKey({
    id: "portfolio-a:instrument:stock:DNP",
    assetKind: "stock",
    symbol: "DNP.PL",
    name: "Dino Polska",
    marketCurrency: "PLN",
  });
  const second = getGpwCorporateEventCanonicalKey({
    id: "portfolio-b:instrument:stock:DNP",
    assetKind: "stock",
    symbol: "DNP.PL",
    name: "Dino Polska",
    marketCurrency: "PLN",
  });

  assert.equal(first, second);
});

test("Dino naturally switches from H1 to Q3 after the H1 date", () => {
  const dinoEvents = parseCorporateEventDocument(sourceFixtures.dino);
  const upcomingAfterH1 = dinoEvents
    .filter((event) => event.eventDate > "2026-08-20")
    .sort((left, right) => left.eventDate.localeCompare(right.eventDate))[0];

  assert.deepEqual(
    { date: upcomingAfterH1.eventDate, period: upcomingAfterH1.fiscalPeriod },
    { date: "2026-11-05", period: "Q3" }
  );
  assert.equal(getDaysUntilCorporateEvent("2026-08-20", new Date("2026-08-11T12:00:00")), 9);
});

test("parses Kino Polska's confirmed future dividend from its official-calendar wording", () => {
  const events = parseCorporateEventDocument(`
    Dywidenda za rok obrotowy 2025:
    Zgodnie z uchwałą podjętą 29 czerwca 2026 r. Zwyczajne Walne Zgromadzenie
    przeznaczyło na wypłatę dywidendy. Kwota dywidendy przypadająca na jedną akcję wynosi 1,18 zł.
    Dzień ustalenia prawa do dywidendy – 21 sierpnia 2026 r.
    Dzień wypłaty dywidendy – 28 sierpnia 2026 r.
  `).filter((event) => event.eventType === "UPCOMING_DIVIDEND");

  assert.equal(events.length, 1);
  assert.equal(events[0].dividendPerShare, 1.18);
  assert.equal(events[0].dividendCurrency, "PLN");
  assert.equal(events[0].dividendStatus, "CONFIRMED");
  assert.equal(events[0].recordDate, "2026-08-21");
  assert.equal(events[0].paymentDate, "2026-08-28");
  assert.equal(events[0].fiscalYear, 2025);
  assert.equal(events[0].eventIdentity, "dividend:2025:single");
  assert.equal(Math.round(events[0].dividendPerShare * 10 * 100) / 100, 11.8);
});

test("a dividend proposal and final resolution keep one identity when amount or dates change", () => {
  const [proposal] = parseCorporateEventDocument(`
    Dywidenda za rok 2025: rekomendacja zarządu 1,00 zł na akcję.
    Dzień dywidendy 20 sierpnia 2026 r., wypłata 27 sierpnia 2026 r.
  `).filter((event) => event.eventType === "UPCOMING_DIVIDEND");
  const [confirmed] = parseCorporateEventDocument(`
    Dywidenda za rok 2025: walne zgromadzenie uchwaliło 1,18 zł na akcję.
    Dzień dywidendy 21 sierpnia 2026 r., wypłata 28 sierpnia 2026 r.
  `).filter((event) => event.eventType === "UPCOMING_DIVIDEND");

  assert.equal(proposal.dividendStatus, "PROPOSED");
  assert.equal(confirmed.dividendStatus, "CONFIRMED");
  assert.equal(getCorporateEventIdentityKey(proposal), getCorporateEventIdentityKey(confirmed));
});

test("keeps Grupa Kęty dividend installments as separate dated upcoming payments", () => {
  const events = parseCorporateEventDocument(`
    Uchwała Zwyczajnego Walnego Zgromadzenia w sprawie wypłaty dywidendy.
    Dywidenda za rok obrotowy 2025:
    Łączna dywidenda wynosi 48,97 zł na akcję i jest wypłacana w dwóch ratach:
    pierwsza rata 16,33 zł na akcję, dzień wypłaty 3 września 2026 r.;
    druga rata 32,64 zł na akcję, dzień wypłaty 4 listopada 2026 r.
    Dzień ustalenia prawa do dywidendy – 19 sierpnia 2026 r.
  `)
    .filter((event) => event.eventType === "UPCOMING_DIVIDEND")
    .sort((left, right) => (left.paymentDate ?? "").localeCompare(right.paymentDate ?? ""));

  assert.deepEqual(
    events.map((event) => ({
      amount: event.dividendPerShare,
      recordDate: event.recordDate,
      paymentDate: event.paymentDate,
      status: event.dividendStatus,
    })),
    [
      { amount: 16.33, recordDate: "2026-08-19", paymentDate: "2026-09-03", status: "CONFIRMED" },
      { amount: 32.64, recordDate: "2026-08-19", paymentDate: "2026-11-04", status: "CONFIRMED" },
    ]
  );
});

test("subtracts an already paid advance from the confirmed LPP total", () => {
  const [event] = parseCorporateEventDocument(`
    Uchwała Zwyczajnego Walnego Zgromadzenia.
    Dywidenda za rok obrotowy 2025/2026: łączna dywidenda wynosi 900 PLN na jedną akcję.
    Dzień dywidendy ustalono na 9 października 2026 r., a ostateczny termin wypłaty dywidendy na 30 października 2026 r.
    Kwota dywidendy faktycznie wypłaconej zostanie pomniejszona o wcześniej wypłaconą zaliczkę
    w wysokości 400 PLN na jedną akcję.
  `).filter((candidate) => candidate.eventType === "UPCOMING_DIVIDEND");

  assert.deepEqual({
    remaining: event.dividendPerShare,
    total: event.dividendTotalPerShare,
    advance: event.dividendAdvancePerShare,
    recordDate: event.recordDate,
    paymentDate: event.paymentDate,
    status: event.dividendStatus,
  }, { remaining: 500, total: 900, advance: 400, recordDate: "2026-10-09", paymentDate: "2026-10-30", status: "CONFIRMED" });
});

test("a confirmed issuer resolution supersedes lower-priority PAP data even without a parsed publication timestamp", () => {
  const parsed = parseCorporateEventDocument(`
    Uchwała Zwyczajnego Walnego Zgromadzenia.
    Dywidenda za rok obrotowy 2025/2026: 900 PLN na jedną akcję.
    Dzień dywidendy 9 października 2026 r. Termin wypłaty dywidendy 30 października 2026 r.
    Wypłata zostanie pomniejszona o wcześniej wypłaconą zaliczkę 400 PLN na jedną akcję.
  `).find((event) => event.eventType === "UPCOMING_DIVIDEND");

  assert.ok(parsed);
  assert.equal(shouldApplyEvent({
    id: "existing",
    event_date: "2026-10-09",
    status: "CONFIRMED",
    source_published_at: "2026-06-10T12:05:00.000Z",
    source_priority: 100,
    source_type: "PAP_ESPI",
    updated_at: "2026-06-10T12:05:00.000Z",
  }, {
    sourceType: "ISSUER_CURRENT_REPORT",
    sourceUrl: "https://issuer.example/final-resolution",
  }, parsed), true);
});

test("parses the newer Grupa Kęty installment update without turning the total into a third payment", () => {
  const events = parseCorporateEventDocument(`
    Dywidenda za rok 2025 została uchwalona przez Zwyczajne Walne Zgromadzenie.
    Dzień dywidendy 19 sierpnia 2026 r. Łączna kwota dywidendy wynosi obecnie 48,96 zł na akcję.
    W ramach wypłaty pierwszej transzy w terminie 3 września 2026 r. wynosi 16,32 zł na akcję,
    natomiast w ramach wypłaty drugiej transzy w terminie 4 listopada 2026 r. wynosi 32,64 zł na akcję.
  `).filter((event) => event.eventType === "UPCOMING_DIVIDEND");

  assert.deepEqual(
    events.map((event) => [event.dividendPerShare, event.paymentDate, event.dividendInstallment]),
    [[16.32, "2026-09-03", 1], [32.64, "2026-11-04", 2]]
  );
});

test("parses the exact issuer wording used by the Grupa Kęty installment correction", () => {
  const events = parseCorporateEventDocument(`
    W konsekwencji zmianie ulega łączna kwota dywidendy, która przypada do wypłaty na jedną akcję i wynosi obecnie 48,96 zł
    (wobec 48,97 zł według stanu na dzień 18 czerwca 2026 r.) oraz kwota dywidendy do wypłaty na jedną akcję
    w ramach pierwszej transzy ustalonej na dzień 3 września 2026 r., która wynosi obecnie 16,32 zł
    (wobec 16,33 zł według stanu na 18 czerwca 2026 r.). Kwota dywidendy do wypłaty na jedną akcję w ramach wypłaty
    drugiej transzy ustalonej na dzień 4 listopada 2026 r. nie ulega zmianie i wynosi 32,64 zł.
  `).filter((event) => event.eventType === "UPCOMING_DIVIDEND");

  assert.deepEqual(events.map((event) => [event.dividendPerShare, event.paymentDate]), [
    [16.32, "2026-09-03"],
    [32.64, "2026-11-04"],
  ]);
});

test("associates installment dates that appear before each per-share amount", () => {
  const events = parseCorporateEventDocument(`
    Dywidenda za rok 2025: uchwała Zwyczajnego Walnego Zgromadzenia.
    Dzień dywidendy 19 sierpnia 2026 r. Wysokość dywidendy wynosi 48,97 zł na akcję,
    w tym w ramach wypłaty w terminie 3 września 2026 r. wynosi 16,33 zł na akcję,
    natomiast w terminie 4 listopada 2026 r. wynosi 32,64 zł na akcję.
  `).filter((event) => event.eventType === "UPCOMING_DIVIDEND");

  assert.deepEqual(
    events.map((event) => [event.dividendPerShare, event.paymentDate]),
    [[16.33, "2026-09-03"], [32.64, "2026-11-04"]]
  );
});

test("decodes official IR HTML entities and ignores the fiscal year-end as a dividend date", () => {
  const [event] = parseCorporateEventDocument(`
    <h3>Dywidenda 2024&#x2F;2025 (WZA 2026)</h3>
    <p>Walne Zgromadzenie Sp&oacute;łki podjęło uchwałę za rok zakończony 31 grudnia 2025 r.
    i przeznaczyło na wypłatę 4,80 zł na jedną akcję.</p>
    <p>Dzień, według kt&oacute;rego ustala się listę akcjonariuszy uprawnionych do wypłaty
    dywidendy, został ustalony na 17 września 2026 roku.</p>
    <p>Termin wypłaty dywidendy został ustalony na 8 października 2026 roku.</p>
  `).filter((candidate) => candidate.eventType === "UPCOMING_DIVIDEND");

  assert.deepEqual(
    {
      fiscalYear: event.fiscalYear,
      amount: event.dividendPerShare,
      recordDate: event.recordDate,
      paymentDate: event.paymentDate,
    },
    { fiscalYear: 2025, amount: 4.8, recordDate: "2026-09-17", paymentDate: "2026-10-08" }
  );
});

test("parses the official PAP dividend amount when the numeric amount is followed by words", () => {
  const [event] = parseCorporateEventDocument(`
    PZU SA: Decyzja Zwyczajnego Walnego Zgromadzenia PZU SA w sprawie wypłaty dywidendy za 2025 rok.
    Walne Zgromadzenie postanowiło przeznaczyć na wypłatę dywidendy kwotę
    4,80 złotych (słownie: cztery złote 80 groszy) na akcję.
    Dzień, według którego ustala się listę akcjonariuszy uprawnionych do wypłaty dywidendy
    za rok obrotowy zakończony dnia 31 grudnia 2025 r.,
    został ustalony na 17 września 2026 roku. Termin wypłaty dywidendy został ustalony
    na 8 października 2026 roku.
  `).filter((candidate) => candidate.eventType === "UPCOMING_DIVIDEND");

  assert.deepEqual(
    {
      fiscalYear: event.fiscalYear,
      amount: event.dividendPerShare,
      recordDate: event.recordDate,
      paymentDate: event.paymentDate,
      status: event.dividendStatus,
    },
    {
      fiscalYear: 2025,
      amount: 4.8,
      recordDate: "2026-09-17",
      paymentDate: "2026-10-08",
      status: "CONFIRMED",
    }
  );
});

test("keeps a proposal distinct from a confirmed dividend and leaves absent dates undefined", () => {
  const [event] = parseCorporateEventDocument(`
    Propozycja zarządu: dywidenda za rok 2025 w wysokości 0,55 zł na akcję.
    Dzień ustalenia prawa do dywidendy: 10 września 2026 r.
  `).filter((candidate) => candidate.eventType === "UPCOMING_DIVIDEND");

  assert.equal(event.dividendStatus, "PROPOSED");
  assert.equal(event.recordDate, "2026-09-10");
  assert.equal(event.exDividendDate, undefined);
  assert.equal(event.paymentDate, undefined);
});

test("keeps future installments upcoming after their record date and only displays future dates", () => {
  const afterRecordDate = new Date("2026-08-20T12:00:00+02:00");
  const septemberInstallment = {
    eventDate: "2026-08-19",
    recordDate: "2026-08-19",
    paymentDate: "2026-09-03",
  };
  const novemberInstallment = {
    eventDate: "2026-08-19",
    recordDate: "2026-08-19",
    paymentDate: "2026-11-04",
  };

  assert.equal(getUpcomingDividendRelevantDate(septemberInstallment, afterRecordDate), "2026-09-03");
  assert.equal(getUpcomingDividendRelevantDate(novemberInstallment, afterRecordDate), "2026-11-04");
  assert.deepEqual(
    getUpcomingDividendDatesForDisplay(septemberInstallment, afterRecordDate),
    { exDividendDate: undefined, recordDate: undefined, paymentDate: "2026-09-03" }
  );
  assert.equal(
    getUpcomingDividendRelevantDate(
      { ...septemberInstallment, paymentDate: "2026-08-19" },
      afterRecordDate
    ),
    undefined
  );
});

test("corporate-event refresh preserves stored data and delegates posting to the guarded dividend module", async () => {
  const providerSource = await readFile(new URL("../src/lib/server/corporate-events.ts", import.meta.url), "utf8");
  const routeSource = await readFile(new URL("../src/app/api/corporate-events/route.ts", import.meta.url), "utf8");
  const automaticSource = await readFile(new URL("../src/lib/automatic-gpw-dividends.ts", import.meta.url), "utf8");

  assert.match(providerSource, /for \(const result of successful\)[\s\S]*for \(const batch of batches\) \{\s*await upsertParsedEvents/);
  assert.doesNotMatch(providerSource, /buildDividendOperation|operationType:\s*["']DIVIDEND|calculateCashBalances/);
  assert.match(routeSource, /applyAutomaticGpwDividends/);
  assert.match(automaticSource, /event\.status !== "CONFIRMED"/);
  assert.match(automaticSource, /event\.paymentDate > today/);
  assert.match(automaticSource, /automaticDividendEventId/);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  extractPolishDates,
  getCorporateEventIdentityKey,
  getDaysUntilCorporateEvent,
  isCorporateEventSourceUnavailable,
  parseCorporateEventDocument,
} from "../src/lib/corporate-events.ts";
import {
  classifyCorporateEventHttpStatus,
  getGpwCorporateEventCanonicalKey,
  isGpwCorporateEventInstrument,
  PapEspiCorporateEventProvider,
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

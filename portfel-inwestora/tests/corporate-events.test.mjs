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

  assert.match(providerSource, /for \(const result of successful\) \{\s*await upsertParsedEvents/s);
  assert.doesNotMatch(providerSource, /buildDividendOperation|operationType:\s*["']DIVIDEND|calculateCashBalances/);
  assert.match(routeSource, /applyAutomaticGpwDividends/);
  assert.match(automaticSource, /event\.status !== "CONFIRMED"/);
  assert.match(automaticSource, /event\.paymentDate > today/);
  assert.match(automaticSource, /automaticDividendEventId/);
});

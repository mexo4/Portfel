import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import {
  parseGpwOfficialCatalog,
  searchGpwCatalogItems,
} from "../src/lib/server/gpw-catalog.ts";
import { parsePapEspiSearchCandidates } from "../src/lib/server/corporate-events.ts";

const gpwRow = ({ name, isin, ticker, currency = "PLN" }) => `
  <tr>
    <td></td><td></td><td>${name}</td><td>${isin}</td><td>${ticker}</td><td>${currency}</td>
  </tr>
`;

const gpwFixture = [
  gpwRow({ name: "GRUPRACUJ", isin: "PLGRPRC00015", ticker: "GPP" }),
  gpwRow({ name: "ALPHA GRUPA", isin: "PLALPGR00010", ticker: "ALG" }),
  gpwRow({ name: "ECHO", isin: "PLECHPS00019", ticker: "ECH" }),
  gpwRow({ name: "PEPEES", isin: "PLPEPES00018", ticker: "PPS" }),
  gpwRow({ name: "DINO POLSKA", isin: "PLDINPL00011", ticker: "DNP" }),
  gpwRow({ name: "ORLEN", isin: "PLPKN0000018", ticker: "PKN" }),
  gpwRow({ name: "FOREIGN", isin: "US0000000001", ticker: "BAD", currency: "USD" }),
].join("\n");

test("official GPW table yields a complete market-aware searchable catalogue", () => {
  const items = parseGpwOfficialCatalog(gpwFixture);
  assert.equal(items.length, 6);
  assert.deepEqual(items[0], {
    symbol: "GPP.WA",
    name: "GRUPRACUJ",
    isin: "PLGRPRC00015",
  });

  const cases = [
    ["Grupa Pracuj", "GPP.WA"],
    ["GPP", "GPP.WA"],
    ["Echo Investment", "ECH.WA"],
    ["ECH", "ECH.WA"],
    ["Pepees", "PPS.WA"],
    ["PPS", "PPS.WA"],
    ["Dino Polska", "DNP.WA"],
    ["PKN", "PKN.WA"],
  ];

  for (const [query, expectedSymbol] of cases) {
    const [result] = searchGpwCatalogItems(items, query);
    assert.equal(result?.symbol, expectedSymbol, query);
    assert.equal(result?.kind, "stock", query);
    assert.equal(result?.marketCurrency, "PLN", query);
    assert.equal(result?.subtitle, "GPW", query);
    assert.match(result?.isin ?? "", /^PL[A-Z0-9]{10}$/, query);
  }
});

test("PAP discovery list keeps only official ESPI articles and source timestamps", () => {
  const candidates = parsePapEspiSearchCandidates(`
    <div role="article" about="/biznes-i-finanse/grupa-pracuj-sa-zmiana-terminu">
      <span class="field field--name-title">GRUPA PRACUJ SA: Zmiana terminu publikacji raportu okresowego</span>
      <ul><li class="date">17.08.2026, 18:04</li><li class="source"><a>ESPI</a></li></ul>
    </div>
    <div role="article" about="/wiadomosci/komentarz-rynkowy">
      <span class="field field--name-title">Komentarz rynkowy</span>
      <ul><li class="date">18.08.2026, 08:00</li><li class="source"><a>PAP Biznes</a></li></ul>
    </div>
  `);

  assert.deepEqual(candidates, [{
    title: "GRUPA PRACUJ SA: Zmiana terminu publikacji raportu okresowego",
    url: "https://pap-mediaroom.pl/biznes-i-finanse/grupa-pracuj-sa-zmiana-terminu",
    sourcePublishedAt: "2026-08-17T18:04:00.000Z",
  }]);
});

test("real GPW schedule formats parse future H1 and Q3 dates without legal-date false positives", () => {
  const echo = parseCorporateEventDocument(`
    ECHO INVESTMENT S.A. Terminy publikacji raportów okresowych w 2026 roku.
    Raport półroczny za I półrocze 2026 roku - 17 września 2026 roku.
    Raport kwartalny za III kwartał 2026 roku - 26 listopada 2026 roku.
    Emitent nie będzie publikował raportu za II kwartał zgodnie z rozporządzeniem z 6 czerwca 2025 roku.
  `);
  const pepees = parseCorporateEventDocument(`
    Harmonogram publikacji raportów okresowych PEPEES S.A. w 2026 roku.
    Skonsolidowany raport półroczny za I półrocze 2026 r. – 25.09.2026 r.
    Skonsolidowany raport kwartalny za III kwartał 2026 r. – 20-11-2026 r.
  `);

  assert.ok(echo.some((event) => event.eventType === "HALF_YEAR_REPORT" && event.eventDate === "2026-09-17"));
  assert.ok(echo.some((event) => event.eventType === "QUARTERLY_REPORT" && event.eventDate === "2026-11-26"));
  assert.ok(!echo.some((event) => event.eventDate === "2025-06-06"));
  assert.ok(pepees.some((event) => event.eventType === "HALF_YEAR_REPORT" && event.eventDate === "2026-09-25"));
  assert.ok(pepees.some((event) => event.eventType === "QUARTERLY_REPORT" && event.eventDate === "2026-11-20"));
});

test("a Polish 'zmianie terminu' notice keeps one event and replaces the old date", () => {
  const [event] = parseCorporateEventDocument(`
    Informacja o zmianie terminu publikacji raportu okresowego za I półrocze 2026 roku.
    Pierwotny termin publikacji raportu półrocznego: 27 sierpnia 2026 roku.
    Nowy termin publikacji raportu półrocznego: 25 sierpnia 2026 roku.
  `);

  assert.deepEqual(event, {
    eventType: "HALF_YEAR_REPORT",
    eventDate: "2026-08-25",
    previousEventDate: "2026-08-27",
    fiscalPeriod: "H1",
    fiscalYear: 2026,
    isScheduleChange: true,
  });
});

test("an official dividend notice preserves amount, status, record and payment dates", () => {
  const [event] = parseCorporateEventDocument(`
    Zwyczajne Walne Zgromadzenie podjęło uchwałę w sprawie wypłaty dywidendy.
    Wysokość dywidendy przypadająca na jedną akcję wynosi 100,00 zł na akcję.
    Dzień dywidendy ustalono na 7 września 2026 r., a dzień wypłaty dywidendy na 25 września 2026 r.
  `);

  assert.equal(event.eventType, "UPCOMING_DIVIDEND");
  assert.equal(event.dividendPerShare, 100);
  assert.equal(event.dividendStatus, "CONFIRMED");
  assert.equal(event.recordDate, "2026-09-07");
  assert.equal(event.paymentDate, "2026-09-25");
});

test("the production flow is generic and does not add the tested issuers to a manual registry", async () => {
  const source = await readFile(new URL("../src/lib/server/corporate-events.ts", import.meta.url), "utf8");
  const marketDataSource = await readFile(new URL("../src/lib/server/market-data.ts", import.meta.url), "utf8");
  const defaultProviders = source.slice(source.indexOf("const defaultProviders"), source.indexOf("const refreshInFlight"));

  assert.match(defaultProviders, /PapEspiDiscoveryCorporateEventProvider\("report-change"\)/);
  assert.match(defaultProviders, /PapEspiDiscoveryCorporateEventProvider\("report-schedule"\)/);
  assert.match(defaultProviders, /PapEspiDiscoveryCorporateEventProvider\("dividend"\)/);
  assert.doesNotMatch(source.slice(source.indexOf("GPW_ISSUER_SOURCE_REGISTRY"), source.indexOf("const sourcePriority")), /\bGPP\b|\bECH\b|\bPPS\b/);
  assert.match(marketDataSource, /const catalogResults = await searchGpwCatalog\(query\)/);
});

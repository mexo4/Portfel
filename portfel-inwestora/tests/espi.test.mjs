import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  classifyEspiCategory,
  classifyEspiReportType,
  parsePapEspiList,
  parsePapEspiReport,
} from "../src/lib/espi.ts";
import {
  buildTrackedGpwInstruments,
  classifyEspiHttpStatus,
  validateEspiFeedFilters,
} from "../src/lib/server/espi.ts";

const candidate = {
  sourceId: "pap:607780",
  sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/testowy-raport",
  sourceTitle: "TESTOWA SA (16/2026) Informacja o transakcji na akcjach Spółki",
  sourcePublishedAt: "2026-08-22T13:25:00.000Z",
};

const articleFixture = ({
  sourceTitle = candidate.sourceTitle,
  lead = "Raport bieżący nr 16 / 2026",
  body = "Podstawa prawna: Art. 19 ust. 3 Rozporządzenia MAR<br>Informacja o transakcji osoby pełniącej obowiązki zarządcze.",
  issuerTag = "TESTOWA SA-PLTEST000001-TST",
  reportTag = "16/2026",
  attachments = `
    <a href="/sites/default/files/attachments/607780/test.pdf" download>
      <div class="textWrapper">Powiadomienie – załącznik.pdf</div>
      <span>application/pdf, 111,04 KB</span>
    </a>
  `,
} = {}) => `
  <article role="article">
    <div class="field field--name-title">${sourceTitle}</div>
    <div class="date">22.08.2026, 15:25<span>ESPI</span></div>
    <div class="field field--name-field-lead">${lead}</div>
    <div property="schema:text" class="field field--name-body"><p>${body}</p>
      <ul class="tags">
        <li><a href="/tag/${issuerTag}">${issuerTag}</a></li>
        <li><a href="/tag/${reportTag}">${reportTag}</a></li>
      </ul>
    </div>
    ${attachments}
    <div id="source-of-information">ESPI</div>
  </article>
`;

test("PAP list parser keeps the stable source node, canonical URL and exact Warsaw publication time", () => {
  const parsed = parsePapEspiList(`
    <div role="article" about="/biznes-i-finanse/testowy-raport">
      <span class="field field--name-title">TESTOWA SA (16/2026) Ważny raport</span>
      <ul><li class="source"><a href="/zrodlo/ESPI">ESPI</a></li><li class="date">22.08.2026, 15:25</li></ul>
      <a href="/node/607780#downloadMaterialBlock">Pobierz</a>
    </div>
    <a rel="next" href="?page=1">Następna</a>
  `);

  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].sourceId, "pap:607780");
  assert.equal(parsed.candidates[0].sourceUrl, candidate.sourceUrl);
  assert.equal(parsed.candidates[0].sourcePublishedAt, "2026-08-22T13:25:00.000Z");
  assert.equal(parsed.hasNextPage, true);
});

test("PAP detail parser reads issuer identity, full body, report metadata and attachment without storing HTML", () => {
  const parsed = parsePapEspiReport(articleFixture(), candidate);
  assert.ok(parsed);
  assert.equal(parsed.issuerName, "TESTOWA SA");
  assert.equal(parsed.sourceTicker, "TST");
  assert.equal(parsed.sourceIsin, "PLTEST000001");
  assert.equal(parsed.reportNumber, "16/2026");
  assert.equal(parsed.reportType, "CURRENT");
  assert.equal(parsed.category, "INSIDER_TRANSACTIONS");
  assert.equal(parsed.publishedAt, "2026-08-22T13:25:00.000Z");
  assert.match(parsed.body, /Informacja o transakcji/);
  assert.doesNotMatch(parsed.body, /<p>|<br>/);
  assert.deepEqual(parsed.attachments, [{
    name: "Powiadomienie – załącznik.pdf",
    mediaType: "application/pdf",
    sizeLabel: "111,04 KB",
    sourceUrl: "https://pap-mediaroom.pl/sites/default/files/attachments/607780/test.pdf",
  }]);
});

test("periodic report classification wins over incidental dividend words in its body", () => {
  const title = "SEKO SA Raport okresowy półroczny za 2026 SA-P";
  const reportType = classifyEspiReportType(title);
  assert.equal(reportType, "PERIODIC_HALF_YEAR");
  assert.equal(classifyEspiCategory({
    title,
    body: "Sprawozdanie zawiera także informację o wypłaconej dywidendzie.",
    reportType,
  }), "FINANCIAL_RESULTS");
});

test("deterministic ESPI categories cover high-confidence Polish report patterns and preserve OTHER", () => {
  const cases = [
    ["Uchwała w sprawie wypłaty dywidendy", "DIVIDEND"],
    ["Informacja o zawarciu istotnej umowy", "CONTRACTS"],
    ["Powołanie Członka Rady Nadzorczej", "MANAGEMENT_BOARD"],
    ["Zawiadomienie w trybie art. 69 - zmiana udziału w głosach", "SHAREHOLDING"],
    ["Zwołanie Nadzwyczajnego Walnego Zgromadzenia", "GENERAL_MEETING"],
    ["Rejestracja podwyższenia kapitału zakładowego", "ISSUANCE_AND_SHARES"],
    ["Powiadomienie o transakcji osoby pełniącej obowiązki zarządcze", "INSIDER_TRANSACTIONS"],
    ["Publikacja prognozy wyników na 2027 rok", "FORECASTS"],
    ["Informacja organizacyjna", "OTHER"],
  ];
  for (const [title, expected] of cases) {
    assert.equal(classifyEspiCategory({ title }), expected, title);
  }
});

test("a formal correction remains a separate source report and points to its original number", () => {
  const correctionCandidate = {
    ...candidate,
    sourceId: "pap:607781",
    sourceTitle: "TESTOWA SA (17/2026) Korekta raportu bieżącego nr 16/2026",
  };
  const parsed = parsePapEspiReport(articleFixture({
    sourceTitle: correctionCandidate.sourceTitle,
    lead: "Raport bieżący nr 17 / 2026",
    body: "Korekta raportu bieżącego nr 16/2026. Poprawiono treść załącznika.",
    reportTag: "17/2026",
    attachments: "",
  }), correctionCandidate);
  assert.ok(parsed);
  assert.equal(parsed.sourceId, "pap:607781");
  assert.equal(parsed.reportNumber, "17/2026");
  assert.equal(parsed.isCorrection, true);
  assert.equal(parsed.correctionTargetReportNumber, "16/2026");
});

test("list parsing deduplicates repeated source records by the stable PAP node id", () => {
  const article = `
    <div role="article" about="/biznes-i-finanse/testowy-raport">
      <span class="field field--name-title">TESTOWA SA (16/2026) Raport</span>
      <li class="source"><a href="/zrodlo/ESPI">ESPI</a></li>
      <li class="date">22.08.2026, 15:25</li>
      <a href="/node/607780#downloadMaterialBlock">Pobierz</a>
    </div>`;
  assert.equal(parsePapEspiList(`${article}${article}`).candidates.length, 1);
});

test("My companies universe uses open GPW holdings plus watchlist and deduplicates both sources", () => {
  const now = "2026-08-20T10:00:00.000Z";
  const asset = (id, symbol, name, quantity = 1, marketCurrency = "PLN") => ({
    id, symbol, name, quantity, marketCurrency, kind: "stock", provider: "stooq",
    purchaseDate: "2026-01-02", purchasePrice: 100, purchaseCurrency: marketCurrency,
    feePln: 0, createdAt: now,
  });
  const portfolio = (id, assets) => ({
    id, name: id, assets, sales: [], realizedAdjustments: [], createdAt: now, updatedAt: now,
  });
  const tracked = buildTrackedGpwInstruments([
    portfolio("one", [asset("dino-lot", "DNP.PL", "Dino Polska", 3), asset("us", "AAPL.US", "Apple", 2, "USD")]),
    portfolio("two", [asset("dino-other", "DNP.WA", "Dino Polska", 2)]),
    portfolio("sold", []),
  ], [
    { id: "watch-dino", symbol: "DNP.PL", name: "Dino Polska", isin: "PLDINPL00011" },
    { id: "watch-cdr", symbol: "CDR.PL", name: "CD Projekt", isin: "PLOPTTC00011" },
  ]);

  assert.equal(tracked.length, 2);
  assert.deepEqual(tracked.map(({ ticker, held, watched }) => ({ ticker, held, watched })), [
    { ticker: "DNP", held: true, watched: true },
    { ticker: "CDR", held: false, watched: true },
  ]);
});

test("source failures and pagination filters are normalized without unbounded limits", () => {
  assert.equal(classifyEspiHttpStatus(403), "ACCESS_DENIED");
  assert.equal(classifyEspiHttpStatus(404), "NOT_FOUND");
  assert.equal(classifyEspiHttpStatus(429), "TEMPORARILY_UNAVAILABLE");
  assert.equal(classifyEspiHttpStatus(502), "TEMPORARILY_UNAVAILABLE");
  const filters = validateEspiFeedFilters(new URLSearchParams("scope=all&limit=not-a-number&category=DIVIDEND&dateFrom=2026-08-01"));
  assert.equal(filters.scope, "all");
  assert.equal(filters.category, "DIVIDEND");
  assert.equal(filters.dateFrom, "2026-08-01");
  assert.equal(filters.limit, 20);
});

test("ESPI is exposed as a Tester market route and an optional, non-default Dashboard 2.0 widget", async () => {
  const [shell, layout, detail, defaultLayout, apiRoute, db] = await Promise.all([
    readFile(new URL("../src/components/AppWorkspaceShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ConfigurableDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/EspiReportDetail.tsx", import.meta.url), "utf8"),
    import("../src/lib/dashboard-layout.ts"),
    readFile(new URL("../src/app/api/espi/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/server/db.ts", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /Raporty ESPI/);
  assert.match(shell, /MEXO_TESTER_MODE/);
  assert.match(layout, /LatestEspiWidget/);
  assert.ok(defaultLayout.DASHBOARD_WIDGET_DEFINITIONS.some((item) => item.id === "latest-espi"));
  assert.equal(defaultLayout.DEFAULT_DASHBOARD_LAYOUT.widgets.some((item) => item.id === "latest-espi"), false);
  assert.match(detail, /correctionTargetReportNumber/);
  assert.match(detail, /correctionOfReportId/);
  assert.match(apiRoute, /after\(async \(\) =>/);
  assert.match(db, /UNIQUE \(source, source_id\)/);
  assert.match(db, /idx_espi_reports_search/);
});

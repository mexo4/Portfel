import assert from "node:assert/strict";
import test from "node:test";

import {
  collectPapCategoryEventBatches,
  collectPapIssuerCandidatePages,
  getCorporateEventAggregateSourceStatus,
} from "../src/lib/server/corporate-events.ts";
import { isCorporateEventSourceUnavailable } from "../src/lib/corporate-events.ts";

const issuer = {
  id: "issuer:test",
  canonical_key: "gpw:ticker:TST",
  ticker: "TST",
  company_name: "Testowa Spółka",
  isin: "PLTEST000001",
  last_checked_at: null,
  last_source_status: null,
};

const listing = (path, title, date = "20.10.2026, 12:00") => `
  <div role="article" about="${path}">
    <span class="field--name-title">${title}</span>
    <ul><li class="date">${date}</li><li class="source"><a>ESPI</a></li></ul>
  </div>`;

const scheduleArticle = (day, month, year = 2026) => `
  <main>ISIN PLTEST000001. Harmonogram publikacji raportów okresowych.
  Raport kwartalny za III kwartał 2026 roku - ${day} ${month} ${year} roku.</main>`;

test("PAP issuer discovery continues after the first schedule and includes later corrections", async () => {
  const pages = new Map([
    ["https://pap-mediaroom.pl/taxonomy/term/123", listing("/schedule-a", "Terminy publikacji raportów okresowych")],
    ["https://pap-mediaroom.pl/taxonomy/term/123?page=1", listing("/correction-a", "Zmiana terminu publikacji raportów okresowych")],
    ["https://pap-mediaroom.pl/taxonomy/term/123?page=2", listing("/schedule-b", "Harmonogram raportów okresowych")],
    ["https://pap-mediaroom.pl/taxonomy/term/123?page=3", "<div class=\"view-empty\">Brak wyników</div>"],
  ]);
  const requested = [];
  const result = await collectPapIssuerCandidatePages("https://pap-mediaroom.pl/taxonomy/term/123", async (url) => {
    requested.push(url);
    return { status: "SUCCESS", document: pages.get(url) ?? "" };
  });

  assert.equal(result.status, "SUCCESS");
  assert.equal(result.incomplete, false);
  assert.equal(result.pagesRead, 4);
  assert.deepEqual(result.candidates.map(({ url }) => new URL(url).pathname), [
    "/schedule-a", "/correction-a", "/schedule-b",
  ]);
  assert.equal(requested.length, 4);
});

test("PAP issuer discovery reports a repeated page or request cap as incomplete", async () => {
  const samePage = listing("/schedule-a", "Harmonogram raportów okresowych");
  const repeated = await collectPapIssuerCandidatePages("https://pap-mediaroom.pl/taxonomy/term/123",
    async () => ({ status: "SUCCESS", document: samePage }));
  assert.equal(repeated.incomplete, true);
  assert.equal(repeated.candidates.length, 1);
  assert.equal(repeated.pagesRead, 2);

  const capped = await collectPapIssuerCandidatePages("https://pap-mediaroom.pl/taxonomy/term/123",
    async (url) => ({ status: "SUCCESS", document: listing(`/${new URL(url).search || "zero"}`, "Harmonogram raportów okresowych") }), 2);
  assert.equal(capped.incomplete, true);
  assert.equal(capped.pagesRead, 2);
});

test("bounded PAP coverage cannot be reported as a successful complete sync", () => {
  assert.equal(getCorporateEventAggregateSourceStatus([
    { status: "SUCCESS", incomplete: true },
    { status: "SUCCESS" },
  ]), "INCOMPLETE");
  assert.equal(getCorporateEventAggregateSourceStatus([
    { status: "NOT_FOUND", incomplete: true },
  ]), "INCOMPLETE");
  assert.equal(getCorporateEventAggregateSourceStatus([
    { status: "SUCCESS", incomplete: true, retrySoon: true },
  ]), "TEMPORARILY_UNAVAILABLE");
  assert.equal(getCorporateEventAggregateSourceStatus([
    { status: "SUCCESS" },
  ]), "SUCCESS");
  assert.equal(isCorporateEventSourceUnavailable("INCOMPLETE"), false,
    "a fixed source cap should retain the daily TTL instead of retrying hourly");
});

test("PAP issuer discovery does not mistake a non-ESPI article page for the end", async () => {
  const pages = [
    listing("/commentary", "Komentarz giełdowy").replace("<a>ESPI</a>", "<a>PAP Biznes</a>"),
    listing("/report", "Terminy publikacji raportów okresowych"),
    "<div class=\"view-empty\">Brak wyników</div>",
  ];
  let page = 0;
  const result = await collectPapIssuerCandidatePages("https://pap-mediaroom.pl/taxonomy/term/123",
    async () => ({ status: "SUCCESS", document: pages[page++] }));
  assert.equal(result.incomplete, false);
  assert.equal(result.pagesRead, 3);
  assert.equal(result.candidates.length, 1);
  assert.equal(new URL(result.candidates[0].url).pathname, "/report");
});

test("PAP issuer discovery does not mistake an unrecognized 200 response for end of pagination", async () => {
  const result = await collectPapIssuerCandidatePages("https://pap-mediaroom.pl/taxonomy/term/123",
    async () => ({ status: "SUCCESS", document: "<html><body>Temporary challenge</body></html>" }));
  assert.equal(result.incomplete, true);
  assert.equal(result.candidates.length, 0);
});

test("PAP category search reads beyond four documents and preserves each source", async () => {
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    url: `https://pap-mediaroom.pl/schedule-${index}`,
    title: `Terminy publikacji raportów okresowych ${index}`,
    sourcePublishedAt: `2026-10-${String(index + 10).padStart(2, "0")}T12:00:00.000Z`,
  }));
  const result = await collectPapCategoryEventBatches(candidates, "report-schedule", issuer, async (url) => ({
    status: "SUCCESS",
    document: url.endsWith("-4") ? scheduleArticle(24, "listopada")
      : url.endsWith("-5") ? scheduleArticle(25, "listopada")
        : "<main>ISIN PLTEST000001. Historyczna wzmianka bez terminu raportu.</main>",
  }));

  assert.equal(result.status, "SUCCESS");
  assert.equal(result.documentsRead, 6);
  assert.equal(result.incomplete, false);
  assert.deepEqual(result.batches.map(({ source }) => source.sourceUrl), [candidates[4].url, candidates[5].url]);
  assert.deepEqual(result.events.map(({ eventDate }) => eventDate), ["2026-11-24", "2026-11-25"]);
});

test("PAP category search continues after an unavailable source but reports partial coverage", async () => {
  const candidates = [
    { url: "https://pap-mediaroom.pl/unavailable", title: "Terminy publikacji raportów okresowych", sourcePublishedAt: "2026-10-20T12:00:00.000Z" },
    { url: "https://pap-mediaroom.pl/valid", title: "Terminy publikacji raportów okresowych", sourcePublishedAt: "2026-10-19T12:00:00.000Z" },
  ];
  const result = await collectPapCategoryEventBatches(candidates, "report-schedule", issuer, async (url) =>
    url.endsWith("unavailable")
      ? { status: "TEMPORARILY_UNAVAILABLE", document: "" }
      : { status: "SUCCESS", document: scheduleArticle(24, "listopada") });

  assert.equal(result.status, "SUCCESS");
  assert.equal(result.incomplete, true);
  assert.equal(result.retrySoon, true, "a transient source failure must shorten the next retry even if another document succeeded");
  assert.equal(result.documentsRead, 2);
  assert.equal(result.batches.length, 1);
});

test("PAP batches are applied in publication order even when discovery lists newest first", async () => {
  const candidates = [
    { url: "https://pap-mediaroom.pl/newer", title: "Terminy publikacji raportów okresowych", sourcePublishedAt: "2026-10-21T12:00:00.000Z" },
    { url: "https://pap-mediaroom.pl/older", title: "Terminy publikacji raportów okresowych", sourcePublishedAt: "2026-10-10T12:00:00.000Z" },
  ];
  const result = await collectPapCategoryEventBatches(candidates, "report-schedule", issuer, async (url) => ({
    status: "SUCCESS",
    document: url.endsWith("newer") ? scheduleArticle(25, "listopada") : scheduleArticle(24, "listopada"),
  }));
  assert.deepEqual(result.batches.map(({ source }) => source.sourceUrl), [candidates[1].url, candidates[0].url]);
  assert.deepEqual(result.events.map(({ eventDate }) => eventDate), ["2026-11-24", "2026-11-25"]);
});

test("PAP category search does not infer another issuer or pretend a capped scan is complete", async () => {
  const candidates = [
    { url: "https://pap-mediaroom.pl/foreign", title: "Terminy publikacji raportów okresowych", sourcePublishedAt: "2026-10-20T12:00:00.000Z" },
    { url: "https://pap-mediaroom.pl/owned", title: "Terminy publikacji raportów okresowych", sourcePublishedAt: "2026-10-19T12:00:00.000Z" },
  ];
  const result = await collectPapCategoryEventBatches(candidates, "report-schedule", issuer, async (url) => ({
    status: "SUCCESS", document: url.endsWith("foreign")
      ? scheduleArticle(24, "listopada").replace("PLTEST000001", "PLFOREIGN001")
      : scheduleArticle(25, "listopada"),
  }), 1);

  assert.equal(result.incomplete, true);
  assert.equal(result.retrySoon, false, "a fixed document cap must not trigger an hourly request storm");
  assert.equal(result.batches.length, 0);
  assert.equal(result.status, "NOT_FOUND");
});

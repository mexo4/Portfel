import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getDividendCalendarDisplayStatus,
  parseCorporateEventDocument,
} from "../src/lib/corporate-events.ts";

const dividendEvents = (document) =>
  parseCorporateEventDocument(document).filter((event) => event.eventType === "UPCOMING_DIVIDEND");

test("a management proposal mentioning a future AGM remains proposed", () => {
  const [event] = dividendEvents(`
    Zarząd LPP S.A. rekomenduje wypłatę dywidendy za rok 2025 w wysokości
    900,00 PLN na jedną akcję. Dzień dywidendy proponuje się ustalić na
    9 października 2026 roku, a termin wypłaty na 30 października 2026 roku.
    Ostateczną decyzję w sprawie podziału zysku podejmie Walne Zgromadzenie.
  `);
  assert.ok(event);
  assert.equal(event.dividendStatus, "PROPOSED");
  assert.equal(event.recordDate, "2026-10-09");
  assert.equal(event.paymentDate, "2026-10-30");
});

test("an adopted dividend resolution is confirmed", () => {
  const [event] = dividendEvents(`
    Zwyczajne Walne Zgromadzenie podjęło uchwałę w sprawie podziału zysku
    i wypłaty dywidendy za rok 2025 w wysokości 1,18 PLN na akcję.
    Dzień dywidendy ustalono na 21 sierpnia 2026 roku,
    a dzień wypłaty na 28 sierpnia 2026 roku.
  `);
  assert.ok(event);
  assert.equal(event.dividendStatus, "CONFIRMED");
});

test("official GPW wording with a spelled-out amount keeps the numeric dividend", () => {
  const [event] = dividendEvents(`
    Zwyczajne Walne Zgromadzenie Ailleron S.A. podjęło uchwałę o wypłacie
    dywidendy. Na jedną akcję przeznacza się 0,65 zł (słownie: sześćdziesiąt
    pięć groszy). Dzień dywidendy ustala się na 23 października 2026 roku,
    a termin wypłaty dywidendy na 10 listopada 2026 roku.
  `);
  assert.ok(event);
  assert.equal(event.dividendPerShare, 0.65);
  assert.equal(event.dividendCurrency, "PLN");
  assert.equal(event.recordDate, "2026-10-23");
  assert.equal(event.paymentDate, "2026-11-10");
  assert.equal(event.dividendStatus, "CONFIRMED");
});

test("a confirmed advance payment may keep an unknown record date", () => {
  const [event] = dividendEvents(`
    Zarząd DOM Development S.A. podjął uchwałę o wypłacie zaliczki na poczet
    przewidywanej dywidendy za 2026 rok. Na jedną akcję będzie przypadać kwota
    7,35 zł. Termin wypłaty ustalono na 9 grudnia 2026 roku.
  `);
  assert.ok(event);
  assert.equal(event.dividendPerShare, 7.35);
  assert.equal(event.recordDate, undefined);
  assert.equal(event.paymentDate, "2026-12-09");
  assert.equal(event.dividendStatus, "CONFIRMED");
});

test("calendar status distinguishes a proposal, entitlement passed and payment date passed", () => {
  assert.equal(getDividendCalendarDisplayStatus({ status: "PROPOSED" }, "2026-10-15"), "PROPOSED");
  assert.equal(getDividendCalendarDisplayStatus({
    status: "CONFIRMED",
    recordDate: "2026-10-09",
    paymentDate: "2026-10-30",
  }, "2026-10-15"), "AWAITING_PAYMENT");
  assert.equal(getDividendCalendarDisplayStatus({
    status: "CONFIRMED",
    recordDate: "2026-09-01",
    paymentDate: "2026-10-14",
  }, "2026-10-15"), "PAYMENT_DATE_PASSED");
});

test("global dividend ingestion is separate from WZA projection and resilient", async () => {
  const [schema, source, projection, route] = await Promise.all([
    readFile(new URL("../src/lib/server/db.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/server/espi.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/server/corporate-events.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/dividend-calendar/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /dividend_projection_status/);
  assert.match(schema, /idx_espi_reports_dividend_projection_queue/);
  assert.match(source, /GPW_DIVIDEND_SOURCE = "GPW_DIVIDENDS"/);
  assert.match(source, /synchronizeGpwDividendReports/);
  assert.match(source, /parseGpwEspiList/);
  assert.match(source, /parseGpwEspiReport/);
  assert.match(projection, /synchronizeGlobalDividends/);
  assert.match(projection, /DIVIDEND_PROJECTION_BATCH_SIZE = 100/);
  assert.match(projection, /for \(const report of reports\)/);
  assert.match(projection, /getGlobalDividends/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /getUserTrackedGpwInstruments/);
  assert.match(route, /Cache-Control.*private, no-store/);
});

test("Wydarzenia GPW exposes a searchable and sortable dividend category", async () => {
  const [workspace, panel, styles] = await Promise.all([
    readFile(new URL("../src/components/GpwEventsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DividendCalendarPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /Kalendarz dywidend/);
  assert.match(panel, /Spółka lub ticker/);
  assert.match(panel, /type="date"/);
  assert.match(panel, /Dzień dywidendy · najbliższe/);
  assert.match(panel, /Wypłata · najbliższa/);
  assert.match(panel, /Kwota nieogłoszona/);
  assert.match(panel, /Nie ogłoszono/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.dividend-calendar-row/);
});

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

test("parses official entitlement wording used by Ailleron, Ambra, DOM Development and IMS", () => {
  const fixtures = [
    {
      body: `Rada Nadzorcza wyraziła zgodę na wypłatę zaliczki na poczet dywidendy za 2026 rok
        w wysokości 0,65 PLN na akcję. Dniem ustalenia uprawnionych do zaliczki będzie
        3 listopada 2026 roku, a wypłata nastąpi 10 listopada 2026 roku.`,
      amount: 0.65, record: "2026-11-03", payment: "2026-11-10",
    },
    {
      body: `Zwyczajne Walne Zgromadzenie podjęło uchwałę o wypłacie dywidendy za 2025 rok
        w wysokości 1,10 PLN na jedną akcję. Dzień ustalenia praw do dywidendy ustalono na
        28 października 2026 roku, a dzień wypłaty na 10 listopada 2026 roku.`,
      amount: 1.1, record: "2026-10-28", payment: "2026-11-10",
    },
    {
      body: `Rada Nadzorcza udzieliła zgody na wypłatę zaliczki na poczet przewidywanej
        dywidendy za 2026 rok w wysokości 7,35 zł na akcję. Dzień, według którego ustalać
        się będzie uprawnionych do zaliczki, wyznaczono na 2 grudnia 2026 roku,
        a termin wypłaty na 9 grudnia 2026 roku.`,
      amount: 7.35, record: "2026-12-02", payment: "2026-12-09",
    },
    {
      body: `Rada Nadzorcza Spółki wyraziła zgodę na wypłatę zaliczki na poczet dywidendy
        za 2026 rok. Na jedną akcję będzie przypadać kwota 0,18 zł. Dzień, według stanu
        na który ustala się uprawnionych do Zaliczki wyznaczono na 1 grudnia 2026 roku,
        natomiast jako dzień wypłaty Zaliczki ustalono dzień 3 grudnia 2026 roku.`,
      amount: 0.18, record: "2026-12-01", payment: "2026-12-03",
    },
  ];

  for (const fixture of fixtures) {
    const [event] = dividendEvents(fixture.body);
    assert.ok(event);
    assert.equal(event.dividendPerShare, fixture.amount);
    assert.equal(event.recordDate, fixture.record);
    assert.equal(event.paymentDate, fixture.payment);
    assert.equal(event.dividendStatus, "CONFIRMED");
  }
});

test("does not promote a conditional Votum advance to confirmed", () => {
  const [event] = dividendEvents(`
    Zarząd VOTUM S.A. podjął uchwałę w sprawie zamiaru wypłaty zaliczki na poczet
    przewidywanej dywidendy za rok 2026 w wysokości 2,50 PLN na akcję. Warunkiem
    wypłaty jest uzyskanie zgody Rady Nadzorczej. Zarząd rekomenduje dzień
    21 października 2026 roku jako dzień ustalenia uprawnionych do zaliczki,
    a dzień wypłaty na 28 października 2026 roku.
  `);
  assert.ok(event);
  assert.equal(event.dividendStatus, "PROPOSED");
  assert.equal(event.recordDate, "2026-10-21");
  assert.equal(event.paymentDate, "2026-10-28");
});

test("parses final Ailleron and Votum supervisory-board approvals from official wording", () => {
  const fixtures = [
    {
      label: "Ailleron",
      body: `Rada Nadzorcza Spółki wyraziła zgodę na wypłatę akcjonariuszom Spółki zaliczki
        na poczet przewidywanej dywidendy za rok obrotowy 2026. Kwota zaliczki wyniesie
        0,65 zł _słownie:
        sześćdziesiąt pięć groszy_ na jedną akcję. Dniem ustalenia uprawnionych do otrzymania zaliczki na
        poczet przewidywanej dywidendy za rok obrotowy 2026 będzie 3 listopada 2026 r.,
        natomiast termin wypłaty zaliczki został wyznaczony na 10 listopada 2026 r.`,
      amount: 0.65,
      record: "2026-11-03",
      payment: "2026-11-10",
    },
    {
      label: "Votum",
      body: `Rada Nadzorcza Spółki postanowiła wyrazić zgodę na wypłatę akcjonariuszom
        zaliczki na poczet dywidendy za 2026 rok. Na jedną akcję będzie przypadać kwota
        2,50 zł. Dniem, według którego ustala się uprawnionych do zaliczki będzie dzień
        21 października 2026 r., a dniem wypłaty zaliczki będzie dzień 28 października
        2026 r.`,
      amount: 2.5,
      record: "2026-10-21",
      payment: "2026-10-28",
    },
  ];

  for (const fixture of fixtures) {
    const [event] = dividendEvents(fixture.body);
    assert.ok(event, fixture.label);
    assert.equal(event.dividendPerShare, fixture.amount, fixture.label);
    assert.equal(event.recordDate, fixture.record, fixture.label);
    assert.equal(event.paymentDate, fixture.payment, fixture.label);
    assert.equal(event.dividendStatus, "CONFIRMED", fixture.label);
  }
});

test("parses verified GPW control cases without ticker-specific rules", () => {
  const cases = [
    {
      label: "BoomBit",
      body: `Rada Nadzorcza wyraziła zgodę na wypłatę zaliczki na poczet przewidywanej
        dywidendy za rok 2026. Kwota zaliczki przypadająca na 1 akcję Spółki wyniesie
        0,24 zł. Dzień ustalenia akcjonariuszy uprawnionych do zaliczki: 29 października
        2026 r., dzień wypłaty zaliczki: 5 listopada 2026 r.`,
      expected: [{ amount: 0.24, record: "2026-10-29", payment: "2026-11-05" }],
    },
    {
      label: "Instal Kraków",
      body: `Zwyczajne Walne Zgromadzenie podjęło uchwałę w sprawie podziału zysku netto
        Spółki za 2025 rok. Postanowiło przeznaczyć część zysku w kwocie 18.213.750 zł,
        co stanowi 2,50 zł na każdą akcję, na wypłatę dywidendy akcjonariuszom Spółki.
        Ustaliło dzień prawa do dywidendy na 24 sierpnia 2026 roku, a dzień wypłaty
        dywidendy na 6 listopada 2026 roku.`,
      expected: [{ amount: 2.5, record: "2026-08-24", payment: "2026-11-06" }],
    },
    {
      label: "Voxel",
      body: `Zwyczajne Walne Zgromadzenie Emitenta podjęło uchwałę o wypłacie dywidendy
        z zysku netto za rok 2025. Na jedną akcję Emitenta przypada 2,50 zł.
        Zwyczajne Walne Zgromadzenie określiło dzień dywidendy na dzień 30 września
        2026 roku oraz termin wypłaty dywidendy na dzień 4 grudnia 2026 roku.`,
      expected: [{ amount: 2.5, record: "2026-09-30", payment: "2026-12-04" }],
    },
    {
      label: "ECB",
      body: `Zwyczajne Walne Zgromadzenie podjęło uchwałę o wypłacie dywidendy za 2025 rok
        w kwocie 0,80 PLN na akcję. Dzień dywidendy ustalono na 26 sierpnia 2026 r.,
        a termin wypłaty dywidendy na 25 listopada 2026 r.`,
      expected: [{ amount: 0.8, record: "2026-08-26", payment: "2026-11-25" }],
    },
  ];

  for (const fixture of cases) {
    const events = dividendEvents(fixture.body);
    assert.equal(events.length, fixture.expected.length, fixture.label);
    assert.deepEqual(events.map((event) => ({
      amount: event.dividendPerShare,
      record: event.recordDate,
      payment: event.paymentDate,
    })), fixture.expected, fixture.label);
  }
});

test("keeps both official GK IMMOBILE installments", () => {
  const events = dividendEvents(`
    Zgodnie z podjętą przez Zwyczajne Walne Zgromadzenie uchwałą w sprawie przeznaczenia
    zysku za 2025r. postanowiono przeznaczyć część zysku na wypłatę dywidendy w kwocie
    9.797.181,16 zł tj. 0,13 zł na akcję. Dniem nabycia prawa do dywidendy jest dzień
    14.09.2026r. Ustalono terminy wypłaty przez Spółkę dywidendy w 2 ratach w dniach:
    - 27.10.2026r. - wypłata 4.521.775,92 zł tj. 0,06 zł na jedną akcję;
    - 26.11.2026r. - wypłata 5.275.405,24 zł tj. 0,07 zł na jedną akcję.
  `);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => ({
    amount: event.dividendPerShare,
    installment: event.dividendInstallment,
    payment: event.paymentDate,
  })), [
    { amount: 0.06, installment: 1, payment: "2026-10-27" },
    { amount: 0.07, installment: 2, payment: "2026-11-26" },
  ]);
});

test("marks a formal dividend cancellation and a payment-date change", () => {
  const [cancelled] = dividendEvents(`
    Emitent informuje o odwołaniu wypłaty dywidendy w wysokości 1,00 PLN na akcję,
    której dzień dywidendy ustalono na 2 listopada 2026 roku.
  `);
  assert.ok(cancelled);
  assert.equal(cancelled.isCancellation, true);

  const [changed] = dividendEvents(`
    Zwyczajne Walne Zgromadzenie podjęło uchwałę o zmianie terminu wypłaty dywidendy
    w wysokości 1,00 PLN na akcję. Dzień dywidendy pozostaje 2 listopada 2026 roku,
    a nowy termin wypłaty dywidendy ustalono na 18 listopada 2026 roku.
  `);
  assert.ok(changed);
  assert.equal(changed.isScheduleChange, true);
  assert.equal(changed.paymentDate, "2026-11-18");
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
  assert.match(schema, /confirms_record_date/);
  assert.match(schema, /confirms_payment_date/);
  assert.match(source, /GPW_DIVIDEND_SOURCE = "GPW_DIVIDENDS"/);
  assert.match(source, /synchronizeGpwDividendReports/);
  assert.match(source, /parseGpwEspiList/);
  assert.match(source, /parseGpwEspiReport/);
  assert.match(source, /GPW_DIVIDEND_BACKFILL_DAYS_PER_SYNC/);
  assert.match(source, /fetchGpwList\(\{ offset, date: toGpwDate\(isoDate\) \}\)/);
  assert.match(source, /nextBackfillDay = Math\.max\(GPW_DIVIDEND_RECENT_DAYS/);
  assert.match(source, /Preserve every plausible official report/);
  assert.match(projection, /synchronizeGlobalDividends/);
  assert.match(projection, /DIVIDEND_PROJECTION_VERSION = 5/);
  assert.match(projection, /getDividendProjectionDiagnostics/);
  assert.match(projection, /sourceTitle: report\.source_title \|\| report\.title/);
  assert.match(projection, /DIVIDEND_PROJECTION_BATCH_SIZE = 100/);
  assert.match(projection, /for \(const report of reports\)/);
  assert.match(projection, /getGlobalDividends/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /getUserTrackedGpwInstruments/);
  assert.match(route, /sourceBackfillComplete: initialState\.backfillComplete/);
  assert.match(route, /projectionPending: diagnostics\.pending/);
  assert.match(route, /Cache-Control.*private, no-store/);
});

test("the dividend audit is read-only unless an operator passes an explicit write flag", async () => {
  const [audit, packageJson] = await Promise.all([
    readFile(new URL("../scripts/validate-gpw-dividends-official.mjs", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(audit, /process\.argv\.includes\("--refresh-source"\)/);
  assert.match(audit, /process\.argv\.includes\("--reprocess"\)/);
  assert.match(audit, /mode: refreshSource \|\| reprocess \? "explicit-write" : "read-only"/);
  assert.match(audit, /missingRecordDate/);
  assert.match(packageJson, /audit:gpw-dividends/);
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

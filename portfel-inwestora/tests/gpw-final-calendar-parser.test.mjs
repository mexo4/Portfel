import assert from "node:assert/strict";
import test from "node:test";
import { getCorporateEventIdentityKey, parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { planReportScheduleReprojection } from "../src/lib/report-schedule-reprojection.ts";

const reportEvents = (document) => parseCorporateEventDocument(document).filter((event) =>
  ["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT"].includes(event.eventType)
);

test("official ORLEN, Herkules and Urteste correction formats update one stable Q3 identity", () => {
  const examples = [
    {
      source: "Raport bieżący nr 35/2026. Zmiana terminu publikacji raportu okresowego za 3 kwartał 2026 roku z 19 listopada 2026 roku na 5 listopada 2026 roku.",
      date: "2026-11-05",
      previous: "2026-11-19",
    },
    {
      source: "Raport bieżący nr 49/2026. Zmiana terminu publikacji raportu kwartalnego za III kwartał 2026 roku. Dotychczasowy raport miał być opublikowany 19 listopada 2026 roku. Nowym terminem publikacji raportu kwartalnego za III kwartał 2026 roku jest 26 listopada 2026 roku.",
      date: "2026-11-26",
      previous: "2026-11-19",
    },
    {
      source: "Zmiana terminu publikacji raportu okresowego za III kwartał 2026 r. Dotychczasowy termin publikacji raportu za III kwartał 2026 r. został określony na dzień 27 listopada 2026 r. Nowy termin publikacji raportu za III kwartał 2026 r. został wyznaczony na dzień 30 listopada 2026 r.",
      date: "2026-11-30",
      previous: "2026-11-27",
    },
  ];

  for (const example of examples) {
    const [event] = reportEvents(example.source);
    assert.equal(event?.eventType, "QUARTERLY_REPORT");
    assert.equal(event?.fiscalPeriod, "Q3");
    assert.equal(event?.fiscalYear, 2026);
    assert.equal(event?.eventDate, example.date);
    assert.equal(event?.previousEventDate, example.previous);
    assert.equal(getCorporateEventIdentityKey(event), "QUARTERLY_REPORT:Q3:2026");
  }
});

test("real GPW correction wording and wrapped Eko Export rows retain the correct report identity", () => {
  const actualNotice = [
    "Zmiana terminu publikacji raportu okresowego Herkules S.A. Raport bieżący nr 49/2026. Zgodnie z treścią raportu bieżącego nr 1/2026 rozszerzony skonsolidowany raport kwartalny Emitenta za III kwartał 2026 roku miał być przekazany",
    "do publicznej wiadomości w dniu 19 listopada 2026 roku.",
    "Nowym terminem publikacji rozszerzonego skonsolidowanego raportu kwartalnego Spółki za III kwartał 2026 roku jest 26 listopada 2026 roku.",
  ].join("\n");
  const [herkules] = reportEvents(actualNotice);
  assert.equal(herkules?.eventDate, "2026-11-26");
  assert.equal(herkules?.previousEventDate, "2026-11-19");
  assert.equal(herkules?.fiscalPeriod, "Q3");

  const eko = [
    "Zmiana terminu przekazania raportów okresowych.",
    "Publikacja jednostkowego i skonsolidowanego sprawozdania finansowego za I półrocze 2024 roku wyznaczona na dzień 11 września 2026 r. zostaje przesunięta na dzień 6 listopada",
    "2026 r.",
    "Publikacja skonsolidowanego sprawozdania finansowego za III kwartał 2024 roku wyznaczona na dzień",
    "25 września 2026 r. zostaje przesunięta na dzień 20 listopada 2026 r.",
    "Publikacja jednostkowego i skonsolidowanego sprawozdania finansowego za 2024 rok wyznaczona na dzień 30 października 2026 r. zostaje przesunięta na dzień 30 grudnia 2026 r.",
    "Publikacja skonsolidowanego sprawozdania finansowego za I kwartał 2025 roku wyznaczona na dzień",
    "13 listopada 2026 r. zostaje przesunięta na dzień 22 stycznia 2027 r.",
    "Publikacja jednostkowego i skonsolidowanego sprawozdania finansowego za I półrocze 2025 roku wyznaczona na dzień 4 grudnia 2026 r. zostaje przesunięta na dzień 26 lutego 2027 r.",
    "Publikacja skonsolidowanego sprawozdania finansowego za III kwartał 2025 roku wyznaczona na dzień 18 grudnia 2026 r. zostaje przesunięta na dzień 12 marca 2027 r.",
    "Publikacja jednostkowego i skonsolidowanego sprawozdania finansowego za 2025 rok wyznaczona na dzień 22 stycznia 2027 r. zostaje przesunięta na dzień 9 kwietnia 2027 r.",
    "Publikacja skonsolidowanego sprawozdania finansowego za I kwartał 2026 roku wyznaczona na dzień 5 lutego 2027 r. zostaje przesunięta na dzień 23 kwietnia 2027 r.",
    "Publikacja jednostkowego i skonsolidowanego sprawozdania finansowego za I półrocze 2026 roku wyznaczona na dzień 5 marca 2027 r. zostaje przesunięta na dzień 21 maja",
    "2027 r.",
    "Publikacja skonsolidowanego sprawozdania finansowego za III kwartał 2026 roku wyznaczona na dzień 19 marca 2027 r. zostaje przesunięta na dzień 4 czerwca 2027 r.",
  ].join("\n");
  assert.deepEqual(reportEvents(eko).map(({ eventType, fiscalPeriod, fiscalYear, eventDate }) =>
    [eventType, fiscalPeriod, fiscalYear, eventDate]), [
    ["HALF_YEAR_REPORT", "H1", 2024, "2026-11-06"],
    ["QUARTERLY_REPORT", "Q3", 2024, "2026-11-20"],
    ["ANNUAL_REPORT", "FY", 2024, "2026-12-30"],
    ["QUARTERLY_REPORT", "Q1", 2025, "2027-01-22"],
    ["HALF_YEAR_REPORT", "H1", 2025, "2027-02-26"],
    ["QUARTERLY_REPORT", "Q3", 2025, "2027-03-12"],
    ["ANNUAL_REPORT", "FY", 2025, "2027-04-09"],
    ["QUARTERLY_REPORT", "Q1", 2026, "2027-04-23"],
    ["HALF_YEAR_REPORT", "H1", 2026, "2027-05-21"],
    ["QUARTERLY_REPORT", "Q3", 2026, "2027-06-04"],
  ]);
});

test("one Eko Export correction notice parses every explicit rescheduled report independently", () => {
  const source = [
    "Raport bieżący: zmiana terminu przekazania raportów okresowych.",
    "Publikacja jednostkowego i skonsolidowanego sprawozdania finansowego za 2024 rok wyznaczona na dzień 30 października 2026 r. zostaje przesunięta na dzień 30 grudnia 2026 r.",
    "Publikacja skonsolidowanego sprawozdania finansowego za I kwartał 2026 roku wyznaczona na dzień 5 lutego 2027 r. zostaje przesunięta na dzień 23 kwietnia 2027 r.",
    "Publikacja jednostkowego i skonsolidowanego sprawozdania finansowego za I półrocze 2026 wyznaczona na dzień 5 marca 2027 r. zostaje przesunięta na dzień 21 maja 2027 r.",
    "Publikacja skonsolidowanego sprawozdania finansowego za III kwartał 2026 roku wyznaczona na dzień 19 marca 2027 r. zostaje przesunięta na dzień 4 czerwca 2027 r.",
  ].join("\n");

  assert.deepEqual(reportEvents(source).map(({ eventType, fiscalPeriod, fiscalYear, eventDate, previousEventDate }) =>
    [eventType, fiscalPeriod, fiscalYear, eventDate, previousEventDate]), [
    ["ANNUAL_REPORT", "FY", 2024, "2026-12-30", "2026-10-30"],
    ["QUARTERLY_REPORT", "Q1", 2026, "2027-04-23", "2027-02-05"],
    ["HALF_YEAR_REPORT", "H1", 2026, "2027-05-21", "2027-03-05"],
    ["QUARTERLY_REPORT", "Q3", 2026, "2027-06-04", "2027-03-19"],
  ]);
});

test("FON and IFCapital non-calendar fiscal-year schedules identify first three and nine months", () => {
  const source = [
    "Harmonogram przekazywania raportów okresowych w roku obrotowym 2026/2027.",
    "Jednostkowy raport za pierwsze 3 miesiące roku obrotowego 2026-2027 publikacja nastąpi",
    "w dniu 27.11.2026 r.",
    "Jednostkowy raport za pierwsze półrocze roku obrotowego 2026-2027 publikacja nastąpi",
    "w dniu 19.02.2027 r.",
    "Jednostkowy raport za pierwsze 9 miesięcy roku obrotowego 2026-2027 publikacja nastąpi",
    "w dniu 29.04.2027 r.",
    "Jednostkowy raport roczny za rok obrotowy 2026-2027 publikacja nastąpi w dniu 30.09.2027 r.",
  ].join("\n");

  assert.deepEqual(reportEvents(source).map(({ eventType, fiscalPeriod, fiscalYearLabel, eventDate }) =>
    [eventType, fiscalPeriod, fiscalYearLabel, eventDate]), [
    ["QUARTERLY_REPORT", "Q1", "2026/2027", "2026-11-27"],
    ["HALF_YEAR_REPORT", "H1", "2026/2027", "2027-02-19"],
    ["QUARTERLY_REPORT", "Q3", "2026/2027", "2027-04-29"],
    ["ANNUAL_REPORT", "FY", "2026/2027", "2027-09-30"],
  ]);
});

test("official Kęty and Budimex schedules keep the Q1 and Q3 publication dates on their own rows", () => {
  const examples = [
    {
      source: [
        "Zarząd Grupy Kęty S.A. informuje o terminach publikacji raportów okresowych w 2026 roku:",
        "1_ Skonsolidowany raport kwartalny:",
        "- za I kwartał 2026 r. - 22 kwietnia 2026 roku,",
        "- za III kwartał 2026 r. - 26 października 2026 roku,",
        "2_ Skonsolidowany raport półroczny za I półrocze 2026 r. - 29 lipca 2026 roku,",
        "3_ Jednostkowy i skonsolidowany raport roczny za 2025 r. - 26 marca 2026 roku.",
        "Jednocześnie Spółka informuje, że nie będzie publikowała raportu za IV kwartał 2025 roku oraz za II kwartał 2026 roku.",
      ].join("\n"),
      expected: [
        ["Q1", 2026, "2026-04-22"],
        ["Q3", 2026, "2026-10-26"],
      ],
    },
    {
      source: [
        "Terminy przekazywania raportów:",
        "1. Raporty roczne:",
        "- raport roczny Budimex SA za 2025 rok - 27 marca 2026 r.",
        "- skonsolidowany raport roczny Grupy Budimex za 2025 rok - 27 marca 2026 r.",
        "2. Skonsolidowane raporty kwartalne Grupy Budimex:",
        "- za I kwartał 2026 r. - 6 maja 2026 r.",
        "- za III kwartał 2026 r. - 27 października 2026 r.",
        "3. Skonsolidowany raport Grupy Budimex za I półrocze 2026 r. - 21 sierpnia 2026 r.",
      ].join("\n"),
      expected: [
        ["Q1", 2026, "2026-05-06"],
        ["Q3", 2026, "2026-10-27"],
      ],
    },
  ];

  for (const { source, expected } of examples) {
    assert.deepEqual(reportEvents(source)
      .filter((event) => event.fiscalPeriod === "Q1" || event.fiscalPeriod === "Q3")
      .map(({ fiscalPeriod, fiscalYear, eventDate }) => [fiscalPeriod, fiscalYear, eventDate]), expected);
  }
});

test("GreenX annual general meeting date may follow a weekday rather than an explicit 'on date' label", () => {
  const [meeting] = parseCorporateEventDocument(
    "Zarząd GreenX Metals Limited informuje, że Zwyczajne Walne Zgromadzenie Akcjonariuszy (ZWZA) Spółki odbędzie się w środę 11 listopada 2026 r."
  );
  assert.equal(meeting?.eventType, "GENERAL_MEETING");
  assert.equal(meeting?.generalMeetingType, "ZWZ");
  assert.equal(meeting?.eventDate, "2026-11-11");
  assert.equal(meeting?.registrationDate, undefined);
});

test("same-source schedule correction keeps the existing event row identity for in-place date update", () => {
  const [event] = reportEvents(
    "Zmiana terminu publikacji raportu kwartalnego za III kwartał 2026 r. z 19 listopada 2026 r. na 5 listopada 2026 r."
  );
  const plan = planReportScheduleReprojection([
    { id: "existing-event", event_identity: "QUARTERLY_REPORT:Q3:2026", event_date: "2026-11-19", source_urls: ["https://gpw.pl/old-schedule"] },
  ], [event], "https://gpw.pl/changed-schedule", true);

  assert.equal(getCorporateEventIdentityKey(event), "QUARTERLY_REPORT:Q3:2026");
  assert.deepEqual(plan.missingIdentities, []);
  assert.deepEqual(plan.deactivateIds, []);
});

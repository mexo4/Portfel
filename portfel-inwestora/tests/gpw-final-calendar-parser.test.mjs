import assert from "node:assert/strict";
import test from "node:test";
import { getCandidateSegments, getCorporateEventIdentityKey, parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
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

test("official EQUNICO correction preserves Q3 identity and exposes previous and current dates", () => {
  // Official issuer report 69/2026 changes the scheduled publication from
  // 27 November to 16 November 2026; the period itself remains Q3 2026.
  const [event] = reportEvents(`Raport bie\u017c\u0105cy nr 69/2026: Zmiana terminu publikacji raportu okresowego za III kwarta\u0142 2026 roku.
Zgodnie z kalendarzem opublikowanym w raporcie bie\u017c\u0105cym nr 3/2026 publikacja mia\u0142a nast\u0105pi\u0107 27 listopada 2026 roku.
Skonsolidowany raport okresowy za III kwarta\u0142 2026 roku zostanie przekazany do publicznej wiadomo\u015bci w dniu 16 listopada 2026 roku.`);
  assert.deepEqual([event?.fiscalPeriod, event?.fiscalYear, event?.eventDate, event?.previousEventDate],
    ["Q3", 2026, "2026-11-16", "2026-11-27"]);
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

test("official GPW Allegro notice plural 'odbędą się w dniu' creates both announced meetings", () => {
  const source = "https://www.gpw.pl/komunikat?geru_id=498094";
  const notice = [
    "Ogłoszenie o zwołaniu OGM i EGM Allegro.eu.",
    "Rada Dyrektorów informuje akcjonariuszy, że Zwyczajne Walne Zgromadzenie (OGM)",
    "oraz Nadzwyczajne Walne Zgromadzenie (EGM) odbędą się w dniu 18 listopada 2026 roku.",
    "OGM o godzinie 14:00 CEST; EGM o godzinie 14:30 CEST.",
    "Dzień ustalenia prawa do uczestnictwa przypada 4 listopada 2026 roku.",
  ].join(" ");

  const actual = parseCorporateEventDocument(notice)
    .filter((event) => event.eventType === "GENERAL_MEETING")
    .map(({ generalMeetingType, eventDate, eventTime, eventIdentity }) =>
      [generalMeetingType, eventDate, eventTime, eventIdentity]);
  assert.deepEqual(actual, [
    ["ZWZ", "2026-11-18", "14:00 CEST (strefa źródłowa niejednoznaczna)", "general-meeting:ZWZ:2026-11-18"],
    ["NWZ", "2026-11-18", "14:30 CEST (strefa źródłowa niejednoznaczna)", "general-meeting:NWZ:2026-11-18"],
  ], source);
});

test("same-source schedule correction keeps the existing event row identity for in-place date update", () => {
  const [event] = reportEvents(
    "Zmiana terminu publikacji raportu kwartalnego za III kwartał 2026 r. z 19 listopada 2026 r. na 5 listopada 2026 r."
  );
  const plan = planReportScheduleReprojection([
    { id: "existing-event", event_type: "QUARTERLY_REPORT", event_identity: "QUARTERLY_REPORT:Q3:2026", event_date: "2026-11-19", source_urls: ["https://gpw.pl/old-schedule"] },
  ], [event], "https://gpw.pl/changed-schedule", true);

  assert.equal(getCorporateEventIdentityKey(event), "QUARTERLY_REPORT:Q3:2026");
  assert.deepEqual(plan.missingIdentities, []);
  assert.deepEqual(plan.deactivateIds, []);
});

// Independently verified against the issuers' current investor-relations
// schedules on 2026-10-24. Keep source URLs beside the compact excerpts so a
// future parser change can be rechecked against issuer evidence.
test("Orange, Alior and Pekao official schedules bind Q3 dates to Q3, not H1", () => {
  const officialSchedules = [
    {
      issuer: "Orange Polska",
      source: "https://www.orange-ir.pl/pl/rb-2-2026-daty-publikacji-raportow-okresowych-za-2026-rok/",
      text: [
        "Rozszerzone skonsolidowane raporty kwartalne:",
        "– za I kwartał 2026 r. – w dniu 22.04.2026 r.",
        "– za III kwartał 2026 r. – w dniu 26.10.2026 r.",
        "Skonsolidowany rozszerzony raport półroczny – za I półrocze 2026 r. – w dniu 27.07.2026 r.",
      ].join("\n"),
      expected: [
        ["Q1", 2026, "2026-04-22"],
        ["H1", 2026, "2026-07-27"],
        ["Q3", 2026, "2026-10-26"],
      ],
    },
    {
      issuer: "Alior Bank",
      source: "https://www.aliorbank.pl/dam/jcr:877c68a8-f5f2-4a5b-95d1-a4a91cfc085b/Raport_biezacy_42_2025.pdf",
      text: [
        "Daty przekazywania raportów okresowych w 2026 roku:",
        "28 kwietnia 2026 r. – skonsolidowany raport kwartalny za I kwartał 2026 r.",
        "4 sierpnia 2026 r. – skonsolidowany raport półroczny za I półrocze 2026 r.",
        "27 października 2026 r. – skonsolidowany raport kwartalny za III kwartał 2026 r.",
      ].join("\n"),
      expected: [
        ["Q1", 2026, "2026-04-28"],
        ["H1", 2026, "2026-08-04"],
        ["Q3", 2026, "2026-10-27"],
      ],
    },
    {
      issuer: "Bank Pekao",
      source: "https://www.pekao.com.pl/relacje-inwestorskie/raporty-i-sprawozdania/raporty/4e5cd393-acbe-4250-82f7-c8c8e097d33e/",
      text: [
        "Bank ogłasza daty przekazywania raportów okresowych w 2026 roku:",
        "Skonsolidowany raport kwartalny Grupy Kapitałowej Banku za I kwartał 2026 roku – w dniu 30 kwietnia 2026 roku.",
        "Skonsolidowany raport półroczny Grupy Kapitałowej Banku za I półrocze 2026 roku – w dniu 30 lipca 2026 roku.",
        "Skonsolidowany raport kwartalny Grupy Kapitałowej Banku za III kwartał 2026 roku – w dniu 29 października 2026 roku.",
      ].join("\n"),
      expected: [
        ["Q1", 2026, "2026-04-30"],
        ["H1", 2026, "2026-07-30"],
        ["Q3", 2026, "2026-10-29"],
      ],
    },
  ];

  for (const { issuer, source, text, expected } of officialSchedules) {
    const actual = reportEvents(text).map(({ fiscalPeriod, fiscalYear, eventDate }) =>
      [fiscalPeriod, fiscalYear, eventDate]);
    assert.deepEqual(actual, expected, `${issuer}: ${source}; segments=${JSON.stringify(getCandidateSegments(text))}`);
  }
});

test("a dashed standalone publication-date continuation is joined to the annual report row", () => {
  // Source: Orange Polska ESPI report 2/2026; the annual-report publication
  // appointment is a separate indented line beginning with "- w dniu".
  const source = [
    "Raport roczny za 2026 r.",
    "- w dniu 05.03.2027 r.",
    "Skonsolidowany raport roczny za 2026 r.",
    "- w dniu 05.03.2027 r.",
  ].join("\n");
  const reports = reportEvents(source);
  assert.equal(reports.length, 1, "same-period standalone and consolidated rows on one date merge to one calendar event");
  assert.deepEqual([reports[0]?.eventType, reports[0]?.fiscalPeriod, reports[0]?.fiscalYear, reports[0]?.eventDate],
    ["ANNUAL_REPORT", "FY", 2026, "2027-03-05"]);
  assert.equal(reports[0]?.reportScope, "CONSOLIDATED");
});

test("GreenX PAP official non-calendar fiscal schedule preserves report quarter, year-end and publication date", () => {
  // Compact transcription of PAP MediaRoom report 22/2026, cross-checked
  // against the issuer's attached periodic-information notice. The financial
  // year runs from 1 July 2026 through 30 June 2027.
  // Source: https://pap-mediaroom.pl/biznes-i-finanse/greenx-metals-ltd-222026-harmonogram-publikacji-raportow-okresowych-greenx-za-rok
  const source = [
    "GREENX METALS LTD. (22/2026) Harmonogram publikacji raportów okresowych GreenX za rok obrotowy 2027 (2026/2027)",
    "Harmonogram za rok obrotowy kończący się w 2027 r. (od 1 lipca 2026 do 30 czerwca 2027 r.).",
    "- Raport kwartalny za okres lipiec-wrzesień 2026 r. (pierwszy kwartał) - 30 października 2026 r.",
    "- Raport kwartalny za okres październik-grudzień 2026 r. (drugi kwartał) - 29 stycznia 2027 r.",
    "- Raport półroczny 2026 (za pierwsze półrocze roku obrotowego kończące się 31 grudnia 2026 r.) - 12 marca 2027 r.",
    "- Raport kwartalny za okres styczeń-marzec 2027 r. (trzeci kwartał) - 30 kwietnia 2027 r.",
    "- Raport kwartalny za okres kwiecień-czerwiec 2027 r. (czwarty kwartał) - 30 lipca 2027 r.",
    "- Raport roczny 2027 (za rok obrotowy kończący się 30 czerwca 2027 r.) - 30 września 2027 r.",
  ].join("\n");

  assert.deepEqual(reportEvents(source).map(({ eventType, fiscalPeriod, fiscalYearLabel, eventDate }) =>
    [eventType, fiscalPeriod, fiscalYearLabel, eventDate]), [
    ["QUARTERLY_REPORT", "Q1", "2026/2027", "2026-10-30"],
    ["QUARTERLY_REPORT", "Q2", "2026/2027", "2027-01-29"],
    ["HALF_YEAR_REPORT", "H1", "2026/2027", "2027-03-12"],
    ["QUARTERLY_REPORT", "Q3", "2026/2027", "2027-04-30"],
    ["QUARTERLY_REPORT", "Q4", "2026/2027", "2027-07-30"],
    ["ANNUAL_REPORT", "FY", "2026/2027", "2027-09-30"],
  ]);
});

test("official Syn2Bio October--September year is not evaluated using calendar-quarter end dates", () => {
  // Source: GPW ESPI report 19/2026, 2026-10-15, public issuer report.
  // The issuer calls this financial year 2026 and explicitly says it runs
  // from 1 October 2026 to 30 September 2027. Calendar-quarter labels in
  // parentheses explain the covered months; they do not redefine its fiscal
  // periods or make the future publication dates overdue.
  const source = [
    "Terminy publikacji raportów okresowych w roku obrotowym 2026, trwającym od 1 października 2026 r. do 30 września 2027 r.:",
    "Raport roczny za rok finansowy 2025 - 3 grudnia 2026 r.",
    "Raport kwartalny za I kwartał roku finansowego 2026 (a IV kwartał roku kalendarzowego 2026) - 17 lutego 2027 r.",
    "Raport półroczny za I półrocze roku finansowego 2026 (okres: IV kwartał roku kalendarzowego 2026 i I kwartał roku kalendarzowego 2027) - 30 czerwca 2027 r.",
    "Raport kwartalny za III kwartał roku finansowego 2026 (a II kwartał roku kalendarzowego 2027) - 11 sierpnia 2027 r.",
  ].join("\n");
  const parsed = reportEvents(source).map(({ eventType, fiscalPeriod, fiscalYearLabel, eventDate, requiresReview, reviewReasons }) =>
    ({ eventType, fiscalPeriod, fiscalYearLabel, eventDate, requiresReview, reviewReasons }));

  assert.deepEqual(parsed.map(({ eventType, fiscalPeriod, fiscalYearLabel, eventDate }) =>
    [eventType, fiscalPeriod, fiscalYearLabel, eventDate]), [
    ["ANNUAL_REPORT", "FY", "2025", "2026-12-03"],
    ["QUARTERLY_REPORT", "Q1", "2026", "2027-02-17"],
    ["HALF_YEAR_REPORT", "H1", "2026", "2027-06-30"],
    ["QUARTERLY_REPORT", "Q3", "2026", "2027-08-11"],
  ]);
  assert.equal(parsed[0]?.requiresReview, true, "the explicitly older FY2025 publication remains reviewable as overdue");
  assert.equal(parsed[1]?.requiresReview, undefined);
  assert.equal(parsed[2]?.requiresReview, undefined);
  assert.equal(parsed[3]?.requiresReview, undefined);
});

test("an explicit calendar-quarter equivalence supplies a safe report-period end for fiscal Q4", () => {
  // Source: GPW ESPI report 48/2026 by Synektik S.A., 2026-10-15.
  // The previous fiscal Q4 is explicitly equated with calendar Q3 2026;
  // its Nov 18 publication date is therefore not a year-late report.
  const source = [
    "Terminy publikacji raportów okresowych Spółki w roku obrotowym 2026, trwającym od 1 października 2026 r. do 30 września 2027 r.:",
    "skonsolidowany raport kwartalny za IV kwartał roku finansowego 2025 (a III kwartał roku kalendarzowego 2026) - 18 listopada 2026 r.",
    "jednostkowy raport roczny za rok finansowy 2025 - 22 grudnia 2026 r.",
    "skonsolidowany raport kwartalny za I kwartał roku finansowego 2026 (a IV kwartał roku kalendarzowego 2026) - 24 lutego 2027 r.",
    "skonsolidowany raport półroczny za I półrocze roku finansowego 2026 (okres: IV kwartał roku kalendarzowego 2026 i I kwartał roku kalendarzowego 2027) - 23 czerwca 2027 r.",
  ].join("\n");
  const parsed = reportEvents(source);
  const q4 = parsed.find((event) => event.fiscalPeriod === "Q4");
  const q1 = parsed.find((event) => event.fiscalPeriod === "Q1");
  const h1 = parsed.find((event) => event.fiscalPeriod === "H1");
  const annual = parsed.find((event) => event.eventType === "ANNUAL_REPORT");
  assert.deepEqual([q4?.fiscalYearLabel, q4?.eventDate, q4?.periodEnd, q4?.requiresReview],
    ["2025", "2026-11-18", "2026-09-30", undefined]);
  assert.deepEqual([q1?.eventDate, q1?.periodEnd, q1?.requiresReview],
    ["2027-02-24", "2026-12-31", undefined]);
  assert.deepEqual([h1?.eventDate, h1?.periodEnd, h1?.requiresReview],
    ["2027-06-23", "2027-03-31", undefined]);
  assert.equal(annual?.requiresReview, true, "the calendar-year FY2025 still stays flagged as potentially overdue");
});

test("official AB 2026/2027 schedule keeps Q1, Q3, H1 and FY publication dates on their own clauses", () => {
  // Source: GPW ESPI report 25/2026 by AB S.A., 2026-10-21.
  const source = [
    "Terminy przekazywania przez Spółkę raportów okresowych w roku obrotowym 2026/2027.",
    "Raport za I kwartał (01-10-2026 - 31-12-2026) roku obrotowego 2026/2027 zostanie opublikowany w dniu 22-02-2027 r.",
    "Raport za III kwartał (01-04-2027 - 30-06-2027) roku obrotowego 2026/2027 zostanie opublikowany w dniu 23-08-2027 r.",
    "Raport za I półrocze (01-10-2026 - 31-03-2027) roku obrotowego 2026/2027 zostanie opublikowany w dniu 08-06-2027 r.",
    "Raport roczny za rok obrotowy 2026/2027 (01-10-2026 - 30-09-2027) zostanie opublikowany w dniu 07-01-2028 r.",
  ].join("\n");
  assert.deepEqual(reportEvents(source).map(({ eventType, fiscalPeriod, fiscalYearLabel, eventDate, requiresReview }) =>
    [eventType, fiscalPeriod, fiscalYearLabel, eventDate, Boolean(requiresReview)]), [
    ["QUARTERLY_REPORT", "Q1", "2026/2027", "2027-02-22", false],
    ["HALF_YEAR_REPORT", "H1", "2026/2027", "2027-06-08", false],
    ["QUARTERLY_REPORT", "Q3", "2026/2027", "2027-08-23", false],
    ["ANNUAL_REPORT", "FY", "2026/2027", "2028-01-07", false],
  ]);
});

test("Atlanta and HELIO preserve an explicitly prior annual fiscal year from the report row", () => {
  const atlanta = parseCorporateEventDocument(`ATLANTA POLAND SA (4/2026). Spółka informuje o terminach raportów okresowych w bieżącym roku obrotowym 2026/2027, trwającym od 01.07.2026 r. do 30.06.2027 r.:
- raport roczny za rok obrotowy 2025/2026 - 28.10.2026 r.,
- raport kwartalny za I kwartał roku obrotowego 2026/2027 - 30.11.2026 r.,
- raport półroczny za I półrocze roku obrotowego 2026/2027 - 31.03.2027 r.,
- raport kwartalny za III kwartał roku obrotowego 2026/2027 - 31.05.2027 r.`);
  assert.deepEqual(atlanta.map(({ fiscalPeriod, fiscalYearLabel, eventDate }) => [fiscalPeriod, fiscalYearLabel, eventDate]), [
    ["FY", "2025/2026", "2026-10-28"],
    ["Q1", "2026/2027", "2026-11-30"],
    ["H1", "2026/2027", "2027-03-31"],
    ["Q3", "2026/2027", "2027-05-31"],
  ]);

  const helio = parseCorporateEventDocument(`HELIO S.A. przekazuje terminy publikacji raportów w roku obrotowym 2026/2027, trwającym od 01.07.2026 r. do 30.06.2027 r.:
- raport roczny za rok obrotowy 2025/2026 – 30.10.2026 r.,
- raport kwartalny za I kwartał roku obrotowego 2026/2027 – 27.11.2026 r.,
- raport półroczny za półrocze roku obrotowego 2026/2027 – 31.03.2027 r.,
- raport kwartalny za III kwartał roku obrotowego 2026/2027 – 28.05.2027 r.`);
  assert.deepEqual(helio.map(({ fiscalPeriod, fiscalYearLabel, eventDate }) => [fiscalPeriod, fiscalYearLabel, eventDate]), [
    ["FY", "2025/2026", "2026-10-30"],
    ["Q1", "2026/2027", "2026-11-27"],
    ["H1", "2026/2027", "2027-03-31"],
    ["Q3", "2026/2027", "2027-05-28"],
  ]);
});

test("LPP financial-period boundaries are not mistaken for publication appointments", () => {
  const events = parseCorporateEventDocument(`LPP SA informuje o terminach publikacji raportów okresowych w 2026 roku:
Jednostkowy i skonsolidowany raport za 2025: 26 marca 2026 roku.
Skonsolidowany raport za I półrocze 2026: 17 września 2026 roku.
Skonsolidowane raporty kwartalne:
- Rozszerzony skonsolidowany raport za I kwartał 2026: 11 czerwca 2026 roku;
- Rozszerzony skonsolidowany raport za III kwartał 2026: 03 grudnia 2026 roku.
Spółka nie będzie publikować skonsolidowanego raportu kwartalnego za IV kwartał 2025 i II kwartał 2026.
Rok finansowy trwa od 1 lutego 2026 roku do 31 stycznia 2027 roku.
IV kwartał 2026 - od 1 listopada 2026 do 31 stycznia 2027.`);
  assert.equal(events.some((event) => event.eventDate === "2027-01-31"), false);
  assert.ok(events.some((event) => event.fiscalPeriod === "Q3" && event.eventDate === "2026-12-03"));
});

test("single paragraph with distinct report mentions keeps each appointment in its own clause", () => {
  const text = "Raport półroczny za I półrocze 2026 r. opublikowano 30 lipca 2026 r., a raport kwartalny za III kwartał 2026 r. zostanie opublikowany 26 października 2026 r.";
  assert.deepEqual(reportEvents(text).map(({ fiscalPeriod, fiscalYear, eventDate }) =>
    [fiscalPeriod, fiscalYear, eventDate]), [
    ["H1", 2026, "2026-07-30"],
    ["Q3", 2026, "2026-10-26"],
  ]);
});

test("HTML table cell and row boundaries stay local to each report schedule", () => {
  const html = `<table>
    <tr><th>Raport</th><th>Okres</th><th>Termin publikacji</th></tr>
    <tr><td>Skonsolidowany raport kwartalny</td><td>za I kwartał 2026 r.</td><td>22.04.2026 r.</td></tr>
    <tr><td>Skonsolidowany raport kwartalny</td><td>za III kwartał 2026 r.</td><td>26.10.2026 r.</td></tr>
  </table>`;
  assert.deepEqual(reportEvents(html).map(({ fiscalPeriod, fiscalYear, eventDate }) =>
    [fiscalPeriod, fiscalYear, eventDate]), [
    ["Q1", 2026, "2026-04-22"],
    ["Q3", 2026, "2026-10-26"],
  ]);
});

test("calendar-year periods with contradictory or overdue publication years require review", () => {
  const cases = [
    {
      source: "Raport kwartalny za III kwartał 2029 r. zostanie opublikowany 18 listopada 2026 r.",
      reason: "PUBLICATION_YEAR_CONFLICTS_WITH_PERIOD",
    },
    {
      source: "Raport kwartalny za III kwartał 2025 r. zostanie opublikowany 18 listopada 2026 r.",
      reason: "REPORT_PERIOD_MAY_BE_OVERDUE",
    },
  ];
  for (const { source, reason } of cases) {
    const [event] = reportEvents(source);
    assert.equal(event?.requiresReview, true, source);
    assert.ok(event?.reviewReasons?.includes(reason), source);
    if (reason === "PUBLICATION_YEAR_CONFLICTS_WITH_PERIOD") {
      assert.equal(event?.fiscalYearLabel, "2029", "retain the source's literal anomalous year");
      assert.equal(event?.fiscalYear, 2029);
    }
  }
  const [normal] = reportEvents("Raport kwartalny za III kwartał 2026 r. zostanie opublikowany 29 października 2026 r.");
  assert.equal(normal?.requiresReview, undefined);
});

test("invalid calendar dates are rejected rather than normalized into another month", () => {
  assert.deepEqual(extractInvalidDateProbe("Raport kwartalny za III kwartał 2026 r. zostanie opublikowany 31 lutego 2026 r."), []);
});

function extractInvalidDateProbe(text) {
  return reportEvents(text).map(({ eventDate }) => eventDate);
}

test("Allegro official combined OGM/EGM notice produces two independently identified meetings", () => {
  const source = "https://about.allegro.eu/investors/general-meetings/";
  const text = `The Board of Directors of Allegro.eu (the “Company”) hereby informs its shareholders that the Ordinary General Meeting (the “OGM”) and the Extraordinary General Meeting (the “EGM”) will be held on 18 November 2026. The OGM at 2:00 pm CEST; the EGM (held before a Luxembourg notary public) at 2:30 pm CEST. The right to participate is determined on the basis of share ownership on 4 November 2026 at midnight (23:59:59) CEST (“Record Date”).`;
  const actual = parseCorporateEventDocument(text).filter((event) => event.eventType === "GENERAL_MEETING")
    .map(({ generalMeetingType, eventDate, eventTime, registrationDate, eventIdentity, status, requiresReview, reviewReasons }) =>
    [generalMeetingType, eventDate, eventTime, registrationDate, eventIdentity, status, requiresReview, reviewReasons]);
  assert.deepEqual(actual, [
    ["ZWZ", "2026-11-18", "14:00 CEST (strefa źródłowa niejednoznaczna)", "2026-11-04", "general-meeting:ZWZ:2026-11-18", undefined, true, ["MEETING_TIME_ZONE_CONFLICT"]],
    ["NWZ", "2026-11-18", "14:30 CEST (strefa źródłowa niejednoznaczna)", "2026-11-04", "general-meeting:NWZ:2026-11-18", undefined, true, ["MEETING_TIME_ZONE_CONFLICT"]],
  ], source);
});

test("GreenX official report converts its explicit AWST meeting time to Warsaw time", () => {
  const source = "https://pap-mediaroom.pl/biznes-i-finanse/greenx-metals-ltd-232026-zawiadomienie-o-zwolaniu-zwyczajnego-walnego-zgromadzenia";
  const [event] = parseCorporateEventDocument("GREENX METALS LTD. (23/2026) Zawiadomienie o zwołaniu Zwyczajnego Walnego Zgromadzenia Akcjonariuszy. GreenX Metals Limited informuje, że jej Zwyczajne Walne Zgromadzenie Akcjonariuszy odbędzie się w środę 11 listopada 2026 r. o godzinie 10:00 czasu AWST.").filter((candidate) => candidate.eventType === "GENERAL_MEETING");
  assert.deepEqual([event?.generalMeetingType, event?.eventDate, event?.eventTime], ["ZWZ", "2026-11-11", "03:00"], source);
});

test("explicit UTC meeting times convert across a Warsaw calendar-day boundary", () => {
  const [event] = parseCorporateEventDocument("The Ordinary General Meeting will be held on 18 November 2026 at 23:30 UTC.")
    .filter((candidate) => candidate.eventType === "GENERAL_MEETING");
  assert.deepEqual([event?.eventDate, event?.eventTime], ["2026-11-19", "00:30"]);
});

test("recognized IANA time zones use their date-specific offset", () => {
  const [event] = parseCorporateEventDocument("The Ordinary General Meeting will be held on 18 November 2026 at 00:30 Pacific/Kiritimati.")
    .filter((candidate) => candidate.eventType === "GENERAL_MEETING");
  assert.deepEqual([event?.eventDate, event?.eventTime], ["2026-11-17", "11:30"]);
});

test("unknown explicit meeting time zones are not mislabeled as Warsaw local time", () => {
  const [event] = parseCorporateEventDocument("The Ordinary General Meeting will be held on 18 November 2026 at 14:00 XYZ.")
    .filter((candidate) => candidate.eventType === "GENERAL_MEETING");
  assert.deepEqual([event?.eventDate, event?.eventTime], ["2026-11-18", undefined]);
});

test("deterministic property matrix preserves report identity through harmless formatting variants (seed 20261024)", () => {
  let state = 20261024;
  const random = (max) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
  const h1DateFormats = ["30 lipca 2026 r.", "30.07.2026 r.", "30-07-2026"];
  const q3DateFormats = ["26 października 2026 r.", "26.10.2026 r.", "26-10-2026"];
  const separators = ["; ", ". ", " — ", "\n"];
  const spaces = [" ", "  ", "\t"];
  const checks = 1_200;
  for (let index = 0; index < checks; index += 1) {
    const q3Date = q3DateFormats[random(q3DateFormats.length)];
    const h1Date = h1DateFormats[random(h1DateFormats.length)];
    const separator = separators[random(separators.length)];
    const space = spaces[random(spaces.length)];
    const h1 = `Raport${space}półroczny za I półrocze 2026 r. zostanie opublikowany ${h1Date}`;
    const q3 = `Raport${space}kwartalny za III kwartał 2026 r. zostanie opublikowany ${q3Date}`;
    const source = random(2) ? `${h1}${separator}${q3}` : `${q3}${separator}${h1}`;
    const expected = [["H1", "2026-07-30"], ["Q3", "2026-10-26"]];
    const actual = reportEvents(source).map(({ fiscalPeriod, eventDate }) => [fiscalPeriod, eventDate]);
    assert.deepEqual(actual, expected, `seed=20261024 iteration=${index} source=${source}`);
  }
});

test("ambiguous report replacement never deactivates an existing source projection", () => {
  const [ambiguous] = reportEvents("Raport kwartalny za III kwartał 2025 r. zostanie opublikowany 18 listopada 2026 r.");
  const plan = planReportScheduleReprojection([
    { id: "prior-confirmed", event_identity: "QUARTERLY_REPORT:Q3:2025", event_date: "2026-11-18", source_urls: ["https://issuer.example/schedule"] },
  ], [ambiguous], "https://issuer.example/schedule", false);
  assert.deepEqual(plan.deactivateIds, []);
  assert.deepEqual(plan.retainedIds, ["prior-confirmed"]);
});

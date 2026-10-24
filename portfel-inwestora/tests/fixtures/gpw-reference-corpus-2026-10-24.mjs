/**
 * Source-annotated corpus for the GPW event parser.
 * Expected values were transcribed manually from linked PAP/GPW publications,
 * before running this parser. It is deliberately small; it is not a substitute
 * for the requested 100-row independent gold set.
 */
const event = (fields) => fields;

export const gpwReferenceCorpus = [
  {
    id: "DGA-1-2026",
    group: "A-development",
    issuer: "DGA S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/dga-sa-12026-terminy-publikacji-raportow-okresowych-w-2026-roku",
    publishedAt: "2026-01-30T12:15:00+01:00",
    sourceKind: "PAP_ESPI",
    parserInput: `DGA SA (1/2026) Terminy publikacji raportów okresowych w 2026 roku.
      Jednostkowy raport roczny za 2025 rok - 24 kwietnia 2026 r.
      Jednostkowy raport za I kwartał 2026 roku - 29 maja 2026 r.
      Jednostkowy raport za I półrocze 2026 roku - 30 września 2026 r.
      Jednostkowy raport za III kwartał 2026 roku - 27 listopada 2026 r.
      Spółka nie będzie publikowała raportów kwartalnych za IV kwartał 2025 roku oraz II kwartał 2026 roku.`,
    expectedEvents: [
      event({ eventType: "ANNUAL_REPORT", eventDate: "2026-04-24", fiscalPeriod: "FY", fiscalYear: 2025 }),
      event({ eventType: "QUARTERLY_REPORT", eventDate: "2026-05-29", fiscalPeriod: "Q1", fiscalYear: 2026 }),
      event({ eventType: "HALF_YEAR_REPORT", eventDate: "2026-09-30", fiscalPeriod: "H1", fiscalYear: 2026 }),
      event({ eventType: "QUARTERLY_REPORT", eventDate: "2026-11-27", fiscalPeriod: "Q3", fiscalYear: 2026 }),
    ],
    ambiguous: false,
  },
  {
    id: "DGA-16-2026",
    group: "A-development",
    issuer: "DGA S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/dga-sa-162026-zmiana-terminu-publikacji-raportu-za-i-polrocze-2026-r",
    publishedAt: "2026-09-21T17:04:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `DGA SA (16/2026) Zmiana terminu publikacji raportu za I półrocze 2026 r.
      Data określona pierwotnie na dzień 30 września 2026 r. zostaje zmieniona na dzień 24 września 2026 roku.`,
    expectedEvents: [event({
      eventType: "HALF_YEAR_REPORT", eventDate: "2026-09-24", previousEventDate: "2026-09-30",
      fiscalPeriod: "H1", fiscalYear: 2026, isScheduleChange: true,
    })],
    ambiguous: false,
  },
  {
    id: "HERKULES-49-2026",
    group: "A-development",
    issuer: "Herkules S.A. w restrukturyzacji",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/herkules-sa-w-restrukturyzacji-492026-zmiana-terminu-publikacji-raportu-okresowego",
    publishedAt: "2026-10-09T08:17:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `Zmiana terminu publikacji raportu okresowego Herkules S.A. Raport bieżący nr 49/2026. Zgodnie z treścią raportu bieżącego nr 1/2026 rozszerzony skonsolidowany raport kwartalny Emitenta za III kwartał 2026 roku miał być przekazany
      do publicznej wiadomości w dniu 19 listopada 2026 roku.
      Nowym terminem publikacji rozszerzonego skonsolidowanego raportu kwartalnego Spółki za III kwartał 2026 roku jest 26 listopada 2026 roku.`,
    expectedEvents: [event({
      eventType: "QUARTERLY_REPORT", eventDate: "2026-11-26", previousEventDate: "2026-11-19",
      fiscalPeriod: "Q3", fiscalYear: 2026, isScheduleChange: true,
    })],
    ambiguous: false,
    annotation: "PAP gives the previously scheduled Q3 2026 publication date as 19 November and the replacement as 26 November.",
  },
  {
    id: "DGA-15-2026-correction",
    group: "A-development",
    issuer: "DGA S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/dga-sa-152026-rejestracja-zmian-statutu-dga-sa-i-tekst-jednolity-statutu-spolki-0",
    publishedAt: "2026-09-18T16:46:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `DGA SA (15/2026) Rejestracja zmian statutu - korekta. Korekta nie zmienia treści raportu.
      Sąd zarejestrował zmianę statutu podjętą na Zwyczajnym Walnym Zgromadzeniu Akcjonariuszy w dniu 29 czerwca 2026 r.
      Raport dotyczy wpisu KRS i tekstu jednolitego statutu.`,
    expectedEvents: [],
    ambiguous: false,
  },
  {
    id: "MCR-4-2026",
    group: "A-development",
    issuer: "mcr S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/mcr-sa-42026-terminy-publikacji-raportow-okresowych-w-roku-2026",
    publishedAt: "2026-01-14T15:38:00+01:00",
    sourceKind: "PAP_ESPI",
    parserInput: `MCR SA (4/2026) Terminy publikacji raportów okresowych w roku 2026.
      Skonsolidowany raport kwartalny za III kwartał roku obrotowego 2025/2026 obejmujący okres 01.10.2025 do 31.12.2025: 27.02.2026.
      Skonsolidowany raport kwartalny za I kwartał roku obrotowego 2026/2027 obejmujący okres od 01.04.2026 do 30.06.2026: 21.08.2026.
      Skonsolidowany raport półroczny za I półrocze roku obrotowego 2026/2027 obejmujący okres od 01.04.2026 do 30.09.2026: 30.11.2026.
      Jednostkowy raport roczny za rok obrotowy 2025/2026 obejmujący okres od 01.04.2025 do 31.03.2026: 10.07.2026.`,
    expectedEvents: [
      event({ eventType: "QUARTERLY_REPORT", eventDate: "2026-02-27", fiscalPeriod: "Q3", fiscalYear: 2026, fiscalYearLabel: "2025/2026", periodStart: "2025-10-01", periodEnd: "2025-12-31", reportScope: "CONSOLIDATED" }),
      event({ eventType: "QUARTERLY_REPORT", eventDate: "2026-08-21", fiscalPeriod: "Q1", fiscalYear: 2027, fiscalYearLabel: "2026/2027", periodStart: "2026-04-01", periodEnd: "2026-06-30", reportScope: "CONSOLIDATED" }),
      event({ eventType: "HALF_YEAR_REPORT", eventDate: "2026-11-30", fiscalPeriod: "H1", fiscalYear: 2027, fiscalYearLabel: "2026/2027", periodStart: "2026-04-01", periodEnd: "2026-09-30", reportScope: "CONSOLIDATED" }),
      event({ eventType: "ANNUAL_REPORT", eventDate: "2026-07-10", fiscalPeriod: "FY", fiscalYear: 2026, fiscalYearLabel: "2025/2026", periodStart: "2025-04-01", periodEnd: "2026-03-31", reportScope: "UNIT" }),
    ],
    ambiguous: false,
  },
  {
    id: "MCR-27-2026",
    group: "A-development",
    issuer: "mcr S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/mcr-sa-272026-zmiana-terminu-publikacji-skonsolidowanego-raportu-kwartalnego-za",
    publishedAt: "2026-08-17T08:32:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `MCR SA (27/2026) Zmiana terminu publikacji skonsolidowanego raportu kwartalnego
      za pierwszy kwartał roku obrotowego obejmujący okres od 01.04.2026 do 30.06.2026.
      Termin publikacji zostaje przesunięty z dnia 21.08.2026 r. na dzień 20.08.2026 r.`,
    expectedEvents: [event({
      eventType: "QUARTERLY_REPORT", eventDate: "2026-08-20", previousEventDate: "2026-08-21",
      fiscalPeriod: "Q1", periodStart: "2026-04-01", periodEnd: "2026-06-30",
      isScheduleChange: true,
    })],
    ambiguous: true,
  },
  {
    id: "NPL-NOVA-1-2026",
    group: "A-development",
    issuer: "NPL Nova S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/npl-nova-sa-12026-terminy-przekazywania-raportow-okresowych-w-2026-roku",
    publishedAt: "2026-01-30T13:14:00+01:00",
    sourceKind: "PAP_ESPI",
    parserInput: `NPL NOVA SA (1/2026) Terminy przekazywania raportów okresowych w 2026 roku.
      Jednostkowy i skonsolidowany raport roczny za 2025 r. - 2 kwietnia 2026 r.
      Rozszerzony skonsolidowany raport kwartalny za I kwartał 2026 r. - 28 maja 2026 r.
      Rozszerzony skonsolidowany raport za I półrocze 2026 r. - 24 września 2026 r.
      Rozszerzony skonsolidowany raport kwartalny za III kwartał 2026 r. - 26 listopada 2026 r.`,
    expectedEvents: [
      event({ eventType: "ANNUAL_REPORT", eventDate: "2026-04-02", fiscalPeriod: "FY", fiscalYear: 2025 }),
      event({ eventType: "QUARTERLY_REPORT", eventDate: "2026-05-28", fiscalPeriod: "Q1", fiscalYear: 2026, reportScope: "CONSOLIDATED" }),
      event({ eventType: "HALF_YEAR_REPORT", eventDate: "2026-09-24", fiscalPeriod: "H1", fiscalYear: 2026, reportScope: "CONSOLIDATED" }),
      event({ eventType: "QUARTERLY_REPORT", eventDate: "2026-11-26", fiscalPeriod: "Q3", fiscalYear: 2026, reportScope: "CONSOLIDATED" }),
    ],
    ambiguous: false,
  },
  {
    id: "NPL-NOVA-9-2026",
    group: "A-development",
    issuer: "NPL Nova S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/npl-nova-sa-92026-zmiana-terminu-publikacji-raportu-polrocznego-za-i-polrocze-2026",
    publishedAt: "2026-09-21T16:47:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `NPL NOVA SA (9/2026) Zmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku.
      Pierwotny termin raportu był 24 września 2026 roku.
      Zarząd koryguje informacje zawarte w raporcie nr 1/2026 i informuje, że kolejne raporty będą przekazywane w terminach:
      - rozszerzony jednostkowy raport za I półrocze 2026 r. - 30 września 2026 r.
      - rozszerzony jednostkowy raport kwartalny za III kwartał 2026 r. - 26 listopada 2026 r.`,
    expectedEvents: [
      event({ eventType: "HALF_YEAR_REPORT", eventDate: "2026-09-30", fiscalPeriod: "H1", fiscalYear: 2026, reportScope: "UNIT", isScheduleChange: true }),
      event({ eventType: "QUARTERLY_REPORT", eventDate: "2026-11-26", fiscalPeriod: "Q3", fiscalYear: 2026, reportScope: "UNIT", isScheduleChange: true }),
    ],
    ambiguous: false,
  },
  {
    id: "ATREM-16-2026",
    group: "A-development",
    issuer: "ATREM S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/atrem-sa-162026-informacje-na-temat-dywidendy",
    publishedAt: "2026-06-24T17:06:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `Zarząd spółki ATREM S.A. informuje, że Zwyczajne Walne Zgromadzenie w dniu 24.06.2026 r. uchwałą ustaliło 2,16 zł na jedną akcję na wypłatę dywidendy.
      Dniem nabycia prawa do dywidendy jest dzień 10.08.2026 r.
      Terminy wypłaty przez Spółkę dywidendy ustala się w 3 równych ratach w dniach:
      - 18.08.2026 r. - wypłata 6.645.656,88 zł tj. 0,72 zł na jedną akcję;
      - 22.09.2026 r. - wypłata 6.645.656,88 zł tj. 0,72 zł na jedną akcję;
      - 20.10.2026 r. - wypłata 6.645.656,88 zł tj. 0,72 zł na jedną akcję.`,
    expectedEvents: [
      event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-08-10", recordDate: "2026-08-10", paymentDate: "2026-08-18", dividendPerShare: 0.72, dividendTotalPerShare: 2.16, dividendCurrency: "PLN", dividendInstallment: 1, dividendStatus: "CONFIRMED" }),
      event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-08-10", recordDate: "2026-08-10", paymentDate: "2026-09-22", dividendPerShare: 0.72, dividendTotalPerShare: 2.16, dividendCurrency: "PLN", dividendInstallment: 2, dividendStatus: "CONFIRMED" }),
      event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-08-10", recordDate: "2026-08-10", paymentDate: "2026-10-20", dividendPerShare: 0.72, dividendTotalPerShare: 2.16, dividendCurrency: "PLN", dividendInstallment: 3, dividendStatus: "CONFIRMED" }),
    ],
    ambiguous: false,
  },
  {
    id: "PASSUS-23-2026",
    group: "B-validation",
    issuer: "Passus S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/passus-sa-232026-zmiana-rekomendacji-zarzadu-dotyczaca-wyplaty-dywidendy",
    publishedAt: "2026-05-13T10:46:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `Zarząd Passus S.A. podjął uchwałę zmieniającą rekomendację wypłaty dywidendy i będzie rekomendował Walnemu Zgromadzeniu wypłatę 2,50 zł na jedną akcję.
      Zarząd Spółki będzie rekomendował ustalić dzień dywidendy na 25 czerwca 2026 r., a termin wypłaty dywidendy na dzień 2 lipca 2026 r.
      Ostateczną decyzję dotyczącą wypłaty podejmie Zwyczajne Walne Zgromadzenie.`,
    expectedEvents: [event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-06-25", recordDate: "2026-06-25", paymentDate: "2026-07-02", dividendPerShare: 2.5, dividendCurrency: "PLN", dividendStatus: "PROPOSED" })],
    ambiguous: false,
  },
  {
    id: "PASSUS-33-2026",
    group: "B-validation",
    issuer: "Passus S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/passus-sa-332026-podjecie-uchwaly-w-sprawie-wyplaty-dywidendy",
    publishedAt: "2026-06-10T15:23:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `Zarząd Spółki Passus S.A. informuje, że Zwyczajne Walne Zgromadzenie uchwałą postanowiło o wypłacie dywidendy w wysokości 4 035 622,50 zł, tj. 2,50 zł na jedną akcję.
      Dzień dywidendy został ustalony na 25 czerwca 2026 r., natomiast termin wypłaty dywidendy na 2 lipca 2026 roku.`,
    expectedEvents: [event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-06-25", recordDate: "2026-06-25", paymentDate: "2026-07-02", dividendPerShare: 2.5, dividendCurrency: "PLN", dividendStatus: "CONFIRMED" })],
    ambiguous: false,
  },
  {
    id: "KETY-27-2026",
    group: "B-validation",
    issuer: "Grupa Kęty S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/grupa-kety-sa-272026-uchwala-zwyczajnego-walnego-zgromadzenia-grupy-kety-sa-w",
    publishedAt: "2026-06-18T17:42:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `Zwyczajne Walne Zgromadzenie podjęło uchwałę w sprawie wypłaty dywidendy dla akcjonariuszy.
      Jako dzień dywidendy określono dzień 19 sierpnia 2026 r., natomiast termin wypłaty dywidendy ustalony został na 3 września 2026 r. i 4 listopada 2026 r.
      Wysokość dywidendy na akcję licząc według liczby akcji wynosi 48,97 zł na akcję, w tym w ramach wypłaty w terminie 3 września 2026 r. wynosi 16,33 zł na akcję, natomiast w terminie 4 listopada 2026 r. wynosi 32,64 zł na akcję.`,
    expectedEvents: [
      event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-08-19", recordDate: "2026-08-19", paymentDate: "2026-09-03", dividendPerShare: 16.33, dividendTotalPerShare: 48.97, dividendCurrency: "PLN", dividendInstallment: 1, dividendStatus: "CONFIRMED" }),
      event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-08-19", recordDate: "2026-08-19", paymentDate: "2026-11-04", dividendPerShare: 32.64, dividendTotalPerShare: 48.97, dividendCurrency: "PLN", dividendInstallment: 2, dividendStatus: "CONFIRMED" }),
    ],
    ambiguous: false,
  },
  {
    id: "KETY-31-2026",
    group: "B-validation",
    issuer: "Grupa Kęty S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/grupa-kety-sa-312026",
    publishedAt: "2026-07-13T15:50:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `Spółka w nawiązaniu do raportu bieżącego 27/2026 informuje, że w wyniku zmiany liczby akcji kwota dywidendy do wypłaty na jedną akcję wynosi obecnie 48,96 zł.
      Kwota dywidendy do wypłaty na jedną akcję w ramach pierwszej transzy ustalonej na dzień 3 września 2026 r. wynosi obecnie 16,32 zł.
      Kwota dywidendy do wypłaty na jedną akcję w ramach drugiej transzy ustalonej na dzień 4 listopada 2026 r. nie ulega zmianie i wynosi 32,64 zł.`,
    expectedEvents: [
      event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-09-03", paymentDate: "2026-09-03", dividendPerShare: 16.32, dividendTotalPerShare: 48.96, dividendCurrency: "PLN", dividendInstallment: 1, dividendStatus: "UNKNOWN" }),
      event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-11-04", paymentDate: "2026-11-04", dividendPerShare: 32.64, dividendTotalPerShare: 48.96, dividendCurrency: "PLN", dividendInstallment: 2, dividendStatus: "UNKNOWN" }),
    ],
    ambiguous: true,
  },
  {
    id: "GPW-4-2026",
    group: "B-validation",
    issuer: "Giełda Papierów Wartościowych w Warszawie S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/gpw-sa-42026-wniosek-zarzadu-gpw-do-rady-gieldy-o-zaopiniowanie-propozycji-w",
    publishedAt: "2026-04-27T18:34:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `GPW SA (4/2026) Zarząd wystąpił o zaopiniowanie propozycji podziału zysku, w której przewiduje dywidendę 3,40 zł na akcję.
      Dokument nie podaje dnia dywidendy ani terminu wypłaty.`,
    expectedEvents: [],
    ambiguous: true,
  },
  {
    id: "GPW-5-2026",
    group: "B-validation",
    issuer: "Giełda Papierów Wartościowych w Warszawie S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/gpw-sa-52026-opinia-rady-nadzorczej-gpw-dotyczaca-propozycji-zarzadu-gieldy-w",
    publishedAt: "2026-05-13T15:17:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `GPW SA (5/2026) Rada Giełdy pozytywnie zaopiniowała wniosek Zarządu o podział zysku.
      Proponowana dywidenda wynosi 3,40 zł na akcję; raport nie zawiera terminu wypłaty ani dnia dywidendy.`,
    expectedEvents: [],
    ambiguous: true,
  },
  {
    id: "GPW-9-2026",
    group: "B-validation",
    issuer: "Giełda Papierów Wartościowych w Warszawie S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/gpw-sa-92026-uchwala-zwyczajnego-walnego-zgromadzenia-gpw-w-sprawie-wyplaty",
    publishedAt: "2026-06-23T14:03:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `Zarząd Giełdy Papierów Wartościowych w Warszawie S.A. informuje, że Zwyczajne Walne Zgromadzenie GPW podjęło uchwałę w sprawie podziału zysku Spółki za 2025 r.
      Wysokość dywidendy przypadająca na jedną akcję wynosi 3,40 zł. Jednocześnie ZWZ GPW ustaliło dzień dywidendy na 23 lipca 2026 r. oraz dzień wypłaty dywidendy na 6 sierpnia 2026 r.`,
    expectedEvents: [event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-07-23", recordDate: "2026-07-23", paymentDate: "2026-08-06", dividendPerShare: 3.4, dividendCurrency: "PLN", dividendStatus: "CONFIRMED" })],
    ambiguous: false,
  },
  {
    id: "ENEA-47-2026",
    group: "C-holdout",
    issuer: "Enea S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/enea-sa-472026-zwolanie-nadzwyczajnego-walnego-zgromadzenia-enea-sa-na-dzien-16",
    publishedAt: "2026-10-19T13:36:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `ENEA SA (47/2026) Zarząd zwołuje na dzień 16 listopada 2026 roku, na godzinę 12.00 Nadzwyczajne Walne Zgromadzenie Enea S.A. (NWZ).`,
    expectedEvents: [event({ eventType: "GENERAL_MEETING", eventDate: "2026-11-16", generalMeetingType: "NWZ", eventTime: "12:00" })],
    ambiguous: false,
  },
  {
    id: "PEKAO-30-2026",
    group: "C-holdout",
    issuer: "Bank Polska Kasa Opieki S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/bank-pekao-sa-302026-ogloszenie-o-zwolaniu-nadzwyczajnego-walnego-zgromadzenia",
    publishedAt: "2026-10-23T16:52:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `BANK PEKAO SA (30/2026) Zarząd zwołuje Nadzwyczajne Walne Zgromadzenie Banku na dzień 19 listopada 2026 roku na godzinę 10:00.`,
    expectedEvents: [event({ eventType: "GENERAL_MEETING", eventDate: "2026-11-19", generalMeetingType: "NWZ", eventTime: "10:00" })],
    ambiguous: false,
  },
  {
    id: "PKO-BP-32-2026",
    group: "C-holdout",
    issuer: "PKO Bank Polski S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/pko-bp-sa-322026-zwolanie-nadzwyczajnego-walnego-zgromadzenia-pko-banku-polskiego",
    publishedAt: "2026-09-10T19:08:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `Treść raportu: Zarząd PKO Banku Polskiego S.A. ("Bank"), na podstawie art. 399 § 1 Kodeksu spółek handlowych, zwołuje Nadzwyczajne Walne Zgromadzenie Banku na 14 października 2026 r. na godzinę 10.00, w Warszawie w budynku Rotundy przy ul. Marszałkowskiej 100/102.`,
    expectedEvents: [event({ eventType: "GENERAL_MEETING", eventDate: "2026-10-14", generalMeetingType: "NWZ", eventTime: "10:00" })],
    ambiguous: false,
  },
  {
    id: "AGORA-21-2026",
    group: "C-holdout",
    issuer: "Agora S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/agora-sa-212026-zwolanie-nadzwyczajnego-walnego-zgromadzenia-agory-sa-oraz",
    publishedAt: "2026-09-18T16:39:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `AGORA SA (21/2026) Zarząd zwołuje na dzień 15 października 2026 roku, na godzinę 11:00, Nadzwyczajne Walne Zgromadzenie Agory S.A.`,
    expectedEvents: [event({ eventType: "GENERAL_MEETING", eventDate: "2026-10-15", generalMeetingType: "NWZ", eventTime: "11:00" })],
    ambiguous: false,
  },
  {
    id: "PJP-MAKRUM-14-2026",
    group: "C-holdout",
    issuer: "PJP Makrum S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/pjp-makrum-sa-142026-informacje-na-temat-dywidendy",
    publishedAt: "2026-06-25T13:19:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `PJP MAKRUM SA (14/2026) Zwyczajne Walne Zgromadzenie podjęło uchwałę o dywidendzie 0,61 zł na akcję.
      Dniem nabycia prawa jest 18.08.2026 r. Wypłaty w 2 ratach:
      25.09.2026 r. - 0,30 zł na akcję; 23.10.2026 r. - 0,31 zł na akcję.`,
    expectedEvents: [
      event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-08-18", recordDate: "2026-08-18", paymentDate: "2026-09-25", dividendPerShare: 0.3, dividendTotalPerShare: 0.61, dividendCurrency: "PLN", dividendInstallment: 1, dividendStatus: "CONFIRMED" }),
      event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-08-18", recordDate: "2026-08-18", paymentDate: "2026-10-23", dividendPerShare: 0.31, dividendTotalPerShare: 0.61, dividendCurrency: "PLN", dividendInstallment: 2, dividendStatus: "CONFIRMED" }),
    ],
    ambiguous: false,
  },
  {
    id: "GK-IMMOBILE-17-2026",
    group: "C-holdout",
    issuer: "Grupa Kapitałowa IMMOBILE S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/gk-immobile-sa-172026-informacje-na-temat-dywidendy",
    publishedAt: "2026-06-26T20:49:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `Zarząd spółki Grupa Kapitałowa IMMOBILE S.A. informuje, że zgodnie z podjętą przez Zwyczajne Walne Zgromadzenie Spółki w dniu 26.06.2026 r. uchwałą w sprawie przeznaczenia zysku za 2025 r. postanowiono przeznaczyć zysk w części na wypłatę dywidendy, tj. 0,13 zł na akcję. Dniem nabycia prawa do dywidendy jest dzień 14.09.2026 r. Ustalono terminy wypłaty przez Spółkę dywidendy w 2 ratach w dniach: 27.10.2026 r. – wypłata tj. 0,06 zł na jedną akcję; 26.11.2026 r. – wypłata tj. 0,07 zł na jedną akcję.`,
    expectedEvents: [
      event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-09-14", recordDate: "2026-09-14", paymentDate: "2026-10-27", dividendPerShare: 0.06, dividendTotalPerShare: 0.13, dividendCurrency: "PLN", dividendInstallment: 1, dividendStatus: "CONFIRMED" }),
      event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-09-14", recordDate: "2026-09-14", paymentDate: "2026-11-26", dividendPerShare: 0.07, dividendTotalPerShare: 0.13, dividendCurrency: "PLN", dividendInstallment: 2, dividendStatus: "CONFIRMED" }),
    ],
    ambiguous: false,
  },
  {
    id: "GRUPA-PRACUJ-10-2026",
    group: "C-holdout",
    issuer: "Grupa Pracuj S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/grupa-pracuj-sa-102026-podjecie-przez-zwyczajne-walne-zgromadzenie-w-dniu-17",
    publishedAt: "2026-06-17T15:35:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `Zarząd spółki Grupa Pracuj S.A. informuje, że w dniu 17 czerwca 2026 r. Zwyczajne Walne Zgromadzenie Spółki podjęło uchwałę w sprawie wypłaty dywidendy w wysokości 3,00 zł na jedną uprawnioną akcję. Zwyczajne Walne Zgromadzenie wyznaczyło dzień dywidendy na dzień 24 czerwca 2026 r. oraz ustaliło termin wypłaty dywidendy na dzień 2 lipca 2026 r.`,
    expectedEvents: [event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-06-24", recordDate: "2026-06-24", paymentDate: "2026-07-02", dividendPerShare: 3, dividendCurrency: "PLN", dividendStatus: "CONFIRMED" })],
    ambiguous: false,
  },
  {
    id: "VRG-12-2026",
    group: "C-holdout",
    issuer: "VRG S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/vrg-sa-122026-podjecie-przez-zwyczajne-walne-zgromadzenie-vrg-sa-w-dniu-25-czerwca",
    publishedAt: "2026-06-25T13:40:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `Zarząd VRG S.A. informuje, że Zwyczajne Walne Zgromadzenie podjęło uchwałę w sprawie wypłaty dywidendy w kwocie 0,05 zł na jedną akcję. Uprawnionymi do dywidendy będą akcjonariusze Spółki na dzień 19 września 2026 r. (dzień dywidendy). Dniem wypłaty dywidendy będzie 15 grudnia 2026 r.`,
    expectedEvents: [event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-09-19", recordDate: "2026-09-19", paymentDate: "2026-12-15", dividendPerShare: 0.05, dividendCurrency: "PLN", dividendStatus: "CONFIRMED" })],
    ambiguous: false,
  },
  {
    id: "ODLEWNIE-POLSKIE-9-2026",
    group: "C-holdout",
    issuer: "Odlewnie Polskie S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/odlewnie-polskie-sa-92026-podjecie-przez-zwyczajne-walne-zgromadzenie-uchwaly-o",
    publishedAt: "2026-06-23T15:35:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `ODLEWNIE POLSKIE SA (9/2026) Zwyczajne Walne Zgromadzenie podjęło uchwałę o dywidendzie 0,45 zł na akcję.
      Dzień dywidendy - 17 lipca 2026 r.`,
    expectedEvents: [event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-07-17", recordDate: "2026-07-17", dividendPerShare: 0.45, dividendCurrency: "PLN", dividendStatus: "CONFIRMED" })],
    ambiguous: true,
  },
  {
    id: "BENEFIT-32-2026",
    group: "C-holdout",
    issuer: "Benefit Systems S.A.",
    sourceUrl: "https://pap-mediaroom.pl/biznes-i-finanse/benefit-systems-sa-322026-podjecie-przez-zwyczajne-walne-zgromadzenie-w-dniu-10",
    publishedAt: "2026-06-10T14:16:00+02:00",
    sourceKind: "PAP_ESPI",
    parserInput: `BENEFIT SYSTEMS SA (32/2026) Walne Zgromadzenie podjęło uchwałę o dywidendzie 100,00 zł na akcję.
      Dzień dywidendy ustalono na 7 września 2026 r., dzień wypłaty na 25 września 2026 r.`,
    expectedEvents: [event({ eventType: "UPCOMING_DIVIDEND", eventDate: "2026-09-07", recordDate: "2026-09-07", paymentDate: "2026-09-25", dividendPerShare: 100, dividendCurrency: "PLN", dividendStatus: "CONFIRMED" })],
    ambiguous: false,
  },
];

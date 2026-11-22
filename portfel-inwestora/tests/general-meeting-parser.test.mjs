import assert from "node:assert/strict";
import test from "node:test";
import {
  getCorporateEventIdentityKey,
  getCorporateEventLabel,
  parseCorporateEventDocument,
} from "../src/lib/corporate-events.ts";

import { gpwWzaConvocationCues } from "./fixtures/gpw-wza-convocation-cues-2026-11-22.mjs";

const meetings = (document) =>
  parseCorporateEventDocument(document).filter((event) => event.eventType === "GENERAL_MEETING");

test("parses the formal LSI ZWZ date and time without inventing a record date", () => {
  const [event] = meetings(`
    LSI SOFTWARE SA (19/2026) Zwyczajne Walne Zgromadzenie
    Data publikacji: 02.06.2026, 17:57
    Zarząd spółki LSI Software S.A. z siedzibą w Łodzi, na podstawie art. 399 § 1,
    art. 4021 oraz art. 4022 KSH zwołuje na dzień 29 czerwca 2026 roku,
    na godzinę 10:00, Zwyczajne Walne Zgromadzenie.
  `);

  assert.deepEqual(
    {
      eventDate: event?.eventDate,
      eventTime: event?.eventTime,
      meetingType: event?.generalMeetingType,
      action: event?.generalMeetingAction,
      registrationDate: event?.registrationDate,
      label: event ? getCorporateEventLabel(event) : undefined,
    },
    {
      eventDate: "2026-06-29",
      eventTime: "10:00",
      meetingType: "ZWZ",
      action: "CONVENING",
      registrationDate: undefined,
      label: "Zwyczajne Walne Zgromadzenie",
    }
  );
});

test("prefers Triton's official NWZ registration date when the date precedes its label", () => {
  const [event] = meetings(`
    TRITON DEVELOPMENT SA (6/2026) Ogłoszenie o zwołaniu Nadzwyczajnego Walnego Zgromadzenia
    Data publikacji: 27.08.2026, 14:59
    Zarząd Triton Development S.A. zwołuje Nadzwyczajne Walne Zgromadzenie.
    Nadzwyczajne Walne Zgromadzenie Triton Development S.A. odbędzie się w dniu
    24 września 2026 roku o godzinie 10.00 w Warszawie.
    Dzień 8 września 2026 roku jest dniem rejestracji uczestnictwa w NWZ
    (Dzień Rejestracji).
  `);

  assert.deepEqual(
    {
      eventDate: event?.eventDate,
      eventTime: event?.eventTime,
      meetingType: event?.generalMeetingType,
      registrationDate: event?.registrationDate,
    },
    {
      eventDate: "2026-09-24",
      eventTime: "10:00",
      meetingType: "NWZ",
      registrationDate: "2026-09-08",
    }
  );
});

test("extracts the exact LC reschedule dates despite earlier report-publication dates", () => {
  const [event] = meetings(`
    LC SA (5/2026) Informacja o zmianie terminu, na który zwołano Zwyczajne Walne Zgromadzenie LC S.A.
    Data publikacji: 21.05.2026, 11:30
    Zarząd spółki LC S.A., w nawiązaniu do raportów bieżących nr 3/2026 z dnia
    7 maja 2026 r. i nr 4/2026 z dnia 7 maja 2026 r., informuje, że z przyczyn
    organizacyjnych podjął decyzję o zmianie terminu Zwyczajnego Walnego Zgromadzenia
    Spółki (dalej "ZWZ") z dnia 3 czerwca 2026 r. na dzień 19 czerwca 2026 r.
    Zarząd odwołuje ZWZ zwołane pierwotnie na dzień 3 czerwca 2026 r. i jednocześnie
    zwołuje Zwyczajne Walne Zgromadzenie na dzień 19 czerwca 2026 r. na godz. 11:00.
  `);

  assert.deepEqual(
    {
      oldDate: event?.previousEventDate,
      newDate: event?.eventDate,
      eventTime: event?.eventTime,
      meetingType: event?.generalMeetingType,
      action: event?.generalMeetingAction,
      changed: event?.isScheduleChange,
      identity: event ? getCorporateEventIdentityKey(event) : undefined,
    },
    {
      oldDate: "2026-06-03",
      newDate: "2026-06-19",
      eventTime: "11:00",
      meetingType: "ZWZ",
      action: "RESCHEDULE",
      changed: true,
      identity: "general-meeting:ZWZ:2026-06-03",
    }
  );
});

// Creotech Instruments 58/2026 (ESPI, 4 November 2026), text as stored. Its agenda moves part of the business to a
// subsidiary ("przeniesienie do spółki zależnej"); that word is not a reschedule of the meeting. The notice was lost
// (NO_EVENT) because the reschedule cue took it for one.
const CREOTECH_58_2026 = `CREOTECH INSTRUMENTS SPÓŁKA AKCYJNA (58/2026) Ogłoszenie o zwołaniu Nadzwyczajnego Walnego Zgromadzenia Creotech Instruments S.A. na dzień 1 grudnia 2026 r.
Temat

Ogłoszenie o zwołaniu Nadzwyczajnego Walnego Zgromadzenia Creotech Instruments S.A.
na dzień 1 grudnia 2026 r.

Podstawa prawna

Art. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe

Treść raportu:

Zarząd spółki pod firmą Creotech Instruments S.A. z siedzibą w Piasecznie _"Spółka"_,
niniejszym informuje o zwołaniu Nadzwyczajnego Walnego Zgromadzenia Spółki na dzień
1 grudnia 2026 r., na godzinę 12:00 w lokalu w Warszawie _02-823_ przy ul. Osmańskiej
14, bud. Berlin, p. II, zgodnie z treścią ogłoszenia stanowiącego załącznik do niniejszego
raportu bieżącego.
Porządek obrad Nadzwyczajnego Walnego Zgromadzenia Spółki obejmuje:
1. Otwarcie obrad Nadzwyczajnego Walnego Zgromadzenia.
2. Wybór Przewodniczącego Nadzwyczajnego Walnego Zgromadzenia.
3. Stwierdzenie prawidłowości zwołania Nadzwyczajnego Walnego Zgromadzenia i jego
zdolności do podejmowania uchwał.
4. Przyjęcie porządku obrad Nadzwyczajnego Walnego Zgromadzenia.
5. Podjęcie uchwały w sprawie wyrażenia zgody na przeniesienie do spółki zależnej
zorganizowanej części przedsiębiorstwa Spółki przeznaczonej do prowadzenia działalności
w obszarze aplikacji satelitarnych i dronowych.
6. Podjęcie uchwał w sprawie zmian statutu Spółki.
7. Zamknięcie obrad Nadzwyczajnego Walnego Zgromadzenia.`;

test("a convocation whose agenda says 'przeniesienie' of assets or the seat is still a convocation (Creotech)", () => {
  const found = meetings(CREOTECH_58_2026);
  assert.deepEqual(found.map((event) => ({
    date: event.eventDate, time: event.eventTime, type: event.generalMeetingType, action: event.generalMeetingAction,
    changed: event.isScheduleChange,
  })), [{ date: "2026-12-01", time: "12:00", type: "NWZ", action: "CONVENING", changed: false }]);

  const [split] = meetings(`CREOTECH INSTRUMENTS SPÓŁKA AKCYJNA (10/2026) Ogłoszenie o zwołaniu Nadzwyczajnego Walnego Zgromadzenia
Zarząd spółki informuje o zwołaniu Nadzwyczajnego Walnego Zgromadzenia Spółki na dzień 5 marca 2026 r., na godzinę 11:00.
Porządek obrad Nadzwyczajnego Walnego Zgromadzenia:
4. Przyjęcie porządku obrad Nadzwyczajnego Walnego Zgromadzenia.
5. Podjęcie uchwały w sprawie podziału Spółki poprzez przeniesienie części majątku Spółki na spółkę przejmującą.`);
  assert.deepEqual([split?.eventDate, split?.generalMeetingAction], ["2026-03-05", "CONVENING"]);

  const [seat] = meetings(`ACME SA (3/2026) Zwołanie Zwyczajnego Walnego Zgromadzenia
Zarząd ACME S.A. zwołuje Zwyczajne Walne Zgromadzenie na dzień 18 czerwca 2026 r. na godzinę 10:00.
Porządek obrad: 1. Otwarcie obrad Zwyczajnego Walnego Zgromadzenia. 2. Podjęcie uchwały w sprawie przeniesienia siedziby Spółki.`);
  assert.deepEqual([seat?.eventDate, seat?.generalMeetingAction], ["2026-06-18", "CONVENING"]);
});

test("an announced move of the meeting itself ('przeniesienie terminu', 'zostało przeniesione na dzień') is still a reschedule", () => {
  const [moved] = meetings(`ACME SA (7/2026) Informacja o przeniesieniu terminu Nadzwyczajnego Walnego Zgromadzenia
Zarząd ACME S.A. informuje o przeniesieniu terminu Nadzwyczajnego Walnego Zgromadzenia z dnia 1 grudnia 2026 r. na dzień 15 grudnia 2026 r.`);
  assert.deepEqual([moved?.generalMeetingAction, moved?.previousEventDate, moved?.eventDate], ["RESCHEDULE", "2026-12-01", "2026-12-15"]);

  const [participle] = meetings(`ACME SA (8/2026) Zmiana terminu walnego zgromadzenia
Nadzwyczajne Walne Zgromadzenie ACME S.A. zwołane na dzień 1 grudnia 2026 r. zostało przeniesione z dnia 1 grudnia 2026 r. na dzień 15 grudnia 2026 r.`);
  assert.deepEqual([participle?.generalMeetingAction, participle?.previousEventDate, participle?.eventDate], ["RESCHEDULE", "2026-12-01", "2026-12-15"]);
});

// Real convocations (stored ESPI text) that were dropped with NO_EVENT: the date follows "odbędzie się" directly, or the
// verb is the infinitive "postanawia zwołać na dzień ...". The expected dates and times are those printed in the notices.
test("convocations that state the date after 'odbędzie się' or with the infinitive 'zwołać' are recognised", () => {
  const found = (key) => {
    const notice = gpwWzaConvocationCues[key];
    return meetings(`${notice.sourceTitle}\n${notice.title}\n${notice.text}`)
      .map((event) => [event.eventDate, event.eventTime, event.generalMeetingType, event.generalMeetingAction]);
  };
  assert.deepEqual(found("votum485695"), [["2026-05-12", "12:00", "ZWZ", "CONVENING"]]);
  assert.deepEqual(found("larq490787"), [["2026-06-30", "10:00", "ZWZ", "CONVENING"]]);
  assert.deepEqual(found("diagnostyka487390"), [["2026-05-25", "14:00", "ZWZ", "CONVENING"]]);
  assert.deepEqual(found("mangataNwz481829"), [["2026-03-12", "10:00", "NWZ", "CONVENING"]]);
  assert.deepEqual(found("mangataZwz487741").map(([date, , type]) => [date, type]), [["2026-05-28", "ZWZ"]]);
  assert.deepEqual(found("compremum490267").map(([date, , type]) => [date, type]), [["2026-06-26", "ZWZ"]]);
});

test("'odbędzie się' without a convening notice, and a date that only mentions the past, still create no meeting", () => {
  assert.deepEqual(meetings(`ACME SA (9/2026) Treść uchwał podjętych przez Zwyczajne Walne Zgromadzenie
Zwyczajne Walne Zgromadzenie ACME S.A., które odbyło się 12 maja 2026 roku, podjęło uchwały w sprawie podziału zysku.`), []);
  assert.deepEqual(meetings(`ACME SA (10/2026) Projekty uchwał na Zwyczajne Walne Zgromadzenie
Zarząd przekazuje projekty uchwał na Zwyczajne Walne Zgromadzenie, które odbędzie się 12 maja 2026 roku.`), []);
});

test("parses the Elektrotim cancellation and targets the originally convened NWZ", () => {
  const [event] = meetings(`
    ELEKTROTIM SA (1/2026) Odwołanie Nadzwyczajnego Walnego Zgromadzenia
    ELEKTROTIM S.A. z dnia 13.01.2026 r.
    Data publikacji: 08.01.2026, 08:32
    ELEKTROTIM S.A., w nawiązaniu do raportu bieżącego nr 47/2025 z dnia
    15 grudnia 2025 r., w którym zwołał Nadzwyczajne Walne Zgromadzenie Spółki
    na dzień 13 stycznia 2026 r., niniejszym informuje o odwołaniu tego Zgromadzenia.
  `);

  assert.deepEqual(
    {
      eventDate: event?.eventDate,
      meetingType: event?.generalMeetingType,
      action: event?.generalMeetingAction,
      cancellation: event?.isCancellation,
      identity: event ? getCorporateEventIdentityKey(event) : undefined,
    },
    {
      eventDate: "2026-01-13",
      meetingType: "NWZ",
      action: "CANCELLATION",
      cancellation: true,
      identity: "general-meeting:NWZ:2026-01-13",
    }
  );
});

test("does not manufacture meetings from follow-up WZA reports", () => {
  const falseNotices = [
    "Projekty uchwał na NWZ zwołane na dzień 13 marca 2026 roku.",
    "Zgłoszenie projektu uchwały dotyczącej ZWZ zwołanego na dzień 18 czerwca 2026 r.",
    "Uzupełnienie porządku obrad Nadzwyczajnego Walnego Zgromadzenia zwołanego na 24 września 2026 r.",
    "Zmiana porządku obrad ZWZ zwołanego na dzień 29 czerwca 2026 r.",
    "Treść uchwał podjętych przez Zwyczajne Walne Zgromadzenie w dniu 19 czerwca 2026 r.",
    "Wyniki głosowania Nadzwyczajnego Walnego Zgromadzenia z dnia 24 września 2026 r.",
    "Wykaz akcjonariuszy posiadających co najmniej 5% głosów na ZWZ w dniu 29 czerwca 2026 r.",
    "Lista akcjonariuszy uprawnionych do udziału w NWZ zwołanym na 24 września 2026 r.",
  ];

  for (const notice of falseNotices) {
    assert.deepEqual(meetings(notice), [], notice);
  }
});

test("uses occurrence-specific identities for multiple NWZ meetings in one year", () => {
  const [first] = meetings(
    "Zarząd spółki zwołuje Nadzwyczajne Walne Zgromadzenie na dzień 13 stycznia 2026 r."
  );
  const [second] = meetings(
    "Zarząd spółki zwołuje Nadzwyczajne Walne Zgromadzenie na dzień 24 września 2026 r."
  );

  assert.equal(getCorporateEventIdentityKey(first), "general-meeting:NWZ:2026-01-13");
  assert.equal(getCorporateEventIdentityKey(second), "general-meeting:NWZ:2026-09-24");
  assert.notEqual(getCorporateEventIdentityKey(first), getCorporateEventIdentityKey(second));
});

test("keeps ZWZ and NWZ independent even when they occur in the same year", () => {
  const [zwz] = meetings(
    "Zarząd spółki zwołuje Zwyczajne Walne Zgromadzenie na dzień 29 czerwca 2026 r."
  );
  const [nwz] = meetings(
    "Zarząd spółki zwołuje Nadzwyczajne Walne Zgromadzenie na dzień 29 września 2026 r."
  );

  assert.equal(zwz.generalMeetingType, "ZWZ");
  assert.equal(nwz.generalMeetingType, "NWZ");
  assert.notEqual(getCorporateEventIdentityKey(zwz), getCorporateEventIdentityKey(nwz));
});

test("does not create an extra meeting from the VIGO supervisory board opinion", () => {
  const text = `OPINIA RADY NADZORCZEJ W SPRAWIE PORZĄDKU OBRAD ORAZ PROJEKTÓW UCHWAŁ
    NADZWYCZAJNEGO WALNEGO ZGROMADZENIA VIGO PHOTONICS S.A. ZWOŁANEGO NA DZIEŃ
    29 PAŹDZIERNIKA 2026 ROKU.`;
  assert.deepEqual(meetings(text), []);
});

test("financial-report schedules remain intact and do not create a meeting", () => {
  const events = parseCorporateEventDocument(`
    Terminy przekazywania raportów okresowych w 2026 roku.
    Raport półroczny za I półrocze 2026 roku: 20 sierpnia 2026 r.
    Raport kwartalny za III kwartał 2026 roku: 5 listopada 2026 r.
    Terminy zatwierdził Zarząd po odbyciu Zwyczajnego Walnego Zgromadzenia.
  `);

  assert.deepEqual(
    events.map(({ eventType, fiscalPeriod, eventDate }) => ({ eventType, fiscalPeriod, eventDate })),
    [
      { eventType: "HALF_YEAR_REPORT", fiscalPeriod: "H1", eventDate: "2026-08-20" },
      { eventType: "QUARTERLY_REPORT", fiscalPeriod: "Q3", eventDate: "2026-11-05" },
    ]
  );
});

test("parses no-diacritic official notice forms and keeps meeting date separate from registration date", () => {
  const [event] = meetings(`
    Informacja o terminie NWZ spółki Example S.A.
    Zarzad zwoluje Nadzwyczajne Walne Zgromadzenie, ktore odbedzie sie w dniu
    01 pazdziernika 2026 roku o godzinie 09:00.
    Dzien 17 wrzesnia 2026 roku jest dniem rejestracji uczestnictwa.
  `);

  assert.deepEqual(
    {
      eventDate: event?.eventDate,
      eventTime: event?.eventTime,
      meetingType: event?.generalMeetingType,
      registrationDate: event?.registrationDate,
    },
    {
      eventDate: "2026-10-01",
      eventTime: "09:00",
      meetingType: "NWZ",
      registrationDate: "2026-09-17",
    }
  );
});

test("parses an English bilingual notice with month-first date and AM/PM time", () => {
  const [event] = meetings(`
    Notice of an Extraordinary General Meeting (EGM)
    The meeting will be held on October 1, 2026 at 10:30 a.m. in Warsaw.
    Record date: September 15, 2026.
  `);

  assert.deepEqual(
    {
      eventDate: event?.eventDate,
      eventTime: event?.eventTime,
      meetingType: event?.generalMeetingType,
      registrationDate: event?.registrationDate,
    },
    {
      eventDate: "2026-10-01",
      eventTime: "10:30",
      meetingType: "NWZ",
      registrationDate: "2026-09-15",
    }
  );
});

test("does not project English AGM follow-up reports as new meetings", () => {
  assert.deepEqual(
    meetings("Results of voting at the Annual General Meeting held on June 25, 2026."),
    []
  );
});

test("a current convening notice is not cancelled by a later reference to an older cancelled meeting", () => {
  const [event] = meetings(`
    Zarząd zwołuje Nadzwyczajne Walne Zgromadzenie, które odbędzie się w dniu 21 października 2026 roku o godzinie 11:00.
    Poprzednie NWZ zwołane na 8 października zostało odwołane.
  `);

  assert.equal(event?.eventDate, "2026-10-21");
  assert.equal(event?.generalMeetingAction, "CONVENING");
  assert.equal(event?.isCancellation, false);
});

test("an official XTPL-style new meeting keeps its announced date ahead of the cancelled prior date", () => {
  const [event] = meetings(`
    XTPL SPÓŁKA AKCYJNA (38/2026) Zwołanie Nadzwyczajnego Walnego Zgromadzenia na dzień 19 października 2026 roku
    Zarząd XTPL S.A. informuje o zwołaniu na dzień 19 października 2026 roku Nadzwyczajnego Walnego Zgromadzenia, które rozpocznie się o godzinie 12:00.
    Zwołanie Walnego Zgromadzenia następuje w związku z odwołaniem NWZ Spółki zwołanego na dzień 29 września 2026 roku.
  `);

  assert.deepEqual(
    {
      eventDate: event?.eventDate,
      eventTime: event?.eventTime,
      registrationDate: event?.registrationDate,
      action: event?.generalMeetingAction,
      cancelled: event?.isCancellation,
    },
    {
      eventDate: "2026-10-19",
      eventTime: "12:00",
      registrationDate: undefined,
      action: "CONVENING",
      cancelled: false,
    }
  );
});

test("a dividend approved by a general meeting stays a dividend, not a new WZA", () => {
  const events = parseCorporateEventDocument(`
    Dywidenda za rok 2025: Zwyczajne Walne Zgromadzenie uchwaliło 1,18 zł na akcję.
    Dzień ustalenia prawa do dywidendy: 21 sierpnia 2026 r.
    Dzień wypłaty dywidendy: 28 sierpnia 2026 r.
  `);

  const [dividend] = events.filter((event) => event.eventType === "UPCOMING_DIVIDEND");
  assert.equal(dividend?.dividendPerShare, 1.18);
  assert.equal(dividend?.dividendStatus, "CONFIRMED");
  assert.deepEqual(events.filter((event) => event.eventType === "GENERAL_MEETING"), []);
});

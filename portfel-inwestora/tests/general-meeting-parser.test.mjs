import assert from "node:assert/strict";
import test from "node:test";
import {
  getCorporateEventIdentityKey,
  getCorporateEventLabel,
  getGeneralMeetingRegistrationDate,
  parseCorporateEventDocument,
} from "../src/lib/corporate-events.ts";

const meetings = (document) =>
  parseCorporateEventDocument(document).filter((event) => event.eventType === "GENERAL_MEETING");

test("parses the formal LSI ZWZ date and time instead of the PAP publication date", () => {
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
      registrationDate: "2026-06-13",
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

test("registration fallback is exactly 16 calendar days, including month boundaries", () => {
  assert.equal(getGeneralMeetingRegistrationDate("2026-06-03"), "2026-05-18");
  assert.equal(getGeneralMeetingRegistrationDate("2026-09-24"), "2026-09-08");
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

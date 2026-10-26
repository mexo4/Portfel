import assert from "node:assert/strict";
import test from "node:test";

import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";

const meetingFrom = (document) =>
  parseCorporateEventDocument(document).find((event) => event.eventType === "GENERAL_MEETING");

test("a share-issue record date is not a general-meeting registration date", () => {
  // Source structure: Medicalgorithmics ESPI 45/2026, published by PAP.
  // The separate rights-issue proposal is not a WZA attendance record date.
  const event = meetingFrom(`
    Informacja o zwołaniu Nadzwyczajnego Walnego Zgromadzenia wraz z projektami uchwał.
    Zarząd informuje o zwołaniu Nadzwyczajnego Walnego Zgromadzenia na dzień
    18 listopada 2026 r. na godzinę 14:00 w Warszawie.
    Projekt uchwały przewiduje emisję nowych akcji w trybie subskrypcji zamkniętej.
    Proponowanym dniem prawa poboru jest dzień 30 listopada 2026 r.
    The proposed record date for the exercise of pre-emptive rights is November 30, 2026.
  `);

  assert.equal(event?.eventDate, "2026-11-18");
  assert.equal(event?.eventTime, "14:00");
  assert.equal(event?.registrationDate, undefined);
});

test("an unrelated dividend record date does not become WZA registration", () => {
  const event = meetingFrom(`
    Notice of an Extraordinary General Meeting. The meeting will be held on November 18, 2026 at 14:00.
    A separate draft resolution proposes a dividend. The record date for dividend entitlement
    is November 30, 2026; the payment date is December 10, 2026.
  `);

  assert.equal(event?.eventDate, "2026-11-18");
  assert.equal(event?.registrationDate, undefined);
});

test("an explicit WZA participation date wins after an unrelated rights date", () => {
  const event = meetingFrom(`
    Notice of an Extraordinary General Meeting. The meeting will be held on November 18, 2026 at 14:00.
    The proposed record date for the exercise of pre-emptive rights is November 30, 2026.
    The record date for participation in the General Meeting is November 2, 2026.
  `);

  assert.equal(event?.eventDate, "2026-11-18");
  assert.equal(event?.registrationDate, "2026-11-02");
});

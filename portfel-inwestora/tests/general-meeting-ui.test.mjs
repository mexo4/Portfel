import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getDashboardUpcomingEvents } from "../src/lib/dashboard-read-model.ts";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const meeting = {
  id: "meeting-nwz-1",
  instrumentId: "instrument-dnp",
  ticker: "DNP.PL",
  companyName: "Dino Polska",
  eventType: "GENERAL_MEETING",
  eventDate: "2026-09-18",
  eventTime: "11:00",
  fiscalYear: 2026,
  generalMeetingType: "NWZ",
  registrationDate: "2026-09-02",
  status: "CONFIRMED",
  active: true,
  discoveredAt: "2026-08-20T08:00:00.000Z",
  updatedAt: "2026-08-20T08:00:00.000Z",
};

test("Wydarzenia GPW show meeting time, registration date and investor guidance", async () => {
  const panel = await readSource("src/components/CorporateEventsPanel.tsx");

  assert.match(panel, /event\.eventType === "GENERAL_MEETING"/);
  assert.match(panel, /Dzień rejestracji:/);
  assert.match(panel, /16 dni przed WZA · szczegóły uczestnictwa sprawdź u brokera/);
  assert.match(panel, /godz\. \{formatEventTime\(event\.eventTime\)\}/);
  assert.match(panel, /Termin zmieniony/);
  assert.doesNotMatch(panel, /Brak potwierdzonych przyszłych terminów raportów/);
});

test("cancelled meetings are not rendered as active upcoming events", async () => {
  const panel = await readSource("src/components/CorporateEventsPanel.tsx");

  assert.match(panel, /event\.active !== false/);
  assert.match(panel, /event\.status !== "CANCELLED"/);
});

test("dashboard keeps independent meetings from the same issuer and year", () => {
  const secondMeeting = {
    ...meeting,
    id: "meeting-nwz-2",
    eventDate: "2026-11-06",
    registrationDate: "2026-10-21",
  };
  const cancelledMeeting = {
    ...meeting,
    id: "meeting-cancelled",
    eventDate: "2026-12-04",
    status: "CANCELLED",
    active: false,
  };

  const result = getDashboardUpcomingEvents(
    [meeting, { ...meeting }, secondMeeting, cancelledMeeting],
    10
  );

  assert.deepEqual(result.map((event) => event.id), ["meeting-nwz-1", "meeting-nwz-2"]);
});

test("existing dashboard widget uses the shared event label for meetings", async () => {
  const dashboard = await readSource("src/components/ConfigurableDashboard.tsx");

  assert.match(dashboard, /getCorporateEventLabel\(event\)/);
  assert.match(dashboard, /event\.eventType === "GENERAL_MEETING" && event\.eventTime/);
  assert.doesNotMatch(dashboard, /function GeneralMeetingWidget/);
});

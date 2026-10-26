import assert from "node:assert/strict";
import test from "node:test";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";

test("wrapped fiscal-period end is not a report publication appointment", () => {
  const events = parseCorporateEventDocument(`Zarząd podaje terminy publikacji raportów okresowych
w roku obrotowym trwającym od 01.07.2026 do 30.06.2027:
1. Jednostkowy i skonsolidowany raport roczny za rok obrotowy trwający od 01.07.2025 do 30.06.2026 - 29.10.2026 roku.
2. Skonsolidowane raporty kwartalne:
a. za I kwartał trwający od 01.07.2026 do 30.09.2026 - 25.11.2026 r.,
b. za III kwartał trwający od 01.01.2027 do 31.03.2027 - 26.05.2027 r.
Zarząd informuje o zamiarze przekazywania w roku obrotowym trwającym od 01.07.2026
do 30.06.2027 skonsolidowanych raportów kwartalnych zawierających skrócone kwartalne
sprawozdanie finansowe.`);

  assert.deepEqual(
    events.filter((event) => event.eventType.endsWith("_REPORT")).map(({ eventDate }) => eventDate),
    ["2026-10-29", "2026-11-25", "2027-05-26"],
  );
  assert.equal(events.some(({ eventDate }) => eventDate === "2027-06-30"), false);
});

test("an explicitly announced publication after a fiscal boundary is still retained", () => {
  const events = parseCorporateEventDocument(`Skonsolidowany raport roczny za rok obrotowy od 01.07.2026 do 30.06.2027 zostanie opublikowany w dniu 30.09.2027 r.`);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "ANNUAL_REPORT");
  assert.equal(events[0].eventDate, "2027-09-30");
});

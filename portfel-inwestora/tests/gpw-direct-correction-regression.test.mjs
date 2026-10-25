import assert from "node:assert/strict";
import test from "node:test";

import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";

const find = (events, period) => events.find((event) => event.fiscalPeriod === period);

test("direct report correction is detected without a dedicated correction heading", () => {
  const events = parseCorporateEventDocument([
    "Raport półroczny za I półrocze 2026 roku.",
    "Termin publikacji ustalony na dzień 30 września 2026 r. zostaje zmieniony na dzień 24 września 2026 r.",
  ].join("\n"));

  const event = find(events, "H1");
  assert.deepEqual(
    [event?.eventType, event?.eventDate, event?.previousEventDate, event?.fiscalPeriod, event?.fiscalYear, event?.isScheduleChange],
    ["HALF_YEAR_REPORT", "2026-09-24", "2026-09-30", "H1", 2026, true],
  );
  assert.match(event?.sourceEvidence ?? "", /zostaje zmieniony na/iu);
});

test("two locally anchored direct corrections in one source retain both report identities", () => {
  const events = parseCorporateEventDocument([
    "Raport półroczny za I półrocze 2026 roku. Termin ustalony na dzień 30 września 2026 r. ulega zmianie na dzień 24 września 2026 r.",
    "Raport kwartalny za III kwartał 2026 roku. Termin ustalony na dzień 20 listopada 2026 r. zostaje przesunięty na dzień 27 listopada 2026 r.",
  ].join("\n"));

  assert.deepEqual(events.map((event) => [event.eventType, event.fiscalPeriod, event.previousEventDate, event.eventDate]), [
    ["HALF_YEAR_REPORT", "H1", "2026-09-30", "2026-09-24"],
    ["QUARTERLY_REPORT", "Q3", "2026-11-20", "2026-11-27"],
  ]);
});

test("a negated non-change phrase does not fabricate a correction", () => {
  const events = parseCorporateEventDocument([
    "Raport półroczny za I półrocze 2026 roku.",
    "Termin ustalony na dzień 30 września 2026 r. nie ulega zmianie na skutek publikacji dokumentu z dnia 24 września 2026 r.",
  ].join("\n"));

  assert.equal(events.length, 0);
});

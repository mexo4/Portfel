import assert from "node:assert/strict";
import test from "node:test";

import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";

const generator = (seed) => {
  let state = seed >>> 0;
  return (max) => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state % max;
  };
};

const find = (events, type, period) => events.find((event) =>
  event.eventType === type && (!period || event.fiscalPeriod === period));

test("2,400 deterministic realistic GPW variants preserve report and correction semantics (seed 20261025)", () => {
  const random = generator(20_261_025);
  const publicationVerbs = ["zostanie opublikowany", "zostanie przekazany", "Spółka opublikuje", "przekazanie nastąpi"];
  const dateFormats = ["20 listopada 2026 r.", "20.11.2026 r.", "20-11-2026"];
  const separators = [". ", "; ", "\n", " — "];
  const spacing = [" ", "  ", "\t"];
  const checks = 1_600;
  for (let index = 0; index < checks; index += 1) {
    const verb = publicationVerbs[random(publicationVerbs.length)];
    const date = dateFormats[random(dateFormats.length)];
    const space = spacing[random(spacing.length)];
    const separator = separators[random(separators.length)];
    const preface = random(2) ? "Emitent informuje akcjonariuszy" : "Harmonogram raportów okresowych";
    const q1 = `Raport${space}kwartalny za I kwartał 2026 roku ${verb} ${date}`;
    const q3 = `Raport kwartalny za III kwartał 2026 roku zostanie opublikowany 27 listopada 2026 r.`;
    const source = random(2) ? `${preface}.${separator}${q1}.${separator}${q3}.` : `${q3}.${separator}${preface}.${separator}${q1}.`;
    const events = parseCorporateEventDocument(source);
    assert.equal(find(events, "QUARTERLY_REPORT", "Q1")?.eventDate, "2026-11-20", `report seed=20261025 i=${index}`);
    assert.equal(find(events, "QUARTERLY_REPORT", "Q3")?.eventDate, "2026-11-27", `report seed=20261025 i=${index}`);
  }

  const correctionPhrases = ["zostaje zmieniony na", "ulega zmianie na", "zostaje przesunięty na"];
  for (let index = 0; index < 800; index += 1) {
    const phrase = correctionPhrases[random(correctionPhrases.length)];
    const separator = separators[random(separators.length)];
    const source = `Zmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku.${separator}Termin ustalony na dzień 30 września 2026 r. ${phrase} dzień 24 września 2026 r.`;
    const event = find(parseCorporateEventDocument(source), "HALF_YEAR_REPORT", "H1");
    assert.equal(event?.eventDate, "2026-09-24", `correction seed=20261025 i=${index}`);
    assert.equal(event?.previousEventDate, "2026-09-30", `correction previous date seed=20261025 i=${index}`);
    assert.equal(event?.isScheduleChange, true, `correction flag seed=20261025 i=${index}`);
  }
});

test("800 deterministic changes of meaning alter the expected report date instead of preserving stale data (seed 20261026)", () => {
  const random = generator(20_261_026);
  const dates = [
    ["18 listopada 2026 r.", "2026-11-18"],
    ["19 listopada 2026 r.", "2026-11-19"],
    ["20 listopada 2026 r.", "2026-11-20"],
    ["21 listopada 2026 r.", "2026-11-21"],
  ];
  for (let index = 0; index < 800; index += 1) {
    const [writtenDate, expectedDate] = dates[random(dates.length)];
    const source = `Raport za III kwartał 2026 roku zostanie opublikowany ${writtenDate}.`;
    const event = find(parseCorporateEventDocument(source), "QUARTERLY_REPORT", "Q3");
    assert.equal(event?.eventDate, expectedDate, `meaningful date mutation seed=20261026 i=${index}`);
  }
});

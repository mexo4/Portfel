import assert from "node:assert/strict";
import test from "node:test";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { gpwReferenceCorpus } from "./fixtures/gpw-reference-corpus-2026-10-24.mjs";

const comparedFields = [
  "eventType", "eventDate", "previousEventDate", "fiscalPeriod", "fiscalYear", "fiscalYearLabel",
  "generalMeetingType", "eventTime", "registrationDate", "recordDate", "paymentDate",
  "dividendPerShare", "dividendTotalPerShare", "dividendInstallment", "dividendStatus", "isScheduleChange",
];

const matchesExpected = (expected, actual) => {
  if (expected.length !== actual.length) return false;
  const remaining = [...actual];
  for (const wanted of expected) {
    const index = remaining.findIndex((candidate) => comparedFields
      .filter((field) => wanted[field] !== undefined)
      .every((field) => candidate[field] === wanted[field]));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
};

const sourceDocument = (id) => {
  const document = gpwReferenceCorpus.find((item) => item.id === id);
  assert.ok(document, `expected source fixture ${id}`);
  return document;
};

const expectMutationDetected = (name, expected, mutated) => {
  assert.equal(matchesExpected(expected, mutated), false, `reference oracle should reject seeded mutation: ${name}`);
};

test("source-oracle sensitivity detects seeded report, WZA, dividend, correction and dedupe mutations", () => {
  const schedule = sourceDocument("MCR-4-2026");
  const scheduleActual = parseCorporateEventDocument(schedule.parserInput);
  assert.equal(matchesExpected(schedule.expectedEvents, scheduleActual), true);

  expectMutationDetected("Q1/Q3 swap", schedule.expectedEvents, scheduleActual.map((event) => ({
    ...event,
    fiscalPeriod: event.fiscalPeriod === "Q1" ? "Q3" : event.fiscalPeriod === "Q3" ? "Q1" : event.fiscalPeriod,
  })));
  expectMutationDetected("fiscal year shift", schedule.expectedEvents, scheduleActual.map((event) =>
    event.fiscalYear === undefined ? event : { ...event, fiscalYear: event.fiscalYear + 1 }));
  expectMutationDetected("wrong publication date", schedule.expectedEvents, scheduleActual.map((event, index) =>
    index === 0 ? { ...event, eventDate: "2026-02-28" } : event));
  expectMutationDetected("event omission", schedule.expectedEvents, scheduleActual.slice(1));
  expectMutationDetected("duplicate projection", schedule.expectedEvents, [...scheduleActual, scheduleActual[0]]);

  const correction = sourceDocument("MCR-27-2026");
  const correctionActual = parseCorporateEventDocument(correction.parserInput);
  assert.equal(matchesExpected(correction.expectedEvents, correctionActual), true);
  expectMutationDetected("correction omitted", correction.expectedEvents, correctionActual.map((event) => ({
    ...event,
    previousEventDate: undefined,
    isScheduleChange: false,
  })));
  expectMutationDetected("older date overwrites correction", correction.expectedEvents, correctionActual.map((event) => ({
    ...event,
    eventDate: event.previousEventDate,
  })));

  const meetingsText = "The Board of Directors of Allegro.eu informs shareholders that the Ordinary General Meeting (OGM) and the Extraordinary General Meeting (EGM) will be held on 18 November 2026. The OGM at 2:00 pm CEST; the EGM at 2:30 pm CEST. The right to participate is determined on 4 November 2026 (Record Date).";
  const meetings = parseCorporateEventDocument(meetingsText).filter((event) => event.eventType === "GENERAL_MEETING");
  assert.equal(meetings.length, 2);
  expectMutationDetected("two WZA occurrences merged", meetings, meetings.slice(0, 1));

  const installments = sourceDocument("KETY-27-2026");
  const dividendActual = parseCorporateEventDocument(installments.parserInput);
  assert.equal(matchesExpected(installments.expectedEvents, dividendActual), true);
  expectMutationDetected("two dividend installments merged", installments.expectedEvents, dividendActual.slice(0, 1));

  const noEvent = sourceDocument("DGA-15-2026-correction");
  expectMutationDetected("false event emitted from no-event source", noEvent.expectedEvents, [scheduleActual[0]]);
});

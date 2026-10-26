import { pathToFileURL } from "node:url";

import { gpwKnownAnnotatedCorpus } from "./gpw-quality-corpus.mjs";
import { parseCorporateEventDocument as baselineParser } from "../src/lib/corporate-events.ts";

const modulePath = process.argv[2];
if (!modulePath) throw new Error("Pass the temporary parser module path as the first argument.");

const sameValue = (expected, actual) => typeof expected === "number"
  ? typeof actual === "number" && Math.abs(expected - actual) < 0.000001
  : expected === actual;

const compare = (expectedEvents, actualEvents) => {
  const remaining = [...actualEvents];
  const failures = [];
  for (const expected of expectedEvents) {
    const index = remaining.findIndex((actual) => actual.eventType === expected.eventType && actual.eventDate === expected.eventDate);
    if (index < 0) {
      failures.push({ kind: "MISSING_OR_CHANGED", expected });
      continue;
    }
    const [actual] = remaining.splice(index, 1);
    const mismatches = Object.entries(expected)
      .filter(([, value]) => value !== undefined)
      .filter(([key, value]) => !sameValue(value, actual[key]))
      .map(([key, value]) => ({ field: key, expected: value, actual: actual[key] }));
    if (mismatches.length) failures.push({ kind: "FIELD_MISMATCH", expected, actual, mismatches });
  }
  for (const actual of remaining) failures.push({ kind: "UNEXPECTED", actual });
  return failures;
};

// Hand-annotated synthetic semantics, separate from the official-source
// regression corpus. One physical paragraph intentionally contains two
// independently announced reports with different dates and fiscal years.
// This specifically detects a parser that borrows from an adjacent clause.
const semanticProbes = [
  {
    id: "semantic:two-report-clauses-one-paragraph",
    parserInput: [
      "Harmonogram publikacji raportów okresowych.",
      "Raport kwartalny za I kwartał roku obrotowego 2025/2026 zostanie opublikowany 20 maja 2026 roku oraz raport kwartalny za III kwartał roku obrotowego 2026/2027 zostanie opublikowany 20 listopada 2027 roku.",
    ].join("\n"),
    expectedEvents: [
      { eventType: "QUARTERLY_REPORT", eventDate: "2026-05-20", fiscalPeriod: "Q1", fiscalYear: 2026, fiscalYearLabel: "2025/2026" },
      { eventType: "QUARTERLY_REPORT", eventDate: "2027-11-20", fiscalPeriod: "Q3", fiscalYear: 2027, fiscalYearLabel: "2026/2027" },
    ],
  },
];

const cases = [...gpwKnownAnnotatedCorpus, ...semanticProbes];
const evaluate = (parser) => cases.flatMap((document) => compare(
  document.expectedEvents ?? [],
  parser(document.parserInput ?? ""),
).map((failure) => ({ documentId: document.id, ...failure })));

try {
  const baselineFailures = evaluate(baselineParser);
  if (baselineFailures.length) {
    throw new Error(`Mutation oracle baseline disagrees with ${baselineFailures.length} hand-annotated expectation(s).`);
  }
  const parserModule = await import(`${pathToFileURL(modulePath).href}?mutation=${encodeURIComponent(modulePath)}`);
  if (typeof parserModule.parseCorporateEventDocument !== "function") throw new Error("Mutant does not export parseCorporateEventDocument.");
  const failures = evaluate(parserModule.parseCorporateEventDocument);
  process.stdout.write(`${JSON.stringify({ status: failures.length ? "KILLED" : "SURVIVED", failures })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: "ERROR",
    error: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exitCode = 2;
}

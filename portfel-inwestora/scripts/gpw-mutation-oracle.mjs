import { pathToFileURL } from "node:url";

import { gpwKnownAnnotatedCorpus } from "./gpw-quality-corpus.mjs";

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

try {
  const parserModule = await import(`${pathToFileURL(modulePath).href}?mutation=${encodeURIComponent(modulePath)}`);
  if (typeof parserModule.parseCorporateEventDocument !== "function") throw new Error("Mutant does not export parseCorporateEventDocument.");
  const failures = gpwKnownAnnotatedCorpus.flatMap((document) => compare(
    document.expectedEvents ?? [],
    parserModule.parseCorporateEventDocument(document.parserInput ?? ""),
  ).map((failure) => ({ documentId: document.id, ...failure })));
  process.stdout.write(`${JSON.stringify({ status: failures.length ? "KILLED" : "SURVIVED", failures })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({
    status: "ERROR",
    error: error instanceof Error ? error.message : String(error),
  })}\n`);
  process.exitCode = 2;
}

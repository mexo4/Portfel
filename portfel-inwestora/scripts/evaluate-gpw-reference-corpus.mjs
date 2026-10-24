import { gpwReferenceCorpus } from "../tests/fixtures/gpw-reference-corpus-2026-10-24.mjs";
import { gpwProspectiveHoldoutD } from "../tests/fixtures/gpw-prospective-holdout-D-2026-10-24.mjs";
import { gpwProspectiveHoldoutE } from "../tests/fixtures/gpw-prospective-holdout-E-2026-10-24.mjs";
import { gpwProspectiveHoldoutF } from "../tests/fixtures/gpw-prospective-holdout-F-2026-10-24.mjs";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";

const corpus = [
  ...gpwReferenceCorpus,
  ...gpwProspectiveHoldoutD,
  ...gpwProspectiveHoldoutE,
  ...gpwProspectiveHoldoutF,
];
const requestedGroups = process.argv.find((argument) => argument.startsWith("--groups="))
  ?.slice("--groups=".length).split(",");
const selected = requestedGroups
  ? corpus.filter((document) => requestedGroups.includes(document.group))
  : corpus;

const fields = [
  "eventType", "eventDate", "previousEventDate", "fiscalPeriod", "fiscalYear", "fiscalYearLabel",
  "periodStart", "periodEnd", "reportScope", "generalMeetingType", "eventTime", "registrationDate", "recordDate",
  "paymentDate", "dividendPerShare", "dividendTotalPerShare", "dividendCurrency",
  "dividendInstallment", "dividendStatus", "isScheduleChange",
];

const canonical = (event) => fields
  .filter((field) => event[field] !== undefined)
  .map((field) => `${field}=${event[field]}`)
  .join("|");

const categoryFor = (event) => {
  if (["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT"].includes(event.eventType)) return "reports";
  if (event.eventType === "GENERAL_MEETING") return "meetings";
  if (event.eventType === "UPCOMING_DIVIDEND") return "dividends";
  return "other";
};

const matchScore = (expected, actual) => {
  let score = 0;
  if (expected.eventDate === actual.eventDate) score += 32;
  if (expected.eventType === actual.eventType) score += 16;
  if (expected.fiscalPeriod !== undefined && expected.fiscalPeriod === actual.fiscalPeriod) score += 8;
  if (expected.fiscalYear !== undefined && expected.fiscalYear === actual.fiscalYear) score += 8;
  if (expected.fiscalYearLabel !== undefined && expected.fiscalYearLabel === actual.fiscalYearLabel) score += 8;
  if (expected.generalMeetingType !== undefined && expected.generalMeetingType === actual.generalMeetingType) score += 8;
  if (expected.registrationDate !== undefined && expected.registrationDate === actual.registrationDate) score += 6;
  if (expected.recordDate !== undefined && expected.recordDate === actual.recordDate) score += 8;
  if (expected.paymentDate !== undefined && expected.paymentDate === actual.paymentDate) score += 10;
  if (expected.dividendInstallment !== undefined && expected.dividendInstallment === actual.dividendInstallment) score += 12;
  if (expected.previousEventDate !== undefined && expected.previousEventDate === actual.previousEventDate) score += 6;
  return score;
};

const results = selected.map((document) => {
  const actual = parseCorporateEventDocument(document.parserInput);
  const unmatchedActual = [...actual];
  const errors = [];
  const pairs = [];

  for (const expected of document.expectedEvents) {
    const ranked = unmatchedActual.map((event, index) => ({ event, index, score: matchScore(expected, event) }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    if (!best || best.score < 16) {
      errors.push(`missing ${canonical(expected)}`);
      continue;
    }
    const [candidate] = unmatchedActual.splice(best.index, 1);
    pairs.push({ expected, actual: candidate });
    for (const field of fields) {
      if (expected[field] === undefined) continue;
      const equal = typeof expected[field] === "number"
        ? typeof candidate[field] === "number" && Math.abs(candidate[field] - expected[field]) < 0.00001
        : candidate[field] === expected[field];
      if (!equal) errors.push(`${field}: expected ${expected[field]}, got ${candidate[field] ?? "<missing>"}`);
    }
  }

  for (const extra of unmatchedActual) errors.push(`unexpected ${canonical(extra)}`);

  return { document, actual, pairs, errors };
});

const expectedCount = selected.reduce((total, item) => total + item.expectedEvents.length, 0);
const actualCount = results.reduce((total, item) => total + item.actual.length, 0);
const passed = results.filter((item) => item.errors.length === 0).length;
const failed = results.length - passed;
const metric = (correct, total) => ({ correct, total, accuracy: total ? Number((correct / total).toFixed(4)) : null });
const categories = ["reports", "meetings", "dividends"];
const metricsByCategory = Object.fromEntries(categories.map((category) => {
  const pairs = results.flatMap((item) => item.pairs)
    .filter(({ expected: event }) => categoryFor(event) === category);
  const actualCategoryCount = results.reduce((total, item) =>
    total + item.actual.filter((event) => categoryFor(event) === category).length, 0);
  const truePositives = pairs.filter(({ expected: left, actual: right }) =>
    left.eventType === right.eventType && left.eventDate === right.eventDate).length;
  const periodPairs = pairs.filter(({ expected: event }) => event.fiscalPeriod !== undefined);
  const yearPairs = pairs.filter(({ expected: event }) => event.fiscalYear !== undefined || event.fiscalYearLabel !== undefined);
  const correctionPairs = pairs.filter(({ expected: event }) =>
    event.previousEventDate !== undefined || event.isScheduleChange === true);
  const expectedTotal = selected.reduce((total, document) =>
    total + document.expectedEvents.filter((event) => categoryFor(event) === category).length, 0);
  return [category, {
    expected: expectedTotal,
    actual: actualCategoryCount,
    truePositives,
    falseNegatives: expectedTotal - truePositives,
    falsePositives: actualCategoryCount - truePositives,
    precision: actualCategoryCount ? Number((truePositives / actualCategoryCount).toFixed(4)) : null,
    recall: expectedTotal ? Number((truePositives / expectedTotal).toFixed(4)) : null,
    eventTypeAccuracy: metric(pairs.filter(({ expected: left, actual: right }) => left.eventType === right.eventType).length, pairs.length),
    dateAccuracy: metric(pairs.filter(({ expected: left, actual: right }) => left.eventDate === right.eventDate).length, pairs.length),
    periodAccuracy: metric(periodPairs.filter(({ expected: left, actual: right }) => left.fiscalPeriod === right.fiscalPeriod).length, periodPairs.length),
    yearAccuracy: metric(yearPairs.filter(({ expected: left, actual: right }) =>
      (left.fiscalYear === undefined || left.fiscalYear === right.fiscalYear) &&
      (left.fiscalYearLabel === undefined || left.fiscalYearLabel === right.fiscalYearLabel)).length, yearPairs.length),
    correctionAccuracy: metric(correctionPairs.filter(({ expected: left, actual: right }) =>
      (left.previousEventDate === undefined || left.previousEventDate === right.previousEventDate) &&
      (left.isScheduleChange === undefined || left.isScheduleChange === right.isScheduleChange)).length, correctionPairs.length),
  }];
}));
const falseNegatives = Object.values(metricsByCategory).reduce((sum, item) => sum + item.falseNegatives, 0);
const falsePositives = Object.values(metricsByCategory).reduce((sum, item) => sum + item.falsePositives, 0);

console.log(JSON.stringify({
  corpus: selected.length,
  sourceLinkedDocuments: selected.filter((document) => /^https:\/\//.test(document.sourceUrl ?? "")).length,
  ambiguousAnnotations: selected.filter((document) => document.ambiguous === true).length,
  groups: Object.fromEntries([...new Set(selected.map((item) => item.group))]
    .map((group) => [group, selected.filter((item) => item.group === group).length])),
  expectedEvents: expectedCount,
  parsedEvents: actualCount,
  documentPass: passed,
  documentFail: failed,
  falsePositives,
  falseNegatives,
  metricsByCategory,
  note: "Small manually annotated source sample; descriptive only, not a statistically representative quality estimate.",
  failures: results.filter((item) => item.errors.length > 0).map(({ document, errors, actual }) => ({
    id: document.id,
    sourceUrl: document.sourceUrl,
    errors,
    actual: actual.map((event) => Object.fromEntries(fields
      .filter((field) => event[field] !== undefined).map((field) => [field, event[field]]))),
  })),
}, null, 2));

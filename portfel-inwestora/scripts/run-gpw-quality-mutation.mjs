import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { getAuditOutputDirectory, printArtifactSummary, renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const appRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const parserPath = path.join(appRoot, "src", "lib", "corporate-events.ts");
const oraclePath = path.join(appRoot, "scripts", "gpw-mutation-oracle.mjs");

const replaceOnce = (source, from, to, name) => {
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`Mutation ${name} could not find its source anchor.`);
  return `${source.slice(0, index)}${to}${source.slice(index + from.length)}`;
};

const inside = (source, marker, from, to, name) => {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Mutation ${name} could not find its enclosing marker.`);
  const index = source.indexOf(from, start);
  if (index < 0) throw new Error(`Mutation ${name} could not find its source anchor.`);
  return `${source.slice(0, index)}${to}${source.slice(index + from.length)}`;
};

/** These transforms alter the real TypeScript parser source in a temporary
 * directory. They are intentionally not oracle mutations. */
const mutants = [
  {
    name: "remove-report-schedule-lane",
    description: "Suppresses the normal report-schedule parser lane.",
    transform: (source) => replaceOnce(
      source,
      "for (const event of parseReportScheduleEvents(text)) {",
      "for (const event of []) {",
      "remove-report-schedule-lane",
    ),
  },
  {
    name: "remove-general-meeting-lane",
    description: "Suppresses all WZA/NWZ parsing after the document parser dispatch.",
    transform: (source) => replaceOnce(
      source,
      "for (const generalMeeting of getGeneralMeetingEvents(text)) {",
      "for (const generalMeeting of []) {",
      "remove-general-meeting-lane",
    ),
  },
  {
    name: "remove-dividend-lane",
    description: "Suppresses the dividend parser lane.",
    transform: (source) => replaceOnce(
      source,
      "for (const dividend of getUpcomingDividendEvents(text)) {",
      "for (const dividend of []) {",
      "remove-dividend-lane",
    ),
  },
  {
    name: "invert-correction-date-direction",
    description: "Swaps corrected and previous dates in the core correction parser.",
    transform: (source) => inside(
      source,
      "const parseReportScheduleCorrectionEvents",
      "const eventDate = isNewInsteadOfOld ? firstDate.date : secondDate.date;",
      "const eventDate = isNewInsteadOfOld ? secondDate.date : firstDate.date;",
      "invert-correction-date-direction",
    ),
  },
  {
    name: "erase-correction-marker",
    description: "Drops the correction marker on explicitly parsed correction events.",
    transform: (source) => inside(
      source,
      "const parseReportScheduleCorrectionEvents",
      "isScheduleChange: true,",
      "isScheduleChange: false,",
      "erase-correction-marker",
    ),
  },
  {
    name: "prefer-schedule-fiscal-year-over-row",
    description: "Breaks row-level fiscal-year precedence for non-calendar schedules.",
    transform: (source) => replaceOnce(
      source,
      "if (clauseYearLabel?.includes(\"/\")) return clauseYearLabel;",
      "if (clauseYearLabel?.includes(\"/\")) return scheduleYearLabel;",
      "prefer-schedule-fiscal-year-over-row",
    ),
  },
  {
    name: "borrow-fiscal-year-from-adjacent-row",
    description: "Lets a multi-report paragraph's first fiscal year override the year in the current report clause.",
    transform: (source) => inside(
      source,
      "const parseReportScheduleEvents",
      "const clauseYearLabel = getFiscalYearLabel(clause);",
      "const clauseYearLabel = getFiscalYearLabel(segment.text) ?? getFiscalYearLabel(clause);",
      "borrow-fiscal-year-from-adjacent-row",
    ),
  },
  {
    name: "borrow-publication-date-from-adjacent-row",
    description: "Uses the first date in a multi-report paragraph instead of the current report clause's date.",
    transform: (source) => inside(
      source,
      "const parseReportScheduleEvents",
      "const eventDate = getReportPublicationDate(clause);",
      "const eventDate = getReportPublicationDate(segment.text) ?? getReportPublicationDate(clause);",
      "borrow-publication-date-from-adjacent-row",
    ),
  },
  {
    name: "swap-q1-and-q3-ordinal",
    description: "Mislabels a first-quarter report as a third-quarter report while leaving other periods intact.",
    transform: (source) => inside(
      source,
      "const getFiscalPeriod",
      String.raw`[/\b(?:i|1|pierwsz(?:y|ego))\.?\s+kwartał/giu, "Q1"],`,
      String.raw`[/\b(?:i|1|pierwsz(?:y|ego))\.?\s+kwartał/giu, "Q3"],`,
      "swap-q1-and-q3-ordinal",
    ),
  },
  {
    name: "reverse-only-previous-correction-date",
    description: "Keeps the corrected publication date but records the wrong superseded date.",
    transform: (source) => inside(
      source,
      "const parseReportScheduleCorrectionEvents",
      "const previousEventDate = isNewInsteadOfOld ? secondDate.date : firstDate.date;",
      "const previousEventDate = isNewInsteadOfOld ? firstDate.date : secondDate.date;",
      "reverse-only-previous-correction-date",
    ),
  },
  {
    name: "drop-second-dividend-installment",
    description: "Keeps the first dividend installment but silently discards later installments in the same announcement.",
    transform: (source) => replaceOnce(
      source,
      "for (const dividend of getUpcomingDividendEvents(text)) {",
      "for (const dividend of getUpcomingDividendEvents(text).slice(0, 1)) {",
      "drop-second-dividend-installment",
    ),
  },
];

const source = await readFile(parserPath, "utf8");
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "mexo-gpw-source-mutation-"));
const results = [];
try {
  for (const mutant of mutants) {
    let mutated;
    try {
      mutated = mutant.transform(source);
    } catch (error) {
      results.push({ name: mutant.name, description: mutant.description, status: "ERROR", error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const mutantPath = path.join(temporaryDirectory, `${mutant.name}.ts`);
    await writeFile(mutantPath, mutated, "utf8");
    const child = spawnSync(process.execPath, ["--experimental-strip-types", oraclePath, mutantPath], {
      cwd: appRoot,
      encoding: "utf8",
      timeout: 60_000,
    });
    let oracle;
    try {
      oracle = JSON.parse((child.stdout ?? "").trim().split(/\r?\n/).at(-1) ?? "{}");
    } catch {
      oracle = { status: "ERROR", error: "The mutation oracle did not emit valid JSON.", stdout: child.stdout, stderr: child.stderr };
    }
    results.push({
      name: mutant.name,
      description: mutant.description,
      status: oracle.status ?? "ERROR",
      exitCode: child.status,
      timedOut: child.error?.code === "ETIMEDOUT",
      failures: oracle.failures?.length ?? 0,
      firstFailure: oracle.failures?.[0] ?? null,
      error: oracle.error ?? child.error?.message ?? null,
    });
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

const killed = results.filter((result) => result.status === "KILLED");
const survived = results.filter((result) => result.status === "SURVIVED");
const errors = results.filter((result) => result.status === "ERROR");
const status = survived.length || errors.length ? "FAIL" : "PASS";
const mutationScore = killed.length + survived.length
  ? killed.length / (killed.length + survived.length)
  : null;
const report = {
  schemaVersion: 1,
  type: "REAL_SOURCE_CODE_MUTATION",
  sourceFile: "src/lib/corporate-events.ts",
  temporaryIsolation: "OS temporary directory; no repository parser source was changed.",
  totals: { configured: mutants.length, killed: killed.length, survived: survived.length, errors: errors.length, mutationScore },
  results,
  status,
};
const artifacts = await writeGpwQualityArtifacts({
  outputDir: getAuditOutputDirectory(),
  basename: "mutation",
  report,
  markdown: renderGenericMarkdown("GPW real source-code mutation report", [
    { heading: "Method", body: "Each controlled transform was applied to a temporary copy of `src/lib/corporate-events.ts`. The oracle first checked the unmutated parser against the source-annotated regression corpus and separate hand-annotated synthetic semantic probes, then compared each mutant. The repository parser file was never changed. Synthetic probes are not independent market holdout evidence." },
    { heading: "Result", body: `- Status: **${status}**\n- Configured: ${mutants.length}\n- Killed: ${killed.length}\n- Survived: ${survived.length}\n- Errors: ${errors.length}\n- Mutation score: ${mutationScore === null ? "N/A" : `${(mutationScore * 100).toFixed(1)}%`}` },
    { heading: "Mutants", body: results.map((result) => `- **${result.name}** — ${result.status}; ${result.description}${result.firstFailure ? ` First detection: ${result.firstFailure.documentId ?? "n/a"}.` : ""}${result.error ? ` Error: ${result.error}` : ""}`).join("\n") },
  ]),
});

printArtifactSummary({ name: "gpw:mutation", status, artifacts, summary: report.totals });
if (status !== "PASS") process.exitCode = 1;

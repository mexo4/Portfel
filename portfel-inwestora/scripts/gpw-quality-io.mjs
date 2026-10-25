import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const appRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

export const getOption = (name, args = process.argv.slice(2)) => {
  const prefix = `--${name}=`;
  const value = args.find((argument) => argument.startsWith(prefix));
  return value?.slice(prefix.length);
};

export const getAuditOutputDirectory = (args = process.argv.slice(2)) => {
  const requested = getOption("out", args) ?? process.env.MEXO_GPW_AUDIT_OUT ?? "artifacts/gpw-quality";
  const output = path.resolve(appRoot, requested);
  const relative = path.relative(appRoot, output);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("GPW audit output must stay within the application worktree.");
  }
  return output;
};

export const writeGpwQualityArtifacts = async ({ outputDir, basename, report, markdown }) => {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${basename}.json`);
  const markdownPath = path.join(outputDir, `${basename}.md`);
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, `${markdown.trim()}\n`, "utf8");
  return { jsonPath, markdownPath };
};

const value = (input) => input === null || input === undefined ? "n/a" : String(input);

export const renderGpwAuditMarkdown = (title, report) => {
  const metrics = Object.entries(report.metricsByCategory ?? {}).map(([category, item]) =>
    `| ${category} | ${item.expected} | ${item.actual} | ${item.truePositives} | ${value(item.exactMatches)} | ${value(item.fieldMismatches)} | ${item.falsePositives} | ${item.falseNegatives} | ${value(item.precision)} | ${value(item.recall)} | ${value(item.f1)} |`
  ).join("\n");
  const findings = report.findings?.length
    ? report.findings.map((item) => `- **${item.code}** (${item.classification}, ${item.confidence}) — ${item.issuer}; ${item.message}${item.sourceUrl ? ` [źródło](${item.sourceUrl})` : ""}`).join("\n")
    : "- Brak anomalii wykrytych w tym deterministycznym zakresie.";
  return `# ${title}

## Zakres

- Dokumenty: ${report.scope?.documents ?? "n/a"}
- Emitenci: ${report.scope?.issuers ?? "n/a"}
- Dokumenty z URL źródła: ${report.scope?.sourceLinkedDocuments ?? "n/a"}
- Zakres pokrycia: ${report.scope?.coverage ?? "n/a"}

## Metryki

| Kategoria | Oczekiwane | Odczytane | TP data+typ | Pełne | Niezgodności pól | FP | FN | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${metrics || "| n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |"}

## Anomalie (${report.findings?.length ?? 0})

${findings}

## Ograniczenia

${(report.scope?.limitations ?? ["Brak zadeklarowanych ograniczeń."]).map((item) => `- ${item}`).join("\n")}
`;
};

export const renderGenericMarkdown = (title, sections) => `# ${title}

${sections.map(({ heading, body }) => `## ${heading}\n\n${body}`).join("\n\n")}
`;

export const printArtifactSummary = ({ name, artifacts, status, summary = {} }) => {
  process.stdout.write(`${JSON.stringify({ name, status, artifacts, ...summary }, null, 2)}\n`);
};

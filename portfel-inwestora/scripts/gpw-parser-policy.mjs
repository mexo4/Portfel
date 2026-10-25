import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const localRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const defaultFiles = [
  "src/lib/corporate-events.ts",
  "src/lib/report-schedule-reprojection.ts",
  "src/lib/dividend-reprojection.ts",
  "src/lib/server/corporate-events.ts",
];

const tickerLiteral = /["'`](?:[A-Z0-9]{2,8})(?:\.(?:WA|PL|UK|DE|US))?["'`]/g;
const tickerObjectKey = /^\s*([A-Z0-9]{2,8}(?:\.(?:WA|PL|UK|DE|US))?)\s*:/gm;
const identityReference = String.raw`(?:ticker|symbol|issuerName|companyName|instrumentTicker|sourceTicker|canonicalKey)`;
const decisionReference = new RegExp(
  String.raw`\b${identityReference}\b\s*(?:===|!==|==|!=|\.includes\(|\.startsWith\(|\.endsWith\()|\bswitch\s*\(\s*${identityReference}\s*\)[\s\S]{0,240}?\bcase\b`,
  "iu",
);
const identitySetDecision = new RegExp(
  String.raw`\bnew\s+Set\s*\(\s*\[[^\]]*["'` + "`" + String.raw`][A-Z0-9]{2,8}(?:\.(?:WA|PL|UK|DE|US))?["'` + "`" + String.raw`][^\]]*\]\s*\)\s*\.has\s*\(\s*${identityReference}\s*\)`,
  "iu",
);
const identityKeyedLookup = new RegExp(
  String.raw`\b[A-Za-z_$][\w$]*(?:override|exception|rule|map|byTicker|byIssuer)[A-Za-z_$]*\s*\[\s*${identityReference}\s*\]`,
  "iu",
);
const dateLiteral = /["'`](?:20\d{2})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])["'`]/g;
const dateDecisionReference = /\b(?:eventDate|date|publishedAt|fiscalYear|fiscalYearLabel)\b\s*(?:===|!==|==|!=|\.includes\(|\.startsWith\(|\.endsWith\()|\bswitch\s*\(\s*(?:eventDate|date|publishedAt|fiscalYear|fiscalYearLabel)\s*\)[\s\S]{0,240}?\bcase\b/iu;

const lineForOffset = (source, offset) => source.slice(0, offset).split("\n").length;

const registryRange = (source) => {
  const start = source.indexOf("GPW_ISSUER_SOURCE_REGISTRY");
  if (start < 0) return undefined;
  const end = source.indexOf("};", start);
  return end < 0 ? undefined : { start, end: end + 2 };
};

export const scanGpwParserPolicySources = ({ files, exceptions = [] }) => {
  const findings = [];
  const documentedExceptions = [];
  for (const { file, source } of files) {
    const registry = file === "src/lib/server/corporate-events.ts" ? registryRange(source) : undefined;
    if (registry) {
      const registrySource = source.slice(registry.start, registry.end);
      const exception = exceptions.find((entry) => entry.file === file && entry.symbol === "GPW_ISSUER_SOURCE_REGISTRY");
      for (const match of registrySource.matchAll(tickerObjectKey)) {
        const offset = registry.start + (match.index ?? 0);
        documentedExceptions.push({ file, line: lineForOffset(source, offset), literal: match[1], exception: exception?.symbol ?? null });
        if (!exception) {
          findings.push({
            code: "UNDOCUMENTED_TICKER_METADATA",
            file, line: lineForOffset(source, offset), literal: match[1],
            message: "Ticker-keyed source metadata has no explicit, versioned policy exception.",
          });
        }
      }
    }
    const addFinding = (entry) => {
      if (!findings.some((finding) => finding.file === entry.file && finding.line === entry.line && finding.code === entry.code)) {
        findings.push(entry);
      }
    };
    const isInRegistry = (offset) => registry && offset >= registry.start && offset <= registry.end;
    for (const match of source.matchAll(tickerLiteral)) {
      const offset = match.index ?? 0;
      const literal = match[0];
      const nearby = source.slice(Math.max(0, offset - 260), Math.min(source.length, offset + 260));
      const inRegistry = isInRegistry(offset);
      if (inRegistry) {
        const exception = exceptions.find((entry) => entry.file === file && entry.symbol === "GPW_ISSUER_SOURCE_REGISTRY");
        documentedExceptions.push({ file, line: lineForOffset(source, offset), literal, exception: exception?.symbol ?? null });
        if (!exception) {
          findings.push({
            code: "UNDOCUMENTED_TICKER_METADATA",
            file, line: lineForOffset(source, offset), literal,
            message: "Tickerowe metadane źródła nie mają jawnego, wersjonowanego wyjątku polityki.",
          });
        }
        continue;
      }
      if (decisionReference.test(nearby)) {
        addFinding({
          code: "TICKER_SPECIFIC_PARSER_DECISION",
          file, line: lineForOffset(source, offset), literal,
          message: "Warunek produkcyjny łączy identyfikator emitenta z decyzją parsera/projekcji.",
        });
      }
    }
    for (const match of source.matchAll(dateLiteral)) {
      const offset = match.index ?? 0;
      if (isInRegistry(offset)) continue;
      const nearby = source.slice(Math.max(0, offset - 260), Math.min(source.length, offset + 260));
      if (dateDecisionReference.test(nearby)) {
        addFinding({
          code: "DATE_SPECIFIC_PARSER_DECISION",
          file, line: lineForOffset(source, offset), literal: match[0],
          message: "Warunek produkcyjny łączy konkretną datę z decyzją parsera/projekcji.",
        });
      }
    }
    for (const pattern of [identitySetDecision, identityKeyedLookup]) {
      for (const match of source.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
        const offset = match.index ?? 0;
        if (isInRegistry(offset)) continue;
        addFinding({
          code: "TICKER_SPECIFIC_PARSER_DECISION",
          file, line: lineForOffset(source, offset), literal: match[0],
          message: "Produkcja wybiera zachowanie parsera/projekcji na podstawie tożsamości emitenta.",
        });
      }
    }
  }
  return {
    schemaVersion: 1,
    status: findings.length ? "FAIL" : "PASS",
    scannedFiles: files.map(({ file }) => file),
    findings,
    documentedExceptions,
    policy: "Tickerowe dane mogą być wyłącznie jawnymi metadanymi źródłowymi; parser i projekcja pozostają zależne od treści dokumentu. Skaner jest obroną leksykalną, a nie formalnym dowodem braku wszystkich możliwych wyjątków.",
  };
};

export const scanGpwParserPolicy = async ({ appRoot = localRoot } = {}) => {
  const exceptionPath = path.join(appRoot, "docs", "gpw-parser-policy-exceptions.json");
  const manifest = JSON.parse(await readFile(exceptionPath, "utf8"));
  const files = await Promise.all(defaultFiles.map(async (file) => ({
    file,
    source: await readFile(path.join(appRoot, file), "utf8"),
  })));
  return scanGpwParserPolicySources({ files, exceptions: manifest.exceptions ?? [] });
};

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gpwIndependentHoldout, gpwKnownAnnotatedCorpus, loadGpwSourceReviewQueue } from "./gpw-quality-corpus.mjs";
import { getAuditOutputDirectory, printArtifactSummary, renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const DEFAULT_SEED = "gpw-independent-intake-2026-10-26-v1";
const appRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

const normalizeIssuer = (value) => String(value ?? "")
  .normalize("NFKD").replace(/\p{M}/gu, "").replaceAll("Ł", "L").replaceAll("ł", "l")
  .toUpperCase().replace(/\b(?:SPOLKA\s+AKCYJNA|S\.?A\.?)\b/gu, "")
  .replace(/[^A-Z0-9]/gu, "");

const titleBucket = (title) => {
  if (/(?:waln\p{L}*\s+zgromadzen\p{L}*|\bNWZ\b|\bZWZ\b)/iu.test(title)) return "MEETING_LEAD";
  if (/dywidend|zaliczk\p{L}*\s+na\s+poczet\s+dywidend/iu.test(title)) return "DIVIDEND_LEAD";
  if (/(?:termin|harmonogram|kalendarz|korekt|zmian).{0,90}(?:raport|sprawozdan)/iu.test(title)) return "REPORT_LEAD";
  return "NEGATIVE_OR_OTHER_LEAD";
};

/** Selection uses only official source identity and title, never parser events. */
export const selectGpwHoldoutIntake = ({ documents, knownCorpus = [], priorQueue = [],
  seed = DEFAULT_SEED, target = 30 }) => {
  if (!Number.isInteger(target) || target < 1 || target > 100) throw new Error("Invalid holdout intake target.");
  const usedIssuers = new Set([...knownCorpus, ...priorQueue]
    .map((item) => normalizeIssuer(item.issuer)).filter(Boolean));
  const usedIsins = new Set([...knownCorpus, ...priorQueue]
    .map((item) => item.issuerIsin ?? item.sourceIsin).filter(Boolean));
  const usedUrls = new Set([...knownCorpus, ...priorQueue]
    .map((item) => item.sourceUrl).filter(Boolean));
  const eligible = documents.filter((document) => document.parseStatus === "PARSED" &&
    document.sourceIsin && /^https:\/\/www\.gpw\.pl\/komunikat\?/.test(document.sourceUrl) &&
    !usedIssuers.has(normalizeIssuer(document.issuer)) && !usedIsins.has(document.sourceIsin) &&
    !usedUrls.has(document.sourceUrl))
    .map((document) => ({ ...document, bucket: titleBucket(document.title),
      rank: createHash("sha256").update(`${seed}:${document.id}`).digest("hex") }))
    .sort((left, right) => left.rank.localeCompare(right.rank));

  const quotas = [
    ["REPORT_LEAD", 8], ["MEETING_LEAD", 6], ["DIVIDEND_LEAD", 6],
    ["NEGATIVE_OR_OTHER_LEAD", 10],
  ];
  let quotaBudget = target;
  const targetQuotas = quotas.map(([bucket, count]) => {
    const desired = Math.min(count, quotaBudget);
    quotaBudget -= desired;
    return [bucket, desired];
  });
  const selected = [];
  const issuerIds = new Set();
  const issuerNames = new Set();
  const take = (bucket, count) => {
    for (const document of eligible) {
      if (count <= 0) break;
      if (bucket && document.bucket !== bucket) continue;
      if (issuerIds.has(document.sourceIsin)) continue;
      if (issuerNames.has(normalizeIssuer(document.issuer))) continue;
      selected.push(document);
      issuerIds.add(document.sourceIsin);
      issuerNames.add(normalizeIssuer(document.issuer));
      count -= 1;
    }
  };
  for (const [bucket, count] of targetQuotas) take(bucket, count);
  take(null, target - selected.length);

  return {
    schemaVersion: 1, status: selected.length >= target ? "ANNOTATION_PENDING" : "INSUFFICIENT_ISSUER_DIVERSE_POOL",
    sourceAuditWindow: null, selectionSeed: seed, target, selectedCount: selected.length,
    selectionPolicy: "One GPW report per ISIN and normalized issuer name, excluding issuers and URLs in development fixtures and previous review intake; deterministic SHA-256 order with title-only diversity quotas. Parser events were not consulted.",
    warning: "These are source-review candidates, not gold labels or independently double-annotated holdout. Expected events remain unknown until two independent source reviews.",
    categoryCounts: Object.fromEntries([...new Set(selected.map((item) => item.bucket))]
      .sort().map((bucket) => [bucket, selected.filter((item) => item.bucket === bucket).length])),
    unmetTitleQuotas: Object.fromEntries(targetQuotas.map(([bucket, count]) => [bucket,
      Math.max(0, count - selected.filter((item) => item.bucket === bucket).length)])),
    documents: selected.map((document) => ({
      id: document.id, issuer: document.issuer, issuerIsin: document.sourceIsin,
      sourceUrl: document.sourceUrl, sourceTitle: document.title, publishedAt: document.publishedAt,
      sourceBodyHash: document.bodyHash ?? null,
      sourceHtmlWasParsed: true, attachmentReadIncomplete: document.fetchStatus === "PARTIAL",
      titleOnlyIntakeBucket: document.bucket, reviewStatus: "PENDING_INDEPENDENT_SOURCE_ANNOTATION",
      expectedEvents: null, reviewers: [],
    })),
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourcePath = path.join(appRoot, "artifacts", "gpw-quality", "sources.json");
  const sources = JSON.parse(await readFile(sourcePath, "utf8"));
  const queue = await loadGpwSourceReviewQueue();
  const report = selectGpwHoldoutIntake({ documents: sources.documents,
    knownCorpus: [...gpwKnownAnnotatedCorpus, ...gpwIndependentHoldout], priorQueue: queue.documents });
  report.sourceAuditWindow = {
    from: sources.sourcePublicationHorizon?.from ?? sources.scope?.dates?.[0] ?? null,
    to: sources.sourcePublicationHorizon?.to ?? sources.scope?.dates?.at(-1) ?? null,
  };
  const artifacts = await writeGpwQualityArtifacts({ outputDir: getAuditOutputDirectory(),
    basename: "holdout-intake", report,
    markdown: renderGenericMarkdown("GPW independent holdout intake", [
      { heading: "Status", body: `**${report.status}**. ${report.warning}` },
      { heading: "Selection", body: `Seed: ${report.selectionSeed}; selected: ${report.selectedCount}/${report.target}; publication window: ${report.sourceAuditWindow.from}–${report.sourceAuditWindow.to}.` },
      { heading: "Category leads", body: Object.entries(report.categoryCounts).map(([name, count]) => `- ${name}: ${count}`).join("\n") },
      { heading: "Review queue", body: report.documents.map((document) =>
        `- ${document.id} · ${document.issuer} · ${document.titleOnlyIntakeBucket} · [official source](${document.sourceUrl}) · **annotation pending**`).join("\n") },
    ]),
  });
  printArtifactSummary({ name: "gpw:holdout:intake", status: report.status, artifacts,
    summary: { selected: report.selectedCount, titleBuckets: report.categoryCounts,
      unmetQuotas: report.unmetTitleQuotas } });
}

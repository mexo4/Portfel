import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { appRoot, getAuditOutputDirectory, getOption, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";
import { compareOfficialSource, extractOfficialGpwReport } from "./gpw-independent-source-check.mjs";

const artifact = (name) => path.join(appRoot, "artifacts", "gpw-quality", name);
const proposalPath = path.resolve(appRoot, getOption("proposal") ?? artifact("scoped-repair-proposal.json"));
const snapshotPath = path.resolve(appRoot, getOption("snapshot") ?? artifact("reprojection-snapshot.json"));
const [proposal, snapshot] = await Promise.all([proposalPath, snapshotPath]
  .map(async (filename) => JSON.parse(await readFile(filename, "utf8"))));
assert.equal(proposal.counts.mutations, 32, "Unexpected scoped mutation count");
assert.equal(proposal.counts.unchangedControls, 10, "Unexpected NO_CHANGE control count");
assert.equal(proposal.actions.length, 42, "The full scoped matrix must be present");
assert.equal(proposal.actions.filter((item) => item.decision === "NO_CHANGE").length, 10);
for (const item of proposal.actions.filter((action) => action.decision === "NO_CHANGE")) {
  for (const field of ["eventDate", "identity", "status", "active"])
    assert.equal(item.before[field], item.after[field], `NO_CHANGE control drift: ${item.eventId}/${field}`);
}
assert.ok(proposal.excludedReviews.some((item) => item.documentId === "gpw:499257"),
  "The unresolved GPW document must remain excluded");
assert.equal(proposal.sourceSnapshotFingerprint, snapshot.fingerprint, "Proposal/snapshot mismatch");

const sources = new Map();
const urls = [...new Set(proposal.actions.flatMap((action) => action.officialUrls ?? []))]
  .filter((url) => /^https:\/\/www\.gpw\.pl\/komunikat\?geru_id=\d+(?:&|$)/u.test(url));
const noNetwork = process.argv.includes("--offline");
const sourceCachePath = artifact("automated-source-cache.json");
const checkpoint = noNetwork ? JSON.parse(await readFile(path.resolve(appRoot,
  getOption("checkpoint") ?? sourceCachePath), "utf8")) : null;
for (const url of urls) {
  let fetchedAt = new Date().toISOString();
  let document = null;
  let failure = null;
  try {
    if (noNetwork) {
      const cached = Object.values(checkpoint.entries).find((entry) =>
        new URL(entry.url).searchParams.get("geru_id") === new URL(url).searchParams.get("geru_id"));
      if (!cached) throw new Error("CHECKPOINT_ENTRY_MISSING");
      fetchedAt = cached.checkedAt;
      document = cached.extracted ?? cached.document;
    } else {
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000),
        headers: { "User-Agent": "MexoGPWSourceAudit/1.0", Accept: "text/html" }, cache: "no-store" });
      if (!response.ok) throw new Error(`OFFICIAL_HTTP_${response.status}`);
      const html = await response.text();
      if (html.length > 1_500_000) throw new Error("OFFICIAL_RESPONSE_TOO_LARGE");
      document = html;
    }
  } catch (error) { failure = error instanceof Error ? error.message : "SOURCE_FETCH_FAILED"; }
  const extracted = document && typeof document === "object" ? document
    : document ? extractOfficialGpwReport(document) : null;
  if (!extracted && !failure) failure = "OFFICIAL_REPORT_BODY_MISSING";
  sources.set(url, { fetchedAt, failure, document: extracted });
}
if (!noNetwork) {
  await mkdir(path.dirname(sourceCachePath), { recursive: true });
  await writeFile(sourceCachePath, JSON.stringify({
  sourceMode: "LIVE_OFFICIAL_GPW", entries: Object.fromEntries([...sources].map(([url, value]) =>
    [url, { url, checkedAt: value.fetchedAt, extracted: value.document, failure: value.failure }])),
  }, null, 2));
}

const instruments = new Map(snapshot.instruments.map((instrument) => [instrument.id, instrument]));
const byId = new Map(proposal.actions.map((action) => [action.eventId, action]));
const records = proposal.actions.map((action) => {
  const instrument = instruments.get(action.issuerId);
  const related = (action.relatedActionIds ?? []).map((id) => byId.get(id)).filter(Boolean);
  const sourceResults = (action.officialUrls ?? []).map((url) => {
    const fetched = sources.get(url);
    const checked = compareOfficialSource({ ...action, issuerIsin: instrument?.isin },
      fetched?.document, related);
    return { url, communicationId: new URL(url).searchParams.get("geru_id"),
      fetchedAt: fetched?.fetchedAt ?? null, sourceFailure: fetched?.failure ?? null,
      sourceIsin: fetched?.document?.isin ?? null, reportNumber: fetched?.document?.reportNumber ?? null,
      sourcePublishedAt: fetched?.document?.sourcePublishedAt ?? null, ...checked };
  });
  const available = sourceResults.filter((source) => source.status !== "SOURCE_UNAVAILABLE");
  const statuses = new Set(available.map((source) => source.status));
  const status = !available.length ? "SOURCE_UNAVAILABLE"
    : statuses.has("CONFLICT") && statuses.has("AUTO_EVIDENCE_MATCH") ? "NEEDS_REVIEW"
      : statuses.has("CONFLICT") ? "CONFLICT"
        : statuses.has("AUTO_EVIDENCE_MATCH") && !statuses.has("NEEDS_REVIEW")
          ? "AUTO_EVIDENCE_MATCH" : "NEEDS_REVIEW";
  return { eventId: action.eventId, issuerId: action.issuerId,
    issuer: instrument?.company_name ?? null, ticker: instrument?.ticker ?? null,
    isin: instrument?.isin ?? null, eventType: action.eventType, action: action.decision,
    current: action.before, proposed: action.after, relatedEventIds: action.relatedActionIds ?? [],
    sourceResults, status, controlUnchanged: action.decision === "NO_CHANGE" ? true : undefined,
    machineEvidenceSufficient: status === "AUTO_EVIDENCE_MATCH",
    rationale: status === "AUTO_EVIDENCE_MATCH"
      ? "Independent, conservative source-to-projection checks matched; not a human approval"
      : [...new Set(sourceResults.map((source) => source.reason))].join("; ") };
});
const counts = Object.fromEntries(["AUTO_EVIDENCE_MATCH", "CONFLICT", "NEEDS_REVIEW", "SOURCE_UNAVAILABLE"]
  .map((status) => [status, records.filter((record) => record.action !== "NO_CHANGE" && record.status === status).length]));
const report = { schemaVersion: 1, kind: "INDEPENDENT_MACHINE_EVIDENCE_NOT_APPROVAL",
  generatedAt: new Date().toISOString(), sourceMode: noNetwork ? "LOCAL_CHECKPOINT" : "LIVE_OFFICIAL_GPW",
  snapshotFingerprint: snapshot.fingerprint, proposalFingerprint: proposal.sourceManifestFingerprint,
  communicationCount: urls.length, counts, unchangedControls: records.filter((record) => record.action === "NO_CHANGE").length,
  excludedReview: proposal.excludedReviews.map((item) => item.documentId),
  limitations: ["Machine comparison is not a reviewer signature or authorization to repair Aiven.",
    "A missing item in one schedule cannot prove no separate report was ever announced.",
    "Unavailable sources or unsupported attachments remain unresolved; no CAPTCHA bypass."], records };
const cell = (value) => String(value ?? "—").replace(/\|/gu, "\\|").replace(/\s+/gu, " ").slice(0, 220);
const state = (value) => [value?.eventDate, value?.identity, value?.status, String(value?.active)]
  .map(cell).join(" · ");
const rows = records.map((record) => {
  const first = record.sourceResults[0];
  const excerpt = record.sourceResults.find((result) => result.evidence)?.evidence ??
    first?.dates?.[0]?.context ?? "—";
  const links = record.sourceResults.map((result) => result.url
    ? `[GPW ${result.communicationId}](${result.url})` : "—").join(", ");
  return `| \`${record.eventId}\` | ${cell(record.ticker)} | ${record.action} | ${cell(state(record.current))} | ${cell(state(record.proposed))} | ${record.status} | ${cell(excerpt)} | ${cell(record.rationale)} | ${links} |`;
});
const markdown = `# Niezależny automatyczny audyt źródeł GPW

**Wynik maszynowy, nie zatwierdzenie korekt produkcyjnych.** Źródło: ${report.sourceMode}; pobrano ${urls.length} unikalnych komunikatów. Snapshot jest historyczny (${snapshot.capturedAt}); nie stanowi świeżego stanu Aiven.

32 modyfikacje: AUTO_EVIDENCE_MATCH ${counts.AUTO_EVIDENCE_MATCH}, CONFLICT ${counts.CONFLICT}, NEEDS_REVIEW ${counts.NEEDS_REVIEW}, SOURCE_UNAVAILABLE ${counts.SOURCE_UNAVAILABLE}. Dziesięć NO_CHANGE jest kontrolą niezmienności. \`gpw:499257\` pozostaje REVIEW poza zakresem.

| Pełne eventId | Ticker | Działanie | Obecnie | Propozycja | Wynik | Fragment GPW | Powód | Źródło |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

Każdy wpis w JSON zawiera obecny/proponowany stan, numer komunikatu, czas pobrania, fragment i semantyczne role dat oraz powiązane rekordy. Wynik nie zmienia globalnej bramki NO-GO, decyzji recenzentów ani danych.
`;
const artifacts = await writeGpwQualityArtifacts({ outputDir: getAuditOutputDirectory(),
  basename: "automated-source-audit", report, markdown });
console.log(JSON.stringify({ name: "gpw:automated-source-audit", ...counts,
  controls: report.unchangedControls, communications: urls.length, artifacts }));

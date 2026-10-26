import assert from "node:assert/strict";
import test from "node:test";
import { getGpwAuditDates, runGpwSourceAudit } from "../src/lib/gpw-source-audit.ts";
import { assessGpwQualityGate } from "../scripts/gpw-quality-gate.mjs";

const candidate = (number, title = "Komunikat") => ({
  sourceId: `gpw:${number}`, sourceUrl: `https://www.gpw.pl/komunikat?geru_id=${number}`,
  sourceTitle: title, issuerName: `Issuer ${number}`, sourceIsin: `PL${String(number).padStart(10, "0")}`,
  sourcePublishedAt: "2026-10-25T10:00:00.000Z",
});
const detail = (entry) => ({
  sourceId: entry.sourceId, sourceUrl: entry.sourceUrl, sourceTitle: entry.sourceTitle,
  issuerName: entry.issuerName, sourceIsin: entry.sourceIsin, market: "GPW",
  reportType: "CURRENT", publishedAt: entry.sourcePublishedAt,
  title: entry.sourceTitle, body: "Dokument źródłowy z terminem publikacji.",
  category: "FINANCIAL_RESULTS", isCorrection: false, attachments: [],
});

test("read-only source audit walks all official result pages, including generic titles", async () => {
  const offsets = [];
  const entries = Array.from({ length: 51 }, (_, index) => candidate(index + 1));
  const report = await runGpwSourceAudit({
    fetchPage: async (_date, offset) => { offsets.push(offset); return { status: "SUCCESS", document: String(offset) }; },
    parseList: (html) => {
      const offset = Number(html);
      return { candidates: entries.slice(offset, offset + 50), eligibleRows: entries.slice(offset, offset + 50).length, malformedRows: 0 };
    },
    fetchDocument: async () => ({ status: "SUCCESS", document: "full official detail" }),
    parseDetail: (_html, entry) => detail(entry),
    parseEvents: () => [{ eventType: "QUARTERLY_REPORT", eventDate: "2026-11-20", fiscalPeriod: "Q3", fiscalYear: 2026, isScheduleChange: false }],
  }, { dates: ["2026-10-25"], maxPagesPerDate: 3, maxDocuments: 51 });

  assert.deepEqual(offsets, [0, 50]);
  assert.equal(report.status, "SOURCE_WINDOW_COMPLETE_NOT_MARKET_COMPLETE");
  assert.equal(report.counts.discovered, 51);
  assert.equal(report.counts.sourceEvents, 51);
  assert.equal(report.sourceEvents[50].issuer, entries[50].sourceIsin);
});

test("source audit fails open neither on pagination cap nor missing detail", async () => {
  const report = await runGpwSourceAudit({
    fetchPage: async () => ({ status: "SUCCESS", document: "same" }),
    parseList: () => ({ candidates: [candidate(1, "Harmonogram raportów")], eligibleRows: 50, malformedRows: 0 }),
    fetchDocument: async () => ({ status: "ACCESS_DENIED", document: "" }),
    parseDetail: () => null,
    parseEvents: () => [],
  }, { dates: ["2026-10-25"], maxPagesPerDate: 2, maxDocuments: 1 });
  assert.equal(report.status, "SOURCE_AUDIT_INCOMPLETE");
  assert.equal(report.coverage[0].reason, "REPEATED_PAGE");
  assert.equal(report.coverage[0].nextOffset, 50);
  assert.ok(report.findings.some((finding) => finding.code === "SOURCE_NOT_FETCHED"));
  assert.ok(report.findings.every((finding) => finding.confidence === "REVIEW"));
});

test("a subsidiary-only distribution is not counted as a missed issuer dividend", async () => {
  const entry = candidate(203, "Dywidenda wypłacana przez spółkę zależną Emitenta");
  const report = await runGpwSourceAudit({
    fetchPage: async () => ({ status: "SUCCESS", document: "one result" }),
    parseList: () => ({ candidates: [entry], eligibleRows: 1, malformedRows: 0 }),
    fetchDocument: async () => ({ status: "SUCCESS", document: "official detail" }),
    parseDetail: () => ({ ...detail(entry), category: "DIVIDEND",
      body: "Spółki zależnej Emitenta dotyczy wypłata akcjonariuszom tej spółki zaliczki na poczet dywidendy." }),
    parseEvents: () => [],
  }, { dates: ["2026-10-25"], maxPagesPerDate: 2, maxDocuments: 1 });
  assert.equal(report.counts.sourceEvents, 0);
  assert.equal(report.findings.some((finding) => finding.code === "PARSER_MISSED_EVENT"), false);
});

test("two identical whitespace-only responses remain unverified, while explicit no-results is complete", async () => {
  let calls = 0;
  const adapters = {
    fetchPage: async () => { calls += 1; return { status: "SUCCESS", document: "\n\t\r\n" }; },
    parseList: () => ({ candidates: [], eligibleRows: 0, malformedRows: 0 }),
    fetchDocument: async () => ({ status: "SUCCESS", document: "" }),
    parseDetail: () => null,
    parseEvents: () => [],
  };
  const rechecked = await runGpwSourceAudit(adapters,
    { dates: ["2026-10-25"], maxPagesPerDate: 2, maxDocuments: 1 });
  assert.equal(calls, 2);
  assert.equal(rechecked.coverage[0].status, "INCOMPLETE");
  assert.equal(rechecked.coverage[0].reason, "EMPTY_LIST_UNVERIFIED");
  assert.equal(rechecked.coverage[0].emptyRechecked, true);

  const complete = await runGpwSourceAudit({ ...adapters,
    fetchPage: async () => ({ status: "SUCCESS", document: "Brak wyników" }),
  }, { dates: ["2026-10-25"], maxPagesPerDate: 2, maxDocuments: 1 });
  assert.equal(complete.coverage[0].status, "COMPLETE");

  let inconsistentCalls = 0;
  const inconsistent = await runGpwSourceAudit({ ...adapters,
    fetchPage: async () => ({ status: "SUCCESS", document: ++inconsistentCalls === 1 ? "\n\t" : "changed response" }),
  }, { dates: ["2026-10-25"], maxPagesPerDate: 2, maxDocuments: 1 });
  assert.equal(inconsistent.coverage[0].status, "INCOMPLETE");
  assert.equal(inconsistent.coverage[0].reason, "EMPTY_LIST_UNVERIFIED");

  const unstable = await runGpwSourceAudit({ ...adapters,
    fetchPage: async () => ({ status: "TEMPORARILY_UNAVAILABLE", document: "" }),
  }, { dates: ["2026-10-25"], maxPagesPerDate: 2, maxDocuments: 1 });
  assert.equal(unstable.coverage[0].status, "INCOMPLETE");
});

test("source audit extracts the official PDF attachment and distinguishes missing attachments", async () => {
  const entries = [candidate(1), candidate(2)];
  const report = await runGpwSourceAudit({
    fetchPage: async () => ({ status: "SUCCESS", document: "official listing" }),
    parseList: () => ({ candidates: entries, eligibleRows: 2, malformedRows: 0 }),
    fetchDocument: async () => ({ status: "SUCCESS", document: "official detail" }),
    parseDetail: (_html, entry) => ({ ...detail(entry), body: "No announced event in HTML.",
      attachments: [{ sourceUrl: `https://www.gpw.pl/${entry.sourceId === "gpw:1" ? "available" : "missing"}.pdf`, name: "report.pdf" }] }),
    readAttachment: async (url) => url.includes("available")
      ? "Raport roczny za rok 2026 zostanie opublikowany 5 kwietnia 2027 roku." : undefined,
    parseEvents: (text) => text.includes("5 kwietnia")
      ? [{ eventType: "ANNUAL_REPORT", eventDate: "2027-04-05", fiscalPeriod: "FY", fiscalYear: 2026, isScheduleChange: false }]
      : [],
  }, { dates: ["2026-10-25"], maxPagesPerDate: 2, maxDocuments: 2 });
  assert.equal(report.sourceEvents.length, 1);
  assert.equal(report.documents[0].attachmentsRead, 1);
  assert.equal(report.documents[0].fetchStatus, "FETCHED");
  assert.equal(report.documents[1].fetchStatus, "PARTIAL");
  assert.equal(report.status, "SOURCE_AUDIT_INCOMPLETE");
});

test("source audit marks a page-capped official PDF as partial even when text was extracted", async () => {
  const report = await runGpwSourceAudit({
    fetchPage: async () => ({ status: "SUCCESS", document: "official listing" }),
    parseList: () => ({ candidates: [candidate(3)], eligibleRows: 1, malformedRows: 0 }),
    fetchDocument: async () => ({ status: "SUCCESS", document: "official detail" }),
    parseDetail: (_html, entry) => ({ ...detail(entry), attachments: [
      { sourceUrl: "https://www.gpw.pl/long.pdf", name: "long.pdf" },
    ] }),
    readAttachment: async () => ({ text: "Raport roczny za rok 2026 zostanie opublikowany 5 kwietnia 2027 roku.",
      pagesRead: 16, totalPages: 20, truncated: true }),
    parseEvents: () => [],
  }, { dates: ["2026-10-25"], maxPagesPerDate: 2, maxDocuments: 1 });
  assert.equal(report.documents[0].attachmentsRead, 1);
  assert.equal(report.documents[0].attachmentsTruncated, 1);
  assert.equal(report.documents[0].fetchStatus, "PARTIAL");
  assert.equal(report.status, "SOURCE_AUDIT_INCOMPLETE");
});

test("source dates reject invalid or unbounded windows", () => {
  assert.deepEqual(getGpwAuditDates("2026-10-25", "2026-10-26"), ["2026-10-25", "2026-10-26"]);
  assert.throws(() => getGpwAuditDates("2026-02-30", "2026-03-01"));
  assert.throws(() => getGpwAuditDates("2026-10-26", "2026-10-25"));
  assert.throws(() => getGpwAuditDates("2026-01-01", "2027-12-31"));
});

test("strict quality gate rejects green fixtures without sources, holdout, PostgreSQL and API/ICS", () => {
  const decision = assessGpwQualityGate({
    audit: { qualityGate: { parserRegressionFree: true, fullIndependentAuditReady: false }, antiTickerPolicy: { status: "PASS" }, findings: [] },
    sources: { status: "SOURCE_WINDOW_COMPLETE_NOT_MARKET_COMPLETE", coverage: [{ status: "COMPLETE" }], counts: { pending: 0, partial: 0 }, findings: [] },
    projections: { status: "SOURCE_WINDOW_PROJECTIONS_MATCH", databaseState: "READ_ONLY_SNAPSHOT_PASS", scope: { sourceStatus: "SOURCE_WINDOW_COMPLETE_NOT_MARKET_COMPLETE", publicApi: "NOT_RUN", ics: "NOT_RUN" }, findings: [] },
    e2e: { status: "UNIT_ONLY" },
  });
  assert.equal(decision.status, "NO_GO");
  assert.equal(decision.stages.regression, "PASS_REGRESSION_ONLY");
  assert.equal(decision.stages.postgres, "POSTGRES_E2E_NOT_RUN");
  assert.ok(decision.reasons.some((reason) => reason.includes("HOLDOUT_NOT_VERIFIED")));
});

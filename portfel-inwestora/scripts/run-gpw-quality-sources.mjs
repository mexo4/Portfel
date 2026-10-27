import { fetchGpwList, fetchOfficialHtml } from "../src/lib/server/espi.ts";
import { parseGpwEspiList, parseGpwEspiReport } from "../src/lib/espi.ts";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { inspectOfficialMeetingPdf, isTrustedMeetingPdfUrl } from "../src/lib/server/general-meeting-pdf.ts";
import { getGpwAuditDates, runGpwSourceAudit } from "../src/lib/gpw-source-audit.ts";
import { createGpwAuditCheckpoint } from "./gpw-audit-checkpoint.mjs";
import { getAuditOutputDirectory, getOption, printArtifactSummary, renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const warsawToday = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const today = warsawToday();
const from = getOption("from") ?? today;
const to = getOption("to") ?? from;
const maxPagesPerDate = Number(getOption("max-pages-per-date") ?? 20);
const maxDocuments = Number(getOption("max-documents") ?? 100);
const dates = getGpwAuditDates(from, to);
const eventFrom = getOption("event-from") ?? today;
getGpwAuditDates(eventFrom, eventFrom);
const defaultEventTo = new Date(Date.parse(`${eventFrom}T12:00:00Z`) + 365 * 86_400_000)
  .toISOString().slice(0, 10);
const eventTo = getOption("event-to") ?? defaultEventTo;
getGpwAuditDates(eventFrom, eventTo);
const outputDir = getAuditOutputDirectory();
const resume = process.argv.includes("--resume");
const checkpoint = await createGpwAuditCheckpoint({ outputDir, resume });
const formatDate = (date) => date.split("-").reverse().join("-");

// Exactly the official GPW listing/detail adapter used by the synchronizer.
// No synchronization, locks, database helpers, or production writes are called.
const report = await runGpwSourceAudit({
  fetchPage: (date, offset) => fetchGpwList({ date: formatDate(date), offset }),
  parseList: parseGpwEspiList,
  fetchDocument: (url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.gpw.pl" || parsed.pathname !== "/komunikat") {
      throw new Error("Only official GPW report detail URLs are allowed in this audit.");
    }
    return checkpoint.fetchDocument(url, () => fetchOfficialHtml(url));
  },
  parseDetail: parseGpwEspiReport,
  parseEvents: parseCorporateEventDocument,
  readAttachment: async (url) => {
    if (!isTrustedMeetingPdfUrl(url)) return { status: "UNREADABLE", reason: "UNTRUSTED_URL" };
    const result = await checkpoint.readAttachment(url, inspectOfficialMeetingPdf);
    return result.status === "READ" ? result.read : result;
  },
}, { dates, maxPagesPerDate, maxDocuments, eventWindow: { from: eventFrom, to: eventTo } });
report.scope.checkpoint = { resumeEnabled: resume, ...checkpoint.counters,
  note: "Only public source HTML and bounded attachment diagnostics are persisted under ignored audit artifacts; parser outputs are recalculated." };

const artifacts = await writeGpwQualityArtifacts({
  outputDir, basename: "sources", report,
  markdown: renderGenericMarkdown("GPW official source audit (read-only)", [
    { heading: "Coverage", body: `- Status: **${report.status}**\n- Publication dates: ${from}–${to}\n- Discovered: ${report.counts.discovered}; fetched: ${report.counts.fetched}; parsed: ${report.counts.parsed}; partial: ${report.counts.partial}; rejected: ${report.counts.rejected}; pending: ${report.counts.pending}\n- Attachment issues: ${Object.entries(report.attachmentIssueCounts).map(([code, count]) => `${code}=${count}`).join(", ") || "none"}\n- Parser event hypotheses: ${report.counts.sourceEvents}\n- This is a bounded date-window audit, not a statement of market completeness.` },
    { heading: "Two independent horizons", body: `- Source publications: ${report.sourcePublicationHorizon.from}–${report.sourcePublicationHorizon.to}; ${report.sourcePublicationHorizon.completeDays}/${report.sourcePublicationHorizon.auditedDays} daily cursors complete; ${report.sourcePublicationHorizon.status}; not market-complete.\n- Requested future event dates: ${report.futureEventHorizon.from}–${report.futureEventHorizon.to}; observed parser-hypothesis dates: ${report.futureEventHorizon.observedEventDateMin ?? "none"}–${report.futureEventHorizon.observedEventDateMax ?? "none"}; ${report.futureEventHorizon.parserHypotheses} unverified hypotheses; ${report.futureEventHorizon.status}.\n- A complete publication-date window does not establish complete future events.` },
    { heading: "Attachment evidence", body: `- Documents with no attachments: ${report.counts.documentsWithoutAttachments}.\n- Partial documents where HTML produced an event hypothesis: ${report.counts.partialWithHtmlEventHypotheses}.\n- Partial documents with no HTML event hypothesis: ${report.counts.partialWithoutHtmlEventHypotheses}.\n- Neither group proves attachment dispensability; unresolved files require source review.\n- Issues by actual cause: ${Object.entries(report.attachmentIssueCounts).map(([code, count]) => `${code}=${count}`).join(", ") || "none"}.` },
    { heading: "Bounded checkpoint and retry", body: `- Resume enabled: ${resume}.\n- Cached official detail pages reused: ${checkpoint.counters.cachedDetailsReused}.\n- Previously unresolved non-transient attachment results reused within 24 hours: ${checkpoint.counters.attachmentFailuresReused}.\n- Transient attachment retries: ${checkpoint.counters.transientRetries}.\n- Attachment checks: ${checkpoint.counters.attachmentChecks}.\n- No CAPTCHA or access restriction is bypassed; rerun without --resume to probe fresh source responses.` },
    { heading: "Date cursors", body: report.coverage.map((item) => `- ${item.date}: ${item.status}, pages=${item.pagesRead}, rows=${item.eligibleRows}, malformed=${item.malformedRows}, nextOffset=${item.nextOffset ?? "none"}, reason=${item.reason ?? "none"}`).join("\n") },
    { heading: "Findings for review", body: report.findings.length ? report.findings.map((item) => `- ${item.code}: ${item.sourceId ?? "date window"} ${item.sourceUrl ?? ""} — ${item.reason}`).join("\n") : "- None in the bounded window; this does not prove that the parser found every event." },
    { heading: "Limitations", body: report.scope.limitations.map((item) => `- ${item}`).join("\n") },
  ]),
});
printArtifactSummary({ name: "gpw:audit:sources", status: report.status, artifacts, summary: report.counts });

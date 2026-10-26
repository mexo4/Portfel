import { fetchGpwList, fetchOfficialHtml } from "../src/lib/server/espi.ts";
import { parseGpwEspiList, parseGpwEspiReport } from "../src/lib/espi.ts";
import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { readOfficialMeetingPdfWithCoverage } from "../src/lib/server/general-meeting-pdf.ts";
import { getGpwAuditDates, runGpwSourceAudit } from "../src/lib/gpw-source-audit.ts";
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
    return fetchOfficialHtml(url);
  },
  parseDetail: parseGpwEspiReport,
  parseEvents: parseCorporateEventDocument,
  readAttachment: readOfficialMeetingPdfWithCoverage,
}, { dates, maxPagesPerDate, maxDocuments });

const artifacts = await writeGpwQualityArtifacts({
  outputDir: getAuditOutputDirectory(), basename: "sources", report,
  markdown: renderGenericMarkdown("GPW official source audit (read-only)", [
    { heading: "Coverage", body: `- Status: **${report.status}**\n- Publication dates: ${from}–${to}\n- Discovered: ${report.counts.discovered}; fetched: ${report.counts.fetched}; parsed: ${report.counts.parsed}; partial: ${report.counts.partial}; rejected: ${report.counts.rejected}; pending: ${report.counts.pending}\n- Parser event hypotheses: ${report.counts.sourceEvents}\n- This is a bounded date-window audit, not a statement of market completeness.` },
    { heading: "Date cursors", body: report.coverage.map((item) => `- ${item.date}: ${item.status}, pages=${item.pagesRead}, rows=${item.eligibleRows}, malformed=${item.malformedRows}, nextOffset=${item.nextOffset ?? "none"}, reason=${item.reason ?? "none"}`).join("\n") },
    { heading: "Findings for review", body: report.findings.length ? report.findings.map((item) => `- ${item.code}: ${item.sourceId ?? "date window"} ${item.sourceUrl ?? ""} — ${item.reason}`).join("\n") : "- None in the bounded window; this does not prove that the parser found every event." },
    { heading: "Limitations", body: report.scope.limitations.map((item) => `- ${item}`).join("\n") },
  ]),
});
printArtifactSummary({ name: "gpw:audit:sources", status: report.status, artifacts, summary: report.counts });

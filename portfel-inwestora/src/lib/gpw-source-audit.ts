import { createHash } from "node:crypto";
import { getCorporateEventIdentityKey, isSubsidiaryOnlyDividendNotice, type ParsedCorporateEvent } from "@/lib/corporate-events";
import type { PapEspiListCandidate, ParsedPapEspiReport } from "@/lib/espi";

type FetchResult = { status: string; document: string };
type ListResult = { candidates: PapEspiListCandidate[]; eligibleRows: number; malformedRows: number };

export type GpwSourceAuditAdapters = {
  fetchPage: (date: string, offset: number) => Promise<FetchResult>;
  parseList: (document: string) => ListResult;
  fetchDocument: (url: string) => Promise<FetchResult>;
  parseDetail: (document: string, candidate: PapEspiListCandidate) => ParsedPapEspiReport | null;
  parseEvents: (document: string) => ParsedCorporateEvent[];
  readAttachment?: (url: string) => Promise<string | { text: string; pagesRead: number; totalPages: number; truncated: boolean } | undefined>;
};

export type GpwSourceAuditOptions = {
  dates: readonly string[];
  maxPagesPerDate: number;
  maxDocuments: number;
};

const sourceEventTypes = new Set(["QUARTERLY_REPORT", "HALF_YEAR_REPORT", "ANNUAL_REPORT", "GENERAL_MEETING", "UPCOMING_DIVIDEND"]);
const potentialEventTitle = /(?:termin|harmonogram|kalendarz|dat).{0,90}(?:publikacj|przekazywan).{0,70}(?:raport|sprawozdan)|(?:termin|harmonogram|kalendarz).{0,80}raport|(?:zwołan|zwolan|ogłoszen|ogloszen).{0,80}(?:walne|zgromadzen)|dywidend/iu;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const getGpwAuditDates = (from: string, to: string, maxDays = 370) => {
  if (!isoDate.test(from) || !isoDate.test(to)) throw new Error("Audit dates must use YYYY-MM-DD.");
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ||
      start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to || start > end) {
    throw new Error("Invalid GPW audit date range.");
  }
  const dates: string[] = [];
  for (let day = start.getTime(); day <= end.getTime(); day += 86_400_000) {
    if (dates.length >= maxDays) throw new Error(`GPW audit range exceeds ${maxDays} days.`);
    dates.push(new Date(day).toISOString().slice(0, 10));
  }
  return dates;
};

export const runGpwSourceAudit = async (adapters: GpwSourceAuditAdapters, options: GpwSourceAuditOptions) => {
  if (!Number.isInteger(options.maxPagesPerDate) || options.maxPagesPerDate < 1 || options.maxPagesPerDate > 40 ||
      !Number.isInteger(options.maxDocuments) || options.maxDocuments < 1 || options.maxDocuments > 50_000) {
    throw new Error("Audit page/document limits are invalid.");
  }
  const discovered = new Map<string, PapEspiListCandidate>();
  const coverage: Array<{
    date: string; pagesRead: number; eligibleRows: number; malformedRows: number;
    status: "COMPLETE" | "INCOMPLETE"; reason?: string; nextOffset?: number;
    emptyRechecked?: boolean;
  }> = [];
  const findings: Array<{
    code: string; confidence: "REVIEW"; sourceId?: string; sourceUrl?: string; reason: string;
  }> = [];

  for (const date of options.dates) {
    let pagesRead = 0;
    let eligibleRows = 0;
    let malformedRows = 0;
    let reason: string | undefined;
    let nextOffset: number | undefined;
    let emptyRechecked = false;
    const signatures = new Set<string>();
    for (let page = 0; page < options.maxPagesPerDate; page += 1) {
      const offset = page * 50;
      let response: FetchResult;
      try { response = await adapters.fetchPage(date, offset); }
      catch { reason = "SOURCE_FETCH_THROW"; nextOffset = offset; break; }
      if (response.status !== "SUCCESS") {
        reason = `SOURCE_HTTP_${response.status}`;
        nextOffset = offset;
        break;
      }
      pagesRead += 1;
      const signature = createHash("sha256").update(response.document).digest("hex");
      if (signatures.has(signature)) {
        reason = "REPEATED_PAGE";
        nextOffset = offset;
        break;
      }
      signatures.add(signature);
      let parsed: ListResult;
      try { parsed = adapters.parseList(response.document); }
      catch { reason = "LIST_PARSE_THROW"; nextOffset = offset; break; }
      if (page === 0 && parsed.eligibleRows === 0) {
        const explicitEmpty = /brak\s+(?:danych|wynikow|wyników)|no\s+results/iu.test(response.document);
        if (!explicitEmpty && response.document.trim() === "") {
          // The official list currently returns a whitespace-only 200 on a
          // no-publications day. Recheck once; a lone blank response is not
          // enough evidence of a complete date cursor.
          try {
            const repeated = await adapters.fetchPage(date, 0);
            emptyRechecked = repeated.status === "SUCCESS" && repeated.document.trim() === "";
          } catch { /* remain incomplete */ }
        }
        // Two identical empty HTTP responses are useful diagnostics, but a
        // source outage can return the same empty template twice. Only an
        // explicit no-results marker proves that this date cursor is empty.
        if (!explicitEmpty) {
          reason = "EMPTY_LIST_UNVERIFIED";
          nextOffset = 0;
          break;
        }
      }
      eligibleRows += parsed.eligibleRows;
      malformedRows += parsed.malformedRows;
      for (const candidate of parsed.candidates) discovered.set(candidate.sourceId, candidate);
      if (parsed.eligibleRows < 50) break;
      if (page === options.maxPagesPerDate - 1) {
        reason = "PAGE_LIMIT";
        nextOffset = offset + 50;
      }
    }
    if (malformedRows) reason ??= "MALFORMED_LIST_ROWS";
    coverage.push({ date, pagesRead, eligibleRows, malformedRows,
      status: reason ? "INCOMPLETE" : "COMPLETE", reason, nextOffset, emptyRechecked });
    if (reason) findings.push({ code: "SOURCE_NOT_DISCOVERED", confidence: "REVIEW",
      reason: `${date}: listing coverage incomplete (${reason}${nextOffset === undefined ? "" : `, next offset ${nextOffset}`}).` });
  }

  const candidates = [...discovered.values()];
  const selected = candidates.slice(0, options.maxDocuments);
  const documents: Array<{
    id: string; issuer: string; sourceUrl: string; sourceIsin?: string; title: string;
    publishedAt?: string; fetchStatus: "FETCHED" | "UNAVAILABLE" | "REJECTED" | "PARTIAL";
    parseStatus: "PARSED" | "NOT_ATTEMPTED" | "REJECTED"; eventCount: number;
    attachmentCount: number; attachmentsRead: number; attachmentsTruncated?: number;
    bodyHash?: string; evidence?: string; error?: string;
  }> = [];
  const sourceEvents: Array<{
    id: string; documentId: string; issuer: string; identity: string; eventDate: string;
    eventType: string; fiscalPeriod?: string; fiscalYear?: number; fiscalYearLabel?: string;
    sourceUrl: string; sourceUpdatedAt?: string; evidence?: string;
  }> = [];
  for (const candidate of selected) {
    const base = {
      id: candidate.sourceId, issuer: candidate.issuerName ?? "UNKNOWN", sourceUrl: candidate.sourceUrl,
      sourceIsin: candidate.sourceIsin, title: candidate.sourceTitle,
      publishedAt: candidate.sourcePublishedAt,
    };
    try {
      const response = await adapters.fetchDocument(candidate.sourceUrl);
      if (response.status !== "SUCCESS") {
        documents.push({ ...base, fetchStatus: "UNAVAILABLE", parseStatus: "NOT_ATTEMPTED", eventCount: 0,
          attachmentCount: 0, attachmentsRead: 0, error: response.status });
        findings.push({ code: "SOURCE_NOT_FETCHED", confidence: "REVIEW", sourceId: candidate.sourceId,
          sourceUrl: candidate.sourceUrl, reason: response.status });
        continue;
      }
      const report = adapters.parseDetail(response.document, candidate);
      if (!report) {
        documents.push({ ...base, fetchStatus: "REJECTED", parseStatus: "REJECTED", eventCount: 0, attachmentCount: 0, attachmentsRead: 0,
          error: "DETAIL_EXTRACTION_FAILED" });
        findings.push({ code: "EXTRACTION_FAILED", confidence: "REVIEW", sourceId: candidate.sourceId,
          sourceUrl: candidate.sourceUrl, reason: "The official detail could not be parsed into a complete report body." });
        continue;
      }
      const eventMap = new Map<string, ParsedCorporateEvent>();
      const collectEvents = (text: string) => {
        for (const event of adapters.parseEvents(`${report.sourceTitle}\n${text}`)) {
          if (!sourceEventTypes.has(event.eventType)) continue;
          eventMap.set(`${getCorporateEventIdentityKey(event)}:${event.eventDate}`, event);
        }
      };
      collectEvents(`${report.title}\n${report.body}`);
      const attachmentCount = report.attachments.length;
      let attachmentsRead = 0;
      let attachmentsTruncated = 0;
      for (const attachment of report.attachments.slice(0, 8)) {
        if (!adapters.readAttachment) break;
        try {
          const result = await adapters.readAttachment(attachment.sourceUrl);
          const text = typeof result === "string" ? result : result?.text;
          if (!text) continue;
          attachmentsRead += 1;
          if (typeof result !== "string" && result?.truncated) attachmentsTruncated += 1;
          collectEvents(text);
        } catch { /* record partial source coverage below */ }
      }
      const events = [...eventMap.values()];
      const fetchStatus = attachmentsRead < attachmentCount || attachmentsTruncated > 0 ? "PARTIAL" as const : "FETCHED" as const;
      documents.push({ ...base, fetchStatus, parseStatus: "PARSED", eventCount: events.length, attachmentCount, attachmentsRead, attachmentsTruncated,
        bodyHash: createHash("sha256").update(report.body).digest("hex"),
        evidence: report.body.slice(0, 320) });
      for (const [index, event] of events.entries()) sourceEvents.push({
        id: `${candidate.sourceId}:${index}`, documentId: candidate.sourceId,
        issuer: candidate.sourceIsin ?? candidate.issuerName ?? "UNKNOWN",
        identity: getCorporateEventIdentityKey(event), eventDate: event.eventDate,
        eventType: event.eventType, fiscalPeriod: event.fiscalPeriod, fiscalYear: event.fiscalYear,
        fiscalYearLabel: event.fiscalYearLabel, sourceUrl: candidate.sourceUrl,
        sourceUpdatedAt: candidate.sourcePublishedAt,
        evidence: event.sourceEvidence?.slice(0, 500),
      });
      if (!events.length && potentialEventTitle.test(candidate.sourceTitle) &&
          !isSubsidiaryOnlyDividendNotice(report.body)) {
        findings.push({ code: "PARSER_MISSED_EVENT", confidence: "REVIEW", sourceId: candidate.sourceId,
          sourceUrl: candidate.sourceUrl,
          reason: "Event-like official title produced no event; independent source annotation is required before calling this a false negative." });
      }
      if (attachmentsRead < attachmentCount || attachmentsTruncated > 0) findings.push({ code: "INCOMPLETE_DOCUMENT", confidence: "REVIEW",
        sourceId: candidate.sourceId, sourceUrl: candidate.sourceUrl,
        reason: `${attachmentsRead}/${attachmentCount} attachments were extracted; ${attachmentsTruncated} PDF(s) exceeded the page cap.` });
    } catch (error) {
      documents.push({ ...base, fetchStatus: "UNAVAILABLE", parseStatus: "NOT_ATTEMPTED", eventCount: 0,
        attachmentCount: 0, attachmentsRead: 0, error: error instanceof Error ? error.name : "UNKNOWN" });
      findings.push({ code: "SOURCE_NOT_FETCHED", confidence: "REVIEW", sourceId: candidate.sourceId,
        sourceUrl: candidate.sourceUrl, reason: "Source fetch or parsing raised an exception." });
    }
  }
  const pending = candidates.length - selected.length;
  if (pending) findings.push({ code: "SOURCE_NOT_FETCHED", confidence: "REVIEW",
    reason: `${pending} discovered documents remain beyond the bounded document limit.` });
  const incomplete = pending > 0 || coverage.some((item) => item.status === "INCOMPLETE") ||
    documents.some((item) => item.fetchStatus !== "FETCHED");
  return {
    schemaVersion: 1,
    auditedAt: new Date().toISOString(),
    status: incomplete ? "SOURCE_AUDIT_INCOMPLETE" : "SOURCE_WINDOW_COMPLETE_NOT_MARKET_COMPLETE",
    scope: { dates: [...options.dates], maxPagesPerDate: options.maxPagesPerDate,
      maxDocuments: options.maxDocuments, marketComplete: false,
      limitations: ["Only the declared publication-date window was crawled.",
        "Official PDFs are fetched with the existing bounded extractor; unsupported, unavailable, or >8 attachments mark a document partial. Issuer pages are not covered.",
        "Unannotated source events are parser hypotheses, not independently verified ground truth."] },
    counts: { discovered: candidates.length, fetched: documents.filter((item) => item.fetchStatus === "FETCHED" || item.fetchStatus === "PARTIAL").length,
      parsed: documents.filter((item) => item.parseStatus === "PARSED").length,
      partial: documents.filter((item) => item.fetchStatus === "PARTIAL").length,
      rejected: documents.filter((item) => item.fetchStatus === "REJECTED").length,
      pending, sourceEvents: sourceEvents.length, errors: findings.length },
    coverage, documents, sourceEvents, findings,
  };
};

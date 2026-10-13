import { parseCorporateEventDocument } from "../src/lib/corporate-events.ts";
import { parseGpwEspiList, parseGpwEspiReport } from "../src/lib/espi.ts";

const BASE_URL = "https://www.gpw.pl";
const SEARCH_URL = `${BASE_URL}/ajaxindex.php`;
const PAGE_SIZE = 50;
const MAX_PAGES = Math.min(Math.max(Number(process.argv[2] ?? 80), 1), 120);
const START_PAGE = Math.min(Math.max(Number(process.argv[3] ?? 0), 0), 10_000);
const TARGET = 20;
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const searchBody = (offset) => {
  const body = new URLSearchParams({
    action: "GPWEspiReportUnion",
    start: "ajaxSearch",
    page: "espi-ebi-reports",
    format: "html",
    lang: "PL",
    letter: "",
    offset: String(offset),
    limit: String(PAGE_SIZE),
    searchText: "",
    date: "",
  });
  body.append("categoryRaports[]", "ESPI");
  for (const type of ["RB", "P", "Q", "O", "R"]) body.append("typeRaports[]", type);
  return body;
};

const fetchText = async (url, init = {}) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`PUBLIC_SOURCE_HTTP_${response.status}`);
  return response.text();
};

const looksRelevant = (candidate) =>
  /waln|wza|zwz|nwz|agm|egm|meeting|zwo[lł]|odwo[lł]|zmian.{0,40}termin/iu.test(candidate.sourceTitle ?? "");

const fetchAndParse = async (candidate) => {
  const html = await fetchText(candidate.sourceUrl);
  const report = parseGpwEspiReport(html, candidate);
  if (!report) return null;
  const events = parseCorporateEventDocument(`${report.sourceTitle}\n${report.title}\n${report.body}`)
    .filter((event) => event.eventType === "GENERAL_MEETING");
  if (!events.length) return null;
  const cancellationSignals = events.some((event) => event.generalMeetingAction === "CANCELLATION")
    ? Array.from(`${report.sourceTitle}\n${report.title}\n${report.body}`.matchAll(/.{0,70}(?:odwo[lÅł]ani\w*|odwo[lÅł]uj\w*|cancel\w*|withdraw\w*).{0,100}/giu))
      .slice(0, 3)
      .map((match) => match[0].replace(/\s+/g, " ").trim())
    : undefined;
  return {
    issuer: report.issuerName,
    reportNumber: report.reportNumber ?? null,
    publishedAt: report.publishedAt,
    title: report.title,
    market: report.market,
    sourceUrl: report.sourceUrl,
    attachments: report.attachments.length,
    cancellationSignals,
    events: events.map((event) => ({
      type: event.generalMeetingType ?? null,
      date: event.eventDate,
      time: event.eventTime ?? null,
      action: event.generalMeetingAction ?? null,
      previousDate: event.previousEventDate ?? null,
      registrationDate: event.registrationDate ?? null,
      future: event.eventDate >= today,
    })),
  };
};

const output = [];
const checked = new Set();
let pagesRead = 0;
let malformedListRows = 0;
let titleFallbacks = 0;
const malformedListReasons = {};
let detailErrors = 0;

for (let page = START_PAGE; page < START_PAGE + MAX_PAGES && output.length < TARGET; page += 1) {
  const html = await fetchText(SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: searchBody(page * PAGE_SIZE).toString(),
  });
  pagesRead += 1;
  const parsed = parseGpwEspiList(html);
  malformedListRows += parsed.malformedRows;
  titleFallbacks += parsed.titleFallbacks ?? 0;
  for (const [reason, count] of Object.entries(parsed.malformedByReason ?? {})) {
    malformedListReasons[reason] = (malformedListReasons[reason] ?? 0) + count;
  }
  console.error(`[WZA LIVE VALIDATION] page=${page + 1} rows=${parsed.eligibleRows} candidates=${parsed.candidates.length} titleFallbacks=${parsed.titleFallbacks ?? 0} parsedMeetings=${output.length}`);
  if (parsed.eligibleRows === 0) break;

  const candidates = parsed.candidates.filter((candidate) =>
    looksRelevant(candidate) && !checked.has(candidate.sourceId)
  );
  for (const candidate of candidates) checked.add(candidate.sourceId);

  // The official endpoint is paged. Validate only actual, title-relevant
  // notices and keep concurrency low to avoid unnecessary source traffic.
  for (let offset = 0; offset < candidates.length && output.length < TARGET; offset += 3) {
    const batch = candidates.slice(offset, offset + 3);
    const results = await Promise.all(batch.map(async (candidate) => {
      try {
        return await fetchAndParse(candidate);
      } catch (error) {
        detailErrors += 1;
        return {
          issuer: candidate.issuerName ?? "unknown",
          reportNumber: candidate.reportNumber ?? null,
          publishedAt: candidate.sourcePublishedAt ?? null,
          title: candidate.sourceTitle ?? "",
          market: candidate.market ?? "UNKNOWN",
          sourceUrl: candidate.sourceUrl,
          error: error instanceof Error ? error.message : "UNKNOWN",
        };
      }
    }));
    for (const result of results) if (result) output.push(result);
  }
}

console.log(JSON.stringify({
  source: "Official GPW public ESPI result endpoint and linked GPW report details",
  fetchedAt: new Date().toISOString(),
  timezone: "Europe/Warsaw",
  today,
  pagesRead,
  meetingReportsParsed: output.filter((item) => item.events).length,
  parsedFutureEvents: output.flatMap((item) => item.events ?? []).filter((event) => event.future).length,
  malformedListRows,
  malformedListReasons,
  titleFallbacks,
  detailErrors,
  records: output,
}, null, 2));

if (output.filter((item) => item.events).length < TARGET) process.exitCode = 2;

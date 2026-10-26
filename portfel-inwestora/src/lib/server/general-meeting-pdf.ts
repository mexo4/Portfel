import { fetchWithSystemTrust } from "@/lib/server/system-trust-fetch";

const MAX_PDF_BYTES = 2_000_000;
const MAX_PDF_PAGES = 16;
const ALLOWED_HOSTS = new Set(["espiebi.pap.pl", "www.gpw.pl", "gpw.pl", "pap-mediaroom.pl"]);

/** Public ESPI attachments only. Never fetch arbitrary report-provided URLs. */
export const isTrustedMeetingPdfUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname) && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
};

export type OfficialPdfAuditRead = { text: string; pagesRead: number; totalPages: number; truncated: boolean };
export type OfficialPdfAuditResult =
  | { status: "READ"; read: OfficialPdfAuditRead }
  | { status: "UNREADABLE"; reason: "UNTRUSTED_URL" | "HTTP_ERROR" | "NO_BODY" | "SIZE_LIMIT" |
      "ACCESS_CHALLENGE" | "NON_PDF" | "FETCH_ERROR" | "PDF_PARSE_ERROR"; httpStatus?: number };

/** Same trusted, bounded fetch as the application reader, with completeness
 * metadata so an audit never treats a capped PDF as fully inspected. */
export const inspectOfficialMeetingPdf = async (
  url: string, fetcher: typeof fetch = fetchWithSystemTrust
): Promise<OfficialPdfAuditResult> => {
  if (!isTrustedMeetingPdfUrl(url)) return { status: "UNREADABLE", reason: "UNTRUSTED_URL" };
  let response: Response;
  try {
    response = await fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/pdf" },
      cache: "no-store",
    });
  } catch {
    return { status: "UNREADABLE", reason: "FETCH_ERROR" };
  }
  if (!response.ok) return { status: "UNREADABLE", reason: "HTTP_ERROR", httpStatus: response.status };
  if (!response.body) return { status: "UNREADABLE", reason: "NO_BODY" };
  const advertisedSize = Number(response.headers.get("content-length") ?? 0);
  if (advertisedSize > MAX_PDF_BYTES) return { status: "UNREADABLE", reason: "SIZE_LIMIT" };

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PDF_BYTES) return { status: "UNREADABLE", reason: "SIZE_LIMIT" };
      chunks.push(value);
    }
  } catch {
    return { status: "UNREADABLE", reason: "FETCH_ERROR" };
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    const prefix = new TextDecoder().decode(bytes.subarray(0, 2_048));
    return { status: "UNREADABLE",
      reason: /_Incapsula_Resource|Incapsula|hCaptcha|Request unsuccessful/iu.test(prefix)
        ? "ACCESS_CHALLENGE" : "NON_PDF" };
  }

  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({ data: bytes, disableWorker: true } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
    try {
      const pdf = await loadingTask.promise;
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PDF_PAGES); pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
      }
      return { status: "READ", read: { text: pages.join("\n"), pagesRead: pages.length,
        totalPages: pdf.numPages, truncated: pdf.numPages > pages.length } };
    } finally {
      await loadingTask.destroy();
    }
  } catch {
    return { status: "UNREADABLE", reason: "PDF_PARSE_ERROR" };
  }
};

export const readOfficialMeetingPdfWithCoverage = async (url: string): Promise<OfficialPdfAuditRead | undefined> => {
  const result = await inspectOfficialMeetingPdf(url);
  return result.status === "READ" ? result.read : undefined;
};

export const readOfficialMeetingPdf = async (url: string): Promise<string | undefined> =>
  (await readOfficialMeetingPdfWithCoverage(url))?.text;

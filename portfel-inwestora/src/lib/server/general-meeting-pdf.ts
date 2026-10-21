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

export const readOfficialMeetingPdf = async (url: string): Promise<string | undefined> => {
  if (!isTrustedMeetingPdfUrl(url)) return undefined;
  const response = await fetchWithSystemTrust(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(8_000),
    headers: { Accept: "application/pdf" },
    cache: "no-store",
  });
  if (!response.ok || !response.body) return undefined;
  const advertisedSize = Number(response.headers.get("content-length") ?? 0);
  if (advertisedSize > MAX_PDF_BYTES) return undefined;

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PDF_BYTES) return undefined;
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return undefined;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: bytes, disableWorker: true } as unknown as Parameters<typeof pdfjs.getDocument>[0]);
  const pdf = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PDF_PAGES); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    return pages.join("\n");
  } finally {
    await loadingTask.destroy();
  }
};

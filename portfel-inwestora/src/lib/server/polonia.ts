import { strFromU8, unzipSync } from "fflate";
import type { RiskFreeRatePoint } from "@/lib/portfolio-risk-analytics";

export const POLONIA_DESCRIPTION_URL =
  "https://nbp.pl/statystyka-i-sprawozdawczosc/stawka-referencyjna-polonia/";
export const POLONIA_ARCHIVE_URL =
  "https://static.nbp.pl/dane/polonia/Stawka_POLONIA.xlsx";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export type PoloniaRateResponse = {
  rates: RiskFreeRatePoint[];
  sourceUrl: string;
  descriptionUrl: string;
  fetchedAt: string;
  stale: boolean;
};

let cachedResponse: { expiresAt: number; value: PoloniaRateResponse } | null = null;
let lastKnownGood: PoloniaRateResponse | null = null;
let requestInFlight: Promise<PoloniaRateResponse> | null = null;

const decodeXml = (value: string) =>
  value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

const getCellValue = (row: string, column: string) => {
  const cell = row.match(new RegExp(`<c\\b[^>]*\\br="${column}\\d+"[^>]*>([\\s\\S]*?)<\\/c>`, "i"));
  return cell?.[1]?.match(/<v>([\s\S]*?)<\/v>/i)?.[1] ?? null;
};

export const parsePoloniaWorkbook = (bytes: Uint8Array): RiskFreeRatePoint[] => {
  const archive = unzipSync(bytes);
  const worksheet = archive["xl/worksheets/sheet1.xml"];
  if (!worksheet) throw new Error("Archiwum POLONIA nie zawiera arkusza danych.");
  const xml = decodeXml(strFromU8(worksheet));
  const rates: RiskFreeRatePoint[] = [];
  for (const match of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const row = match[1]!;
    const serial = Number(getCellValue(row, "A"));
    const annualRate = Number(getCellValue(row, "B"));
    if (!Number.isFinite(serial) || !Number.isFinite(annualRate) || serial <= 0) continue;
    const date = new Date(EXCEL_EPOCH_MS + Math.round(serial) * DAY_MS)
      .toISOString()
      .slice(0, 10);
    rates.push({ date, annualRate });
  }
  const normalized = Array.from(
    new Map(rates.sort((left, right) => left.date.localeCompare(right.date)).map((rate) => [rate.date, rate] as const)).values()
  );
  if (!normalized.length) throw new Error("Archiwum POLONIA nie zawiera prawidłowych stawek.");
  return normalized;
};

const fetchLatestPoloniaRates = async (): Promise<PoloniaRateResponse> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(POLONIA_ARCHIVE_URL, {
      headers: { Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`NBP POLONIA HTTP ${response.status}`);
    const rates = parsePoloniaWorkbook(new Uint8Array(await response.arrayBuffer()));
    return {
      rates,
      sourceUrl: POLONIA_ARCHIVE_URL,
      descriptionUrl: POLONIA_DESCRIPTION_URL,
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const getPoloniaRates = async (): Promise<PoloniaRateResponse> => {
  const now = Date.now();
  if (cachedResponse && cachedResponse.expiresAt > now) return cachedResponse.value;
  if (requestInFlight) return requestInFlight;
  requestInFlight = fetchLatestPoloniaRates()
    .then((value) => {
      lastKnownGood = value;
      cachedResponse = { expiresAt: Date.now() + CACHE_TTL_MS, value };
      return value;
    })
    .catch((error) => {
      if (lastKnownGood) return { ...lastKnownGood, stale: true };
      throw error;
    })
    .finally(() => {
      requestInFlight = null;
    });
  return requestInFlight;
};

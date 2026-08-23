export const ESPI_CATEGORIES = [
  "DIVIDEND",
  "FINANCIAL_RESULTS",
  "CONTRACTS",
  "MANAGEMENT_BOARD",
  "SHAREHOLDING",
  "GENERAL_MEETING",
  "ISSUANCE_AND_SHARES",
  "INSIDER_TRANSACTIONS",
  "FORECASTS",
  "OTHER",
] as const;

export type EspiCategory = (typeof ESPI_CATEGORIES)[number];

export const ESPI_REPORT_TYPES = [
  "CURRENT",
  "PERIODIC_QUARTERLY",
  "PERIODIC_HALF_YEAR",
  "PERIODIC_ANNUAL",
  "OTHER",
] as const;

export type EspiReportType = (typeof ESPI_REPORT_TYPES)[number];
export type EspiTrackingSource = "PORTFOLIO" | "WATCHLIST" | "PORTFOLIO_AND_WATCHLIST";
export type EspiSourceStatus =
  | "SUCCESS"
  | "NOT_FOUND"
  | "TEMPORARILY_UNAVAILABLE"
  | "ACCESS_DENIED"
  | "PARSE_ERROR";

export type EspiAttachment = {
  id: string;
  name: string;
  mediaType?: string;
  sizeLabel?: string;
  sourceUrl: string;
};

export type EspiReportSummary = {
  id: string;
  issuerName: string;
  ticker?: string;
  mexoInstrumentId?: string;
  reportNumber?: string;
  reportType: EspiReportType;
  publishedAt: string;
  title: string;
  excerpt: string;
  category: EspiCategory;
  source: "PAP_ESPI";
  sourceUrl: string;
  attachmentsCount: number;
  isCorrection: boolean;
  correctionTargetReportNumber?: string;
  correctionOfReportId?: string;
  trackingSource?: EspiTrackingSource;
};

export type EspiReport = EspiReportSummary & {
  body: string;
  legalBasis?: string;
  sourceId: string;
  sourceIsin?: string;
  attachments: EspiAttachment[];
};

export type EspiSyncMeta = {
  status: EspiSourceStatus | "NOT_SYNCED";
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  isStale: boolean;
  isRefreshing?: boolean;
};

export type EspiFeedResponse = {
  items: EspiReportSummary[];
  nextCursor?: string;
  hasMore: boolean;
  sync: EspiSyncMeta;
};

export type PapEspiListCandidate = {
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string;
  sourcePublishedAt?: string;
};

export type ParsedPapEspiReport = {
  sourceId: string;
  sourceUrl: string;
  sourceTitle: string;
  issuerName: string;
  sourceTicker?: string;
  sourceIsin?: string;
  reportNumber?: string;
  reportType: EspiReportType;
  publishedAt: string;
  title: string;
  body: string;
  legalBasis?: string;
  category: EspiCategory;
  isCorrection: boolean;
  correctionTargetReportNumber?: string;
  attachments: Array<Omit<EspiAttachment, "id">>;
};

export const ESPI_CATEGORY_LABELS: Record<EspiCategory, string> = {
  DIVIDEND: "Dywidenda",
  FINANCIAL_RESULTS: "Wyniki / raporty okresowe",
  CONTRACTS: "Umowy",
  MANAGEMENT_BOARD: "Zarząd / Rada nadzorcza",
  SHAREHOLDING: "Akcjonariat",
  GENERAL_MEETING: "Walne zgromadzenie",
  ISSUANCE_AND_SHARES: "Emisje / akcje",
  INSIDER_TRANSACTIONS: "Transakcje insiderów",
  FORECASTS: "Prognozy",
  OTHER: "Pozostałe",
};

export const ESPI_REPORT_TYPE_LABELS: Record<EspiReportType, string> = {
  CURRENT: "Raport bieżący",
  PERIODIC_QUARTERLY: "Raport okresowy kwartalny",
  PERIODIC_HALF_YEAR: "Raport okresowy półroczny",
  PERIODIC_ANNUAL: "Raport okresowy roczny",
  OTHER: "Raport ESPI",
};

const PAP_BASE_URL = "https://pap-mediaroom.pl";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "•",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "„",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  rsquo: "’",
};

export const decodeEspiHtml = (value: string) =>
  value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? entity);

export const espHtmlToText = (value: string) =>
  decodeEspiHtml(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const normalizeForRules = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const extractClassBlock = (document: string, className: string) => {
  const marker = new RegExp(
    `<(?:div|span)[^>]*class="[^"]*${className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]*"[^>]*>`,
    "i"
  );
  const match = marker.exec(document);
  if (!match) return "";
  const start = match.index + match[0].length;
  const end = document.indexOf(`</${match[0].startsWith("<span") ? "span" : "div"}>`, start);
  return end < 0 ? "" : document.slice(start, end);
};

export const toWarsawIso = (value: string) => {
  const match = value.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})(?:,?\s*(\d{1,2}):(\d{2}))?/);
  if (!match) return undefined;
  const [, day, month, year, hour = "00", minute = "00"] = match;
  const components = {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
  };
  const utcGuess = Date.UTC(
    components.year,
    components.month - 1,
    components.day,
    components.hour,
    components.minute
  );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(utcGuess));
  const zoned = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(zoned.year),
    Number(zoned.month) - 1,
    Number(zoned.day),
    Number(zoned.hour),
    Number(zoned.minute)
  );
  return new Date(utcGuess - (representedAsUtc - utcGuess)).toISOString();
};

export const parsePapEspiList = (document: string) => {
  const segments = document.split(/(?=<div\s+role="article")/gi).slice(1);
  const candidates: PapEspiListCandidate[] = [];

  for (const segment of segments) {
    if (!/<li\s+class="source">[\s\S]*?\/zrodlo\/ESPI[\s\S]*?>\s*ESPI\s*<\/a>/i.test(segment)) {
      continue;
    }
    const sourcePath = segment.match(/<div\s+role="article"\s+about="([^"]+)"/i)?.[1];
    const sourceTitleHtml = segment.match(
      /<span[^>]*class="[^"]*field--name-title[^"]*"[^>]*>([\s\S]*?)<\/span>/i
    )?.[1];
    if (!sourcePath || !sourceTitleHtml) continue;
    const nodeId = segment.match(/href="\/node\/(\d+)(?:#[^"]*)?"/i)?.[1];
    const dateHtml = segment.match(/<li\s+class="date">([\s\S]*?)<\/li>/i)?.[1] ?? "";
    const sourceUrl = new URL(sourcePath, PAP_BASE_URL).toString();
    candidates.push({
      sourceId: nodeId ? `pap:${nodeId}` : `pap:${new URL(sourceUrl).pathname}`,
      sourceUrl,
      sourceTitle: espHtmlToText(sourceTitleHtml),
      sourcePublishedAt: toWarsawIso(espHtmlToText(dateHtml)),
    });
  }

  return {
    candidates: Array.from(new Map(candidates.map((item) => [item.sourceId, item])).values()),
    hasNextPage: /rel="next"/i.test(document),
  };
};

export const classifyEspiReportType = (value: string): EspiReportType => {
  const text = normalizeForRules(value);
  const isPeriodic = /raport okresowy|raport kwartalny|raport polroczny|raport roczny/i.test(text);
  if (isPeriodic && /kwartal|\bqsr\b|\bqr\b/i.test(text)) return "PERIODIC_QUARTERLY";
  if (isPeriodic && /polrocz|\bpsr\b|\bpr\b|\bza p\b/i.test(text)) return "PERIODIC_HALF_YEAR";
  // The explicit boundary prevents "roczny" from matching inside "polroczny".
  if (isPeriodic && /(?:^|\s)roczn|\brsr\b|\brr\b/i.test(text)) return "PERIODIC_ANNUAL";
  if (/raport biezacy/i.test(text)) return "CURRENT";
  return "OTHER";
};

export const classifyEspiCategory = ({
  title,
  body,
  reportType,
}: {
  title: string;
  body?: string;
  reportType?: EspiReportType;
}): EspiCategory => {
  const normalizedTitle = normalizeForRules(title);
  const normalizedBody = normalizeForRules(body ?? "");
  if (
    /art\.? 19(?: ust)?|(?:transakcj|powiadomieni).{0,100}obowiazki zarzadcze|transakcj.{0,70}insider|director\/?pdmr transaction|management transaction/i.test(normalizedTitle) ||
    /(?:podstawa prawna:\s*)?art\.? 19|powiadomieni.{0,80}art\.? 19.{0,120}transakcj/i.test(normalizedBody)
  ) return "INSIDER_TRANSACTIONS";
  if (
    reportType === "PERIODIC_QUARTERLY" ||
    reportType === "PERIODIC_HALF_YEAR" ||
    reportType === "PERIODIC_ANNUAL" ||
    /wynik(?:i|ow) finansow|raport\w* okresow|sprawozdani.{0,30}finansow|szacunk\w*.{0,30}wynik|zmian.{0,50}(?:daty|terminu|harmonogramu).{0,70}raport|financial statements|preliminary sales revenue|interim results/i.test(normalizedTitle)
  ) return "FINANCIAL_RESULTS";
  if (/dywidend|zaliczk.{0,30}na poczet dywidendy|dzien prawa do wyplaty/i.test(normalizedTitle)) return "DIVIDEND";
  if (/art\.? 69|zmian.{0,50}(?:udzialu|stanu posiadania)|progu?\s+\d|ogolnej liczbie glosow|akcjonariusz.{0,50}(?:5%|glos)/i.test(normalizedTitle)) {
    return "SHAREHOLDING";
  }
  if (/emisj|subskrypcj.{0,30}akcji|akcji wlasn|skup akcji|nabyci.{0,20}akcji wlasn|przydzial.{0,30}(?:akcji|obligacji)|(?:podwyzszeni|obnizeni|zmian.{0,20}wysokosci).{0,30}kapitalu|treasury shares|tender buyback|share buyback/i.test(normalizedTitle)) {
    return "ISSUANCE_AND_SHARES";
  }
  if (/waln(?:e|ego|ym) zgromadzeni|\bwza\b|\bnwz\b|zwolani.{0,30}walnego/i.test(normalizedTitle)) return "GENERAL_MEETING";
  if (/umow|kontrakt|wybor\w* ofert|najkorzystniejsz\w* ofert|zamowieni|list intencyjn|\bcontract\b|\bagreement\b/i.test(normalizedTitle)) return "CONTRACTS";
  if (/powolani|odwolani|rezygnacj|zmian.{0,30}zarzad|zarzad|rad(?:a|y) nadzorc/i.test(normalizedTitle)) return "MANAGEMENT_BOARD";
  if (/prognoz/i.test(normalizedTitle)) return "FORECASTS";

  // Body fallbacks deliberately require distinctive phrases. Common words such
  // as "zarząd" or "dywidenda" occur in many unrelated current reports.
  if (/uchwal.{0,80}dywidend|propozycj.{0,80}dywidend|dzien dywidendy|dzien wyplaty dywidendy/i.test(normalizedBody)) return "DIVIDEND";
  if (/zawarl.{0,80}(?:istotn|znaczac).{0,60}umow|podpisal.{0,80}(?:umow|kontrakt)|wybran.{0,50}ofert/i.test(normalizedBody)) return "CONTRACTS";
  if (/zawiadomieni.{0,80}art\.? 69|przekrocz.{0,80}ogolnej liczby glosow/i.test(normalizedBody)) return "SHAREHOLDING";
  return "OTHER";
};

const getArticleSection = (document: string) => {
  const start = document.search(/<article\s+role="article"/i);
  if (start < 0) return document;
  const end = document.indexOf("</article>", start);
  return end < 0 ? document.slice(start) : document.slice(start, end + "</article>".length);
};

const extractTags = (article: string) => {
  const tags = article.match(/<ul\s+class="tags">([\s\S]*?)<\/ul>/i)?.[1] ?? "";
  return Array.from(tags.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)).map((match) => ({
    href: match[1] ?? "",
    label: espHtmlToText(match[2] ?? ""),
  }));
};

const parseIssuerTag = (tags: Array<{ href: string; label: string }>) => {
  for (const tag of tags) {
    const match = tag.label.match(/^(.*)-([A-Z]{2}[A-Z0-9]{10})-([A-Z0-9.]+)$/i);
    if (!match) continue;
    return {
      name: match[1]?.trim(),
      isin: match[2]?.toUpperCase(),
      ticker: match[3]?.toUpperCase(),
    };
  }
  return {};
};

const extractIssuerAndSubject = (sourceTitle: string, taggedIssuerName?: string) => {
  const numbered = sourceTitle.match(/^(.*?)\s+\(([^()]*?\/20\d{2})\)\s*(.*)$/i);
  if (numbered) {
    return {
      issuerName: numbered[1]?.trim() || taggedIssuerName || "Nieznany emitent",
      reportNumber: numbered[2]?.trim(),
      title: numbered[3]?.trim() || sourceTitle,
    };
  }
  const periodicIndex = sourceTitle.search(/\braport okresowy\b/i);
  if (periodicIndex > 0) {
    return {
      issuerName: sourceTitle.slice(0, periodicIndex).trim() || taggedIssuerName || "Nieznany emitent",
      title: sourceTitle.slice(periodicIndex).trim(),
    };
  }
  return {
    issuerName: taggedIssuerName?.trim() || "Nieznany emitent",
    title: sourceTitle.trim(),
  };
};

const inferMediaType = (url: string) => {
  const extension = new URL(url).pathname.split(".").at(-1)?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (extension === "zip") return "application/zip";
  if (extension === "xml") return "application/xml";
  if (extension === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (extension === "xls") return "application/vnd.ms-excel";
  if (extension === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return undefined;
};

const extractAttachments = (article: string) =>
  Array.from(article.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*\bdownload\b[^>]*>([\s\S]*?)<\/a>/gi)).flatMap(
    (match) => {
      try {
        const sourceUrl = new URL(decodeEspiHtml(match[1] ?? ""), PAP_BASE_URL).toString();
        if (new URL(sourceUrl).hostname !== "pap-mediaroom.pl") return [];
        const content = match[2] ?? "";
        const metadata = espHtmlToText(content.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? "");
        const withoutMetadata = content.replace(/<span[^>]*>[\s\S]*?<\/span>/gi, " ");
        const name = espHtmlToText(
          withoutMetadata.match(/<div[^>]*class="[^"]*textWrapper[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
            withoutMetadata
        );
        if (!name) return [];
        const separator = metadata.indexOf(",");
        const mediaType = (separator >= 0 ? metadata.slice(0, separator) : metadata).trim();
        const sizeLabel = separator >= 0 ? metadata.slice(separator + 1).trim() : "";
        return [{
          name,
          mediaType: mediaType?.includes("/") ? mediaType : inferMediaType(sourceUrl),
          sizeLabel: sizeLabel || undefined,
          sourceUrl,
        }];
      } catch {
        return [];
      }
    }
  );

const extractBodyHtml = (article: string) => {
  const marker = /<div[^>]*property="schema:text"[^>]*class="[^"]*field--name-body[^"]*"[^>]*>/i.exec(article);
  if (!marker) return "";
  const start = marker.index + marker[0].length;
  const tagsStart = article.indexOf('<ul class="tags">', start);
  if (tagsStart < 0) return "";
  return article.slice(start, tagsStart).replace(/(?:<\/div>\s*)+$/i, "");
};

const findLegalBasis = (body: string) =>
  body.split("\n").map((line) => line.trim()).find((line) => /^podstawa prawna\s*:/i.test(line));

const findCorrectionTarget = (text: string, ownReportNumber?: string) => {
  const normalized = normalizeForRules(text);
  const patterns = [
    /korekt\w*.{0,100}?raport\w*(?: biezac\w*)?(?: nr)?\s*(\d+(?:\/\d+)?\/20\d{2})/i,
    /zmian\w*.{0,80}?raport\w*(?: nr)?\s*(\d+(?:\/\d+)?\/20\d{2})/i,
  ];
  for (const pattern of patterns) {
    const target = normalized.match(pattern)?.[1];
    if (target && target !== ownReportNumber) return target;
  }
  return undefined;
};

export const parsePapEspiReport = (
  document: string,
  candidate: PapEspiListCandidate
): ParsedPapEspiReport | null => {
  const article = getArticleSection(document);
  if (!/id="source-of-information">\s*ESPI\s*</i.test(article)) return null;
  const sourceTitle = espHtmlToText(extractClassBlock(article, "field--name-title")) || candidate.sourceTitle;
  const dateHtml = article.match(/<div\s+class="date">([\s\S]*?)(?:<span>|<\/div>)/i)?.[1] ?? "";
  const publishedAt = toWarsawIso(espHtmlToText(dateHtml)) ?? candidate.sourcePublishedAt;
  if (!sourceTitle || !publishedAt) return null;
  const tags = extractTags(article);
  const taggedIssuer = parseIssuerTag(tags);
  const identity = extractIssuerAndSubject(sourceTitle, taggedIssuer.name);
  const lead = espHtmlToText(extractClassBlock(article, "field--name-field-lead"));
  const reportNumber = identity.reportNumber ??
    tags.map((tag) => tag.label).find((label) => /^\d+(?:\/\d+)?\/20\d{2}(?:\s+[A-Z]+)?$/i.test(label)) ??
    lead.match(/(\d+(?:\/\d+)?\/20\d{2}(?:\s+[A-Z]+)?)/i)?.[1];
  const body = espHtmlToText(extractBodyHtml(article));
  const reportType = classifyEspiReportType(`${lead}\n${sourceTitle}`);
  const isCorrection = /\bkorekt/i.test(normalizeForRules(`${sourceTitle}\n${body.slice(0, 1000)}`));

  return {
    sourceId: candidate.sourceId,
    sourceUrl: candidate.sourceUrl,
    sourceTitle,
    issuerName: identity.issuerName,
    sourceTicker: taggedIssuer.ticker,
    sourceIsin: taggedIssuer.isin,
    reportNumber,
    reportType,
    publishedAt,
    title: identity.title,
    body,
    legalBasis: findLegalBasis(body),
    category: classifyEspiCategory({ title: `${sourceTitle}\n${lead}`, body, reportType }),
    isCorrection,
    correctionTargetReportNumber: isCorrection
      ? findCorrectionTarget(`${sourceTitle}\n${body}`, reportNumber)
      : undefined,
    attachments: extractAttachments(article),
  };
};

export const isEspiCategory = (value: string | null): value is EspiCategory =>
  Boolean(value && ESPI_CATEGORIES.includes(value as EspiCategory));

export const isEspiReportType = (value: string | null): value is EspiReportType =>
  Boolean(value && ESPI_REPORT_TYPES.includes(value as EspiReportType));

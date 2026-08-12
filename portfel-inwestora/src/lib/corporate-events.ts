export const CORPORATE_EVENT_TYPES = [
  "QUARTERLY_REPORT",
  "HALF_YEAR_REPORT",
  "ANNUAL_REPORT",
] as const;

export type CorporateEventType = (typeof CORPORATE_EVENT_TYPES)[number];

export const CORPORATE_EVENT_STATUSES = [
  "CONFIRMED",
  "CHANGED",
  "CANCELLED",
  "UNKNOWN",
] as const;

export type CorporateEventStatus = (typeof CORPORATE_EVENT_STATUSES)[number];

export type CorporateEventSourceType =
  | "ISSUER_CURRENT_REPORT"
  | "ISSUER_IR"
  | "PAP_ESPI";

export type CorporateEventSourceStatus =
  | "SUCCESS"
  | "NOT_FOUND"
  | "TEMPORARILY_UNAVAILABLE"
  | "ACCESS_DENIED"
  | "PARSE_ERROR";

export type ParsedCorporateEvent = {
  eventType: CorporateEventType;
  eventDate: string;
  eventTime?: string;
  fiscalPeriod?: string;
  fiscalYear?: number;
  previousEventDate?: string;
  isScheduleChange: boolean;
};

export type CorporateEventSourceReference = {
  sourceType: CorporateEventSourceType;
  sourceUrl: string;
  sourcePublishedAt?: string;
};

export type CorporateEvent = {
  id: string;
  instrumentId: string;
  ticker: string;
  companyName: string;
  eventType: CorporateEventType;
  eventDate: string;
  eventTime?: string;
  fiscalPeriod?: string;
  fiscalYear?: number;
  status: CorporateEventStatus;
  active: boolean;
  sourcePublishedAt?: string;
  discoveredAt: string;
  updatedAt: string;
  source?: CorporateEventSourceReference;
};

export type CorporateEventHistoryEntry = {
  id: string;
  corporateEventId: string;
  previousEventDate: string;
  nextEventDate: string;
  source?: CorporateEventSourceReference;
  detectedAt: string;
};

export type CorporateEventSourceState = {
  instrumentId: string;
  ticker: string;
  status: CorporateEventSourceStatus;
  lastCheckedAt?: string;
};

export type CorporateEventsResponse = {
  events: CorporateEvent[];
  sourceStates: CorporateEventSourceState[];
  scope: "OK" | "NO_GPW_INSTRUMENTS";
};

export const getCorporateEventIdentityKey = (event: Pick<
  ParsedCorporateEvent,
  "eventType" | "fiscalPeriod" | "fiscalYear"
>) => [event.eventType, event.fiscalPeriod ?? "", event.fiscalYear ?? ""].join(":");

const POLISH_MONTHS: Record<string, string> = {
  stycznia: "01",
  luty: "02",
  lutego: "02",
  marca: "03",
  kwietnia: "04",
  maja: "05",
  czerwca: "06",
  lipca: "07",
  sierpnia: "08",
  września: "09",
  wrzesnia: "09",
  października: "10",
  pazdziernika: "10",
  listopada: "11",
  grudnia: "12",
};

const DATE_PATTERN =
  /\b(\d{1,2})\s*(?:[.\-/]\s*)?([a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+)\s+(20\d{2})\b|\b(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})\b/g;

const normalizeDocumentText = (value: string) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?(?:p|div|li|tr|h[1-6]|br|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&ndash;|&mdash;/gi, "–")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

const toIsoDate = (day: string, month: string, year: string) => {
  const monthNumber = POLISH_MONTHS[month.toLocaleLowerCase("pl-PL")];
  const parsedDay = Number(day);

  if (!monthNumber || !Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) {
    return null;
  }

  return `${year}-${monthNumber}-${String(parsedDay).padStart(2, "0")}`;
};

const getIsoDateFromMatch = (match: RegExpExecArray) => {
  const namedDate = match[1] && match[2] && match[3]
    ? toIsoDate(match[1], match[2], match[3])
    : null;
  const numericDate = match[4] && match[5] && match[6]
    ? `${match[6]}-${match[5].padStart(2, "0")}-${match[4].padStart(2, "0")}`
    : null;

  return namedDate ?? numericDate;
};

export const extractPolishDates = (value: string) => {
  const dates: string[] = [];

  for (const match of value.matchAll(DATE_PATTERN)) {
    const date = getIsoDateFromMatch(match);

    if (date && !dates.includes(date)) {
      dates.push(date);
    }
  }

  return dates;
};

const getEventType = (value: string): CorporateEventType | null => {
  const normalized = value.toLocaleLowerCase("pl-PL");

  if (/półrocz(?:ny|ne|nego|nym)?|półrocze|(?:^|\s)i\s+półrocze/.test(normalized)) {
    return "HALF_YEAR_REPORT";
  }

  if (/\broczn(?:y|e|ego|ym)?\b/.test(normalized)) {
    return "ANNUAL_REPORT";
  }

  if (/kwartaln(?:y|e|ego|ym)?|\b[ivx]{1,3}\.?\s+kwartał|\b[1-4]\.?\s+kwartał/.test(normalized)) {
    return "QUARTERLY_REPORT";
  }

  return null;
};

const getFiscalPeriod = (value: string, eventType: CorporateEventType) => {
  const normalized = value.toLocaleLowerCase("pl-PL");

  if (eventType === "HALF_YEAR_REPORT") return "H1";
  if (eventType === "ANNUAL_REPORT") return "FY";

  if (/(?:^|\s)(?:i|1|pierwsz(?:y|ego))\.?\s+kwartał/i.test(normalized)) return "Q1";
  if (/(?:^|\s)(?:ii|2|drug(?:i|iego))\.?\s+kwartał/i.test(normalized)) return "Q2";
  if (/(?:^|\s)(?:iii|3|trzec(?:i|iego))\.?\s+kwartał/i.test(normalized)) return "Q3";
  if (/(?:^|\s)(?:iv|4|czwart(?:y|ego))\.?\s+kwartał/i.test(normalized)) return "Q4";

  return undefined;
};

const getFiscalYear = (value: string) => {
  const year = value.match(/\b(20\d{2})\b/)?.[1];
  return year ? Number(year) : undefined;
};

const getCandidateSegments = (text: string) => {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const segments: string[] = [];

  lines.forEach((line, index) => {
    segments.push(line);
    if (getEventType(line) && extractPolishDates(line).length === 0) {
      if (index + 1 < lines.length) {
        segments.push([line, lines[index + 1]].join(" "));
      }
      if (index + 2 < lines.length) {
        segments.push([line, lines[index + 1], lines[index + 2]].join(" "));
      }
    }
  });

  return segments;
};

export const parseCorporateEventDocument = (document: string): ParsedCorporateEvent[] => {
  const text = normalizeDocumentText(document);
  if (!text) return [];

  const changeIndex = text.search(/\bzmian[ayę]\s+terminu\b|\bnowy termin(?: publikacji)?\b/i);
  if (changeIndex >= 0) {
    const changeContext = text.slice(changeIndex);
    const eventType = getEventType(changeContext) ?? getEventType(text);
    const dates = extractPolishDates(changeContext);

    if (eventType && dates.length >= 2) {
      return [
        {
          eventType,
          eventDate: dates.at(-1) as string,
          previousEventDate: dates[0],
          fiscalPeriod: getFiscalPeriod(changeContext, eventType),
          fiscalYear: getFiscalYear(changeContext),
          isScheduleChange: true,
        },
      ];
    }
  }

  const events = new Map<string, ParsedCorporateEvent>();

  for (const segment of getCandidateSegments(text)) {
    const dateMatches = Array.from(segment.matchAll(DATE_PATTERN));

    for (const dateMatch of dateMatches) {
      const eventDate = getIsoDateFromMatch(dateMatch);
      if (!eventDate) continue;

      // A schedule sometimes places several reports on one row/paragraph.
      // Start context at the report nearest to this date so the final date of
      // the row cannot accidentally become the date of its first report.
      const beforeDate = segment.slice(0, dateMatch.index ?? 0);
      const reportIndex = beforeDate.toLocaleLowerCase("pl-PL").lastIndexOf("raport");
      const contextStart = reportIndex >= 0 ? reportIndex : 0;
      const context = `${segment.slice(contextStart, dateMatch.index ?? 0)} ${dateMatch[0]}`;
      const eventType = getEventType(context);

      if (!eventType) continue;

      const fiscalPeriod = getFiscalPeriod(context, eventType);
      const fiscalYear = getFiscalYear(context);
      const event: ParsedCorporateEvent = {
        eventType,
        eventDate,
        fiscalPeriod,
        fiscalYear,
        isScheduleChange: false,
      };
      const key = [eventType, fiscalPeriod ?? "", fiscalYear ?? "", eventDate].join(":");
      events.set(key, event);
    }
  }

  return Array.from(events.values()).sort((left, right) =>
    left.eventDate.localeCompare(right.eventDate)
  );
};

export const getCorporateEventLabel = (event: Pick<CorporateEvent, "eventType" | "fiscalPeriod" | "fiscalYear">) => {
  const period = [event.fiscalPeriod, event.fiscalYear].filter(Boolean).join(" ");

  if (event.eventType === "HALF_YEAR_REPORT") {
    return `Raport półroczny${period ? ` ${period}` : ""}`;
  }

  if (event.eventType === "ANNUAL_REPORT") {
    return `Raport roczny${period ? ` ${period}` : ""}`;
  }

  return `Raport kwartalny${period ? ` ${period}` : ""}`;
};

export const getDaysUntilCorporateEvent = (eventDate: string, now = new Date()) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(`${eventDate}T00:00:00`).getTime();
  return Math.round((target - today) / 86_400_000);
};

export const isCorporateEventSourceUnavailable = (status: CorporateEventSourceStatus) =>
  status === "ACCESS_DENIED" || status === "TEMPORARILY_UNAVAILABLE" || status === "PARSE_ERROR";

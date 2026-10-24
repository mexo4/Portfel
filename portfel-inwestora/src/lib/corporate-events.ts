export const CORPORATE_EVENT_TYPES = [
  "QUARTERLY_REPORT",
  "HALF_YEAR_REPORT",
  "ANNUAL_REPORT",
  "UPCOMING_DIVIDEND",
  "GENERAL_MEETING",
] as const;

export type CorporateEventType = (typeof CORPORATE_EVENT_TYPES)[number];

export const CORPORATE_EVENT_STATUSES = [
  "PROPOSED",
  "CONFIRMED",
  "CHANGED",
  "CANCELLED",
  "UNKNOWN",
] as const;

export type CorporateEventStatus = (typeof CORPORATE_EVENT_STATUSES)[number];

export const GENERAL_MEETING_TYPES = ["ZWZ", "NWZ"] as const;

export type GeneralMeetingType = (typeof GENERAL_MEETING_TYPES)[number];

export const GENERAL_MEETING_ACTIONS = [
  "CONVENING",
  "RESCHEDULE",
  "CANCELLATION",
] as const;

export type GeneralMeetingAction = (typeof GENERAL_MEETING_ACTIONS)[number];

export type GeneralMeetingRegistrationSource = "OFFICIAL" | "STATUTORY_CALCULATION" | "UNKNOWN";

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
  fiscalYearLabel?: string;
  periodStart?: string;
  periodEnd?: string;
  reportScope?: "UNIT" | "CONSOLIDATED" | "COMBINED";
  previousEventDate?: string;
  isScheduleChange: boolean;
  generalMeetingType?: GeneralMeetingType;
  generalMeetingAction?: GeneralMeetingAction;
  registrationDate?: string;
  isCancellation?: boolean;
  /** A stable source-independent identity, used for events that have no fiscal period. */
  eventIdentity?: string;
  /** Normalized issuer data; posting is separately gated by status and payment date. */
  dividendPerShare?: number;
  dividendTotalPerShare?: number;
  dividendAdvancePerShare?: number;
  dividendCurrency?: string;
  exDividendDate?: string;
  recordDate?: string;
  paymentDate?: string;
  dividendInstallment?: number;
  /** Portfolio-context quantity projected by the API response. */
  heldQuantity?: number;
  dividendStatus?: Extract<CorporateEventStatus, "PROPOSED" | "CONFIRMED" | "UNKNOWN">;
  /** Heuristics never turn a questionable report period into a confirmed event. */
  requiresReview?: boolean;
  reviewReasons?: string[];
  /** Bounded fragment of normalized source used to derive this event. */
  sourceEvidence?: string;
};

export type CorporateEventSourceReference = {
  sourceType: CorporateEventSourceType;
  sourceUrl: string;
  sourcePublishedAt?: string;
  sourceTitle?: string;
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
  fiscalYearLabel?: string;
  periodStart?: string;
  periodEnd?: string;
  reportScope?: "UNIT" | "CONSOLIDATED" | "COMBINED";
  generalMeetingType?: GeneralMeetingType;
  registrationDate?: string;
  registrationDateSource?: GeneralMeetingRegistrationSource;
  registrationDateConflict?: boolean;
  dividendPerShare?: number;
  dividendTotalPerShare?: number;
  dividendAdvancePerShare?: number;
  dividendCurrency?: string;
  exDividendDate?: string;
  recordDate?: string;
  paymentDate?: string;
  dividendInstallment?: number;
  /** Backward-compatible alias for the portfolio-context eligible quantity. */
  heldQuantity?: number;
  /** Quantity used for the dividend forecast. */
  eligibleQuantity?: number;
  eligibilityDate?: string;
  eligibilityStatus?: "ENTITLEMENT_CONFIRMED" | "CURRENT_ESTIMATE" | "UNAVAILABLE";
  estimatedGrossAmount?: number;
  estimatedTaxAmount?: number;
  estimatedNetAmount?: number;
  status: CorporateEventStatus;
  active: boolean;
  sourcePublishedAt?: string;
  discoveredAt: string;
  updatedAt: string;
  /** Response-only context: held positions retain entitlement projection; a
   * watchlist-only company is informational and never represents a claim. */
  trackingSource?: "HELD" | "WATCHLIST" | "HELD_AND_WATCHLIST";
  source?: CorporateEventSourceReference;
  sources?: CorporateEventSourceReference[];
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
  automaticPosting?: {
    addedCount: number;
    manualMatchesCount: number;
    requiresPortfolioReload: boolean;
  };
};

export type GeneralMeetingScope = "all" | "watchlist" | "portfolio";

export type GeneralMeetingsResponse = {
  events: CorporateEvent[];
  scope: GeneralMeetingScope;
  sourceState: {
    status: CorporateEventSourceStatus | "NOT_SYNCED";
    lastCheckedAt?: string;
    lastSuccessfulSyncAt?: string;
    isRefreshing?: boolean;
    isStale?: boolean;
    projectionPending?: number;
    projectionErrors?: number;
    projectionUnmatched?: number;
    sourceBackfillComplete?: boolean;
  };
};

export type DividendCalendarScope = GeneralMeetingScope;
export type ReportCalendarResponse = GeneralMeetingsResponse;

export const GENERAL_MEETING_WINDOW_DAYS = 180;
export const REPORT_WINDOW_DAYS = 365;
export const CALENDAR_WINDOW_OPTIONS = [60, 180, 365] as const;
export type CalendarWindowDays = (typeof CALENDAR_WINDOW_OPTIONS)[number];

export const isCalendarWindowDays = (value: number): value is CalendarWindowDays =>
  CALENDAR_WINDOW_OPTIONS.some((days) => days === value);

/** Art. 406¹ KSH: calendar days, including weekends. Only call for a verified public-company WZA. */
export const getStatutoryMeetingRegistrationDate = (meetingDate: string): string | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) return undefined;
  const date = new Date(`${meetingDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== meetingDate) return undefined;
  date.setUTCDate(date.getUTCDate() - 16);
  return date.toISOString().slice(0, 10);
};

export type DividendCalendarResponse = {
  events: CorporateEvent[];
  scope: DividendCalendarScope;
  sourceState: GeneralMeetingsResponse["sourceState"];
};

export type DividendCalendarDisplayStatus =
  | "PROPOSED"
  | "CONFIRMED"
  | "AWAITING_PAYMENT"
  | "PAYMENT_DATE_PASSED"
  | "UNKNOWN";

export const getDividendCalendarDisplayStatus = (
  event: Pick<CorporateEvent, "status" | "recordDate" | "exDividendDate" | "paymentDate">,
  today: string
): DividendCalendarDisplayStatus => {
  if (event.status === "PROPOSED") return "PROPOSED";
  if (event.status !== "CONFIRMED" && event.status !== "CHANGED") return "UNKNOWN";
  if (event.paymentDate && event.paymentDate < today) return "PAYMENT_DATE_PASSED";
  const entitlementDate = event.recordDate ?? event.exDividendDate;
  if (entitlementDate && entitlementDate < today && (!event.paymentDate || event.paymentDate >= today)) {
    return "AWAITING_PAYMENT";
  }
  return "CONFIRMED";
};

export const getCorporateEventIdentityKey = (event: Pick<
  ParsedCorporateEvent,
  "eventType" | "fiscalPeriod" | "fiscalYear" | "fiscalYearLabel" | "eventIdentity"
>) => event.eventIdentity ?? [event.eventType, event.fiscalPeriod ?? "", event.fiscalYearLabel ?? event.fiscalYear ?? ""].join(":");

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
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

const DATE_PATTERN =
  /\b(\d{1,2})\s*(?:[.\-/]\s*)?([a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+)\s+(20\d{2})(?:\s*(?:roku|r)\.?)?(?!\d)|\b(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})(?:\s*(?:roku|r)\.?)?(?!\d)/g;

const UNICODE_DATE_PATTERN =
  /\b(\d{1,2})\s*(?:[.\-/]\s*)?([\p{L}]+)\s+(20\d{2})(?:\s*(?:roku|r)\.?)?(?!\d)|\b(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})(?:\s*(?:roku|r)\.?)?(?!\d)|\b([\p{L}]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/giu;

const normalizeDocumentText = (value: string) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    // Preserve table-cell boundaries so separate report rows cannot collapse
    // into one clause and lend their dates to neighboring report labels.
    .replace(/<\/(?:td|th)\s*>/gi, " | ")
    .replace(/<\/?(?:p|div|li|tr|h[1-6]|br|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&oacute;/gi, "ó")
    .replace(/&aogon;/gi, "ą")
    .replace(/&cacute;/gi, "ć")
    .replace(/&eogon;/gi, "ę")
    .replace(/&lstrok;/gi, "ł")
    .replace(/&nacute;/gi, "ń")
    .replace(/&sacute;/gi, "ś")
    .replace(/&zacute;/gi, "ź")
    .replace(/&zdot;/gi, "ż")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
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
  return makeIsoDate(year, monthNumber, parsedDay);
};

const makeIsoDate = (year: string, month: string, day: number) => {
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  if (!Number.isInteger(yearNumber) || monthNumber < 1 || monthNumber > 12) return null;
  const candidate = new Date(Date.UTC(yearNumber, monthNumber - 1, day));
  if (
    candidate.getUTCFullYear() !== yearNumber ||
    candidate.getUTCMonth() !== monthNumber - 1 ||
    candidate.getUTCDate() !== day
  ) return null;
  return `${yearNumber}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const getIsoDateFromMatch = (match: RegExpExecArray) => {
  const namedDate = match[1] && match[2] && match[3]
    ? toIsoDate(match[1], match[2], match[3])
    : null;
  const numericDate = match[4] && match[5] && match[6]
    ? makeIsoDate(match[6], match[5], Number(match[4]))
    : null;
  const englishMonthFirstDate = match[7] && match[8] && match[9]
    ? toIsoDate(match[8], match[7], match[9])
    : null;

  return namedDate ?? numericDate ?? englishMonthFirstDate;
};

export const extractPolishDates = (value: string) => {
  const dates: string[] = [];

  for (const match of [...value.matchAll(DATE_PATTERN), ...value.matchAll(UNICODE_DATE_PATTERN)]) {
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

  if (/\broczn(?:y|e|ego|ym)?\b|\braport(?:y|u|ow)?\s+(?:(?:jednostkow\w*|skonsolidowan\w*)\s+)?(?:jednostkow\w*\s+i\s+skonsolidowan\w*\s+)?za\s+(?:rok(?:\s+obrotowy)?\s+)?20\d{2}(?:\s*\/\s*20\d{2})?\b/.test(normalized)) {
    return "ANNUAL_REPORT";
  }

  if (/kwartaln(?:y|e|ego|ym)?|\b[ivx]{1,3}\.?\s+kwartał|\b[1-4]\.?\s+kwartał|\btrzy\s+kwartały|pierwsz\p{L}*\s+(?:3|trzy|9|dziewi\p{L}*)\s+miesi\p{L}*/iu.test(normalized)) {
    return "QUARTERLY_REPORT";
  }

  if (/\bsprawozdani\p{L}*\s+finansow\p{L}*[\s\S]{0,100}\bza\s+(?:rok(?:\s+obrotowy)?\s+)?20\d{2}\b/iu.test(normalized)) {
    return "ANNUAL_REPORT";
  }

  return null;
};

const getFiscalPeriod = (value: string, eventType: CorporateEventType) => {
  // Calendar-quarter explanations in parentheses are not the issuer's fiscal
  // quarter (Synektik/Syn2Bio use an October--September financial year).
  const normalized = value.toLocaleLowerCase("pl-PL")
    .replace(/_/g, " ")
    .replace(/\([^)]*kwartał(?:u|y)?\s+roku\s+kalendarzowego[^)]*\)/gu, " ")
    .replace(/\([^)]*rok\s+kalendarzow[^)]*\)/gu, " ");

  if (eventType === "HALF_YEAR_REPORT") return "H1";
  if (eventType === "ANNUAL_REPORT") return "FY";

  if (/pierwsz\p{L}*\s+(?:3|trzy)\s+miesi\p{L}*/iu.test(normalized)) return "Q1";
  if (/pierwsz\p{L}*\s+(?:9|dziewi\p{L}*)\s+miesi\p{L}*/iu.test(normalized)) return "Q3";

  // The issuer's financial quarter takes precedence over the explanatory
  // calendar-quarter comparison, which ESPI PDFs sometimes render as _a ..._.
  const financial = normalized.match(/\b(i{1,3}|iv|[1-4])\.?\s+kwartał\s+roku\s+finansowego/iu);
  if (financial) {
    const quarter = { i: "Q1", ii: "Q2", iii: "Q3", iv: "Q4", "1": "Q1", "2": "Q2", "3": "Q3", "4": "Q4" } as const;
    return quarter[financial[1]!.toLowerCase() as keyof typeof quarter];
  }

  // This function receives one report clause, not the entire schedule.
  const periods = [
    [/\b(?:i|1|pierwsz(?:y|ego))\.?\s+kwartał/giu, "Q1"],
    [/\b(?:ii|2|drug(?:i|iego))\.?\s+kwartał/giu, "Q2"],
    [/\b(?:iii|3|trzec(?:i|iego))\.?\s+kwartał/giu, "Q3"],
    [/\btrzy\s+kwartały/giu, "Q3"],
    [/\b(?:iv|4|czwart(?:y|ego))\.?\s+kwartał/giu, "Q4"],
  ] as const;
  let nearest: { index: number; period: string } | undefined;
  for (const [pattern, period] of periods) {
    for (const match of normalized.matchAll(pattern)) {
      if ((match.index ?? -1) > (nearest?.index ?? -1)) nearest = { index: match.index!, period };
    }
  }
  return nearest?.period;
};

const getFiscalYearLabel = (value: string) => {
  const withoutCalendarComparison = value.replace(/\([^)]*roku\s+kalendarzowego[^)]*\)/giu, " ");
  const financialYear = withoutCalendarComparison.match(/\b(?:za\s+)?roku?\s+(?:finansow\p{L}*|obrotow\p{L}*)\s+(20\d{2})(?:\s*[/–—-]\s*(20\d{2}))?/iu);
  if (financialYear?.[1]) return financialYear[2] ? `${financialYear[1]}/${financialYear[2]}` : financialYear[1];
  const endingYear = withoutCalendarComparison.match(/\broku?\s+obrotow\w*\s+kończąc\w*\s+się\s+(?:w\s+dniu\s+)?\d{1,2}\s+\p{L}+\s+(20\d{2})/iu)?.[1];
  const explicit = withoutCalendarComparison.match(
    /(?:za\s+)?(?:[ivx1-4]+\.?\s+)?(?:kwartał|półrocze|roku|rok|raport\s+roczny)(?:\s+roku)?\s+(?:finansow\w*|obrotow\w*)?\s*(20\d{2})(?:\s*\/\s*(20\d{2}))?/iu
  );
  if (explicit?.[1]) return explicit[2] ? `${explicit[1]}/${explicit[2]}` : explicit[1];
  const period = withoutCalendarComparison.match(/\b(?:kwartał|półrocze|raport\s+roczny)\s+(20\d{2})(?:\s*\/\s*(20\d{2}))?/iu)
    ?? withoutCalendarComparison.match(/\bza\s+(20\d{2})(?:\s*\/\s*(20\d{2}))?/iu);
  if (period?.[1]) return period[2] ? `${period[1]}/${period[2]}` : period[1];
  if (endingYear) return endingYear;
  return undefined;
};

const getFiscalYear = (value: string) => {
  const label = getFiscalYearLabel(value);
  return label ? Number(label.slice(-4)) : undefined;
};

const getDividendFiscalYear = (value: string) => {
  const heading = value.match(
    /dywidenda\s+(?:za\s+)?(?:rok(?:\s+obrotowy)?\s+)?(20\d{2})(?:\s*\/\s*(20\d{2}))?/iu
  );
  if (heading?.[2]) return Number(heading[2]);
  if (heading?.[1]) return Number(heading[1]);

  const completedYear = value.match(
    /za\s+rok[^.]{0,120}zakończon[^.]{0,80}\b(20\d{2})\b/iu
  )?.[1];
  if (completedYear) return Number(completedYear);
  const profitYear = value.match(
    /(?:zysku|straty)(?:\s+netto)?(?:\s+spółki)?\s+za(?:\s+rok(?:\s+obrotowy)?)?\s+(20\d{2})(?:\s*\/\s*(20\d{2}))?/iu
  );
  if (profitYear?.[2]) return Number(profitYear[2]);
  if (profitYear?.[1]) return Number(profitYear[1]);
  return getFiscalYear(value);
};

const isReportType = (type: CorporateEventType | null): type is
  "QUARTERLY_REPORT" | "HALF_YEAR_REPORT" | "ANNUAL_REPORT" =>
  type === "QUARTERLY_REPORT" || type === "HALF_YEAR_REPORT" || type === "ANNUAL_REPORT";

const isIndependentReportScheduleLine = (line: string) =>
  /^(?:(?:(?:rozszerzon\p{L}*|skonsolidowan\p{L}*|jednostkow\p{L}*)\s+){0,3})raport\p{L}*\s+(?:roczn\p{L}*|kwartaln\p{L}*|półroczn\p{L}*)\b/iu.test(line);

/** Preserve row boundaries: a date may belong to the preceding report label,
 * but a whole neighbouring report row must never be borrowed as context. */
export const getCandidateSegments = (text: string) => {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const segments: Array<{ text: string; sectionType: CorporateEventType | null }> = [];
  let sectionType: CorporateEventType | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    // A numbered section heading is not a report row. Treat it as context
    // before the continuation logic can swallow several following bullets.
    if (/^\d+[.)]\s+(?:(?:rozszerzone|skonsolidowane)\s+)*raporty\s+(?:roczne|kwartalne|półroczne)(?:\s+[^:]{0,50})?:\s*$/iu.test(line)) {
      sectionType = getEventType(line);
      continue;
    }
    // PDF text extraction sometimes wraps only the year of an announced
    // publication date, even though a fiscal period date already occurred.
    if (isReportType(getEventType(line)) && /[-–—]\s*\d{1,2}\s+\p{L}+\s*$/u.test(line) &&
      /^20\d{2}\s*r\.?\s*$/iu.test(lines[index + 1] ?? "")) {
      line += ` ${lines[++index]}`;
    }
    if (isReportType(getEventType(line)) && /\b20\d{2}\s*$/u.test(line) &&
      /^r\.?\s+(?:zostanie|będzie)\s+(?:opublikowan|przekazan)/iu.test(lines[index + 1] ?? "")) {
      line += ` ${lines[++index]}`;
    }
    // Numbered ESPI rows and "- za I półrocze" rows can wrap just before
    // their date. A detached continuation loses its report type entirely.
    if (/^(?:\d+[.)]\s+(?:roczn|kwartaln|półroczn|skonsolidowan|jednostkow|raport)|[-–—•]\s+za\s+)/iu.test(line) &&
      isReportType(getEventType(line)) &&
      !/(?:termin\s+publikacji|zostanie\s+opublikowan|\s[-–—]\s+)\w*[\s\S]{0,80}?\d{1,2}\s+\p{L}+\s+20\d{2}/iu.test(line)) {
      for (let continuation = 0; continuation < 4; continuation += 1) {
        const next = lines[index + 1];
        if (!next || /^\d+[.)]\s+(?:roczn|kwartaln|półroczn|skonsolidowan|jednostkow|raport)/iu.test(next) ||
          /^[-–—•]\s+za\s+/iu.test(next) || /^Raporty?\s+(?:roczne|kwartalne|półroczne)\s*:/iu.test(next) ||
          isIndependentReportScheduleLine(next)) break;
        line += ` ${next}`;
        index += 1;
        if (/(?:termin\s+publikacji|zostanie\s+opublikowan)[\s\S]{0,80}?\d{1,2}\s+\p{L}+\s+20\d{2}/iu.test(line) ||
          extractPolishDates(line).length >= 3 && /\s[-–—]\s+\d{1,2}\s+\p{L}+\s+20\d{2}/iu.test(line)) break;
      }
    }
    // Official schedules often wrap a bullet after its accounting-period
    // range. The first two dates are NOT publication dates: keep reading the
    // same bullet until the explicit publication appointment, but never cross
    // into another report bullet or section.
    if (/^(?:[-–—•]\s*)?(?:raport|skonsolidowan\w*\s+raport|jednostkow\w*\s+raport|rozszerzon\w*\s+raport)/iu.test(line) &&
      isReportType(getEventType(line)) &&
      /\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2}\s*[-–—]\s*\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2}/iu.test(line) &&
      !/(?:opublikowan|przekazan)\w*[\s\S]{0,90}?\b\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2}/iu.test(line)) {
      for (let continuation = 0; continuation < 4; continuation += 1) {
        const next = lines[index + 1];
        if (!next || /^(?:[-–—•]\s*)?(?:raport\s+(?:za|jednostkowy|skonsolidowany)|skonsolidowan\w*\s+raport|jednostkow\w*\s+raport)/iu.test(next) ||
          /^Raporty\s+(?:roczne|kwartalne|półroczne)\s*:/iu.test(next) || isIndependentReportScheduleLine(next)) break;
        line += ` ${next}`;
        index += 1;
        if (/\b(?:zostanie|będzie)\s+(?:opublikowan|przekazan)[\s\S]{0,90}?\b\d{1,2}[.\/-]\d{1,2}[.\/-]20\d{2}/iu.test(line)) break;
      }
    }
    // ESPI/PDF extraction wraps a single bullet over several physical lines.
    // Join only its continuation, stopping before the next report bullet.
    if (/^[-–—•]\s*(?:skonsolidowan\w*|jednostkow\w*|rozszerzon\w*|raport\w*)/iu.test(line)
      && isReportType(getEventType(line)) && extractPolishDates(line).length === 0) {
      for (let continuation = 0; continuation < 4; continuation += 1) {
        const next = lines[index + 1];
        if (!next || /^[-–—•]\s*(?:skonsolidowan\w*|jednostkow\w*|rozszerzon\w*|raport\w*)/iu.test(next)
          || /^Zarząd\b/iu.test(next) || isIndependentReportScheduleLine(next)) break;
        line += ` ${next}`;
        index += 1;
        if (extractPolishDates(line).length > 0) break;
      }
    }
    // PDF text extraction may wrap the publication year onto the next line.
    // Join only a numeric year continuation, never a second report row.
    if (isReportType(getEventType(line)) && extractPolishDates(line).length === 0 &&
      /^20\d{2}(?:\s*r\.?|\s*roku)?(?:\s*[).,:;–—-]|$)/iu.test(lines[index + 1] ?? "")) {
      line += ` ${lines[++index]}`;
    }
    if (/^\s*(?:\d+[.)]\s*)?(?:rozszerzone\s+)?(?:skonsolidowane\s+)?raporty\s+(?:roczne|kwartalne|półroczne)(?:\s+[^:]{0,35})?\s*:?\s*$/iu.test(line)) {
      sectionType = getEventType(line);
      continue;
    }
    if (/\b(?:jednocześnie|ponadto|na podstawie|w związku z tym)\b/iu.test(line) && !/zostanie opublikowan|termin publikacji/iu.test(line)) {
      sectionType = null;
    }
    if (isReportType(getEventType(line)) && extractPolishDates(line).length === 0) {
      const next = lines[index + 1];
      if (next && /^(?:[-–—:]?\s*)?(?:\d{1,2}(?:[.\-/]|\s+\p{L})|w\s+dniu\b|dnia\b|termin\s+publikacji\b)/iu.test(next)) {
        segments.push({ text: `${line} ${next}`, sectionType });
        index += 1;
        continue;
      }
    }
    for (const clause of line.split(/(?:;|,\s*(?=[-–—]\s*za\s+[ivx1-4])|(?<=[.,])\s+(?=(?:(?:skonsolidowan|jednostkow|rozszerzon)\w*\s+)?raport\s+(?:roczn|półroczn|kwartaln)))\s*(?=(?:[-–—]\s*)?(?:skonsolidowan|jednostkow|rozszerzon|raport|za\s+[ivx1-4]))/iu)) {
      segments.push({ text: clause, sectionType });
    }
  }
  return segments;
};

const getReportPublicationDate = (clause: string) => {
  const withoutOldDate = clause.split(/\bzamiast\b/iu)[0];
  const dates = Array.from(withoutOldDate.matchAll(DATE_PATTERN))
    .map((match) => ({ date: getIsoDateFromMatch(match), index: match.index ?? 0 }))
    .filter((match): match is { date: string; index: number } => Boolean(match.date));
  if (!dates.length) return undefined;
  const appointment = /(?:zostanie|będzie)\s+(?:opublikowan\w*|przekazan\w*)|publikacja\s+(?:nastąpi|odbędzie)|termin\s+(?:publikacji|przekazania)/giu;
  const explicit = Array.from(withoutOldDate.matchAll(appointment)).at(-1);
  if (explicit) return dates.find((date) => date.index > (explicit.index ?? 0))?.date;
  if (dates.length === 1 && /(?:zakończon\w*|kończąc\w*\s+się|na\s+dzień)/iu.test(withoutOldDate)) {
    return undefined;
  }
  // A fiscal-period range is not a report appointment. For mixed rows the
  // publication date must follow that range and its closing parenthesis.
  const periodRange = /\b(?:od\s+\d{1,2}|\d{1,2}[.\-/]\d{1,2}[.\-/]20\d{2})[\s\S]{0,90}\bdo\s+\d{1,2}/iu.test(withoutOldDate) ||
    /\(\s*\d{1,2}[.\-/]\d{1,2}[.\-/]20\d{2}\s*[-–—]/u.test(withoutOldDate);
  if (periodRange && dates.length < 3) return undefined;
  const last = dates.at(-1)!;
  const before = withoutOldDate.slice(0, last.index);
  if (!/[:–—-]\s*$|\b(?:w\s+dniu|dnia)\s*$/iu.test(before) && dates.length > 1 && !periodRange) {
    return undefined;
  }
  return last.date;
};

const getExplicitReportPeriod = (clause: string) => {
  const context = clause.match(/\([^)]*(?:od\s+\d{1,2}|\d{1,2}[.\-/]\d{1,2}[.\-/]20\d{2}\s*[-–—])[^)]*\)/u)?.[0] ??
    clause.match(/\bza\s+okres\s+od\s+[^.;]{0,100}\bdo\s+[^.;]{0,50}/iu)?.[0];
  const dates = context ? extractPolishDates(context) : [];
  if (dates.length >= 2) return { periodStart: dates[0], periodEnd: dates[1] };
  const calendarQuarters = Array.from(clause.matchAll(
    /\b(i{1,3}|iv|[1-4])\.?\s+kwartał(?:u)?\s+roku\s+kalendarzow\w*\s+(20\d{2})/giu
  ));
  const calendarQuarter = calendarQuarters.at(-1);
  if (calendarQuarter) {
    const quarter = ({ i: 1, ii: 2, iii: 3, iv: 4, "1": 1, "2": 2, "3": 3, "4": 4 } as const)[
      calendarQuarter[1]!.toLowerCase() as "i" | "ii" | "iii" | "iv" | "1" | "2" | "3" | "4"
    ];
    const endMonthDay: Record<number, string> = { 1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31" };
    return { periodEnd: `${calendarQuarter[2]}-${endMonthDay[quarter]}` };
  }
  const asOfDate = clause.match(/\btj\.?\s+na\s+dzień\s+[^.;]{0,45}/iu)?.[0];
  if (asOfDate) return { periodEnd: extractPolishDates(asOfDate)[0] };
  const endContext = clause.match(/\b(?:kończąc\w*\s+się|zakończon\w*)\s+(?:w\s+dniu\s+)?[^)]{0,45}/iu)?.[0];
  return { periodEnd: endContext ? extractPolishDates(endContext)[0] : undefined };
};

/**
 * Split only when a paragraph explicitly names multiple, different report
 * identities. This prevents sentence-level type precedence (e.g. H1 winning
 * before Q3) from borrowing a neighboring report's publication date.
 */
const splitIndependentReportMentions = (text: string) => {
  const mentions = Array.from(text.matchAll(/\b(?:raport\p{L}*|sprawozdani\p{L}*\s+finansow\p{L}*)\b/giu));
  const anchors = mentions.flatMap((match, index) => {
    const start = match.index ?? 0;
    const nextStart = mentions[index + 1]?.index ?? text.length;
    const immediate = text.slice(start, Math.min(nextStart, start + 84));
    const eventType = getEventType(immediate);
    if (!isReportType(eventType)) return [];
    const clause = text.slice(start, nextStart).trim();
    const period = getFiscalPeriod(clause, eventType);
    const year = getFiscalYearLabel(clause);
    return [{ start, fingerprint: [eventType, period ?? "", year ?? ""].join(":" ) }];
  });
  if (anchors.length < 2 || new Set(anchors.map((anchor) => anchor.fingerprint)).size < 2) return [text];
  return anchors.map((anchor, index) => text.slice(anchor.start, anchors[index + 1]?.start ?? text.length).trim()).filter(Boolean);
};

const getExplicitNonCalendarFiscalYears = (text: string) => {
  const dateToken = String.raw`(?:\d{1,2}\s+[\p{L}]+\s+20\d{2}(?:\s*(?:r\.?|roku))?|\d{1,2}[.\-/]\d{1,2}[.\-/]20\d{2})`;
  const fiscalYearRanges = text.matchAll(
    new RegExp(
      String.raw`\broku\s+(?:obrotow\p{L}*|finansow\p{L}*)[^;\n]{0,220}?\b(?:trwaj\p{L}*\s+)?od\s+(${dateToken})\s+do\s+(${dateToken})`,
      "giu"
    )
  );
  const years = new Set<number>();
  for (const match of fiscalYearRanges) {
    const start = extractPolishDates(match[1] ?? "")[0];
    const end = extractPolishDates(match[2] ?? "")[0];
    if (!start || !end) continue;
    const startMonthDay = start.slice(5);
    const endMonthDay = end.slice(5);
    if (startMonthDay !== "01-01" || endMonthDay !== "12-31") {
      years.add(Number(start.slice(0, 4)));
      years.add(Number(end.slice(0, 4)));
    }
  }
  return years;
};

const isNonCalendarFiscalYearEvent = (event: ParsedCorporateEvent, fiscalYears: ReadonlySet<number>) => {
  const eventYears = (event.fiscalYearLabel ?? String(event.fiscalYear ?? "")).match(/20\d{2}/g)?.map(Number) ?? [];
  return eventYears.some((year) => fiscalYears.has(year));
};

const getReportScheduleReviewReasons = (
  event: ParsedCorporateEvent,
  nonCalendarFiscalYears: ReadonlySet<number> = new Set()
) => {
  const reasons: string[] = [];
  if (!event.fiscalPeriod) reasons.push("PERIOD_NOT_EXPLICIT");
  if (!event.fiscalYearLabel && !event.fiscalYear) reasons.push("FISCAL_YEAR_NOT_EXPLICIT");
  if (event.fiscalYearLabel || event.fiscalYear) {
    const years = (event.fiscalYearLabel ?? String(event.fiscalYear)).match(/20\d{2}/g)?.map(Number) ?? [];
    const eventYear = Number(event.eventDate.slice(0, 4));
    const earliest = years[0] ?? event.fiscalYear!;
    const latest = years.at(-1) ?? event.fiscalYear!;
    if (eventYear < earliest - 1 || eventYear > latest + 1) reasons.push("PUBLICATION_YEAR_CONFLICTS_WITH_PERIOD");
    // Calendar-year periods can be checked conservatively. For non-calendar
    // years we use only source-provided periodEnd and never infer a year end.
    if (years.length === 1 && event.fiscalPeriod && !isNonCalendarFiscalYearEvent(event, nonCalendarFiscalYears)) {
      const endMonthDay: Record<string, string> = { Q1: "03-31", Q2: "06-30", H1: "06-30", Q3: "09-30", Q4: "12-31", FY: "12-31" };
      const periodEnd = event.periodEnd ?? (endMonthDay[event.fiscalPeriod] ? `${years[0]}-${endMonthDay[event.fiscalPeriod]}` : undefined);
      if (periodEnd && event.eventDate > periodEnd) {
        const lagDays = (Date.parse(`${event.eventDate}T00:00:00Z`) - Date.parse(`${periodEnd}T00:00:00Z`)) / 86_400_000;
        if (lagDays > 210) reasons.push("REPORT_PERIOD_MAY_BE_OVERDUE");
      }
    }
  }
  return reasons;
};

const assessReportScheduleEvent = (
  event: ParsedCorporateEvent,
  nonCalendarFiscalYears: ReadonlySet<number> = new Set()
): ParsedCorporateEvent => {
  const reviewReasons = getReportScheduleReviewReasons(event, nonCalendarFiscalYears);
  return reviewReasons.length ? { ...event, requiresReview: true, reviewReasons } : event;
};

const parseReportScheduleEvents = (text: string) => {
  const events = new Map<string, ParsedCorporateEvent>();
  const nonCalendarFiscalYears = getExplicitNonCalendarFiscalYears(text);
  const explicitFiscalScheduleRange = text.match(
    /\broku?\s+(?:obrotow\p{L}*|finansow\p{L}*)[^.\n]{0,120}?\b(20\d{2})\s*\/\s*(20\d{2})\b/iu
  );
  const scheduleYearMatch = text.match(/\broku?\s+obrotow\w*\s+(20\d{2})(?:\s*\/\s*(20\d{2}))?/iu);
  const scheduleYearLabel = explicitFiscalScheduleRange
    ? `${explicitFiscalScheduleRange[1]}/${explicitFiscalScheduleRange[2]}`
    : scheduleYearMatch?.[1]
    ? [scheduleYearMatch[1], scheduleYearMatch[2]].filter(Boolean).join("/")
    : text.match(/\brok\s+obrotowy\s+kończąc\w*\s+się\s+w\s+(20\d{2})/iu)?.[1];
  // An issuer may announce selected preliminary data from a future report
  // before publishing the report itself. ESPI line wraps can separate
  // "selected data" from "half-year report", so classify the entire clause
  // before segmenting it into potential calendar appointments.
  const scheduleText = text.replace(
    /\bwybran\p{L}*\s+(?:niezaudytowan\p{L}*\s+)?dan\p{L}*\s+finansow\p{L}*[\s\S]{0,350}?(?:zostan\p{L}*\s+(?:opublikowan|przekazan)\p{L}*[\s\S]{0,100}?20\d{2}\s*(?:roku|r\.?))/giu,
    " "
  );
  for (const segment of getCandidateSegments(scheduleText)) {
    for (const clause of splitIndependentReportMentions(segment.text)) {
    if (/\brozporządzen|\bwybrane\s+(?:niezaudytowane\s+)?dane\s+finansowe|\bdane\s+finansowe\s+ze\s+skonsolidowanego\s+raportu/iu.test(clause)) continue;
    if (/\b(?:nie\s+będzie|nie\s+przekaże|nie\s+publikuje)\b/iu.test(clause)) continue;
    if (/\b(?:okresy\s+sprawozdawcze|trwa\s+od)\b/iu.test(clause)) continue;
    const type = getEventType(clause) ?? segment.sectionType;
    if (!isReportType(type)) continue;
    // A date in a legal citation below a section heading is not a report.
    if (!getEventType(clause) && !/(?:zostanie|będzie)\s+(?:opublikowan|przekazan)|termin\s+(?:publikacji|przekazania)/iu.test(clause)) continue;
    const eventDate = getReportPublicationDate(clause);
    if (!eventDate) continue;
    const fiscalPeriod = getFiscalPeriod(clause, type);
    const periodBounds = getExplicitReportPeriod(clause);
    const endingYear = clause.match(/\broku?\s+obrotow\w*\s+kończąc\w*\s+się\s+(?:w\s+dniu\s+)?\d{1,2}\s+\p{L}+\s+(20\d{2})/iu)?.[1];
    const fiscalYearLabel = endingYear && periodBounds.periodEnd &&
      Number(periodBounds.periodEnd.slice(0, 4)) === Number(endingYear) - 1
      ? `${Number(endingYear) - 1}/${endingYear}`
      : (() => {
        const clauseYearLabel = getFiscalYearLabel(clause);
        const scheduleYears = scheduleYearLabel?.match(/20\d{2}/g)?.map(Number) ?? [];
        const clauseYears = clauseYearLabel?.match(/20\d{2}/g)?.map(Number) ?? [];
        const belongsToScheduleRange = scheduleYears.length === 2 &&
          (!clauseYears.length || clauseYears.some((year) => scheduleYears.includes(year)));
        return belongsToScheduleRange ? scheduleYearLabel : clauseYearLabel ?? scheduleYearLabel;
      })();
    const fiscalYear = fiscalYearLabel ? Number(fiscalYearLabel.slice(-4)) : undefined;
    const event: ParsedCorporateEvent = {
      eventType: type, eventDate, fiscalPeriod, fiscalYear, fiscalYearLabel,
      ...periodBounds,
      reportScope: /jednostkow/iu.test(clause) && /skonsolidowan/iu.test(clause) ? "COMBINED"
        : /jednostkow/iu.test(clause) ? "UNIT"
          : /skonsolidowan/iu.test(clause) ? "CONSOLIDATED" : undefined,
      isScheduleChange: false,
      sourceEvidence: clause.slice(0, 500),
    };
    const assessedEvent = assessReportScheduleEvent(event, nonCalendarFiscalYears);
    const key = `${getCorporateEventIdentityKey(assessedEvent)}:${eventDate}`;
    const previous = events.get(key);
    if (previous && previous.reportScope && assessedEvent.reportScope && previous.reportScope !== assessedEvent.reportScope) {
      events.set(key, { ...assessedEvent, reportScope: "COMBINED" });
    } else {
      events.set(key, assessedEvent);
    }
    }
  }
  const result = [...events.values()];
  const datesByIdentity = new Map<string, Set<string>>();
  for (const event of result) {
    const identity = getCorporateEventIdentityKey(event);
    const dates = datesByIdentity.get(identity) ?? new Set<string>();
    dates.add(event.eventDate);
    datesByIdentity.set(identity, dates);
  }
  for (const event of result) {
    const identity = getCorporateEventIdentityKey(event);
    if ((datesByIdentity.get(identity)?.size ?? 0) > 1 && event.reportScope && event.reportScope !== "COMBINED") {
      event.eventIdentity = `${identity}:${event.reportScope}`;
    }
  }
  return result;
};

const toAmount = (value: string) => {
  const normalized = value.replace(/[\s.](?=\d{3}(?:[,.]|\b))/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getDateAfterKeyword = (
  text: string,
  keyword: RegExp,
  maxLength = 180,
  preference: "first" | "last" = "last",
  fromMatchEnd = false
) => {
  const flags = keyword.flags.includes("g") ? keyword.flags : `${keyword.flags}g`;
  const pattern = new RegExp(keyword.source, flags);
  let resolvedDate: string | undefined;

  // Titles often contain e.g. "wypłata dywidendy" but no actual date. Scan
  // all bounded occurrences and prefer the final explicit date from the
  // issuer statement over publication metadata that follows the title.
  for (const match of text.matchAll(pattern)) {
    const contextStart = (match.index ?? 0) + (fromMatchEnd ? match[0].length : 0);
    const context = text.slice(contextStart, contextStart + maxLength);
    if (/data publikacji|aktualizacja/iu.test(context)) continue;
    const date = extractPolishDates(context)[0];
    if (!date) continue;
    if (preference === "first") return date;
    resolvedDate = date;
  }

  return resolvedDate;
};

const GENERAL_MEETING_REFERENCE =
  /waln(?:e|ego|emu|ym|ych)?\s+zgromadzeni(?:e|a|u|em)?(?:\s+akcjonariuszy)?|\b(?:wza|zwz|zwza|nwz|agm|egm)\b|\b(?:annual|extraordinary|ordinary)\s+general\s+meeting\b|\bgeneral\s+meeting\b/iu;

const GENERAL_MEETING_FALSE_NOTICE =
  /opinia\s+(?:rady\s+nadzorczej|zarzadu)[\s\S]{0,240}?(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)|stanowisko\s+rady\s+nadzorczej[\s\S]{0,240}?(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)|projekt(?:y|u|em)?\s+uchwal|zgloszeni(?:e|a)\s+projektu\s+uchwal|(?:uzupelnieni|zmian)[eaęy]?\s+porzadku\s+obrad|zadani(?:e|a)\s+akcjonariusz|zgloszeni(?:e|a)\s+kandydat|wykaz\s+akcjonariusz|lista\s+akcjonariusz[^\n.]{0,100}(?:glos|procent|%)|tresc\s+uchwal\s+podjetych|uchwal(?:y|a)\s+podjet|wynik(?:i|ow)?\s+glosowa|po\s+(?:odbyciu|zakonczeniu)\s+(?:walnego|wza|zwz|nwz)|informacj[ae]\s+po\s+(?:walnym|wza|zwz|nwz)|(?:minutes|results?\s+of\s+voting|resolutions?\s+adopted|draft\s+resolutions?|candidates?\s+for\s+the\s+board|agenda\s+amendment)[^\n.]{0,100}(?:general\s+meeting|\b(?:agm|egm)\b)/iu;

const GENERAL_MEETING_FORMAL_NOTICE =
  /(?:ogloszeni[ae]\s+o\s+)?zwolani[eu]\s+(?:(?:zwyczajnego|nadzwyczajnego)\s+)?walnego\s+zgromadzenia|\bzwol(?:uje|a|al|ano|anie|aniu|ane|anego|anym)(?![\p{L}\p{N}_])[\s\S]{0,260}?(?:waln\w*\s+zgromadzeni\w*|\b(?:zwz|nwz|wza)\b)|(?:waln\w*\s+zgromadzeni\w*|\b(?:zwz|nwz)\b)[\s\S]{0,180}?(?:zostanie\s+zwolan\w*|zwolan\w*\s+na)|(?:zarzad|spolka|emitent)[\s\S]{0,160}?informuje[\s\S]{0,220}?(?:waln\w*\s+zgromadzeni\w*|\b(?:zwz|nwz)\b)[\s\S]{0,100}?odbed(?:zie|a)\s+sie|(?:informacj\w*\s+o\s+terminie|notice\s+(?:of|on)\s+(?:the\s+)?date)[\s\S]{0,180}?(?:waln\w*\s+zgromadzeni\w*|\b(?:zwz|nwz|wza|agm|egm)\b)|(?:notice\s+(?:of|convening)\s+(?:the\s+)?(?:annual|extraordinary|ordinary\s+)?general\s+meeting|(?:annual|extraordinary|ordinary)\s+general\s+meeting[\s\S]{0,180}?(?:will\s+be\s+held|is\s+convened|shall\s+be\s+held)|(?:board|company|issuer)[\s\S]{0,120}?(?:convenes|hereby\s+convenes)[\s\S]{0,150}?general\s+meeting)/iu;

const GENERAL_MEETING_RESCHEDULE_NOTICE =
  /zmian(?:a|y|ie|e)\s+terminu[\s\S]{0,180}?(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)|(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)[\s\S]{0,180}?zmian(?:a|y|ie|e)\s+terminu|(?:przeloz|przenies|zmienia\s+termin)[\s\S]{0,180}?(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)|(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)[\s\S]{0,180}?(?:przeloz|przenies|zmienia\s+termin)|(?:change|reschedul|postpon)[^\n.]{0,160}(?:general\s+meeting|\b(?:agm|egm)\b)|(?:general\s+meeting|\b(?:agm|egm)\b)[^\n.]{0,160}(?:change|reschedul|postpon)/iu;

const GENERAL_MEETING_CANCELLATION_NOTICE =
  /odwolani[ae]\s+(?:(?:zwyczajnego|nadzwyczajnego)\s+)?walnego\s+zgromadzenia|odwoluj\w*[\s\S]{0,180}?(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)|(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)[\s\S]{0,260}?(?:zostalo\s+odwolan\w*|nie\s+odbedzie\s+sie|informuje\s+o\s+odwolaniu\s+(?:tego\s+)?zgromadzenia)|(?:cancel|withdraw)[^\n.]{0,180}(?:general\s+meeting|\b(?:agm|egm)\b)|(?:general\s+meeting|\b(?:agm|egm)\b)[^\n.]{0,180}(?:cancel|withdraw)/iu;
const GENERAL_MEETING_CANCELLATION_SIGNAL =
  /odwolani[ae]|odwoluj\w*|zostalo\s+odwolan\w*|nie\s+odbedzie\s+sie|informuje\s+o\s+odwolaniu|cancel|withdraw/iu;

const normalizeGeneralMeetingText = (value: string) => value
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .replace(/[łŁ]/g, (character) => character === "Ł" ? "L" : "l")
  .replace(/&amp;/gi, "&");

const getGeneralMeetingType = (text: string): GeneralMeetingType | undefined => {
  if (/\bnwz\b|\begm\b|extraordinary\s+general\s+meeting|nadzwyczajn\w*\s+waln\w*\s+zgromadzeni\w*/iu.test(text)) return "NWZ";
  if (/\bzwza\b|\bzwz\b|\bagm\b|annual\s+general\s+meeting|ordinary\s+general\s+meeting|(?<!nadzwy)zwyczajn\w*\s+waln\w*\s+zgromadzeni\w*/iu.test(text)) return "ZWZ";
  return undefined;
};

const getGeneralMeetingIdentity = (
  meetingType: GeneralMeetingType | undefined,
  meetingDate: string
) => ["general-meeting", meetingType ?? "WZA", meetingDate].join(":");

const getSemanticMeetingDate = (text: string) => {
  const keywordPatterns = [
    /\b(?:odbed(?:zie|a)\s+sie|jest\s+zwolan\w*)\s+w\s+(?:poniedzialek|wtorek|srode|czwartek|piatek|sobote|niedziele)\s*/iu,
    /\bzwol(?:uje|al|ano|ane|anego|anym|anie|aniu)(?![\p{L}\p{N}_])[\s\S]{0,180}?\b(?:na\s+dzien|w\s+dniu|dnia)(?![\p{L}\p{N}_])/iu,
    /(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)[\s\S]{0,160}?\b(?:odbed(?:zie|a)\s+sie|zwolan\w*)\b[\s\S]{0,80}?\b(?:w\s+dniu|dnia|na\s+dzien)(?![\p{L}\p{N}_])/iu,
    /(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)[\s\S]{0,100}?\bw\s+dniu\b/iu,
    /(?:general\s+meeting|\b(?:agm|egm)\b)[\s\S]{0,180}?\b(?:will\s+be\s+held|is\s+scheduled\s+to\s+take\s+place|shall\s+be\s+held|takes\s+place)\s+(?:on\s+)?/iu,
    /\b(?:will\s+be\s+held|is\s+scheduled\s+to\s+take\s+place|shall\s+be\s+held)\s+on\s+/iu,
  ];

  for (const keyword of keywordPatterns) {
    const date = getDateAfterKeyword(text, keyword, 100, "first", true);
    if (date) return date;
  }

  return undefined;
};

const getOfficialGeneralMeetingRegistrationDate = (text: string) => {
  // English-language issuer notices often use an explicit label-first form
  // such as "Record date: September 15, 2026".
  for (const reference of text.matchAll(/(?:record|registration)\s+date\s*:?\s*/giu)) {
    const start = (reference.index ?? 0) + reference[0].length;
    const date = extractPolishDates(text.slice(start, start + 120))[0];
    if (date) return date;
  }

  // Some issuer notices define the date first and name it later, e.g.
  // "share ownership on 4 November 2026 ... (Record Date)". Bind only the
  // nearest explicit date to that label and require the surrounding wording
  // to describe share ownership/participation; otherwise a meeting date in
  // the same paragraph could be mistaken for the record date.
  const englishRecordLabels = Array.from(text.matchAll(/\b(?:record|registration)\s+date\b/giu));
  const parsedDates = Array.from(text.matchAll(UNICODE_DATE_PATTERN))
    .map((match) => ({ date: getIsoDateFromMatch(match), start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }))
    .filter((entry): entry is { date: string; start: number; end: number } => Boolean(entry.date));
  for (const label of englishRecordLabels) {
    const labelStart = label.index ?? 0;
    const nearest = parsedDates.filter((entry) => entry.end <= labelStart && labelStart - entry.end <= 180).at(-1);
    if (!nearest) continue;
    const beforeDate = text.slice(Math.max(0, nearest.start - 100), nearest.start);
    const betweenDateAndLabel = text.slice(nearest.end, labelStart);
    if (
      /(?:share\s+ownership|shareholder\s+eligibility|shares\s+held|right\s+to\s+participate)[\s\S]{0,90}\bon\s*$/iu.test(beforeDate) &&
      !/[.!?]/u.test(betweenDateAndLabel)
    ) {
      return nearest.date;
    }
  }

  // PAP/ESPI notices also use the inverse wording: "Dzień 8 września ...
  // jest dniem rejestracji uczestnictwa". Resolve that explicit issuer date
  // before looking for the more common label-first form.
  for (const dateMatch of text.matchAll(UNICODE_DATE_PATTERN)) {
    const date = getIsoDateFromMatch(dateMatch);
    if (!date) continue;
    const afterDate = text.slice(
      (dateMatch.index ?? 0) + dateMatch[0].length,
      (dateMatch.index ?? 0) + dateMatch[0].length + 180
    );
    if (/^\s*(?:(?:roku|r\.)\s*)?[,;:–—-]?\s*(?:jest\s+dniem\s+rejestracji|is\s+(?:the\s+)?record\s+date|is\s+the\s+registration\s+date)(?:\s+uczestnictwa)?\b/iu.test(afterDate)) {
      return date;
    }
  }

  const references = Array.from(
    text.matchAll(/(?:dzien|dniem)\s+rejestracji(?:\s+uczestnictwa)?(?:\s+w\s+(?:walnym\s+zgromadzeniu|wza|zwz|nwz))?|(?:record|registration)\s+date\s*:?/giu)
  );

  for (const reference of references) {
    const context = text.slice(reference.index ?? 0, (reference.index ?? 0) + 280);
    const linkingText = context.slice(reference[0].length);
    const date = extractPolishDates(linkingText)[0];
    if (!date) continue;

    const dateIndex = linkingText.search(/\b\d{1,2}\s*(?:[.\-/]\s*)?(?:[\p{L}]+\s+)?20\d{2}\b|\b[\p{L}]+\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+20\d{2}\b|\b\d{1,2}[.\-/]\d{1,2}[.\-/]20\d{2}\b/u);
    const beforeDate = dateIndex >= 0 ? linkingText.slice(0, dateIndex) : linkingText;
    if (/(?:jest|przypada|ustal\w*|wyznacz\w*|na\s+dzien|:|–|—|-|is|shall\s+be)/iu.test(beforeDate)) {
      return date;
    }
  }

  return undefined;
};

type ParsedMeetingTime = { time: string; timeZone?: string };

const MEETING_TIME_ZONE_OFFSETS: Record<string, number> = {
  UTC: 0,
  GMT: 0,
  CET: 60,
  CEST: 120,
  WET: 0,
  WEST: 60,
  BST: 60,
  EET: 120,
  EEST: 180,
  AWST: 480,
};

const getMeetingTimeZone = (text: string, matchEnd: number) => {
  const suffix = text.slice(matchEnd, matchEnd + 48).match(/^\s*(?:\(\s*)?(?:czas(?:u)?\s+|time\s+)?([A-Z]{2,5}|[A-Za-z_+-]+\/[A-Za-z_+-]+)\b/u)?.[1];
  if (!suffix) return undefined;
  const upper = suffix.toUpperCase();
  if (Object.hasOwn(MEETING_TIME_ZONE_OFFSETS, upper)) return upper;
  // Accept explicit IANA identifiers only when the runtime recognizes them.
  if (suffix.includes("/")) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: suffix });
      return suffix;
    } catch {
      return "UNKNOWN";
    }
  }
  return "UNKNOWN";
};

const getWarsawDateTime = (meetingDate: string, value?: ParsedMeetingTime) => {
  if (!value || value.timeZone === "UNKNOWN") return undefined;
  if (!value.timeZone) return { eventDate: meetingDate, eventTime: value.time };

  const [year, month, day] = meetingDate.split("-").map(Number);
  const [hour, minute] = value.time.split(":").map(Number);
  const localAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  let utcTimestamp: number;
  const fixedOffset = MEETING_TIME_ZONE_OFFSETS[value.timeZone];
  if (fixedOffset !== undefined) {
    utcTimestamp = localAsUtc - fixedOffset * 60_000;
  } else {
    // Convert an IANA-zone wall time to UTC. Iteration handles DST offsets
    // without assuming that the issuer and Warsaw share a calendar date.
    const sourceFormatter = new Intl.DateTimeFormat("en-GB", {
      timeZone: value.timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    utcTimestamp = localAsUtc;
    for (let iteration = 0; iteration < 4; iteration += 1) {
      const parts = Object.fromEntries(sourceFormatter.formatToParts(new Date(utcTimestamp)).map(({ type, value: part }) => [type, part]));
      const sourceWallAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
      const offset = sourceWallAsUtc - utcTimestamp;
      const next = localAsUtc - offset;
      if (next === utcTimestamp) break;
      utcTimestamp = next;
    }
  }

  const warsawParts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Warsaw",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(utcTimestamp)).map(({ type, value: part }) => [type, part]));
  return {
    eventDate: `${warsawParts.year}-${warsawParts.month}-${warsawParts.day}`,
    eventTime: `${warsawParts.hour}:${warsawParts.minute}`,
  };
};

const getGeneralMeetingTime = (text: string, meetingDate: string): ParsedMeetingTime | undefined => {
  const dateOccurrences = Array.from(text.matchAll(UNICODE_DATE_PATTERN))
    .map((match) => ({ date: getIsoDateFromMatch(match), index: match.index ?? 0 }))
    .filter((entry) => entry.date === meetingDate);
  if (dateOccurrences.length === 0) return undefined;

  const polishTimes = Array.from(
    text.matchAll(/\b(?:o\s+godzin(?:ie|e)|na\s+godzine|na\s+g\.|godz(?:ina|ine)?\.?)\s*(\d{1,2})(?:[:.]([0-5]\d))?(?:\s*(a\.m\.|p\.m\.|am|pm))?\b/giu)
  ).flatMap((match) => {
    let hour = Number(match[1]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return [];
    if (match[3] && hour > 12) return [];
    if (/p\.?m\.?/iu.test(match[3] ?? "") && hour < 12) hour += 12;
    if (/a\.?m\.?/iu.test(match[3] ?? "") && hour === 12) hour = 0;
    return [{
      time: `${String(hour).padStart(2, "0")}:${match[2] ?? "00"}`,
      index: match.index ?? 0,
      timeZone: getMeetingTimeZone(text, (match.index ?? 0) + match[0].length),
    }];
  });
  const englishTimes = Array.from(text.matchAll(/\b(?:at\s+)?(\d{1,2}):([0-5]\d)(?:\s*(a\.m\.|p\.m\.|am|pm))?(?=$|\s|[.,;])/giu)
  ).flatMap((match) => {
    let hour = Number(match[1]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || (match[3] && hour > 12)) return [];
    if (/p\.?m\.?/iu.test(match[3] ?? "") && hour < 12) hour += 12;
    if (/a\.?m\.?/iu.test(match[3] ?? "") && hour === 12) hour = 0;
    return [{
      time: `${String(hour).padStart(2, "0")}:${match[2]}`,
      index: match.index ?? 0,
      timeZone: getMeetingTimeZone(text, (match.index ?? 0) + match[0].length),
    }];
  });
  const timeMatches = [...polishTimes, ...englishTimes];

  const candidates = dateOccurrences.flatMap((date) =>
    timeMatches
      .map((time) => ({ ...time, distance: Math.abs(time.index - date.index) }))
      .filter((time) => time.distance <= 180)
  ).sort((left, right) => left.distance - right.distance);

  const { time, timeZone } = candidates[0] ?? {};
  return time ? { time, timeZone } : undefined;
};

const getGeneralMeetingTimeForType = (text: string, meetingType: GeneralMeetingType, fallbackDate: string): ParsedMeetingTime | undefined => {
  const normalized = normalizeGeneralMeetingText(text);
  const typePattern = meetingType === "ZWZ"
    ? /\b(?:ogm|agm|zwz|zwza)\b|\b(?:ordinary|annual)\s+general\s+meeting\b|\bzwyczajn\w*\s+waln\w*\s+zgromadzeni\w*/giu
    : /\b(?:egm|nwz)\b|\bextraordinary\s+general\s+meeting\b|\bnadzwyczajn\w*\s+waln\w*\s+zgromadzeni\w*/giu;
  const otherTypePattern = meetingType === "ZWZ"
    ? /\b(?:egm|nwz)\b|\bextraordinary\s+general\s+meeting\b|\bnadzwyczajn\w*\s+waln\w*\s+zgromadzeni\w*/iu
    : /\b(?:ogm|agm|zwz|zwza)\b|\b(?:ordinary|annual)\s+general\s+meeting\b|\bzwyczajn\w*\s+waln\w*\s+zgromadzeni\w*/iu;
  const timePattern = /\b(?:at\s+|o\s+godzin(?:ie|e)\s*|godz(?:ina|ine)?\.?\s*)?(\d{1,2}):([0-5]\d)(?:\s*(a\.m\.|p\.m\.|am|pm))?\b/iu;
  const candidates = Array.from(normalized.matchAll(typePattern)).flatMap((match) => {
    const start = (match.index ?? 0) + match[0].length;
    const context = normalized.slice(start, start + 180);
    const time = context.match(timePattern);
    if (!time || (otherTypePattern.test(context.slice(0, time.index)) && (time.index ?? 0) > 0)) return [];
    let hour = Number(time[1]);
    const minute = time[2]!;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || (time[3] && hour > 12)) return [];
    if (/p\.?m\.?/iu.test(time[3] ?? "") && hour < 12) hour += 12;
    if (/a\.?m\.?/iu.test(time[3] ?? "") && hour === 12) hour = 0;
    const matchEnd = start + (time.index ?? 0) + time[0].length;
    return [{
      time: `${String(hour).padStart(2, "0")}:${minute}`,
      timeZone: getMeetingTimeZone(normalized, matchEnd),
      distance: time.index ?? 0,
    }];
  }).sort((left, right) => left.distance - right.distance);
  const { time, timeZone } = candidates[0] ?? {};
  return time ? { time, timeZone } : getGeneralMeetingTime(text, fallbackDate);
};

const getGeneralMeetingRescheduleDates = (text: string) => {
  const changeIndex = text.search(GENERAL_MEETING_RESCHEDULE_NOTICE);
  if (changeIndex < 0) return {};
  const context = text.slice(Math.max(0, changeIndex - 180), changeIndex + 1_300);

  // A real ESPI change may cite multiple source reports and their publication
  // dates before the operative "z dnia OLD na dzień NEW" clause. Find that
  // directly paired clause instead of taking the first two dates after the
  // report title. A second "z dnia" before "na dzień" means this is still a
  // report-reference list, not the actual old/new date pair.
  for (const oldDateLabel of context.matchAll(/\bz\s+dnia\b/giu)) {
    const tail = context.slice(oldDateLabel.index ?? 0, (oldDateLabel.index ?? 0) + 180);
    const newDateLabelIndex = tail.search(/\bna\s+dzien(?![\p{L}\p{N}_])/iu);
    if (newDateLabelIndex < 0 || newDateLabelIndex > 110) continue;

    const oldDateContext = tail.slice(oldDateLabel[0].length, newDateLabelIndex);
    if (/\bz\s+dnia\b/iu.test(oldDateContext)) continue;
    const previousEventDate = extractPolishDates(oldDateContext)[0];
    const eventDate = extractPolishDates(tail.slice(newDateLabelIndex, newDateLabelIndex + 100))[0];
    if (previousEventDate && eventDate && previousEventDate !== eventDate) {
      return { previousEventDate, eventDate };
    }
  }

  const previousEventDate =
    getDateAfterKeyword(
      context,
      /(?:dotychczasow\w*|pierwotn\w*)\s+termin\w*[\s\S]{0,80}?(?:na\s+dzien|w\s+dniu|:)|zwolan\w*[\s\S]{0,80}?(?:na\s+dzien|w\s+dniu)|\bz\s+dnia\b/iu,
      100,
      "first",
      true
    );
  const eventDate =
    getDateAfterKeyword(
      context,
      /(?:nowy|zmienion\w*)\s+termin\w*[\s\S]{0,80}?(?:na\s+dzien|w\s+dniu|:)|(?:przeloz|przenies)\w*[\s\S]{0,80}?\bna(?:\s+dzien)?\b|zmienia\s+termin[\s\S]{0,80}?\bna(?:\s+dzien)?\b/iu,
      100,
      "first",
      true
    );
  const dates = extractPolishDates(context);

  return {
    previousEventDate: previousEventDate ?? (dates.length >= 2 ? dates[0] : undefined),
    eventDate: eventDate ?? (dates.length >= 2 ? dates.at(-1) : undefined),
  };
};

const getGeneralMeetingEvents = (text: string): ParsedCorporateEvent[] => {
  const meetingText = normalizeGeneralMeetingText(text);
  if (!GENERAL_MEETING_REFERENCE.test(meetingText)) return [];

  const meetingType = getGeneralMeetingType(meetingText);
  const reschedule = GENERAL_MEETING_RESCHEDULE_NOTICE.test(meetingText);
  const cancellationMatch = meetingText.match(GENERAL_MEETING_CANCELLATION_NOTICE);
  const cancellationSignalOffset = cancellationMatch?.[0].search(GENERAL_MEETING_CANCELLATION_SIGNAL) ?? -1;
  const cancellationSignalIndex = cancellationMatch && cancellationSignalOffset >= 0
    ? (cancellationMatch.index ?? 0) + cancellationSignalOffset
    : -1;
  const formalMatch = meetingText.match(GENERAL_MEETING_FORMAL_NOTICE);
  // A convening notice may mention cancellation of an older meeting or use
  // cancellation boilerplate later in the document. The explicit cancellation
  // phrase must precede the current formal notice; the broad match's start can
  // be the earlier meeting reference, so compare the actual cancellation
  // signal within that match instead.
  const cancellation = cancellationSignalIndex >= 0 &&
    (!formalMatch || cancellationSignalIndex <= (formalMatch.index ?? 0));

  if (reschedule) {
    const { previousEventDate, eventDate } = getGeneralMeetingRescheduleDates(meetingText);
    if (!previousEventDate || !eventDate || previousEventDate === eventDate) return [];
    const resolvedDateTime = getWarsawDateTime(eventDate, getGeneralMeetingTime(meetingText, eventDate));

    return [{
      eventType: "GENERAL_MEETING",
      eventDate: resolvedDateTime?.eventDate ?? eventDate,
      eventTime: resolvedDateTime?.eventTime,
      previousEventDate,
      fiscalYear: Number(eventDate.slice(0, 4)),
      isScheduleChange: true,
      generalMeetingType: meetingType,
      generalMeetingAction: "RESCHEDULE",
      registrationDate: getOfficialGeneralMeetingRegistrationDate(meetingText),
      isCancellation: false,
      eventIdentity: getGeneralMeetingIdentity(meetingType, previousEventDate),
    }];
  }

  const falseNoticeIndex = meetingText.search(GENERAL_MEETING_FALSE_NOTICE);
  const formalNoticeIndex = formalMatch?.index ?? -1;
  if (
    !cancellation &&
    (!formalMatch || (falseNoticeIndex >= 0 && falseNoticeIndex <= formalNoticeIndex))
  ) {
    return [];
  }

  const eventDate = getSemanticMeetingDate(meetingText);
  if (!eventDate) return [];
  const resolvedDateTime = getWarsawDateTime(eventDate, getGeneralMeetingTime(meetingText, eventDate));
  const normalizedEventDate = resolvedDateTime?.eventDate ?? eventDate;

  // Some formal notices convene an ordinary/annual and an extraordinary
  // meeting together on the same day. Keep each meeting's type, identity and
  // (where explicitly announced) time instead of letting the last acronym in
  // the document win for the entire notice.
  const hasOrdinaryMeeting = /\b(?:ogm|agm|zwz|zwza)\b|\b(?:ordinary|annual)\s+general\s+meeting\b|\bzwyczajn\w*\s+waln\w*\s+zgromadzeni\w*/iu.test(meetingText);
  const hasExtraordinaryMeeting = /\b(?:egm|nwz)\b|\bextraordinary\s+general\s+meeting\b|\bnadzwyczajn\w*\s+waln\w*\s+zgromadzeni\w*/iu.test(meetingText);
  if (formalMatch && hasOrdinaryMeeting && hasExtraordinaryMeeting) {
    const registrationDate = getOfficialGeneralMeetingRegistrationDate(meetingText);
    return (["ZWZ", "NWZ"] as const).map((type) => {
      const typeDateTime = getWarsawDateTime(eventDate, getGeneralMeetingTimeForType(meetingText, type, eventDate));
      const resolvedEventDate = typeDateTime?.eventDate ?? eventDate;
      return {
        eventType: "GENERAL_MEETING" as const,
        eventDate: resolvedEventDate,
        eventTime: typeDateTime?.eventTime,
        fiscalYear: Number(eventDate.slice(0, 4)),
        isScheduleChange: false,
        generalMeetingType: type,
        generalMeetingAction: "CONVENING" as const,
        registrationDate,
        isCancellation: false,
        eventIdentity: getGeneralMeetingIdentity(type, eventDate),
      };
    });
  }

  return [{
    eventType: "GENERAL_MEETING",
    eventDate: normalizedEventDate,
    eventTime: resolvedDateTime?.eventTime,
    fiscalYear: Number(eventDate.slice(0, 4)),
    isScheduleChange: false,
    generalMeetingType: meetingType,
    generalMeetingAction: cancellation ? "CANCELLATION" : "CONVENING",
    registrationDate: getOfficialGeneralMeetingRegistrationDate(meetingText),
    isCancellation: cancellation,
    eventIdentity: getGeneralMeetingIdentity(meetingType, eventDate),
  }];
};

const getDividendStatus = (text: string): Extract<
  CorporateEventStatus,
  "PROPOSED" | "CONFIRMED" | "UNKNOWN"
> => {
  const normalized = text.toLocaleLowerCase("pl-PL");
  const folded = normalized.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/ł/g, "l");
  // An adopted profit-allocation resolution is final even if the issuer says
  // it was adopted "zgodnie z propozycją zarządu".
  if (/walne\s+zgromadzenie[\s\S]{0,180}?podjelo[\s\S]{0,160}?uchwale[\s\S]{0,140}?(?:podzialu\s+zysku|wyplacie\s+dywidendy|wyplaty\s+dywidendy)/u.test(folded)) {
    return "CONFIRMED";
  }

  // A board can adopt its own recommendation, but the report may explicitly
  // say the dividend still requires a future shareholder decision. Such a
  // board resolution is not an approved dividend distribution.
  if (/ostateczn\w*\s+decyzj\w*[\s\S]{0,160}?podjet\w*\s+zostanie[\s\S]{0,100}?waln\w*\s+zgromadzen/u.test(folded)) {
    return "PROPOSED";
  }

  const finalApproval =
    /rada\s+nadzorcza[\s\S]{0,180}?(?:wyraziła|udzieliła|podjęła|postanowiła\s+wyrazić).{0,80}zgod|zgod[ae]\s+rady\s+nadzorczej|waln\w*\s+zgromadzeni\w*[\s\S]{0,120}?(?:podj.{0,24}uchwa|postanowi)|uchwał[ae]\s+(?:zwyczajnego|nadzwyczajnego)?\s*walnego\s+zgromadzenia/u.test(normalized);
  const conditionalAdvance =
    /warunkiem\s+wypłat[yi][\s\S]{0,180}?zgod[ayę]\s+rady\s+nadzorczej|uchwał\w*\s+o\s+(?:przedłożeniu|skierowaniu)[\s\S]{0,140}?(?:wniosku|rekomendacji)|zamiar\w*\s+wypłat[yi]\s+zaliczk/u.test(normalized);

  const approvedByMeeting = /waln\w*\s+zgromadzeni\w*[\s\S]{0,180}?podj\w*[\s\S]{0,80}?uchwa\w*[\s\S]{0,100}?dywidend/u.test(normalized);
  const adoptedProfitResolution = /waln\w*\s+zgromadzeni\w*[\s\S]{0,180}?podj\w*[\s\S]{0,180}?uchwa\w*[\s\S]{0,120}?(?:podzia\w*\s+zysku|dywidend)/u.test(normalized);
  if (conditionalAdvance && !finalApproval && !approvedByMeeting) return "PROPOSED";
  if (finalApproval || approvedByMeeting || adoptedProfitResolution) return "CONFIRMED";

  // A proposal often says that the final decision will be taken by the AGM.
  // A bare mention of the meeting must never promote it to a confirmed cash
  // distribution.
  if (
    /propozyc|wniosek\s+zarz|rekomend|ostateczn.{0,32}decyzj.{0,80}(?:waln|wza|zwz)|warunkow.{0,48}(?:zgod|uchwa)/u.test(
      normalized
    ) && !/podj.{0,20}uchwa|uchwa.{0,40}(?:w\s+sprawie\s+)?(?:podzial|wyplat)|zatwierdz|postanawia.{0,48}(?:wyplac|wypłac)/u.test(normalized)
  ) {
    return "PROPOSED";
  }

  if (
    /podj.{0,32}uchwa|uchwal(?:ił|ilo|iło|ono)|(?:^|\n)\s*uchwała\s+(?:(?:zwyczajnego|nadzwyczajnego)\s+)?walnego\s+zgromadzenia|uchwa.{0,40}(?:w\s+sprawie\s+)?(?:podzial|wypłat|wyplat)|zatwierdz|przeznacz.{0,48}dywidend|postanawia.{0,48}(?:wyplac|wypłac)|zgod[ae]\s+rady\s+nadzorczej.{0,80}wypłat.{0,40}zaliczk|decyzj[ae]\s+zarządu.{0,80}wypłat.{0,40}zaliczk/u.test(
      normalized
    )
  ) {
    return "CONFIRMED";
  }

  if (/propozyc|wniosek\s+zarz|rekomend/.test(normalized)) {
    return "PROPOSED";
  }

  return "UNKNOWN";
};

type ParsedDividendAmount = {
  amount: number;
  index: number;
  installment: boolean;
  currency: string;
};

const getDividendCurrency = (text: string, amountIndex: number) => {
  const context = text.slice(Math.max(0, amountIndex - 24), amountIndex + 80);
  const code = context.match(/\b(PLN|EUR|USD|GBP)\b/iu)?.[1]?.toUpperCase();
  if (code) return code;
  return /zł|zlot|złot|\bzl\b/iu.test(context) ? "PLN" : "PLN";
};

const getDividendAmounts = (text: string): ParsedDividendAmount[] => {
  const perSharePattern =
    /(?:^|[^\d])(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln|eur|usd|gbp)\s*(?:\([^)]{0,80}\)\s*)?(?:brutto\s*)?(?:na|\/)\s*(?:(?:jedn[aą]|1)\s*)?akcj/gi;
  const amountAfterPerSharePattern =
    /(?:na|dla)\s*(?:(?:jedn[aą]|1)\s*)?akcj[ęe]\s*(?:(?:przeznacza\s+się|przypada|wynosi|w\s+wysokości)\s*)?(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln|eur|usd|gbp)/gi;
  const unicodePerSharePattern =
    /(?:^|[^\d])(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:z\u0142(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln|eur|usd|gbp)\s*(?:\([^)]{0,80}\)\s*)?(?:brutto\s*)?(?:na|za|\/)\s*(?:(?:jedn(?:a|\u0105)|ka\u017cd(?:a|\u0105)|1)\s*)?akcj/giu;
  const unicodeAmountAfterPerSharePattern =
    /(?:na|dla)\s*(?:(?:jedn(?:a|\u0105)|1)\s*)?akcj(?:\u0119|e)\s*(?:(?:przeznacza\s+si\u0119|przypada|wynosi|w\s+wysoko\u015Bci)\s*)?(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:z\u0142(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln|eur|usd|gbp)/giu;
  const eachShareAmountPattern =
    /(?:na|dla)\s+ka\u017cd(?:a|\u0105)\s+akcj(?:\u0119|e)\s+(?:przypada|wynosi|wyp\u0142ac\w*)\s+(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:z\u0142|zl|pln|eur|usd|gbp)/giu;
  const labeledAmountAfterPerSharePattern =
    /(?:kwota|wysokość)\s+dywidendy(?:\s+brutto)?\s+(?:na|dla)\s*(?:(?:jedn(?:ą|a)|1)\s*)?akcj[ęe]\s*(?::|wynosi(?:\s+obecnie)?|w\s+wysokości)?\s*(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln|eur|usd|gbp)/giu;
  const descriptiveAmountAfterPerSharePattern =
    /(?:kwota|wysokość)\s+dywidendy[\s\S]{0,220}?(?:na|dla)\s*(?:(?:jedn(?:ą|a)|1)\s*)?akcj[ęe][\s\S]{0,220}?(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln|eur|usd|gbp)/giu;
  const amountWithWrittenWordsBeforePerSharePattern =
    /(?:^|[^\d])(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln|eur|usd|gbp)(?:\s*(?:_[^_]{0,160}_|\([^)]{0,160}\)))?\s*(?:brutto\s*)?(?:na|\/)\s*(?:(?:jedn(?:ą|a)|1)\s*)?akcj/giu;
  const naturalAmountAfterPerSharePattern =
    /(?:na|dla)\s*(?:(?:jedn(?:ą|a)|1)\s*)?akcj[ęe](?:\s+(?:sp[oó]łki|emitenta))?\s*(?:będzie\s+)?(?:przypadać|przypada|wynosi|w\s+wysokości)?\s*(?:kwota\s*)?(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln|eur|usd|gbp)/giu;
  const futureAmountAfterPerSharePattern =
    /na\s+(?:(?:jedn(?:ą|a)|1)\s*)?akcj[ęe](?:\s+(?:sp[oó]łki|emitenta))?\s+będzie\s+przypadać\s+kwota\s+(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln|eur|usd|gbp)/giu;
  const formalAmountAfterPerSharePattern =
    /(?:przypadaj[aą]c\w*\s+)?na\s+(?:jedn[aą]\s+|1\s*)?akcj[ęe](?:\s+sp[oó]łki)?[,;:]?\s*(?:będzie\s+)?(?:wynosić|wyniesie|wynosi|przypadać)?\s*:?[\s\n]*(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln|eur|usd|gbp)/giu;
  const amounts: ParsedDividendAmount[] = [];

  for (const pattern of [
    perSharePattern,
    amountAfterPerSharePattern,
    unicodePerSharePattern,
    unicodeAmountAfterPerSharePattern,
    eachShareAmountPattern,
    labeledAmountAfterPerSharePattern,
    descriptiveAmountAfterPerSharePattern,
    amountWithWrittenWordsBeforePerSharePattern,
    naturalAmountAfterPerSharePattern,
    futureAmountAfterPerSharePattern,
    formalAmountAfterPerSharePattern,
  ]) {
    for (const match of text.matchAll(pattern)) {
      const amountText = match[1] ?? "";
      const amount = toAmount(amountText);
      const relativeAmountIndex = match[0].lastIndexOf(amountText);
      const index = (match.index ?? 0) + Math.max(relativeAmountIndex, 0);
      if (!amount) continue;

      const nearby = text.slice(Math.max(0, index - 140), index + 140);
      amounts.push({
        amount,
        index,
        installment: /rat[ayęei]/i.test(nearby),
        currency: getDividendCurrency(text, index),
      });
    }
  }

  const uniqueAmounts = amounts.filter(
    (candidate, index) =>
      !amounts.slice(0, index).some(
        (other) => other.amount === candidate.amount && Math.abs(other.index - candidate.index) < 64
      )
  );

  const installmentsWithoutTotal = uniqueAmounts.filter((candidate) => {
    const otherTotal = uniqueAmounts
      .filter((other) => other !== candidate)
      .reduce((total, other) => total + other.amount, 0);
    return uniqueAmounts.length < 3 || Math.abs(candidate.amount - otherTotal) > 0.005;
  });

  // A multi-rate resolution normally repeats "na akcję" for every rate. If
  // it does, the total per-share amount is informational only and must not
  // become a third, invented future payment.
  const installments = installmentsWithoutTotal.filter((amount) => amount.installment);
  return installments.length > 0 ? installments : installmentsWithoutTotal;
};

const getAdvanceAdjustedDividend = (
  text: string,
  amounts: ParsedDividendAmount[]
): { amount: ParsedDividendAmount; total: number; advance: number } | null => {
  const normalized = text.toLocaleLowerCase("pl-PL");
  if (!/zaliczk/u.test(normalized) || !/(?:pomniejsz|wcześniej wypłac|uprzednio wypłac|wypłacon.{0,40}zaliczk)/u.test(normalized)) return null;

  const advanceAmounts = amounts.filter((entry) =>
    /zaliczk/u.test(normalized.slice(Math.max(0, entry.index - 140), entry.index + 180))
  );
  const totalAmounts = amounts.filter((entry) => !advanceAmounts.includes(entry));
  if (!advanceAmounts.length || !totalAmounts.length) return null;

  const total = Math.max(...totalAmounts.map((entry) => entry.amount));
  const advance = advanceAmounts.reduce((sum, entry) => sum + entry.amount, 0);
  const remaining = Math.round((total - advance) * 10_000) / 10_000;
  if (!(remaining > 0)) return null;
  const sourceAmount = totalAmounts.find((entry) => entry.amount === total) ?? totalAmounts[0]!;
  return { amount: { ...sourceAmount, amount: remaining, installment: false }, total, advance };
};

const getDividendRecordDate = (text: string) => {
  // In resolutions the date often precedes its label. Looking only after
  // "dzień dywidendy" can incorrectly borrow the later payment date.
  for (const match of text.matchAll(UNICODE_DATE_PATTERN)) {
    const date = getIsoDateFromMatch(match);
    if (!date) continue;
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 120), index);
    const after = text.slice(index + match[0].length, index + match[0].length + 110);
    if (/\b(?:na|jako|ustalaj[aą]c|wyznaczaj[aą]c)\s+dzie[nń]\s*$/iu.test(before) &&
      /^\s*(?:r\.?\s*)?(?:[_,;–-]\s*)?(?:jako\s+)?dzie[nń]\s+(?:nabycia\s+praw|ustalenia\s+praw|dywidendy)/iu.test(after)) return date;
  }
  // Some issuers put the concrete date before the semantic label, for example
  // "rekomenduje dzień 21 października ... jako dzień ... uprawnionych".
  for (const match of text.matchAll(UNICODE_DATE_PATTERN)) {
    const date = getIsoDateFromMatch(match);
    if (!date) continue;
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 90), index);
    const after = text.slice(index + match[0].length, index + match[0].length + 260);
    if (
      /(?:rekomenduje|ustala|wyznacza|określa)(?:\s+na)?\s+dzie[ńn]\s*$/iu.test(before) &&
      /jako\s+dzie[ńn][\s\S]{0,180}?(?:uprawnionych|praw\w*\s+do\s+(?:dywidendy|zaliczki))/iu.test(after)
    ) return date;
  }

  const directLabelDate =
    getDateAfterKeyword(
      text,
      /dzie(?:ń|n)\s+nabycia\s+prawa\s+do\s+(?:dywidendy|zaliczki)\s*:?/iu,
      80,
      "first",
      true
    ) ??
    getDateAfterKeyword(
      text,
      /dniem\s+nabycia\s+prawa\s+do\s+(?:dywidendy|zaliczki)\s+(?:jest|będzie)\s+dzie[ńn]/iu,
      100,
      "first",
      true
    ) ??
    getDateAfterKeyword(
      text,
      /dzie[ńn]\s+ustalenia\s+(?:akcjonariuszy\s+)?uprawnionych(?:\s+do\s+(?:dywidendy|zaliczki))?/iu,
      220,
      "first",
      true
    ) ??
    getDateAfterKeyword(
      text,
      /dzie[ńn]\s+(?:ustalenia\s+praw(?:a)?\s+do\s+)?(?:dywidendy|zaliczki)|record\s*date/iu,
      220,
      "first",
      true
    ) ??
    getDateAfterKeyword(
      text,
      /dzie[ńn][\s\S]{0,280}?ustala\s+się\s+listę\s+akcjonariuszy\s+uprawnionych[\s\S]{0,240}?(?:został\s+ustalony|ustalono)\s+na/iu,
      80,
      "first",
      true
    );
  if (directLabelDate) return directLabelDate;

  const labelPatterns = [
    /dzie[ńn](?:,)?\s+(?:ustalenia|nabycia)\s+(?:prawa|praw|uprawnionych)[\s\S]{0,180}?(?:do\s+)?(?:dywidendy|zaliczki)?[\s\S]{0,100}?(?:ustalono|ustalony|wyznaczono|wyznaczony|przypada|będzie|jest|na)/iu,
    /dniem\s+(?:ustalenia|nabycia)\s+(?:prawa|praw|uprawnionych)[\s\S]{0,220}?(?:do\s+(?:otrzymania\s+)?)?(?:dywidendy|zaliczki)?[\s\S]{0,100}?(?:będzie|jest|ustalono|wyznaczono)/iu,
    /dniem\s+ustalenia\s+uprawnionych[\s\S]{0,220}?(?:dywidendy|zaliczki)[\s\S]{0,80}?(?:będzie|jest)/iu,
    /(?:dzie[ńn]|dniem)(?:,)?\s+według[\s\S]{0,220}?(?:uprawnionych|prawa\s+do)[\s\S]{0,120}?(?:wyznaczono|ustalono|określono|będzie(?:\s+dzie[ńn])?|na)/iu,
    /dzie[ńn]\s+(?:prawa\s+do|ustalenia\s+praw\s+do)\s+(?:dywidendy|zaliczki)/iu,
    /record\s*date/iu,
  ];
  for (const pattern of labelPatterns) {
    const date = getDateAfterKeyword(text, pattern, 360, "first", true);
    if (date) return date;
  }

  return undefined;
};

const getPaymentDateBeforeAmount = (text: string, amountIndex: number) => {
  const contextStart = Math.max(0, amountIndex - 280);
  const context = text.slice(contextStart, amountIndex);
  const dates = Array.from(context.matchAll(UNICODE_DATE_PATTERN)).flatMap((match) => {
    const date = getIsoDateFromMatch(match);
    if (!date) return [];
    const afterDate = context.slice((match.index ?? 0) + match[0].length);
    if (!/^\s*(?:r\.?\s*)?[-–—:;,]?\s*(?:wypłat|rat|transz)/iu.test(afterDate)) return [];
    return [{ date, index: match.index ?? 0 }];
  });
  return dates.at(-1)?.date;
};

const DIVIDEND_CANCELLATION_NOTICE =
  /(?:odwoł|anul|rezygnac)[\s\S]{0,140}?(?:wypłat[ayęy]|dywidend|zaliczk)|(?:dywidend|zaliczk)[\s\S]{0,140}?(?:nie\s+zostanie\s+wypłacon|odwoł|anul)/iu;

const DIVIDEND_SCHEDULE_CHANGE =
  /(?:zmian|nowy)[\s\S]{0,100}?(?:termin|dzie[ńn])[\s\S]{0,120}?(?:wypłat|dywidend|zaliczk)|(?:termin|dzie[ńn])[\s\S]{0,80}?(?:wypłat|dywidend|zaliczk)[\s\S]{0,100}?(?:uleg[łła]|zmien)/iu;

const getDividendPaymentDateBeforeLabel = (text: string) => {
  for (const match of text.matchAll(UNICODE_DATE_PATTERN)) {
    const date = getIsoDateFromMatch(match);
    if (!date) continue;
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 90), index);
    const after = text.slice(index + match[0].length, index + match[0].length + 100);
    if (/\bdzie[nń]\s*$/iu.test(before) &&
      /^\s*(?:r\.?\s*)?(?:[_,;–-]\s*)?jako\s+termin\s+wyp[łl]at/iu.test(after)) return date;
  }
  return undefined;
};

const removeUnvotedDividendDraft = (text: string) => {
  const start = text.search(/nie\s+poddano\s+pod\s+g[łl]osowanie[\s\S]{0,200}?projektu\s+uchwa[łl]y/iu);
  if (start < 0) return text;
  const followingResolution = text.slice(start).search(/\n\s*[IVXLCDM]+\.\s*\n\s*Uchwa[łl]a\s+nr/iu);
  return followingResolution < 0
    ? text.slice(0, start)
    : text.slice(0, start) + text.slice(start + followingResolution);
};

export const isNonBindingDividendDraftNotice = (text: string) => {
  const folded = text.toLocaleLowerCase("pl-PL").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/ł/g, "l");
  return /zglos\w*[\s\S]{0,120}?(?:propozycj\w*\s+)?zmian\w*\s+do\s+uchwaly/u.test(folded) &&
    !/walne\s+zgromadzenie[\s\S]{0,180}?podjelo[\s\S]{0,180}?uchwale[\s\S]{0,120}?(?:podzialu\s+zysku|wyplacie\s+dywidendy|wyplaty\s+dywidendy)/u.test(folded) &&
    !/uchwala\s+nr\s*\d+[\s\S]{0,120}?(?:podzialu\s+zysku|wyplacie\s+dywidendy|wyplaty\s+dywidendy)/u.test(folded);
};

export const getDividendAmendmentEvidence = (text: string) => {
  const paymentClause = text.match(/termin\s+wyp[łl]aty\s+dywidendy\s+z\s+dnia\s+[^\n]{0,110}/iu)?.[0] ?? "";
  const [previousPaymentDate, proposedPaymentDate] = extractPolishDates(paymentClause);
  const amountClause = text.match(/(?:podwyższeni\w*|zmian\w*)\s+dywidendy\s+z\s+[\d,.]+\s*(?:zł|PLN)[\s\S]{0,80}?do\s+([\d,.]+)\s*(?:zł|PLN)/iu);
  const proposedAmount = amountClause ? Number(amountClause[1].replace(",", ".")) : NaN;
  return { previousPaymentDate, proposedPaymentDate,
    proposedAmount: Number.isFinite(proposedAmount) ? proposedAmount : undefined };
};

const getUpcomingDividendEvents = (text: string): ParsedCorporateEvent[] => {
  if (!/dywidend|zaliczk/i.test(text)) return [];
  // A meeting summary can quote a shareholder's proposed amendment without
  // confirming it. The adopted resolution may arrive as a separate report or PDF.
  if (isNonBindingDividendDraftNotice(text)) return [];
  text = removeUnvotedDividendDraft(text);
  const documentStatus = getDividendStatus(text);
  const cancellation = DIVIDEND_CANCELLATION_NOTICE.test(text);

  const sectionMatches = Array.from(
    text.matchAll(
      /dywidenda\s+(?:za\s+)?(?:rok(?:\s+obrotowy)?\s+)?20\d{2}(?:\s*\/\s*20\d{2})?[^\n:]{0,64}(?::|\n|\()/giu
    )
  );
  const sections =
    sectionMatches.length > 0
      ? sectionMatches.map((match, index) => ({
          section: text.slice(match.index, sectionMatches[index + 1]?.index),
          statusContext: text.slice(Math.max(0, (match.index ?? 0) - 220), match.index),
        }))
      : [{ section: text, statusContext: "" }];

  const candidates = sections.flatMap<ParsedCorporateEvent>(({ section, statusContext }) => {
    const parsedAmounts = getDividendAmounts(section);
    if (parsedAmounts.length === 0 && !cancellation) return [];
    const advanceAdjustment = getAdvanceAdjustedDividend(section, parsedAmounts);
    const amounts = advanceAdjustment ? [advanceAdjustment.amount] : parsedAmounts;
    const fiscalYear = getDividendFiscalYear(section);

    const recordDate = getDividendRecordDate(section);
    const exDividendDate = getDateAfterKeyword(
      section,
      /ex(?:-|\s)?dividend(?:\s+date)?|ex-date/i
    );
    const paymentDate = getDividendPaymentDateBeforeLabel(section) ?? getDateAfterKeyword(
      section,
      /(?:termin|dzie[ńn]|dniem)\s+wyp.{0,3}at(?:y|a)|wyp.{0,3}at(?:a|y)\s+(?:(?:dywidendy|środków)\s+)?(?:nastąpi|zostanie|ustalon|w\s+terminie)|payment\s*date/iu,
      300
    );
    const sectionStatus = getDividendStatus(section);
    const contextStatus = sectionStatus === "UNKNOWN" ? getDividendStatus(statusContext) : sectionStatus;
    const dividendStatus = contextStatus === "UNKNOWN" ? documentStatus : contextStatus;

    // Some resolutions state the total per share once, then list payment
    // tranches as "date (amount)". Only split when at least two dated amounts
    // sum to the announced total; otherwise retain the regular parser path.
    const paymentLabelIndex = section.search(/(?:termin|dzień)\s+wypłaty\s+dywidendy\s*:/iu);
    const datedInstallments = paymentLabelIndex < 0 ? [] : Array.from(section.slice(paymentLabelIndex).matchAll(UNICODE_DATE_PATTERN))
      .flatMap((match) => {
        const date = getIsoDateFromMatch(match);
        const after = section.slice(paymentLabelIndex + (match.index ?? 0) + match[0].length,
          paymentLabelIndex + (match.index ?? 0) + match[0].length + 44);
        const amountMatch = after.match(/^\s*(?:r\.?\s*)?\(\s*(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł|zl|PLN)\s*\)/iu);
        const amount = amountMatch ? toAmount(amountMatch[1]) : undefined;
        return date && amount ? [{ date, amount }] : [];
      });
    const declaredTotal = parsedAmounts.length === 1 ? parsedAmounts[0]!.amount : undefined;
    if (recordDate && declaredTotal && datedInstallments.length >= 2 &&
      Math.abs(datedInstallments.reduce((sum, item) => sum + item.amount, 0) - declaredTotal) < 0.005) {
      return datedInstallments.map((item, index) => ({
        eventType: "UPCOMING_DIVIDEND" as const,
        eventDate: recordDate,
        fiscalYear,
        isScheduleChange: DIVIDEND_SCHEDULE_CHANGE.test(section),
        eventIdentity: ["dividend", fiscalYear ?? recordDate.slice(0, 4), index + 1].join(":"),
        dividendPerShare: item.amount,
        dividendTotalPerShare: declaredTotal,
        dividendCurrency: parsedAmounts[0]!.currency,
        recordDate,
        paymentDate: item.date,
        dividendInstallment: index + 1,
        dividendStatus,
      }));
    }

    const eventAmounts = amounts.length > 0
      ? amounts
      : [{ amount: undefined, index: 0, installment: false, currency: "PLN" }];
    return eventAmounts.flatMap((entry, index) => {
      const localContextAfter = section.slice(entry.index, entry.index + 260);
      const localContextBefore = section.slice(Math.max(0, entry.index - 240), entry.index);
      const localPaymentDateAfter = getDateAfterKeyword(
        localContextAfter,
        /(?:termin|dzie[ńn]|dniem)\s+wyp.{0,3}at(?:y|a)|zostanie\s+wyp.{0,3}acon\w*|payment\s*date/iu,
        250,
        "first"
      );
      const localInstallmentDateAfter = getDateAfterKeyword(
        localContextAfter,
        /transz(?:a|y|ę|ie)[\s\S]{0,140}?(?:ustalon\w*\s+na\s+dzień|w\s+terminie)/iu,
        100,
        "first",
        true
      );
      const localPaymentDateBefore = getDateAfterKeyword(
        localContextBefore,
        /w\s+terminie|(?:termin|dzie.)\s+wyp.{0,3}at(?:y|a)/iu,
        240,
        "last"
      );
      const localInstallmentDateBefore = getDateAfterKeyword(
        localContextBefore,
        /transz(?:a|y|ę|ie)[\s\S]{0,140}?(?:ustalon\w*\s+na\s+dzień|w\s+terminie)/iu,
        100,
        "last",
        true
      );
      const resolvedPaymentDate =
        getPaymentDateBeforeAmount(section, entry.index) ??
        getDateAfterKeyword(
          localContextAfter,
          /(?:termin|dzie[ńn]|dniem)\s+wyp.{0,3}at(?:y|a)|payment\s*date/iu,
          250,
          "first"
        ) ??
        localInstallmentDateBefore ??
        localPaymentDateBefore ??
        localInstallmentDateAfter ??
        localPaymentDateAfter ??
        paymentDate;
      const cancellationDate = cancellation ? extractPolishDates(section).at(-1) : undefined;
      const eventDate = recordDate ?? exDividendDate ?? resolvedPaymentDate ?? cancellationDate;

      // A source that does not publish any date is useful context for a human,
      // but it is not an upcoming calendar event. Do not invent a technical
      // date merely to force it into storage or the UI.
      if (!eventDate) return [];

      const installment = amounts.length > 1 ? index + 1 : undefined;
      return [{
        eventType: "UPCOMING_DIVIDEND" as const,
        eventDate,
        fiscalYear,
        isScheduleChange: DIVIDEND_SCHEDULE_CHANGE.test(section),
        // Amounts and dates can change between a proposal and the final
        // resolution. The annual distribution + installment is the durable
        // identity, so a correction updates one pending event instead of
        // creating another calendar item.
        eventIdentity: [
          "dividend",
          fiscalYear ?? (recordDate ?? exDividendDate ?? resolvedPaymentDate)?.slice(0, 4) ?? "unknown",
          installment ?? "single",
        ].join(":"),
        dividendPerShare: entry.amount,
        dividendTotalPerShare: advanceAdjustment?.total,
        dividendAdvancePerShare: advanceAdjustment?.advance,
        dividendCurrency: entry.currency,
        exDividendDate,
        recordDate,
        paymentDate: resolvedPaymentDate,
        dividendInstallment: installment,
        dividendStatus,
        isCancellation: cancellation,
      }];
    });
  });

  const uniqueCandidates = Array.from(new Map(candidates.map((event) => [
    [
      event.fiscalYear ?? "unknown",
      event.recordDate ?? event.exDividendDate ?? "no-record-date",
      event.paymentDate ?? event.eventDate,
      event.dividendPerShare ?? "no-amount",
    ].join(":"),
    event,
  ])).values());
  const distributions = new Map<string, ParsedCorporateEvent[]>();
  for (const event of uniqueCandidates) {
    const distributionKey = [
      event.fiscalYear ?? "unknown",
      event.recordDate ?? event.exDividendDate ?? "no-record-date",
    ].join(":");
    distributions.set(distributionKey, [...(distributions.get(distributionKey) ?? []), event]);
  }

  return Array.from(distributions.values()).flatMap((distribution) => {
    const distinctAmounts = Array.from(new Set(
      distribution
        .map((event) => event.dividendPerShare)
        .filter((amount): amount is number => typeof amount === "number")
    ));
    const withoutInformationalTotal = distribution.filter((event) => {
      if (distinctAmounts.length < 3 || typeof event.dividendPerShare !== "number") return true;
      const otherTotal = distinctAmounts
        .filter((amount) => amount !== event.dividendPerShare)
        .reduce((sum, amount) => sum + amount, 0);
      return Math.abs(event.dividendPerShare - otherTotal) > 0.005;
    });
    const sorted = [...withoutInformationalTotal].sort((left, right) =>
      (left.paymentDate ?? left.eventDate).localeCompare(right.paymentDate ?? right.eventDate)
    );
    return sorted.map((event, index) => {
      const installment = sorted.length > 1 ? index + 1 : undefined;
      return {
        ...event,
        dividendInstallment: installment,
        eventIdentity: [
          "dividend",
          event.fiscalYear ?? (event.recordDate ?? event.exDividendDate ?? event.paymentDate ?? event.eventDate).slice(0, 4),
          installment ?? "single",
        ].join(":"),
      };
    });
  });
};

const parseReportScheduleCorrectionEvents = (text: string): ParsedCorporateEvent[] => {
  const datePattern = new RegExp(UNICODE_DATE_PATTERN.source, UNICODE_DATE_PATTERN.flags);
  const events = new Map<string, ParsedCorporateEvent>();

  // Some issuer notices are tables converted into several wrapped physical
  // lines. “Publikacja …” starts one logical row; keep its wrapped date/year
  // together and cut before the next row so its period cannot leak in.
  const publicationStarts = Array.from(text.matchAll(/(?:^|\n)\s*publikacja\s+/giu))
    .map((match) => match.index! + match[0].toLocaleLowerCase("pl-PL").lastIndexOf("publikacja"));
  const chunks = publicationStarts.length > 1
    ? publicationStarts.map((start, index) => text.slice(start, publicationStarts[index + 1] ?? text.length))
    : [text];
  const clauses = chunks.flatMap((chunk) =>
    chunk.split(/;\s*|,\s*(?=(?:zaś|natomiast|jednocześnie)(?:\s|$))/iu).map((clause) => clause.trim())
  );
  for (const context of clauses) {
    const dateTokens = Array.from(context.matchAll(datePattern)).flatMap((match) => {
      const date = getIsoDateFromMatch(match);
      return date && match.index !== undefined
        ? [{ date, start: match.index, end: match.index + match[0].length }]
        : [];
    });

    for (let index = 0; index < dateTokens.length - 1; index += 1) {
      const firstDate = dateTokens[index]!;
      const secondDate = dateTokens[index + 1]!;
      if (firstDate.date === secondDate.date) continue;

      const between = context.slice(firstDate.end, secondDate.start);
      const beforeFirst = context.slice(Math.max(0, firstDate.start - 40), firstDate.start);
      const isOldToNew = (/\bna\s*$/iu.test(between) && /\bz\s+(?:dnia\s*)?$/iu.test(beforeFirst)) ||
        /\b(?:now\p{L}*\s+termin\p{L}*|zmienion\p{L}*\s+termin\p{L}*|przesuni\p{L}*\s+na|zostaj\p{L}*[\s\S]{0,70}\bprzesuni\p{L}*|zostal\p{L}*[\s\S]{0,70}\bprzesuni\p{L}*|ulega\p{L}*[\s\S]{0,70}\bprzesuni\p{L}*)\b/iu.test(between);
      const isNewInsteadOfOld = /\bzamiast\b/iu.test(between);
      if (!isOldToNew && !isNewInsteadOfOld) continue;

      // A date before “zamiast” is the announced date; the date after it is
      // the superseded date. For “z X na Y” and “X przesunięto na Y” the
      // order is the opposite.
      const eventDate = isNewInsteadOfOld ? firstDate.date : secondDate.date;
      const previousEventDate = isNewInsteadOfOld ? secondDate.date : firstDate.date;
      const isSelectedFinancialData = /\b(?:wybran\p{L}*\s+)?niezaudytowan\p{L}*\s+(?:dane|danych)\s+finansow\p{L}*|\bselected\s+unaudited\s+data\b/iu.test(context);
      const hasReportWording = /\b(?:raport\p{L}*|sprawozdani\p{L}*|publikacj\p{L}*)\b/iu.test(context);
      if (isSelectedFinancialData || !hasReportWording) continue;

      const eventType = getEventType(context);
      if (!isReportType(eventType)) continue;

      const fiscalYearLabel = getFiscalYearLabel(context);
      const fiscalYear = fiscalYearLabel ? Number(fiscalYearLabel.slice(-4)) : undefined;
      const scope: ParsedCorporateEvent["reportScope"] =
        /jednostkow\p{L}*[\s\S]{0,100}skonsolidowan\p{L}*|skonsolidowan\p{L}*[\s\S]{0,100}jednostkow\p{L}*/iu.test(context)
          ? "COMBINED"
          : /jednostkow\p{L}*/iu.test(context)
            ? "UNIT"
            : /skonsolidowan\p{L}*/iu.test(context) ? "CONSOLIDATED" : undefined;
      const event: ParsedCorporateEvent = {
        eventType,
        eventDate,
        previousEventDate,
        fiscalPeriod: getFiscalPeriod(context, eventType),
        fiscalYear,
        ...(fiscalYearLabel ? { fiscalYearLabel } : {}),
        ...getExplicitReportPeriod(context),
        ...(scope ? { reportScope: scope } : {}),
        isScheduleChange: true,
      };
      const identity = getCorporateEventIdentityKey(event);
      const key = `${identity}:${event.eventDate}`;
      const previous = events.get(key);
      events.set(key, previous && previous.reportScope && event.reportScope && previous.reportScope !== event.reportScope
        ? { ...event, reportScope: "COMBINED" }
        : event);
    }
  }

  const result = [...events.values()];
  const datesByIdentity = new Map<string, Set<string>>();
  for (const event of result) {
    const identity = getCorporateEventIdentityKey(event);
    datesByIdentity.set(identity, new Set([...(datesByIdentity.get(identity) ?? []), event.eventDate]));
  }
  for (const event of result) {
    const identity = getCorporateEventIdentityKey(event);
    if ((datesByIdentity.get(identity)?.size ?? 0) > 1 && event.reportScope && event.reportScope !== "COMBINED") {
      event.eventIdentity = `${identity}:${event.reportScope}`;
    }
  }
  return result;
};

export const parseCorporateEventDocument = (document: string): ParsedCorporateEvent[] => {
  const text = normalizeDocumentText(document);
  if (!text) return [];
  const events = new Map<string, ParsedCorporateEvent>();
  const changeNotice = /\bzmian(?:a|y|ie|ę)\s+(?:harmonogramu\s+)?terminu\b|\bnowy termin(?: publikacji)?\b/iu.test(text);
  if (changeNotice) {
    for (const event of parseReportScheduleCorrectionEvents(text)) {
      events.set(getCorporateEventIdentityKey(event), event);
    }
    const reportClause = getCandidateSegments(text).find((segment) =>
      isReportType(getEventType(segment.text)) && /\bzamiast\b/iu.test(segment.text)
    );
    if (events.size === 0 && reportClause) {
      const [newPart, oldPart] = reportClause.text.split(/\bzamiast\b/iu);
      const type = getEventType(newPart);
      const eventDate = extractPolishDates(newPart).at(-1);
      const previousEventDate = extractPolishDates(oldPart ?? "")[0];
      if (isReportType(type) && eventDate && previousEventDate && eventDate !== previousEventDate) {
        const fiscalYearLabel = getFiscalYearLabel(newPart) ?? getFiscalYearLabel(text.split("\n")[0] ?? "");
        const event: ParsedCorporateEvent = {
          eventType: type, eventDate, previousEventDate,
          fiscalPeriod: getFiscalPeriod(newPart, type),
          fiscalYear: fiscalYearLabel ? Number(fiscalYearLabel.slice(-4)) : undefined,
          ...(fiscalYearLabel?.includes("/") ? { fiscalYearLabel } : {}),
          isScheduleChange: true,
        };
        events.set(getCorporateEventIdentityKey(event), event);
      }
    }
    if (events.size === 0) {
      const newIndex = text.search(/\bnowy termin(?: publikacji)?\b/iu);
      const oldDate = newIndex >= 0 ? extractPolishDates(text.slice(0, newIndex)).at(-1) : undefined;
      const newContext = newIndex >= 0 ? text.slice(newIndex, newIndex + 420) : "";
      const newDate = extractPolishDates(newContext)[0];
      const type = getEventType(newContext);
      if (oldDate && newDate && oldDate !== newDate && isReportType(type)) {
        const fiscalYearLabel = getFiscalYearLabel(newContext) ?? getFiscalYearLabel(text.slice(0, newIndex));
        const event: ParsedCorporateEvent = {
          eventType: type, eventDate: newDate, previousEventDate: oldDate,
          fiscalPeriod: getFiscalPeriod(newContext, type),
          fiscalYear: fiscalYearLabel ? Number(fiscalYearLabel.slice(-4)) : undefined,
          ...(fiscalYearLabel?.includes("/") ? { fiscalYearLabel } : {}),
          isScheduleChange: true,
        };
        events.set(getCorporateEventIdentityKey(event), event);
      }
    }
  } else {
    for (const event of parseReportScheduleEvents(text)) {
      events.set(`${getCorporateEventIdentityKey(event)}:${event.eventDate}`, event);
    }
  }

  for (const generalMeeting of getGeneralMeetingEvents(text)) {
    events.set(getCorporateEventIdentityKey(generalMeeting), generalMeeting);
  }

  for (const dividend of getUpcomingDividendEvents(text)) {
    events.set(getCorporateEventIdentityKey(dividend), dividend);
  }

  const nonCalendarFiscalYears = getExplicitNonCalendarFiscalYears(text);
  return Array.from(events.values())
    .map((event) => isReportType(event.eventType)
      ? assessReportScheduleEvent(
        { ...event, sourceEvidence: event.sourceEvidence ?? text.slice(0, 500) },
        nonCalendarFiscalYears
      )
      : event)
    .sort((left, right) =>
    left.eventDate.localeCompare(right.eventDate)
    );
};

export const getCorporateEventLabel = (event: Pick<
  CorporateEvent,
  "eventType" | "fiscalPeriod" | "fiscalYear" | "fiscalYearLabel" | "generalMeetingType"
>) => {
  const period = [event.fiscalPeriod, event.fiscalYearLabel ?? event.fiscalYear].filter(Boolean).join(" ");

  if (event.eventType === "UPCOMING_DIVIDEND") {
    return "Nadchodząca dywidenda";
  }

  if (event.eventType === "GENERAL_MEETING") {
    if (event.generalMeetingType === "ZWZ") return "Zwyczajne Walne Zgromadzenie";
    if (event.generalMeetingType === "NWZ") return "Nadzwyczajne Walne Zgromadzenie";
    return "Walne Zgromadzenie";
  }

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

export const getWarsawDate = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

export const addCalendarDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/** Calendar-day difference in Warsaw; independent from browser/server timezone. */
export const getDaysUntilWarsawDate = (date: string, now = new Date()) => {
  const today = getWarsawDate(now);
  const start = new Date(`${today}T12:00:00.000Z`).getTime();
  const target = new Date(`${date}T12:00:00.000Z`).getTime();
  return Math.round((target - start) / 86_400_000);
};

/**
 * An installment remains upcoming as long as it has a non-past relevant
 * milestone. Once record/ex has passed, a still-future payment becomes its
 * only upcoming date. This keeps multi-rate distributions honest after the
 * entitlement date without discarding a payment that has not happened yet.
 */
export const getUpcomingDividendRelevantDate = (
  event: Pick<CorporateEvent, "eventDate" | "recordDate" | "exDividendDate" | "paymentDate">,
  now = new Date()
) => {
  const today = getWarsawDate(now);
  return [event.recordDate, event.exDividendDate, event.paymentDate, event.eventDate]
    .filter((date): date is string => typeof date === "string" && date >= today)
    .sort((left, right) => left.localeCompare(right))[0];
};

export const getUpcomingDividendDatesForDisplay = (
  event: Pick<CorporateEvent, "recordDate" | "exDividendDate" | "paymentDate">,
  now = new Date()
) => {
  const today = getWarsawDate(now);
  return {
    exDividendDate: event.exDividendDate && event.exDividendDate >= today ? event.exDividendDate : undefined,
    recordDate: event.recordDate && event.recordDate >= today ? event.recordDate : undefined,
    paymentDate: event.paymentDate && event.paymentDate >= today ? event.paymentDate : undefined,
  };
};

export const isCorporateEventSourceUnavailable = (status: CorporateEventSourceStatus) =>
  status === "ACCESS_DENIED" || status === "TEMPORARILY_UNAVAILABLE" || status === "PARSE_ERROR";

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
  generalMeetingType?: GeneralMeetingType;
  registrationDate?: string;
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

export const getCorporateEventIdentityKey = (event: Pick<
  ParsedCorporateEvent,
  "eventType" | "fiscalPeriod" | "fiscalYear" | "eventIdentity"
>) => event.eventIdentity ?? [event.eventType, event.fiscalPeriod ?? "", event.fiscalYear ?? ""].join(":");

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

const UNICODE_DATE_PATTERN =
  /\b(\d{1,2})\s*(?:[.\-/]\s*)?([\p{L}]+)\s+(20\d{2})\b|\b(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})\b/gu;

const normalizeDocumentText = (value: string) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
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

const subtractCalendarDays = (isoDate: string, days: number) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (![year, month, day].every(Number.isInteger)) return undefined;

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

export const getGeneralMeetingRegistrationDate = (meetingDate: string) =>
  subtractCalendarDays(meetingDate, 16);

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

const getDividendFiscalYear = (value: string) => {
  const heading = value.match(
    /dywidenda\s+(?:za\s+)?(?:rok(?:\s+obrotowy)?\s+)?(20\d{2})(?:\s*\/\s*(20\d{2}))?/iu
  );
  if (heading?.[2]) return Number(heading[2]);
  if (heading?.[1]) return Number(heading[1]);

  const completedYear = value.match(
    /za\s+rok[^.]{0,120}zakończon[^.]{0,80}\b(20\d{2})\b/iu
  )?.[1];
  return completedYear ? Number(completedYear) : getFiscalYear(value);
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
  /waln(?:e|ego|emu|ym|ych)?\s+zgromadzeni(?:e|a|u|em)?(?:\s+akcjonariuszy)?|\b(?:wza|zwz|nwz)\b/iu;

const GENERAL_MEETING_FALSE_NOTICE =
  /projekt(?:y|u|em)?\s+uchwa|zgłoszeni(?:e|a)\s+projektu\s+uchwa|(?:uzupełnieni|zmian)[eaęy]?\s+porządku\s+obrad|żądani(?:e|a)\s+akcjonariusz|zgłoszeni(?:e|a)\s+kandydat|wykaz\s+akcjonariusz|lista\s+akcjonariusz[^\n.]{0,100}(?:głos|procent|%)|treść\s+uchwał\s+podjętych|uchwał(?:y|a)\s+podjęt|wynik(?:i|ów)?\s+głosowa|po\s+(?:odbyciu|zakończeniu)\s+(?:walnego|wza|zwz|nwz)|informacj[ae]\s+po\s+(?:walnym|wza|zwz|nwz)/iu;

const GENERAL_MEETING_FORMAL_NOTICE =
  /(?:ogłoszeni[ea]\s+o\s+)?zwołani[eu]\s+(?:(?:zwyczajnego|nadzwyczajnego)\s+)?walnego\s+zgromadzenia|\bzwoł(?:uje|ał|ano)(?![\p{L}\p{N}_])[\s\S]{0,260}?(?:waln\w*\s+zgromadzeni\w*|\b(?:zwz|nwz|wza)\b)|(?:waln\w*\s+zgromadzeni\w*|\b(?:zwz|nwz)\b)[\s\S]{0,180}?(?:zostanie\s+zwołan\w*|zwołan\w*\s+na)|(?:zarząd|spółka|emitent)[\s\S]{0,160}?informuje[\s\S]{0,220}?(?:waln\w*\s+zgromadzeni\w*|\b(?:zwz|nwz)\b)[\s\S]{0,100}?odbędzie\s+się/iu;

const GENERAL_MEETING_RESCHEDULE_NOTICE =
  /zmian(?:a|y|ie|ę)\s+terminu[\s\S]{0,180}?(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)|(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)[\s\S]{0,180}?zmian(?:a|y|ie|ę)\s+terminu|(?:przełoż|przenies|zmienia\s+termin)[\s\S]{0,180}?(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)|(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)[\s\S]{0,180}?(?:przełoż|przenies|zmienia\s+termin)/iu;

const GENERAL_MEETING_CANCELLATION_NOTICE =
  /odwołani[ea]\s+(?:(?:zwyczajnego|nadzwyczajnego)\s+)?walnego\s+zgromadzenia|odwołuj\w*[\s\S]{0,180}?(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)|(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)[\s\S]{0,260}?(?:zostało\s+odwołan\w*|nie\s+odbędzie\s+się|informuje\s+o\s+odwołaniu\s+(?:tego\s+)?zgromadzenia)/iu;

const getGeneralMeetingType = (text: string): GeneralMeetingType | undefined => {
  if (/\bnwz\b|nadzwyczajn\w*\s+waln\w*\s+zgromadzeni\w*/iu.test(text)) return "NWZ";
  if (/\bzwz\b|(?<!nadzwy)zwyczajn\w*\s+waln\w*\s+zgromadzeni\w*/iu.test(text)) return "ZWZ";
  return undefined;
};

const getGeneralMeetingIdentity = (
  meetingType: GeneralMeetingType | undefined,
  meetingDate: string
) => ["general-meeting", meetingType ?? "WZA", meetingDate].join(":");

const getSemanticMeetingDate = (text: string) => {
  const keywordPatterns = [
    /\bzwoł(?:uje|ał|ano|ane|anego|anym)(?![\p{L}\p{N}_])[\s\S]{0,180}?\b(?:na\s+dzień|w\s+dniu|dnia)(?![\p{L}\p{N}_])/iu,
    /(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)[\s\S]{0,160}?\b(?:odbędzie\s+się|zwołan\w*)\b[\s\S]{0,80}?\b(?:w\s+dniu|dnia|na\s+dzień)(?![\p{L}\p{N}_])/iu,
    /(?:waln\w*\s+zgromadzeni\w*|\b(?:wza|zwz|nwz)\b)[\s\S]{0,100}?\bw\s+dniu\b/iu,
  ];

  for (const keyword of keywordPatterns) {
    const date = getDateAfterKeyword(text, keyword, 100, "first", true);
    if (date) return date;
  }

  return undefined;
};

const getOfficialGeneralMeetingRegistrationDate = (text: string) => {
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
    if (/^[\s,;:()\w.]{0,60}?jest\s+dniem\s+rejestracji(?:\s+uczestnictwa)?\b/iu.test(afterDate)) {
      return date;
    }
  }

  const references = Array.from(
    text.matchAll(/(?:dzień|dniem)\s+rejestracji(?:\s+uczestnictwa)?(?:\s+w\s+(?:walnym\s+zgromadzeniu|wza|zwz|nwz))?/giu)
  );

  for (const reference of references) {
    const context = text.slice(reference.index ?? 0, (reference.index ?? 0) + 280);
    const linkingText = context.slice(reference[0].length);
    const date = extractPolishDates(linkingText)[0];
    if (!date) continue;

    const dateIndex = linkingText.search(/\b\d{1,2}\s*(?:[.\-/]\s*)?(?:[\p{L}]+\s+)?20\d{2}\b|\b\d{1,2}[.\-/]\d{1,2}[.\-/]20\d{2}\b/u);
    const beforeDate = dateIndex >= 0 ? linkingText.slice(0, dateIndex) : linkingText;
    if (/(?:jest|przypada|ustal\w*|wyznacz\w*|na\s+dzień|:|–|—|-)/iu.test(beforeDate)) {
      return date;
    }
  }

  return undefined;
};

const getGeneralMeetingTime = (text: string, meetingDate: string) => {
  const dateOccurrences = Array.from(text.matchAll(UNICODE_DATE_PATTERN))
    .map((match) => ({ date: getIsoDateFromMatch(match), index: match.index ?? 0 }))
    .filter((entry) => entry.date === meetingDate);
  if (dateOccurrences.length === 0) return undefined;

  const timeMatches = Array.from(
    text.matchAll(/\b(?:o\s+godzinie|na\s+godzinę|godz(?:ina)?\.?)\s*(\d{1,2})(?:[:.]([0-5]\d))?\b/giu)
  ).flatMap((match) => {
    const hour = Number(match[1]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return [];
    return [{
      time: `${String(hour).padStart(2, "0")}:${match[2] ?? "00"}`,
      index: match.index ?? 0,
    }];
  });

  const candidates = dateOccurrences.flatMap((date) =>
    timeMatches
      .map((time) => ({ ...time, distance: Math.abs(time.index - date.index) }))
      .filter((time) => time.distance <= 180)
  ).sort((left, right) => left.distance - right.distance);

  return candidates[0]?.time;
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
    const newDateLabelIndex = tail.search(/\bna\s+dzień(?![\p{L}\p{N}_])/iu);
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
      /(?:dotychczasow\w*|pierwotn\w*)\s+termin\w*[\s\S]{0,80}?(?:na\s+dzień|w\s+dniu|:)|zwołan\w*[\s\S]{0,80}?(?:na\s+dzień|w\s+dniu)|\bz\s+dnia\b/iu,
      100,
      "first",
      true
    );
  const eventDate =
    getDateAfterKeyword(
      context,
      /(?:nowy|zmienion\w*)\s+termin\w*[\s\S]{0,80}?(?:na\s+dzień|w\s+dniu|:)|(?:przełoż|przenies)\w*[\s\S]{0,80}?\bna(?:\s+dzień)?\b|zmienia\s+termin[\s\S]{0,80}?\bna(?:\s+dzień)?\b/iu,
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
  if (!GENERAL_MEETING_REFERENCE.test(text)) return [];

  const meetingType = getGeneralMeetingType(text);
  const reschedule = GENERAL_MEETING_RESCHEDULE_NOTICE.test(text);
  const cancellation = GENERAL_MEETING_CANCELLATION_NOTICE.test(text);

  if (reschedule) {
    const { previousEventDate, eventDate } = getGeneralMeetingRescheduleDates(text);
    if (!previousEventDate || !eventDate || previousEventDate === eventDate) return [];

    return [{
      eventType: "GENERAL_MEETING",
      eventDate,
      eventTime: getGeneralMeetingTime(text, eventDate),
      previousEventDate,
      fiscalYear: Number(eventDate.slice(0, 4)),
      isScheduleChange: true,
      generalMeetingType: meetingType,
      generalMeetingAction: "RESCHEDULE",
      registrationDate:
        getOfficialGeneralMeetingRegistrationDate(text) ??
        getGeneralMeetingRegistrationDate(eventDate),
      isCancellation: false,
      eventIdentity: getGeneralMeetingIdentity(meetingType, previousEventDate),
    }];
  }

  const formalMatch = text.match(GENERAL_MEETING_FORMAL_NOTICE);
  const falseNoticeIndex = text.search(GENERAL_MEETING_FALSE_NOTICE);
  const formalNoticeIndex = formalMatch?.index ?? -1;
  if (
    !cancellation &&
    (!formalMatch || (falseNoticeIndex >= 0 && falseNoticeIndex <= formalNoticeIndex))
  ) {
    return [];
  }

  const eventDate = getSemanticMeetingDate(text);
  if (!eventDate) return [];

  return [{
    eventType: "GENERAL_MEETING",
    eventDate,
    eventTime: getGeneralMeetingTime(text, eventDate),
    fiscalYear: Number(eventDate.slice(0, 4)),
    isScheduleChange: false,
    generalMeetingType: meetingType,
    generalMeetingAction: cancellation ? "CANCELLATION" : "CONVENING",
    registrationDate:
      getOfficialGeneralMeetingRegistrationDate(text) ??
      getGeneralMeetingRegistrationDate(eventDate),
    isCancellation: cancellation,
    eventIdentity: getGeneralMeetingIdentity(meetingType, eventDate),
  }];
};

const getDividendStatus = (text: string): Extract<
  CorporateEventStatus,
  "PROPOSED" | "CONFIRMED" | "UNKNOWN"
> => {
  const normalized = text.toLocaleLowerCase("pl-PL");

  if (
    /uchwa|zatwierdz|walne(?:go)?\s+zgromadzeni|przeznacz.{0,48}dywidend|postanawia.{0,48}(?:wyplac|wypłac)/u.test(
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
};

const getDividendAmounts = (text: string): ParsedDividendAmount[] => {
  const perSharePattern =
    /(?:^|[^\d])(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln)\s*(?:\([^)]{0,80}\)\s*)?(?:brutto\s*)?(?:na|\/)\s*(?:(?:jedn[aą]|1)\s*)?akcj/gi;
  const amountAfterPerSharePattern =
    /(?:na|dla)\s*(?:(?:jedn[aą]|1)\s*)?akcj[ęe]\s*(?:przypada|wynosi|w\s+wysokości)?\s*(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln)/gi;
  const unicodePerSharePattern =
    /(?:^|[^\d])(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:z\u0142(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln)\s*(?:\([^)]{0,80}\)\s*)?(?:brutto\s*)?(?:na|\/)\s*(?:(?:jedn(?:a|\u0105)|1)\s*)?akcj/giu;
  const unicodeAmountAfterPerSharePattern =
    /(?:na|dla)\s*(?:(?:jedn(?:a|\u0105)|1)\s*)?akcj(?:\u0119|e)\s*(?:przypada|wynosi|w\s+wysoko\u015Bci)?\s*(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:z\u0142(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln)/giu;
  const labeledAmountAfterPerSharePattern =
    /(?:kwota|wysokość)\s+dywidendy(?:\s+brutto)?\s+(?:na|dla)\s*(?:(?:jedn(?:ą|a)|1)\s*)?akcj[ęe]\s*(?::|wynosi(?:\s+obecnie)?|w\s+wysokości)?\s*(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln)/giu;
  const descriptiveAmountAfterPerSharePattern =
    /(?:kwota|wysokość)\s+dywidendy[\s\S]{0,220}?(?:na|dla)\s*(?:(?:jedn(?:ą|a)|1)\s*)?akcj[ęe][\s\S]{0,220}?(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł(?:ot(?:y|a|ych|e))?|zl(?:otych)?|pln)/giu;
  const amounts: ParsedDividendAmount[] = [];

  for (const pattern of [
    perSharePattern,
    amountAfterPerSharePattern,
    unicodePerSharePattern,
    unicodeAmountAfterPerSharePattern,
    labeledAmountAfterPerSharePattern,
    descriptiveAmountAfterPerSharePattern,
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

const getUpcomingDividendEvents = (text: string): ParsedCorporateEvent[] => {
  if (!/dywidend/i.test(text)) return [];

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

  const candidates = sections.flatMap(({ section, statusContext }) => {
    const parsedAmounts = getDividendAmounts(section);
    if (parsedAmounts.length === 0) return [];
    const advanceAdjustment = getAdvanceAdjustedDividend(section, parsedAmounts);
    const amounts = advanceAdjustment ? [advanceAdjustment.amount] : parsedAmounts;
    const fiscalYear = getDividendFiscalYear(section);

    const recordDate =
      getDateAfterKeyword(
        section,
        /dzie[\s\S]{0,280}?ustala\s+się\s+listę\s+akcjonariuszy\s+uprawnionych[\s\S]{0,240}?(?:został\s+ustalony|ustalono)\s+na/iu,
        80,
        "first",
        true
      ) ??
      getDateAfterKeyword(
        section,
        /dzie.\s+(?:ustalenia\s+prawa\s+do\s+dywidendy|dywidendy)|record\s*date/iu,
        220
      );
    const exDividendDate = getDateAfterKeyword(
      section,
      /ex(?:-|\s)?dividend(?:\s+date)?|ex-date/i
    );
    const paymentDate = getDateAfterKeyword(
      section,
      /(?:termin|dzie.)\s+wyp.{0,3}at(?:y|a)|wyp.{0,3}at(?:a|y)\s+(?:dywidendy\s+)?(?:nastąpi|zostanie|ustalon|w\s+terminie)|payment\s*date/iu,
      300
    );
    const sectionStatus = getDividendStatus(section);
    const dividendStatus =
      sectionStatus === "UNKNOWN" ? getDividendStatus(statusContext) : sectionStatus;

    return amounts.flatMap((entry, index) => {
      const localContextAfter = section.slice(entry.index, entry.index + 260);
      const localContextBefore = section.slice(Math.max(0, entry.index - 240), entry.index);
      const localPaymentDateAfter = getDateAfterKeyword(
        localContextAfter,
        /(?:termin|dzie.)\s+wyp.{0,3}at(?:y|a)|payment\s*date/iu,
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
        getDateAfterKeyword(
          localContextAfter,
          /(?:termin|dzie.)\s+wyp.{0,3}at(?:y|a)|payment\s*date/iu,
          250,
          "first"
        ) ??
        localInstallmentDateBefore ??
        localPaymentDateBefore ??
        localInstallmentDateAfter ??
        localPaymentDateAfter ??
        paymentDate;
      const eventDate = recordDate ?? exDividendDate ?? resolvedPaymentDate;

      // A source that does not publish any date is useful context for a human,
      // but it is not an upcoming calendar event. Do not invent a technical
      // date merely to force it into storage or the UI.
      if (!eventDate) return [];

      const installment = amounts.length > 1 ? index + 1 : undefined;
      return [{
        eventType: "UPCOMING_DIVIDEND" as const,
        eventDate,
        fiscalYear,
        isScheduleChange: false,
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
        dividendCurrency: "PLN",
        exDividendDate,
        recordDate,
        paymentDate: resolvedPaymentDate,
        dividendInstallment: installment,
        dividendStatus,
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

export const parseCorporateEventDocument = (document: string): ParsedCorporateEvent[] => {
  const text = normalizeDocumentText(document);
  if (!text) return [];

  const changeMatches = Array.from(
    text.matchAll(
      /\bzmian(?:a|y|ie|ę)\s+(?:harmonogramu\s+)?terminu\b|\bnowy termin(?: publikacji)?\b/giu
    )
  );
  for (const changeMatch of changeMatches.reverse()) {
    const changeContext = text.slice(changeMatch.index ?? 0, (changeMatch.index ?? 0) + 1_200);
    const eventType = getEventType(changeContext) ?? getEventType(text);
    const newTermIndex = changeContext.search(/\bnowy termin(?: publikacji)?\b/iu);
    const sentence = changeContext.split(/(?<=[.!?])\s/)[0] ?? changeContext;
    const datesBeforeNew = newTermIndex >= 0
      ? extractPolishDates(changeContext.slice(0, newTermIndex))
      : extractPolishDates(sentence);
    const datesAfterNew = newTermIndex >= 0
      ? extractPolishDates(changeContext.slice(newTermIndex, newTermIndex + 420))
      : [];
    const previousEventDate = newTermIndex >= 0
      ? datesBeforeNew.at(-1)
      : datesBeforeNew[0];
    const eventDate = newTermIndex >= 0
      ? datesAfterNew[0]
      : datesBeforeNew.at(-1);

    if (eventType && previousEventDate && eventDate && previousEventDate !== eventDate) {
      return [
        {
          eventType,
          eventDate,
          previousEventDate,
          fiscalPeriod: getFiscalPeriod(changeContext, eventType),
          fiscalYear: getFiscalYear(changeContext),
          isScheduleChange: true,
        },
      ];
    }
  }

  const events = new Map<string, ParsedCorporateEvent>();

  for (const segment of getCandidateSegments(text)) {
    // Dates naming the legal regulation (for example 6 June 2025) are not
    // publication dates, even when the same paragraph mentions omitted Q2/Q4
    // reports. A report date must come from the issuer's schedule segment.
    if (/rozporządzen/iu.test(segment)) continue;
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

  for (const generalMeeting of getGeneralMeetingEvents(text)) {
    events.set(getCorporateEventIdentityKey(generalMeeting), generalMeeting);
  }

  for (const dividend of getUpcomingDividendEvents(text)) {
    events.set(getCorporateEventIdentityKey(dividend), dividend);
  }

  return Array.from(events.values()).sort((left, right) =>
    left.eventDate.localeCompare(right.eventDate)
  );
};

export const getCorporateEventLabel = (event: Pick<
  CorporateEvent,
  "eventType" | "fiscalPeriod" | "fiscalYear" | "generalMeetingType"
>) => {
  const period = [event.fiscalPeriod, event.fiscalYear].filter(Boolean).join(" ");

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

const getWarsawDate = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
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

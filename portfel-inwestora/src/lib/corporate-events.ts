export const CORPORATE_EVENT_TYPES = [
  "QUARTERLY_REPORT",
  "HALF_YEAR_REPORT",
  "ANNUAL_REPORT",
  "UPCOMING_DIVIDEND",
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
  /** A stable source-independent identity, used for events that have no fiscal period. */
  eventIdentity?: string;
  /** Read-only corporate-event data. It must never be turned into a DIVIDEND operation. */
  dividendPerShare?: number;
  dividendCurrency?: string;
  exDividendDate?: string;
  recordDate?: string;
  paymentDate?: string;
  dividendInstallment?: number;
  /** Portfolio-context quantity projected by the read-only API response. */
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
  dividendPerShare?: number;
  dividendCurrency?: string;
  exDividendDate?: string;
  recordDate?: string;
  paymentDate?: string;
  dividendInstallment?: number;
  /** Portfolio-context quantity projected by the read-only API response. */
  heldQuantity?: number;
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
  preference: "first" | "last" = "last"
) => {
  const flags = keyword.flags.includes("g") ? keyword.flags : `${keyword.flags}g`;
  const pattern = new RegExp(keyword.source, flags);
  let resolvedDate: string | undefined;

  // Titles often contain e.g. "wypłata dywidendy" but no actual date. Scan
  // all bounded occurrences and prefer the final explicit date from the
  // issuer statement over publication metadata that follows the title.
  for (const match of text.matchAll(pattern)) {
    const context = text.slice(match.index, (match.index ?? 0) + maxLength);
    if (/data publikacji|aktualizacja/iu.test(context)) continue;
    const date = extractPolishDates(context)[0];
    if (!date) continue;
    if (preference === "first") return date;
    resolvedDate = date;
  }

  return resolvedDate;
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
    /(?:^|[^\d])(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł|zl|pln)\s*(?:brutto\s*)?(?:na|\/)\s*(?:(?:jedn[aą]|1)\s*)?akcj/gi;
  const amountAfterPerSharePattern =
    /(?:na|dla)\s*(?:(?:jedn[aą]|1)\s*)?akcj[ęe]\s*(?:przypada|wynosi|w\s+wysokości)?\s*(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:zł|zl|pln)/gi;
  const unicodePerSharePattern =
    /(?:^|[^\d])(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:z\u0142|zl|pln)\s*(?:brutto\s*)?(?:na|\/)\s*(?:(?:jedn(?:a|\u0105)|1)\s*)?akcj/giu;
  const unicodeAmountAfterPerSharePattern =
    /(?:na|dla)\s*(?:(?:jedn(?:a|\u0105)|1)\s*)?akcj(?:\u0119|e)\s*(?:przypada|wynosi|w\s+wysoko\u015Bci)?\s*(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{1,4})?)\s*(?:z\u0142|zl|pln)/giu;
  const amounts: ParsedDividendAmount[] = [];

  for (const pattern of [
    perSharePattern,
    amountAfterPerSharePattern,
    unicodePerSharePattern,
    unicodeAmountAfterPerSharePattern,
  ]) {
    for (const match of text.matchAll(pattern)) {
      const amount = toAmount(match[1] ?? "");
      const index = match.index ?? 0;
      if (!amount) continue;

      const nearby = text.slice(Math.max(0, index - 96), index + 96);
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

const getUpcomingDividendEvents = (text: string): ParsedCorporateEvent[] => {
  if (!/dywidend/i.test(text)) return [];

  const sectionMatches = Array.from(text.matchAll(/dywidenda\s+za[^\n:]{0,96}:/gi));
  const sections =
    sectionMatches.length > 0
      ? sectionMatches.map((match, index) => ({
          section: text.slice(match.index, sectionMatches[index + 1]?.index),
          statusContext: text.slice(Math.max(0, (match.index ?? 0) - 220), match.index),
        }))
      : [{ section: text, statusContext: "" }];

  return sections.flatMap(({ section, statusContext }) => {
    const amounts = getDividendAmounts(section);
    if (amounts.length === 0) return [];

    const recordDate = getDateAfterKeyword(
      section,
      /dzie.\s+(?:ustalenia\s+prawa\s+do\s+dywidendy|dywidendy)|record\s*date/i
    );
    const exDividendDate = getDateAfterKeyword(
      section,
      /ex(?:-|\s)?dividend(?:\s+date)?|ex-date/i
    );
    const paymentDate = getDateAfterKeyword(
      section,
      /(?:(?:termin|dzie.)\s+)?wyp.{0,3}at(?:y|a)|payment\s*date/iu
    );
    const sectionStatus = getDividendStatus(section);
    const dividendStatus =
      sectionStatus === "UNKNOWN" ? getDividendStatus(statusContext) : sectionStatus;

    return amounts.flatMap((entry, index) => {
      const localContext = section.slice(entry.index, entry.index + 240);
      const localPaymentDate = getDateAfterKeyword(
        localContext,
        /(?:\d+\.?\s+)?rat[ayęei]|(?:(?:termin|dzie.)\s+)?wyp.{0,3}at(?:y|a)|payment\s*date/iu,
        220,
        "first"
      );
      const resolvedPaymentDate =
        getDateAfterKeyword(localContext, /wyp.{0,6}at(?:y|a)|payment\s*date/i, 220, "first") ??
        localPaymentDate ??
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
        isScheduleChange: false,
        eventIdentity: [
          "dividend",
          recordDate ?? exDividendDate ?? "",
          resolvedPaymentDate ?? "",
          entry.amount.toFixed(6),
          installment ?? "single",
        ].join(":"),
        dividendPerShare: entry.amount,
        dividendCurrency: "PLN",
        exDividendDate,
        recordDate,
        paymentDate: resolvedPaymentDate,
        dividendInstallment: installment,
        dividendStatus,
      }];
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

  for (const dividend of getUpcomingDividendEvents(text)) {
    events.set(getCorporateEventIdentityKey(dividend), dividend);
  }

  return Array.from(events.values()).sort((left, right) =>
    left.eventDate.localeCompare(right.eventDate)
  );
};

export const getCorporateEventLabel = (event: Pick<CorporateEvent, "eventType" | "fiscalPeriod" | "fiscalYear">) => {
  const period = [event.fiscalPeriod, event.fiscalYear].filter(Boolean).join(" ");

  if (event.eventType === "UPCOMING_DIVIDEND") {
    return "Nadchodząca dywidenda";
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

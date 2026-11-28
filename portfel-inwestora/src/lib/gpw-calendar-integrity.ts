/*
 * Checks of the GPW calendar against the notices themselves and against what really happened. They do
 * not use the parser's rules on purpose: a fault in those rules (two advances taken for one, a notice
 * read as nothing, a replaced date taken for the new one) shows up here instead of staying hidden.
 */

const POLISH_MONTHS = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
const ENGLISH_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_NUMBERS = new Map([...POLISH_MONTHS, ...ENGLISH_MONTHS].map((name, index) => [name, (index % 12) + 1]));

const flatten = (text: string) => text.toLocaleLowerCase("pl-PL").replace(/\s+/g, " ");

/** Whether a notice writes this date in any common form ("16 grudnia 2026", "16.12.2026", "2026-12-16"). */
export const noticeStatesDate = (text: string, isoDate: string) => {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const flat = flatten(text);
  return [
    isoDate, `${dd}.${mm}.${year}`, `${day}.${mm}.${year}`, `${dd}-${mm}-${year}`, `${dd}/${mm}/${year}`,
    `${day} ${POLISH_MONTHS[month - 1]} ${year}`, `${dd} ${POLISH_MONTHS[month - 1]} ${year}`,
    `${day} ${ENGLISH_MONTHS[month - 1]} ${year}`, `${ENGLISH_MONTHS[month - 1]} ${day}, ${year}`,
  ].some((form) => {
    // "5.01.2027" must not be found inside "15.01.2027".
    for (let at = flat.indexOf(form); at !== -1; at = flat.indexOf(form, at + 1)) {
      if (!/\d/.test(flat[at - 1] ?? "")) return true;
    }
    return false;
  });
};

const DATE_IN_TEXT = /(\d{1,2})\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+(20\d\d)|(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d\d)|(20\d\d)-(\d\d)-(\d\d)/gu;
/** Words that put a date to a dividend: its payment, its dividend day, who is entitled. */
const DIVIDEND_DAY_WORDS = /(?:wypłat|wyplat|wypłacon|dzień dywidendy|dnia dywidendy|dniem dywidendy|uprawnion|uprawnien|ustalenia praw|nabycia praw|record date|payment date)/u;

const toIso = (year: string, month: number, day: string) =>
  `${year}-${String(month).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;

/**
 * Dates a dividend notice gives to its payment or dividend day, from the given day on: a date shortly
 * after such words. Deliberately simple and independent of the calendar parser.
 */
export const getAnnouncedDividendDays = (text: string, fromDate: string) => {
  const flat = flatten(text);
  const days = new Set<string>();
  // The words belong to the next date only: a date in between ends their reach, except in a short
  // list ("odpowiednio 9 grudnia 2026 r. i 16 grudnia 2026 r.") that continues a dividend date.
  let previousEnd = 0;
  let previousWasDividend = false;
  for (const match of flat.matchAll(DATE_IN_TEXT)) {
    const start = match.index ?? 0;
    const date = match[1] ? toIso(match[3]!, MONTH_NUMBERS.get(match[2]!)!, match[1])
      : match[4] ? toIso(match[6]!, Number(match[5]), match[4]) : toIso(match[7]!, Number(match[8]), match[9]!);
    const between = flat.slice(Math.max(previousEnd, start - 160), start);
    const isDividend: boolean = DIVIDEND_DAY_WORDS.test(between) ||
      (previousWasDividend && /^[\s,;]*(?:r\.|roku)?[\s,;]*(?:i|oraz|a|,)?\s*$/u.test(flat.slice(previousEnd, start)));
    previousEnd = start + match[0].length;
    previousWasDividend = isDividend;
    if (date < fromDate || date > `${Number(fromDate.slice(0, 4)) + 1}-12-31`) continue;
    if (isDividend) days.add(date);
  }
  return [...days].sort();
};

/** A notice about an advance on a dividend, by its words alone ("zaliczka", "interim dividend"). */
export const isAdvanceNoticeText = (text: string) => /zaliczk|interim dividend/u.test(flatten(text));

export type IntegrityDividendMissing ={ issuer: string; sourceUrl: string; publishedAt: string; days: string[] };
export type IntegrityDividendUnsupported = {
  issuer: string; recordDate: string | null; paymentDate: string | null; sourceUrl: string;
};
export type IntegrityReportMismatch = {
  issuer: string; reportType: string; publishedOn: string; calendarDate: string | null; sourceUrl: string;
};

export type GpwCalendarIntegrity = {
  checkedAt: string;
  dividends: {
    noticesChecked: number;
    missing: IntegrityDividendMissing[];
    eventsChecked: number;
    unsupported: IntegrityDividendUnsupported[];
  };
  reports: {
    since: string;
    published: number;
    onCalendarDay: number;
    differentDay: IntegrityReportMismatch[];
    notInCalendar: IntegrityReportMismatch[];
  };
};

/**
 * Below this share of reports out on the calendar's day the report dates need a look. On 28.11.2026 the
 * production calendar had 357 of 392 filings of the last 60 days (91%) on its day.
 */
const REPORT_DAY_SHARE_EXPECTED = 0.85;
/** Too few filings (between reporting seasons) say nothing about the share. */
const REPORT_SHARE_MIN_FILINGS = 20;

/** Polish count forms: 1 komunikat, 2–4 komunikaty, 5 komunikatów (and 12–14 like 5). */
export const polishCount = (count: number, one: string, few: string, many: string) => {
  const lastTwo = count % 100;
  const last = count % 10;
  const form = count === 1 ? one : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
  return `${count} ${form}`;
};

export const assessGpwCalendarIntegrity = (integrity: GpwCalendarIntegrity) => {
  const findings: string[] = [];
  const { dividends, reports } = integrity;
  if (dividends.missing.length > 0) {
    findings.push(`Dywidendy: ${polishCount(dividends.missing.length, "komunikat podaje", "komunikaty podają", "komunikatów podaje")} przyszły dzień dywidendy lub wypłaty, którego nie ma w kalendarzu.`);
  }
  if (dividends.unsupported.length > 0) {
    findings.push(`Dywidendy: ${polishCount(dividends.unsupported.length, "wpis w kalendarzu wskazuje", "wpisy w kalendarzu wskazują", "wpisów w kalendarzu wskazuje")} komunikat bez swoich dat (możliwe sklejenie dwóch wypłat).`);
  }
  // Some companies always file late or after midnight, and some never announce a date: those stay in
  // the lists below without raising the alarm. Only a drop of the whole share does.
  if (reports.published >= REPORT_SHARE_MIN_FILINGS && reports.onCalendarDay / reports.published < REPORT_DAY_SHARE_EXPECTED) {
    findings.push(`Raporty: tylko ${reports.onCalendarDay} z ${reports.published} wyszło w dniu z kalendarza.`);
  }
  return { level: findings.length === 0 ? ("OK" as const) : ("ATTENTION" as const), findings };
};

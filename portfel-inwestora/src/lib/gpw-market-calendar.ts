const GPW_MARKET_CLOSE_MINUTE = 17 * 60 + 15;

export const getWarsawMarketClock = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${valueFor("year")}-${valueFor("month")}-${valueFor("day")}`,
    minute: Number(valueFor("hour")) * 60 + Number(valueFor("minute")),
  };
};

export const shiftCalendarDate = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getEasterSunday = (year: number) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/**
 * GPW does not hold sessions on Saturdays, Sundays and on the days the Exchange
 * Management Board designates (Regulamin Giełdy §120–§122). The Board publishes
 * a resolution per year. It lists statutory holidays that fall on a weekday and
 * the days the Board closes the exchange although they are not statutory
 * (Good Friday, 24 December, 31 December), so the calendar must NOT be modelled
 * as "Polish public holidays + Good Friday".
 *
 * Every year is therefore reported with an explicit basis, and callers/tests
 * must not treat a derived or projected year as confirmed by GPW:
 *  - OFFICIAL           the year is taken verbatim from a GPW resolution below;
 *  - DERIVED_UNVERIFIED a past year without a resolution in this file: a rule
 *                       based derivation, NOT confirmed by a primary source;
 *  - PROJECTED          a year after the last published resolution: a forecast.
 *
 * Evidence, per-rule status and the update procedure: docs/gpw-session-calendar.md.
 */
export type GpwCalendarYearBasis = "OFFICIAL" | "DERIVED_UNVERIFIED" | "PROJECTED";

/**
 * Weekday dates without a session, copied verbatim from the Management Board
 * resolutions "w sprawie określenia dni w roku …, w których nie odbędą się sesje
 * giełdowe i notowania w alternatywnym systemie obrotu" (PDF published on gpw.pl).
 * Weekend dates are not listed by GPW. Add the next year when GPW publishes it
 * (usually June–July of the preceding year) and extend
 * tests/fixtures/gpw-official-non-session-days.mjs with the same list.
 */
export const OFFICIAL_GPW_NON_SESSION_WEEKDAYS: Readonly<Record<number, readonly string[]>> = {
  // Uchwała Nr 593/2021 z 10.06.2021 — https://www.gpw.pl/pub/GPW/uchwaly/2021/593_2021.pdf
  2022: [
    "2022-01-06", "2022-04-15", "2022-04-18", "2022-05-03", "2022-06-16",
    "2022-08-15", "2022-11-01", "2022-11-11", "2022-12-26",
  ],
  // Uchwała Nr 509/2022 z 2.06.2022 — https://www.gpw.pl/pub/GPW/uchwaly/2022/509_2022.pdf
  2023: [
    "2023-01-06", "2023-04-07", "2023-04-10", "2023-05-01", "2023-05-03",
    "2023-06-08", "2023-08-15", "2023-11-01", "2023-12-25", "2023-12-26",
  ],
  // Uchwała Nr 571/2023 z 15.06.2023 — https://www.gpw.pl/pub/GPW/uchwaly/2023/571_2023.pdf
  2024: [
    "2024-01-01", "2024-03-29", "2024-04-01", "2024-05-01", "2024-05-03",
    "2024-05-30", "2024-08-15", "2024-11-01", "2024-11-11", "2024-12-24",
    "2024-12-25", "2024-12-26", "2024-12-31",
  ],
  // Uchwała Nr 701/2024 z 6.06.2024 — https://gpw.pl/pub/GPW/uchwaly/2024/701_2024.pdf
  2025: [
    "2025-01-01", "2025-01-06", "2025-04-18", "2025-04-21", "2025-05-01",
    "2025-06-19", "2025-08-15", "2025-11-11", "2025-12-24", "2025-12-25",
    "2025-12-26", "2025-12-31",
  ],
  // Uchwała Nr 753/2025 z 12.06.2025 — https://www.gpw.pl/pub/GPW/uchwaly/2025/753_2025.pdf
  2026: [
    "2026-01-01", "2026-01-06", "2026-04-03", "2026-04-06", "2026-05-01",
    "2026-06-04", "2026-11-11", "2026-12-24", "2026-12-25", "2026-12-31",
  ],
  // Uchwała Nr 754/2025 z 12.06.2025 — https://www.gpw.pl/pub/GPW/uchwaly/2025/754_2025.pdf
  2027: [
    "2027-01-01", "2027-01-06", "2027-03-26", "2027-03-29", "2027-05-03",
    "2027-05-27", "2027-11-01", "2027-11-11", "2027-12-24", "2027-12-31",
  ],
  // Uchwała Nr 1089/2026 z 20.07.2026 — https://www.gpw.pl/pub/GPW/uchwaly/2026/1089_2026.pdf
  2028: [
    "2028-01-06", "2028-04-14", "2028-04-17", "2028-05-01", "2028-05-03",
    "2028-06-15", "2028-08-15", "2028-11-01", "2028-12-25", "2028-12-26",
  ],
};

/**
 * One-off cancellations outside the yearly resolution. Only entries confirmed by
 * a GPW primary source belong here.
 * - 2018-11-12: GPW notice of 2.11.2018 (https://www.gpw.pl/news?cmn_id=107609):
 *   the Management Board resolved on 31.10.2018 to cancel the session (national
 *   holiday for the centenary of independence). The notice gives no resolution number.
 */
export const GPW_EXTRAORDINARY_NON_TRADING_DAYS: readonly string[] = ["2018-11-12"];

const LAST_OFFICIAL_YEAR = Math.max(...Object.keys(OFFICIAL_GPW_NON_SESSION_WEEKDAYS).map(Number));

export const getGpwCalendarYearBasis = (year: number): GpwCalendarYearBasis => {
  if (OFFICIAL_GPW_NON_SESSION_WEEKDAYS[year] !== undefined) return "OFFICIAL";
  return year > LAST_OFFICIAL_YEAR ? "PROJECTED" : "DERIVED_UNVERIFIED";
};

/**
 * Epiphany is a statutory day off from 2011 (Dz.U. 2010 nr 224 poz. 1459 — level C,
 * to be re-checked in ISAP). The resolution texts for 2010 (609/2009) and 2011
 * (1255/2010) as reproduced by the media agree, but the PDFs were not retrievable,
 * so the threshold is NOT confirmed by a primary source.
 */
const EPIPHANY_NON_SESSION_FROM_YEAR = 2011;

/**
 * UNVERIFIED and CONFLICTING. The resolutions for 2024–2027 (primary source) and for
 * 2020 (media reproduction) list 31 December, and press reports say no session was
 * held on it in 2013 and 2014, but the reproduced resolution texts for 2013 (807/2012)
 * and 2014 (812/2013) do not list it.
 * No primary document explains the difference; 2012 is only the first year in which
 * the date falls on a weekday after sessions were held on 31.12.2010.
 */
const NEW_YEARS_EVE_NON_SESSION_FROM_YEAR = 2012;

/**
 * Rule-based derivation. It reproduces every official list in
 * OFFICIAL_GPW_NON_SESSION_WEEKDAYS (checked by tests) but is NOT an official
 * calendar: for years outside that table it is an unverified derivation
 * (past years) or a forecast (years after the last resolution). Includes weekend dates.
 */
export const deriveGpwNonTradingDays = (year: number): ReadonlySet<string> => {
  const easter = getEasterSunday(year);
  const days = new Set(
    ["01-01", "05-01", "05-03", "08-15", "11-01", "11-11", "12-25", "12-26"].map((day) => `${year}-${day}`)
  );

  days.add(shiftCalendarDate(easter, 1)); // Easter Monday
  days.add(shiftCalendarDate(easter, 60)); // Corpus Christi
  // Closed by decision of the Exchange Management Board, not by statute.
  days.add(shiftCalendarDate(easter, -2)); // Good Friday
  days.add(`${year}-12-24`);
  if (year >= EPIPHANY_NON_SESSION_FROM_YEAR) days.add(`${year}-01-06`);
  if (year >= NEW_YEARS_EVE_NON_SESSION_FROM_YEAR) days.add(`${year}-12-31`);

  return days;
};

const nonTradingDaysByYear = new Map<number, ReadonlySet<string>>();

export const getGpwNonTradingDays = (year: number): ReadonlySet<string> => {
  if (!Number.isInteger(year)) throw new RangeError(`Invalid GPW calendar year: ${year}`);

  const cached = nonTradingDaysByYear.get(year);
  if (cached) return cached;

  const days = new Set<string>(
    getGpwCalendarYearBasis(year) === "OFFICIAL"
      ? OFFICIAL_GPW_NON_SESSION_WEEKDAYS[year]
      : deriveGpwNonTradingDays(year)
  );
  for (const day of GPW_EXTRAORDINARY_NON_TRADING_DAYS) {
    if (day.startsWith(`${year}-`)) days.add(day);
  }

  nonTradingDaysByYear.set(year, days);
  return days;
};

export const isGpwTradingDay = (date: string) => {
  const dayOfWeek = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return dayOfWeek !== 0 && dayOfWeek !== 6 && !getGpwNonTradingDays(Number(date.slice(0, 4))).has(date);
};

export const isCurrentWarsawDayGpwSession = (now = new Date()) =>
  isGpwTradingDay(getWarsawMarketClock(now).date);

export const getLatestCompletedGpwSessionDate = (now = new Date()) => {
  const warsaw = getWarsawMarketClock(now);
  let candidate = warsaw.date;

  if (warsaw.minute < GPW_MARKET_CLOSE_MINUTE) candidate = shiftCalendarDate(candidate, -1);
  while (!isGpwTradingDay(candidate)) candidate = shiftCalendarDate(candidate, -1);

  return candidate;
};

export const isFreshGpwMarketPrice = (priceDate: string | undefined, now = new Date()) =>
  Boolean(priceDate) && priceDate === getLatestCompletedGpwSessionDate(now);

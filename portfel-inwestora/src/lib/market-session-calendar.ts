import { shiftCalendarDate } from "@/lib/gpw-market-calendar";

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

const nonTradingDaysByYear = new Map<number, ReadonlySet<string>>();

const getXetraNonTradingDays = (year: number) => {
  const cached = nonTradingDaysByYear.get(year);
  if (cached) return cached;

  const easterSunday = getEasterSunday(year);
  const holidays = new Set([
    `${year}-01-01`,
    shiftCalendarDate(easterSunday, -2),
    shiftCalendarDate(easterSunday, 1),
    `${year}-05-01`,
    `${year}-12-24`,
    `${year}-12-25`,
    `${year}-12-26`,
    `${year}-12-31`,
  ]);
  nonTradingDaysByYear.set(year, holidays);
  return holidays;
};

/**
 * Deutsche Börse cash-market holidays used by Xetra/Frankfurt. This calendar
 * intentionally includes only published full non-trading days; other German
 * public holidays may still be trading days on these venues.
 */
export const isXetraTradingDay = (date: string) => {
  const dayOfWeek = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  return !getXetraNonTradingDays(Number(date.slice(0, 4))).has(date);
};

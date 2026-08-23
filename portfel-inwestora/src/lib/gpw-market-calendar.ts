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

export const getGpwNonTradingDays = (year: number) => {
  const easter = getEasterSunday(year);
  const fixed = ["01-01", "01-06", "05-01", "05-03", "08-15", "11-01", "11-11", "12-25", "12-26"];
  const holidays = new Set(fixed.map((day) => `${year}-${day}`));

  holidays.add(shiftCalendarDate(easter, -2));
  holidays.add(shiftCalendarDate(easter, 1));
  holidays.add(shiftCalendarDate(easter, 60));
  if (year >= 2025) holidays.add(`${year}-12-24`);

  return holidays;
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

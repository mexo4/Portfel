import type { PricePoint } from "@/lib/instrument-chart";
import { round } from "@/lib/utils";

/** How much a quote changed over fixed periods, in the quote currency and without dividends. */

export const RETURN_PERIODS = [
  { id: "7d", label: "7 dni", days: 7, months: 0 },
  { id: "30d", label: "30 dni", days: 30, months: 0 },
  { id: "6m", label: "6 mies.", days: 0, months: 6 },
  { id: "1y", label: "1 rok", days: 0, months: 12 },
  { id: "3y", label: "3 lata", days: 0, months: 36 },
] as const;

export type ReturnPeriodId = (typeof RETURN_PERIODS)[number]["id"];

/** The latest quote may be this old for the changes to describe the present. */
const MAX_STALE_DAYS = 10;
/** The starting quote may be this long before the start day (holidays, thin trading). */
const MAX_GAP_DAYS = 10;

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/** The day `months` earlier, or the last day of that month when it is shorter. */
const monthsBefore = (date: string, months: number) => {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const length = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, length));
  return target.toISOString().slice(0, 10);
};

/**
 * Percent change from the last quote on or before the start of each period to the latest quote.
 * `null` when the history does not reach back that far or the latest quote is old. `points` must be
 * oldest first.
 */
export const calculatePeriodReturns = (points: PricePoint[], today: string) => {
  const empty = Object.fromEntries(RETURN_PERIODS.map((period) => [period.id, null])) as Record<ReturnPeriodId, number | null>;
  const last = points.at(-1);
  if (!last || last.date < addDays(today, -MAX_STALE_DAYS)) return empty;
  for (const period of RETURN_PERIODS) {
    const start = period.months > 0 ? monthsBefore(last.date, period.months) : addDays(last.date, -period.days);
    let base: PricePoint | undefined;
    for (const point of points) {
      if (point.date > start) break;
      base = point;
    }
    if (base && base.close > 0 && base.date >= addDays(start, -MAX_GAP_DAYS)) empty[period.id] = round((last.close / base.close - 1) * 100, 2);
  }
  return empty;
};

import type { ClosedInvestmentTrade } from "@/lib/closed-investments";
import { round } from "@/lib/utils";

/** The realized result day by day: every sale counts on its own date, in PLN. */

export type CalendarDay = { date: string; day: number; trades: ClosedInvestmentTrade[]; profitLossPln: number };

export type CalendarMonth = {
  /** "2026-11" */
  month: string;
  /** Weeks from Monday to Sunday; `null` outside the month. */
  weeks: Array<Array<CalendarDay | null>>;
  profitLossPln: number;
  closes: number;
  daysWithCloses: number;
  /** The largest absolute result of a day, for shading. */
  largestDayPln: number;
};

/** Months that have at least one sale, oldest first. */
export const listClosingMonths = (trades: ClosedInvestmentTrade[]) => [...new Set(trades.map((trade) => trade.saleDate.slice(0, 7)))].sort();

export const shiftMonth = (month: string, by: number) => {
  const date = new Date(`${month}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + by);
  return date.toISOString().slice(0, 7);
};

export const buildCalendarMonth = (trades: ClosedInvestmentTrade[], month: string): CalendarMonth => {
  const byDate = new Map<string, ClosedInvestmentTrade[]>();
  for (const trade of trades) {
    if (trade.saleDate.slice(0, 7) !== month) continue;
    byDate.set(trade.saleDate.slice(0, 10), [...(byDate.get(trade.saleDate.slice(0, 10)) ?? []), trade]);
  }
  const first = new Date(`${month}-01T00:00:00.000Z`);
  const length = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7;
  const cells: Array<CalendarDay | null> = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= length; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const dayTrades = byDate.get(date) ?? [];
    cells.push({ date, day, trades: dayTrades, profitLossPln: round(dayTrades.reduce((sum, trade) => sum + trade.profitLossPln, 0)) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const days = cells.filter((cell): cell is CalendarDay => cell !== null && cell.trades.length > 0);

  return {
    month,
    weeks: Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7)),
    profitLossPln: round(days.reduce((sum, day) => sum + day.profitLossPln, 0)),
    closes: days.reduce((sum, day) => sum + day.trades.length, 0),
    daysWithCloses: days.length,
    largestDayPln: Math.max(0, ...days.map((day) => Math.abs(day.profitLossPln))),
  };
};

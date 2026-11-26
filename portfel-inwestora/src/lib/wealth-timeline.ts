import type { PortfolioStructureResponse } from "@/lib/portfolio-structure";
import { getDepositState, getLoanState } from "@/lib/wealth-instruments";
import { getWealthReportCategory, WEALTH_CATEGORY_LABELS, type WealthReportCategoryKey } from "@/lib/wealth-report";
import { round } from "@/lib/utils";
import type { FxRates, WealthItem } from "@/types/portfolio";

/**
 * Wealth and debts month by month, in PLN. Investment accounts come from the portfolios' price
 * history, deposits and loans from their terms. For a typed-in item Mexo knows only the values
 * the user typed: it counts from the day it was added, at the value then in force. Foreign items
 * are converted at today's rate.
 */

export type WealthTimelineKey = Exclude<WealthReportCategoryKey, "broker-cash">;

export const WEALTH_TIMELINE_KEYS: WealthTimelineKey[] = ["investments", "deposits", "property", "vehicles", "valuables", "other", "liabilities"];

export const WEALTH_TIMELINE_LABELS: Record<WealthTimelineKey, string> = {
  ...WEALTH_CATEGORY_LABELS,
  investments: "Rachunki inwestycyjne",
};

export type WealthTimelinePoint = Record<WealthTimelineKey, number> & { date: string; assets: number; netWorth: number };

const startOf = (item: WealthItem) => item.deposit?.startDate ?? item.loan?.startDate ?? item.addedAt;

export const getWealthItemValueOn = (item: WealthItem, date: string) => {
  if (date < startOf(item)) return 0;
  if (item.kind === "asset" && item.deposit) return getDepositState(item.deposit, date).value;
  if (item.kind === "liability" && item.loan) return getLoanState(item.loan, date).balance;
  const history = item.valueHistory;
  if (!history?.length) return item.value;
  return [...history].reverse().find((entry) => entry.date <= date)?.value ?? history[0]!.value;
};

const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);

/** Month ends from the first date up to today, and today itself. */
export const monthlyDates = (from: string, today: string) => {
  const dates: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7)) - 1;
  for (let guard = 0; guard < 1200; guard += 1) {
    const end = monthEnd(year, month);
    if (end >= today) break;
    dates.push(end);
    month += 1;
    if (month === 12) { month = 0; year += 1; }
  }
  return [...dates, today];
};

const MAX_MONTHS = 120;

export const buildWealthTimeline = ({
  structure,
  wealthItems,
  fxRates,
  today,
}: {
  structure: Pick<PortfolioStructureResponse, "dates" | "portfolios"> | null;
  wealthItems: WealthItem[];
  fxRates: FxRates;
  today: string;
}): WealthTimelinePoint[] => {
  const investedDates = structure?.dates ?? [];
  const firstInvested = investedDates.find((_, index) => structure!.portfolios.some((portfolio) => Math.abs(portfolio.values[index] ?? 0) >= 0.005));
  const starts = [firstInvested, ...wealthItems.map(startOf)].filter((date): date is string => Boolean(date) && date! <= today).sort();
  if (starts.length === 0) return [];

  /** Each portfolio's latest weekly value on or before the date. */
  const investedOn = (date: string) => {
    let index = -1;
    while (index + 1 < investedDates.length && investedDates[index + 1]! <= date) index += 1;
    if (index < 0 || !structure) return 0;
    return structure.portfolios.reduce((total, portfolio) => total + (portfolio.values[index] ?? 0), 0);
  };
  const rateToPln = (currency: string) => (currency === "PLN" ? 1 : fxRates[currency] && fxRates[currency]! > 0 ? fxRates[currency]! : 1);

  return monthlyDates(starts[0]!, today).slice(-MAX_MONTHS).map((date) => {
    const sums: Record<WealthTimelineKey, number> = { investments: investedOn(date), deposits: 0, property: 0, vehicles: 0, valuables: 0, other: 0, liabilities: 0 };
    for (const item of wealthItems) {
      const key = getWealthReportCategory(item) as WealthTimelineKey;
      sums[key] += getWealthItemValueOn(item, date) * rateToPln(item.currency);
    }
    const assets = WEALTH_TIMELINE_KEYS.filter((key) => key !== "liabilities").reduce((total, key) => total + sums[key], 0);
    return {
      date,
      ...(Object.fromEntries(WEALTH_TIMELINE_KEYS.map((key) => [key, round(sums[key], 2)])) as Record<WealthTimelineKey, number>),
      assets: round(assets, 2),
      netWorth: round(assets - sums.liabilities, 2),
    };
  });
};

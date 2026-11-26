import { round } from "@/lib/utils";
import type { CurrencyCode, PortfolioAssetHistorySeries, PortfolioHistoryResponse } from "@/types/portfolio";

/**
 * How the value of the selected portfolios was made up over time: by asset class, by instrument
 * and by portfolio, sampled once a week. Cash is what a portfolio's value holds besides its
 * instruments.
 */

export type StructureInstrument = {
  key: string;
  label: string;
  symbol: string;
  classId: string;
  classLabel: string;
  values: number[];
};

export type StructurePortfolio = { id: string; name: string; values: number[]; cash: number[] };

export type PortfolioStructureResponse = {
  currency: CurrencyCode;
  dates: string[];
  portfolios: StructurePortfolio[];
  instruments: StructureInstrument[];
  warnings: string[];
};

export type StructureScope = {
  id: string;
  name: string;
  history: Pick<PortfolioHistoryResponse, "points" | "assetSeries" | "warnings" | "presentationCurrency">;
  classify: (series: PortfolioAssetHistorySeries) => { id: string; label: string };
};

const mondayOf = (date: string) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
};

/** The last day of every week, and so always the latest day. */
export const pickWeeklyDates = (dates: string[]) => {
  const sorted = [...new Set(dates)].sort();
  return sorted.filter((date, index) => index === sorted.length - 1 || mondayOf(date) !== mondayOf(sorted[index + 1]!));
};

export const buildPortfolioStructure = (scopes: StructureScope[], currency: CurrencyCode): PortfolioStructureResponse => {
  const dates = pickWeeklyDates(scopes.flatMap((scope) => scope.history.points.map((point) => point.date)));
  const inPresentation = currency !== "PLN";
  const warnings = new Set<string>();
  const instruments = new Map<string, StructureInstrument>();
  let missingRates = false;

  const portfolios = scopes.map((scope): StructurePortfolio => {
    scope.history.warnings.forEach((warning) => warnings.add(warning));
    const pointByDate = new Map(scope.history.points.map((point) => [point.date, point]));
    const assetTotals = dates.map(() => 0);

    for (const series of scope.history.assetSeries) {
      const valueByDate = new Map(series.points.map((point) => [point.date, inPresentation ? point.valuePresentation ?? null : point.valuePln]));
      const values = dates.map((date) => {
        const value = valueByDate.get(date);
        if (value === null) missingRates = true;
        return value ?? 0;
      });
      if (values.every((value) => value === 0)) continue;
      values.forEach((value, index) => { assetTotals[index] += value; });
      // The same instrument held in two portfolios is one line.
      const current = instruments.get(series.groupKey);
      if (current) current.values = current.values.map((value, index) => round(value + values[index]!, 2));
      else {
        const { id, label } = scope.classify(series);
        instruments.set(series.groupKey, { key: series.groupKey, label: series.label, symbol: series.symbol, classId: id, classLabel: label, values: values.map((value) => round(value, 2)) });
      }
    }

    const values = dates.map((date) => {
      const point = pointByDate.get(date);
      if (!point) return 0;
      const value = inPresentation ? point.presentationPortfolioValue ?? null : point.portfolioValuePln;
      if (value === null) missingRates = true;
      return round(value ?? 0, 2);
    });

    return {
      id: scope.id,
      name: scope.name,
      values,
      cash: dates.map((date, index) => (pointByDate.has(date) ? round(values[index]! - assetTotals[index]!, 2) : 0)),
    };
  });

  if (missingRates) warnings.add(`Brakuje części historycznych kursów ${currency}; te dni pokazują wartość zero.`);

  return {
    currency,
    dates,
    portfolios,
    instruments: [...instruments.values()],
    warnings: [...warnings].sort((left, right) => left.localeCompare(right, "pl")),
  };
};

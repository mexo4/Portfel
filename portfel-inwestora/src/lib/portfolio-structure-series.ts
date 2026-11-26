import type { PortfolioStructureResponse } from "@/lib/portfolio-structure";
import { round } from "@/lib/utils";

/**
 * The stacked series of the structure chart. A colour belongs to its class, instrument or
 * portfolio and stays with it when the range or the view changes.
 */

export type StructureView = "classes" | "instruments" | "portfolios";

export type StructureSeries = { id: string; label: string; color: string; values: number[] };

/** The validated categorical order used by Mexo's charts (adjacent pairs stay apart). */
export const SERIES_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const CASH_COLOR = "#8d97a3";
export const OTHER_COLOR = "#c6ccd4";

const CLASS_COLOR_SLOTS: Record<string, number> = { "stock:gpw": 0, "stock:foreign": 1, etf: 2, crypto: 3, bond: 4, fund: 5, cfd: 6 };
const MAX_INSTRUMENTS = 7;

const sumColumns = (columns: number[][], length: number) =>
  Array.from({ length }, (_, index) => round(columns.reduce((total, values) => total + (values[index] ?? 0), 0), 2));

export const buildStructureSeries = (data: PortfolioStructureResponse, view: StructureView): StructureSeries[] => {
  const length = data.dates.length;

  if (view === "portfolios") {
    const colored = data.portfolios.slice(0, SERIES_COLORS.length).map((portfolio, index) => ({ id: portfolio.id, label: portfolio.name, color: SERIES_COLORS[index]!, values: portfolio.values }));
    const rest = data.portfolios.slice(SERIES_COLORS.length);
    return rest.length ? [...colored, { id: "other", label: `Pozostałe portfele (${rest.length})`, color: OTHER_COLOR, values: sumColumns(rest.map((item) => item.values), length) }] : colored;
  }

  const cash: StructureSeries = { id: "cash", label: "Gotówka", color: CASH_COLOR, values: sumColumns(data.portfolios.map((portfolio) => portfolio.cash), length) };
  const hasCash = cash.values.some((value) => Math.abs(value) >= 0.01);

  if (view === "classes") {
    const classes = new Map<string, { label: string; columns: number[][] }>();
    for (const instrument of data.instruments) {
      const current = classes.get(instrument.classId) ?? { label: instrument.classLabel, columns: [] };
      current.columns.push(instrument.values);
      classes.set(instrument.classId, current);
    }
    const series = [...classes.entries()]
      .map(([id, item]) => ({ id, label: item.label, color: SERIES_COLORS[CLASS_COLOR_SLOTS[id] ?? 7]!, values: sumColumns(item.columns, length) }))
      .sort((left, right) => (CLASS_COLOR_SLOTS[left.id] ?? 7) - (CLASS_COLOR_SLOTS[right.id] ?? 7) || left.label.localeCompare(right.label, "pl"));
    return hasCash ? [...series, cash] : series;
  }

  // Ranked over the whole history, so a shorter range keeps the same instruments and colours.
  const ranked = [...data.instruments].sort((left, right) => Math.max(...right.values) - Math.max(...left.values) || left.label.localeCompare(right.label, "pl"));
  const top = ranked.slice(0, MAX_INSTRUMENTS).map((instrument, index) => ({ id: instrument.key, label: instrument.label, color: SERIES_COLORS[index]!, values: instrument.values }));
  const rest = ranked.slice(MAX_INSTRUMENTS);
  return [
    ...top,
    ...(rest.length ? [{ id: "other", label: `Pozostałe walory (${rest.length})`, color: OTHER_COLOR, values: sumColumns(rest.map((item) => item.values), length) }] : []),
    ...(hasCash ? [cash] : []),
  ];
};

export type StructureRange = "6M" | "1Y" | "3Y" | "ALL";

/** Index of the first sample inside the range, counted back from the latest sample. */
export const rangeStartIndex = (dates: string[], range: StructureRange) => {
  if (range === "ALL" || dates.length === 0) return 0;
  const start = new Date(`${dates.at(-1)}T00:00:00.000Z`);
  start.setUTCMonth(start.getUTCMonth() - (range === "6M" ? 6 : range === "1Y" ? 12 : 36));
  const from = start.toISOString().slice(0, 10);
  const index = dates.findIndex((date) => date >= from);
  return index < 0 ? dates.length - 1 : index;
};

/** Shares of the positive values on one sample; a negative cash balance is not a slice. */
export const sharesAt = (series: StructureSeries[], index: number) => {
  const total = series.reduce((sum, item) => sum + Math.max(0, item.values[index] ?? 0), 0);
  return new Map(series.map((item) => [item.id, total > 0 ? (Math.max(0, item.values[index] ?? 0) / total) * 100 : 0]));
};

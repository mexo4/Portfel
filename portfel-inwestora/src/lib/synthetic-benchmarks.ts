import type { PortfolioBenchmarkDefinition } from "@/types/portfolio";

/**
 * Benchmarks that are not a listed instrument:
 * - inflation in Poland: the monthly HICP index for Poland published by Eurostat (2015 = 100);
 * - an overnight deposit: the POLONIA rate published by NBP, accrued daily (actual/365);
 * - a mix: several benchmarks with weights adding up to 100%, rebalanced every day.
 * Each becomes a price index in PLN, so the chart, the results and the risk metrics treat it like
 * any other benchmark.
 */

export const SYNTHETIC_BENCHMARK_PROVIDER = "mexo" as const;
export const INFLATION_PROVIDER_ID = "PL-HICP";
export const DEPOSIT_PROVIDER_ID = "PLN-POLONIA";
export const MIX_PROVIDER_ID = "MIX";
export const MAX_MIX_COMPONENTS = 5;

export const INFLATION_BENCHMARK: PortfolioBenchmarkDefinition = {
  id: "mexo:pl-hicp",
  name: "Inflacja w Polsce (HICP)",
  symbol: "INFLACJA",
  kind: "etf",
  marketCurrency: "PLN",
  provider: SYNTHETIC_BENCHMARK_PROVIDER,
  providerId: INFLATION_PROVIDER_ID,
};

export const DEPOSIT_BENCHMARK: PortfolioBenchmarkDefinition = {
  id: "mexo:pln-polonia",
  name: "Lokata overnight (POLONIA)",
  symbol: "POLONIA",
  kind: "etf",
  marketCurrency: "PLN",
  provider: SYNTHETIC_BENCHMARK_PROVIDER,
  providerId: DEPOSIT_PROVIDER_ID,
};

export const isSyntheticBenchmark = (benchmark: Pick<PortfolioBenchmarkDefinition, "provider">) =>
  benchmark.provider === SYNTHETIC_BENCHMARK_PROVIDER;

export const isMixBenchmark = (benchmark: PortfolioBenchmarkDefinition) =>
  isSyntheticBenchmark(benchmark) && benchmark.providerId === MIX_PROVIDER_ID && Array.isArray(benchmark.components);

const percentLabel = (weight: number) => `${Math.round(weight * 10) / 10}%`.replace(".", ",");

/** Validates the weights (whole mix 100%, each part above 0, no mix inside a mix) and builds the definition. */
export const createMixBenchmark = (
  components: Array<{ benchmark: PortfolioBenchmarkDefinition; weight: number }>,
  name?: string
): PortfolioBenchmarkDefinition => {
  const parts = components.filter((part) => part.weight > 0);
  if (parts.length < 2) throw new Error("Benchmark złożony potrzebuje co najmniej dwóch składników.");
  if (parts.length > MAX_MIX_COMPONENTS) throw new Error(`Benchmark złożony może mieć najwyżej ${MAX_MIX_COMPONENTS} składników.`);
  if (parts.some((part) => isMixBenchmark(part.benchmark))) throw new Error("Benchmark złożony nie może zawierać innego benchmarku złożonego.");
  if (new Set(parts.map((part) => part.benchmark.id)).size !== parts.length) throw new Error("Każdy składnik może wystąpić tylko raz.");
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  if (Math.abs(total - 100) > 0.01) throw new Error(`Wagi muszą sumować się do 100% (teraz ${percentLabel(total)}).`);

  const sorted = [...parts].sort((left, right) => right.weight - left.weight);
  // Names without the bracketed source ("Inflacja w Polsce (HICP)" → "Inflacja w Polsce") keep the label short.
  const shortName = (value: string) => value.replace(/\s*\([^)]*\)\s*$/, "").trim() || value;
  const label = name?.trim() || sorted.map((part) => `${percentLabel(part.weight)} ${shortName(part.benchmark.name)}`).join(" + ");
  const id = `mexo:mix:${sorted.map((part) => `${part.benchmark.id}=${part.weight}`).join(",")}`;

  return {
    id,
    name: label,
    symbol: sorted.map((part) => `${Math.round(part.weight)}/${part.benchmark.symbol}`).join(" "),
    kind: "etf",
    marketCurrency: "PLN",
    provider: SYNTHETIC_BENCHMARK_PROVIDER,
    providerId: MIX_PROVIDER_ID,
    components: sorted.map((part) => ({ benchmark: part.benchmark, weight: part.weight })),
  };
};

export type PricePoint = { date: string; close: number };

/**
 * Inflation as a price index for each date: the index of that date's month, or of the latest
 * published month (the index is published with a delay of a few weeks). Dates before the first
 * published month get no value.
 */
export const buildInflationIndexPoints = (monthly: Array<{ month: string; index: number }>, dates: string[]): PricePoint[] => {
  const sorted = monthly.filter((item) => /^\d{4}-\d{2}$/.test(item.month) && item.index > 0).sort((left, right) => left.month.localeCompare(right.month));
  if (sorted.length === 0) return [];
  const points: PricePoint[] = [];
  let cursor = -1;
  for (const date of [...dates].sort()) {
    const month = date.slice(0, 7);
    while (cursor + 1 < sorted.length && sorted[cursor + 1].month <= month) cursor += 1;
    if (cursor >= 0) points.push({ date, close: sorted[cursor].index });
  }
  return points;
};

/**
 * A deposit at the overnight rate, starting at 100 on the first date and accruing every calendar
 * day at the rate in force that day (actual/365, the last published rate carried forward).
 * `annualRate` is a fraction (0.0364 = 3.64%).
 */
export const buildDepositIndexPoints = (rates: Array<{ date: string; annualRate: number }>, dates: string[]): PricePoint[] => {
  const sortedRates = rates.filter((rate) => Number.isFinite(rate.annualRate)).sort((left, right) => left.date.localeCompare(right.date));
  const sortedDates = [...dates].sort();
  if (sortedRates.length === 0 || sortedDates.length === 0) return [];

  const points: PricePoint[] = [];
  let value = 100;
  let rateIndex = -1;
  let previous: string | null = null;
  const rateOn = (day: string) => {
    while (rateIndex + 1 < sortedRates.length && sortedRates[rateIndex + 1].date <= day) rateIndex += 1;
    return rateIndex >= 0 ? sortedRates[rateIndex].annualRate : null;
  };

  for (const date of sortedDates) {
    if (previous) {
      // Accrue each calendar day from the previous date to this one at that day's rate.
      const day = new Date(`${previous}T00:00:00Z`);
      const end = new Date(`${date}T00:00:00Z`);
      while (day < end) {
        const rate = rateOn(day.toISOString().slice(0, 10));
        if (rate !== null) value *= 1 + rate / 365;
        day.setUTCDate(day.getUTCDate() + 1);
      }
    } else if (rateOn(date) === null) {
      continue; // before the first published rate
    }
    previous = date;
    points.push({ date, close: Math.round(value * 1e8) / 1e8 });
  }
  return points;
};

/**
 * A mix of price series in PLN, rebalanced to its weights every day: the mix's daily return is the
 * weighted sum of the parts' daily returns. It starts on the first date on which every part has a
 * price.
 */
export const combineMixSeries = (parts: Array<{ weight: number; points: Array<{ date: string; pricePln: number }> }>, dates: string[]): PricePoint[] => {
  if (parts.length === 0) return [];
  const lookups = parts.map((part) => new Map(part.points.filter((point) => point.pricePln > 0).map((point) => [point.date, point.pricePln])));
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const points: PricePoint[] = [];
  let value = 100;
  let previousPrices: number[] | null = null;

  for (const date of [...dates].sort()) {
    const prices = lookups.map((lookup) => lookup.get(date));
    if (prices.some((price) => price === undefined)) continue;
    const current = prices as number[];
    if (previousPrices) {
      const mixReturn = parts.reduce((sum, part, index) => sum + (part.weight / totalWeight) * (current[index] / previousPrices![index] - 1), 0);
      value *= 1 + mixReturn;
    }
    previousPrices = current;
    points.push({ date, close: Math.round(value * 1e8) / 1e8 });
  }
  return points;
};

/** Eurostat's JSON-stat answer for one series as month → index. */
export const parseEurostatMonthlySeries = (payload: unknown): Array<{ month: string; index: number }> => {
  const data = payload as { value?: Record<string, number>; dimension?: { time?: { category?: { index?: Record<string, number> } } } };
  const timeIndex = data?.dimension?.time?.category?.index ?? {};
  const values = data?.value ?? {};
  return Object.entries(timeIndex)
    .map(([month, position]) => ({ month, index: Number(values[String(position)]) }))
    .filter((item) => /^\d{4}-\d{2}$/.test(item.month) && Number.isFinite(item.index) && item.index > 0)
    .sort((left, right) => left.month.localeCompare(right.month));
};

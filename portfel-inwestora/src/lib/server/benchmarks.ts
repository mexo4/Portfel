import { round } from "@/lib/utils";
import type {
  BenchmarkComparison,
  BenchmarkInvestment,
} from "@/types/portfolio";

type PricePoint = {
  date: string;
  close: number;
};

type CoinGeckoMarketChartResponse = {
  prices?: Array<[number, number]>;
};

type BenchmarkDefinition = {
  id: string;
  label: string;
  source: "stooq" | "coingecko";
  symbol: string;
};

type BenchmarkValueHistorySeries = {
  id: string;
  label: string;
  points: Array<{
    date: string;
    valuePln: number;
  }>;
};

const BENCHMARKS: BenchmarkDefinition[] = [
  {
    id: "sp500",
    label: "S&P 500",
    source: "stooq",
    symbol: "spy.us",
  },
  {
    id: "nasdaq100",
    label: "Nasdaq 100",
    source: "stooq",
    symbol: "qqq.us",
  },
  {
    id: "wig20",
    label: "WIG20",
    source: "stooq",
    symbol: "wig20",
  },
  {
    id: "bitcoin",
    label: "Bitcoin",
    source: "coingecko",
    symbol: "bitcoin",
  },
];

const formatDateOnly = (value: Date) => value.toISOString().slice(0, 10);

const parseStooqHistory = (csv: string): PricePoint[] =>
  csv
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(","))
    .map((parts) => ({
      date: parts[0] ?? "",
      close: Number(parts[4]),
    }))
    .filter((point) => point.date && Number.isFinite(point.close) && point.close > 0);

const dedupePoints = (points: PricePoint[]) => {
  const seen = new Set<string>();

  return points.filter((point) => {
    if (seen.has(point.date)) {
      return false;
    }

    seen.add(point.date);
    return true;
  });
};

const fetchStooqBenchmarkSeries = async (symbol: string): Promise<PricePoint[]> => {
  const today = formatDateOnly(new Date()).replaceAll("-", "");
  const response = await fetch(
    `https://stooq.pl/q/d/l/?s=${encodeURIComponent(symbol)}&d1=20000101&d2=${today}&i=d`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      next: {
        revalidate: 3600,
      },
    }
  );

  if (!response.ok) {
    return [];
  }

  return parseStooqHistory(await response.text());
};

const fetchCoinGeckoBenchmarkSeries = async (coinId: string): Promise<PricePoint[]> => {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
      coinId
    )}/market_chart?vs_currency=usd&days=max&interval=daily`,
    {
      headers: {
        Accept: "application/json",
      },
      next: {
        revalidate: 3600,
      },
    }
  );

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as CoinGeckoMarketChartResponse;

  return dedupePoints(
    (payload.prices ?? [])
      .map(([timestamp, price]) => ({
        date: formatDateOnly(new Date(timestamp)),
        close: round(price),
      }))
      .filter((point) => Number.isFinite(point.close) && point.close > 0)
  );
};

const fetchBenchmarkSeries = async (benchmark: BenchmarkDefinition) => {
  if (benchmark.source === "coingecko") {
    return fetchCoinGeckoBenchmarkSeries(benchmark.symbol);
  }

  return fetchStooqBenchmarkSeries(benchmark.symbol);
};

const findPointForDate = (series: PricePoint[], targetDate: string) => {
  if (series.length === 0) return null;

  let candidate = series[0];

  for (const point of series) {
    if (point.date > targetDate) {
      break;
    }

    candidate = point;
  }

  return candidate;
};

const buildBenchmarkValueSeriesEntry = (
  benchmark: BenchmarkDefinition,
  series: PricePoint[],
  dates: string[],
  investmentsByDate: Map<string, number>
): BenchmarkValueHistorySeries | null => {
  if (series.length === 0 || dates.length === 0) {
    return null;
  }

  let pointIndex = 0;
  let lastKnownClose: number | undefined;
  let cumulativeUnits = 0;

  const points = dates.map((date) => {
    while (pointIndex < series.length && series[pointIndex]!.date <= date) {
      lastKnownClose = series[pointIndex]!.close;
      pointIndex += 1;
    }

    const flowAmountPln = investmentsByDate.get(date) ?? 0;

    if (
      flowAmountPln !== 0 &&
      typeof lastKnownClose === "number" &&
      Number.isFinite(lastKnownClose) &&
      lastKnownClose > 0
    ) {
      cumulativeUnits += flowAmountPln / lastKnownClose;
    }

    return {
      date,
      valuePln:
        typeof lastKnownClose === "number" && Number.isFinite(lastKnownClose) && lastKnownClose > 0
          ? round(cumulativeUnits * lastKnownClose)
          : 0,
    };
  });

  return {
    id: benchmark.id,
    label: benchmark.label,
    points,
  };
};

const buildBenchmarkComparison = (
  benchmark: BenchmarkDefinition,
  series: PricePoint[],
  investments: BenchmarkInvestment[]
): BenchmarkComparison | null => {
  if (series.length === 0 || investments.length === 0) {
    return null;
  }

  const currentPoint = series[series.length - 1];
  if (!currentPoint || currentPoint.close <= 0) {
    return null;
  }

  const investedPln = round(
    investments.reduce((total, investment) => total + investment.amountPln, 0)
  );

  const currentValuePln = round(
    investments.reduce((total, investment) => {
      const startingPoint = findPointForDate(
        series,
        formatDateOnly(new Date(investment.date))
      );

      if (!startingPoint || startingPoint.close <= 0) {
        return total;
      }

      return total + investment.amountPln * (currentPoint.close / startingPoint.close);
    }, 0)
  );

  const profitLossPln = round(currentValuePln - investedPln);

  return {
    id: benchmark.id,
    label: benchmark.label,
    investedPln,
    currentValuePln,
    profitLossPln,
    returnPercent: investedPln > 0 ? round((profitLossPln / investedPln) * 100, 2) : 0,
  };
};

export const buildBenchmarkComparisons = async (
  investments: BenchmarkInvestment[]
): Promise<BenchmarkComparison[]> => {
  if (investments.length === 0) {
    return [];
  }

  const validInvestments = investments.filter(
    (investment) =>
      Number.isFinite(investment.amountPln) &&
      investment.amountPln !== 0 &&
      Boolean(investment.date)
  );

  if (validInvestments.length === 0) {
    return [];
  }

  const seriesEntries = await Promise.all(
    BENCHMARKS.map(async (benchmark) => ({
      benchmark,
      series: await fetchBenchmarkSeries(benchmark),
    }))
  );

  return seriesEntries
    .map(({ benchmark, series }) =>
      buildBenchmarkComparison(benchmark, series, validInvestments)
    )
    .filter((comparison): comparison is BenchmarkComparison => Boolean(comparison));
};

export const buildBenchmarkValueSeries = async ({
  dates,
  investmentsByDate,
}: {
  dates: string[];
  investmentsByDate: Map<string, number>;
}): Promise<BenchmarkValueHistorySeries[]> => {
  if (dates.length === 0 || investmentsByDate.size === 0) {
    return [];
  }

  const seriesEntries = await Promise.all(
    BENCHMARKS.map(async (benchmark) => ({
      benchmark,
      series: await fetchBenchmarkSeries(benchmark),
    }))
  );

  return seriesEntries
    .map(({ benchmark, series }) =>
      buildBenchmarkValueSeriesEntry(benchmark, series, dates, investmentsByDate)
    )
    .filter((entry): entry is BenchmarkValueHistorySeries => Boolean(entry));
};

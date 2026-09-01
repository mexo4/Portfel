import type {
  PortfolioBenchmarkHistorySeries,
  PortfolioHistoryPoint,
} from "@/types/portfolio";

export const RISK_ANNUALIZATION_DAYS = 365;
export const CAGR_DAYS_PER_YEAR = 365.2425;

export type RiskAnalyticsPeriod = "YTD" | "1Y" | "3Y" | "5Y" | "MAX";

export type RiskMetricUnavailableCode =
  | "NO_DATA"
  | "INSUFFICIENT_OBSERVATIONS"
  | "INSUFFICIENT_HISTORY"
  | "ZERO_VARIANCE"
  | "NO_DOWNSIDE"
  | "ZERO_DRAWDOWN"
  | "RISK_FREE_UNAVAILABLE"
  | "BENCHMARK_REQUIRED"
  | "AGGREGATE_BENCHMARK_UNAVAILABLE";

export type RiskMetric<T> = {
  value: T | null;
  unavailableCode?: RiskMetricUnavailableCode;
  observationCount: number;
  dateFrom: string | null;
  dateTo: string | null;
};

export type PortfolioDailyReturn = {
  startDate: string;
  endDate: string;
  returnDecimal: number;
  resultPln: number;
  previousValuePln: number;
  valuePln: number;
};

export type RiskFreeRatePoint = {
  date: string;
  annualRate: number;
};

export type CalendarReturn = {
  key: string;
  year: number;
  month: number | null;
  returnDecimal: number;
  isComplete: boolean;
  observationCount: number;
  dateFrom: string;
  dateTo: string;
};

export type DrawdownDetails = {
  maxDrawdown: number;
  peakDate: string;
  troughDate: string;
  recoveryDate: string | null;
  currentDrawdown: number;
};

export type UnderWaterPeriod = {
  startDate: string;
  endDate: string | null;
  days: number;
};

export type TimeUnderWaterDetails = {
  longestCompleted: UnderWaterPeriod | null;
  current: UnderWaterPeriod | null;
};

export type BenchmarkRiskMetrics = {
  benchmarkId: string | null;
  benchmarkLabel: string | null;
  beta: RiskMetric<number>;
  alpha: RiskMetric<number>;
  informationRatio: RiskMetric<number>;
  trackingError: RiskMetric<number>;
  monthlyReturns: CalendarReturn[];
  yearlyReturns: CalendarReturn[];
};

export type PortfolioRiskAnalytics = {
  period: RiskAnalyticsPeriod;
  points: PortfolioHistoryPoint[];
  dailyReturns: PortfolioDailyReturn[];
  totalReturn: RiskMetric<number>;
  annualizedReturn: RiskMetric<number>;
  bestDay: RiskMetric<PortfolioDailyReturn>;
  worstDay: RiskMetric<PortfolioDailyReturn>;
  bestMonth: RiskMetric<CalendarReturn>;
  worstMonth: RiskMetric<CalendarReturn>;
  bestYear: RiskMetric<CalendarReturn>;
  worstYear: RiskMetric<CalendarReturn>;
  monthlyReturns: CalendarReturn[];
  yearlyReturns: CalendarReturn[];
  volatility: RiskMetric<number>;
  drawdown: RiskMetric<DrawdownDetails>;
  timeUnderWater: RiskMetric<TimeUnderWaterDetails>;
  sharpe: RiskMetric<number>;
  sortino: RiskMetric<number>;
  calmar: RiskMetric<number>;
  benchmark: BenchmarkRiskMetrics;
};

const DAY_MS = 86_400_000;
const FLOATING_POINT_NOISE = Number.EPSILON * 32;

const metricBounds = <T>(
  returns: PortfolioDailyReturn[],
  value: T | null,
  unavailableCode?: RiskMetricUnavailableCode,
  observationCount = returns.length
): RiskMetric<T> => ({
  value,
  ...(unavailableCode ? { unavailableCode } : {}),
  observationCount,
  dateFrom: returns[0]?.startDate ?? null,
  dateTo: returns.at(-1)?.endDate ?? null,
});

const unavailable = <T>(
  returns: PortfolioDailyReturn[],
  unavailableCode: RiskMetricUnavailableCode,
  observationCount = returns.length
) => metricBounds<T>(returns, null, unavailableCode, observationCount);

const mean = (values: number[]) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const sampleVariance = (values: number[]) => {
  if (values.length < 2) return null;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
};

const sampleStandardDeviation = (values: number[]) => {
  const variance = sampleVariance(values);
  return variance === null ? null : Math.sqrt(variance);
};

const hasMeaningfulDeviation = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && Math.abs(value) > FLOATING_POINT_NOISE;

const covariance = (left: number[], right: number[]) => {
  if (left.length < 2 || left.length !== right.length) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  return left.reduce(
    (sum, value, index) => sum + (value - leftMean) * (right[index]! - rightMean),
    0
  ) / (left.length - 1);
};

const compound = (values: number[]) =>
  values.reduce((wealth, value) => wealth * (1 + value), 1) - 1;

const parseUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const calendarDaysBetween = (from: string, to: string) =>
  Math.max(0, Math.round((parseUtcDate(to).getTime() - parseUtcDate(from).getTime()) / DAY_MS));

const monthEndDate = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

const periodStartDate = (period: RiskAnalyticsPeriod, endDate: string) => {
  if (period === "MAX") return null;
  const end = parseUtcDate(endDate);
  if (period === "YTD") return `${end.getUTCFullYear()}-01-01`;
  const years = period === "1Y" ? 1 : period === "3Y" ? 3 : 5;
  end.setUTCFullYear(end.getUTCFullYear() - years);
  return end.toISOString().slice(0, 10);
};

const sortUniqueHistoryPoints = (points: PortfolioHistoryPoint[]) =>
  Array.from(
    new Map(
      points
        .filter((point) => point.date && Number.isFinite(point.portfolioValuePln) && Number.isFinite(point.profitLossPln))
        .sort((left, right) => left.date.localeCompare(right.date))
        .map((point) => [point.date, point] as const)
    ).values()
  );

/** Keeps the point immediately preceding the selected range as its return baseline. */
export const selectRiskPeriodPoints = (
  points: PortfolioHistoryPoint[],
  period: RiskAnalyticsPeriod
) => {
  const sorted = sortUniqueHistoryPoints(points);
  const endDate = sorted.at(-1)?.date;
  if (!endDate || period === "MAX") return sorted;
  const startDate = periodStartDate(period, endDate)!;
  const firstInRange = sorted.findIndex((point) => point.date >= startDate);
  if (firstInRange <= 0) return firstInRange === -1 ? [] : sorted;
  return sorted.slice(firstInRange - 1);
};

export const deriveDailyCashFlowNeutralReturns = (
  points: PortfolioHistoryPoint[]
): PortfolioDailyReturn[] => {
  const sorted = sortUniqueHistoryPoints(points);
  return sorted.slice(1).flatMap((point, index) => {
    const previous = sorted[index]!;
    if (!(previous.portfolioValuePln > 0)) return [];
    const resultPln = point.profitLossPln - previous.profitLossPln;
    const returnDecimal = resultPln / previous.portfolioValuePln;
    if (!Number.isFinite(returnDecimal)) return [];
    return [{
      startDate: previous.date,
      endDate: point.date,
      returnDecimal,
      resultPln,
      previousValuePln: previous.portfolioValuePln,
      valuePln: point.portfolioValuePln,
    }];
  });
};

export const getAvailableRiskPeriods = (points: PortfolioHistoryPoint[]) =>
  (["YTD", "1Y", "3Y", "5Y", "MAX"] as RiskAnalyticsPeriod[]).filter(
    (period) => deriveDailyCashFlowNeutralReturns(selectRiskPeriodPoints(points, period)).length > 0
  );

export const buildCalendarReturns = (
  returns: PortfolioDailyReturn[],
  granularity: "month" | "year"
): CalendarReturn[] => {
  const grouped = new Map<string, PortfolioDailyReturn[]>();
  for (const dailyReturn of returns) {
    const key = granularity === "month"
      ? dailyReturn.endDate.slice(0, 7)
      : dailyReturn.endDate.slice(0, 4);
    grouped.set(key, [...(grouped.get(key) ?? []), dailyReturn]);
  }
  return Array.from(grouped.entries()).map(([key, bucket]) => {
    const first = bucket[0]!;
    const last = bucket.at(-1)!;
    const year = Number(key.slice(0, 4));
    const month = granularity === "month" ? Number(key.slice(5, 7)) : null;
    const expectedStart = granularity === "month" ? `${key}-01` : `${key}-01-01`;
    const expectedEnd = granularity === "month"
      ? monthEndDate(year, month!)
      : `${key}-12-31`;
    return {
      key,
      year,
      month,
      returnDecimal: compound(bucket.map((item) => item.returnDecimal)),
      isComplete: first.startDate <= expectedStart && last.endDate >= expectedEnd,
      observationCount: bucket.length,
      dateFrom: first.startDate,
      dateTo: last.endDate,
    };
  });
};

const rankCalendarReturn = (
  returns: PortfolioDailyReturn[],
  buckets: CalendarReturn[],
  direction: "best" | "worst",
  minimumComplete: number
) => {
  const complete = buckets.filter((bucket) => bucket.isComplete);
  if (complete.length < minimumComplete) {
    return unavailable<CalendarReturn>(returns, "INSUFFICIENT_OBSERVATIONS", complete.length);
  }
  const sorted = [...complete].sort((left, right) =>
    direction === "best"
      ? right.returnDecimal - left.returnDecimal
      : left.returnDecimal - right.returnDecimal
  );
  return metricBounds(returns, sorted[0]!, undefined, complete.length);
};

export const calculateMaxDrawdown = (
  returns: PortfolioDailyReturn[]
): RiskMetric<DrawdownDetails> => {
  if (!returns.length) return unavailable(returns, "NO_DATA");
  let wealth = 1;
  let peakWealth = 1;
  let peakDate = returns[0]!.startDate;
  let maxDrawdown = 0;
  let maxDrawdownPeakDate = peakDate;
  let troughDate = returns[0]!.endDate;
  const wealthByDate: Array<{ date: string; wealth: number }> = [
    { date: peakDate, wealth },
  ];
  for (const dailyReturn of returns) {
    wealth *= 1 + dailyReturn.returnDecimal;
    wealthByDate.push({ date: dailyReturn.endDate, wealth });
    if (wealth >= peakWealth) {
      peakWealth = wealth;
      peakDate = dailyReturn.endDate;
    }
    const drawdown = peakWealth === 0 ? 0 : wealth / peakWealth - 1;
    if (drawdown < maxDrawdown) {
      maxDrawdown = drawdown;
      maxDrawdownPeakDate = peakDate;
      troughDate = dailyReturn.endDate;
    }
  }
  const troughIndex = wealthByDate.findIndex((point) => point.date === troughDate);
  const peakValue = wealthByDate.find((point) => point.date === maxDrawdownPeakDate)?.wealth ?? 1;
  const recoveryDate = maxDrawdown < 0
    ? wealthByDate.slice(troughIndex + 1).find((point) => point.wealth >= peakValue)?.date ?? null
    : returns[0]!.startDate;
  const currentPeak = wealthByDate.reduce((maximum, point) => Math.max(maximum, point.wealth), 1);
  const currentDrawdown = currentPeak === 0 ? 0 : wealth / currentPeak - 1;
  return metricBounds(returns, {
    maxDrawdown,
    peakDate: maxDrawdownPeakDate,
    troughDate,
    recoveryDate,
    currentDrawdown,
  });
};

export const calculateTimeUnderWater = (
  returns: PortfolioDailyReturn[]
): RiskMetric<TimeUnderWaterDetails> => {
  if (!returns.length) return unavailable(returns, "NO_DATA");
  let wealth = 1;
  let peakWealth = 1;
  let peakDate = returns[0]!.startDate;
  let activeStart: string | null = null;
  const completed: UnderWaterPeriod[] = [];
  for (const dailyReturn of returns) {
    wealth *= 1 + dailyReturn.returnDecimal;
    if (wealth >= peakWealth) {
      if (activeStart) {
        completed.push({
          startDate: activeStart,
          endDate: dailyReturn.endDate,
          days: calendarDaysBetween(activeStart, dailyReturn.endDate),
        });
      }
      peakWealth = wealth;
      peakDate = dailyReturn.endDate;
      activeStart = null;
    } else if (!activeStart) {
      activeStart = peakDate;
    }
  }
  const longestCompleted = completed.sort((left, right) => right.days - left.days)[0] ?? null;
  const endDate = returns.at(-1)!.endDate;
  const current = activeStart
    ? { startDate: activeStart, endDate: null, days: calendarDaysBetween(activeStart, endDate) }
    : null;
  return metricBounds(returns, { longestCompleted, current });
};

const buildRiskFreeLookup = (rates: RiskFreeRatePoint[] | null) => {
  if (!rates?.length) return null;
  const sorted = [...rates]
    .filter((rate) => rate.date && Number.isFinite(rate.annualRate))
    .sort((left, right) => left.date.localeCompare(right.date));
  return (date: string) => {
    let latest: RiskFreeRatePoint | null = null;
    for (const rate of sorted) {
      if (rate.date > date) break;
      latest = rate;
    }
    return latest ? latest.annualRate / RISK_ANNUALIZATION_DAYS : null;
  };
};

const calculateBenchmarkRiskMetrics = ({
  returns,
  benchmark,
  riskFreeRates,
  isAggregate,
}: {
  returns: PortfolioDailyReturn[];
  benchmark?: PortfolioBenchmarkHistorySeries;
  riskFreeRates: RiskFreeRatePoint[] | null;
  isAggregate: boolean;
}): BenchmarkRiskMetrics => {
  const missingCode = isAggregate
    ? "AGGREGATE_BENCHMARK_UNAVAILABLE" as const
    : "BENCHMARK_REQUIRED" as const;
  const base = {
    benchmarkId: benchmark?.id ?? null,
    benchmarkLabel: benchmark?.label ?? null,
  };
  if (isAggregate || !benchmark) {
    return {
      ...base,
      beta: unavailable(returns, missingCode, 0),
      alpha: unavailable(returns, missingCode, 0),
      informationRatio: unavailable(returns, missingCode, 0),
      trackingError: unavailable(returns, missingCode, 0),
      monthlyReturns: [],
      yearlyReturns: [],
    };
  }
  const benchmarkReturns = new Map<string, number>();
  const points = [...benchmark.points].sort((left, right) => left.date.localeCompare(right.date));
  const periodStart = returns[0]?.startDate;
  const periodEnd = returns.at(-1)?.endDate;
  const benchmarkDailyReturns: PortfolioDailyReturn[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    if (!(previous.pricePln > 0) || !Number.isFinite(point.pricePln)) continue;
    const returnDecimal = point.pricePln / previous.pricePln - 1;
    benchmarkReturns.set(`${previous.date}|${point.date}`, returnDecimal);
    if ((!periodStart || previous.date >= periodStart) && (!periodEnd || point.date <= periodEnd)) {
      benchmarkDailyReturns.push({
        startDate: previous.date,
        endDate: point.date,
        returnDecimal,
        resultPln: 0,
        previousValuePln: previous.pricePln,
        valuePln: point.pricePln,
      });
    }
  }
  const aligned = returns.flatMap((portfolioReturn) => {
    const benchmarkReturn = benchmarkReturns.get(`${portfolioReturn.startDate}|${portfolioReturn.endDate}`);
    return benchmarkReturn === undefined ? [] : [{ portfolioReturn, benchmarkReturn }];
  });
  if (aligned.length < 60) {
    return {
      ...base,
      beta: unavailable(returns, "INSUFFICIENT_OBSERVATIONS", aligned.length),
      alpha: unavailable(returns, "INSUFFICIENT_OBSERVATIONS", aligned.length),
      informationRatio: unavailable(returns, "INSUFFICIENT_OBSERVATIONS", aligned.length),
      trackingError: unavailable(returns, "INSUFFICIENT_OBSERVATIONS", aligned.length),
      monthlyReturns: buildCalendarReturns(benchmarkDailyReturns, "month"),
      yearlyReturns: buildCalendarReturns(benchmarkDailyReturns, "year"),
    };
  }
  const portfolioValues = aligned.map((item) => item.portfolioReturn.returnDecimal);
  const benchmarkValues = aligned.map((item) => item.benchmarkReturn);
  const benchmarkVariance = sampleVariance(benchmarkValues);
  const benchmarkDeviation = sampleStandardDeviation(benchmarkValues);
  const betaValue = benchmarkVariance !== null && hasMeaningfulDeviation(benchmarkDeviation)
    ? covariance(portfolioValues, benchmarkValues)! / benchmarkVariance
    : null;
  const activeReturns = aligned.map((item) => item.portfolioReturn.returnDecimal - item.benchmarkReturn);
  const activeDeviation = sampleStandardDeviation(activeReturns);
  const trackingError = hasMeaningfulDeviation(activeDeviation)
    ? activeDeviation * Math.sqrt(RISK_ANNUALIZATION_DAYS)
    : null;
  const informationRatio = hasMeaningfulDeviation(activeDeviation)
    ? mean(activeReturns) / activeDeviation * Math.sqrt(RISK_ANNUALIZATION_DAYS)
    : null;
  const zeroVarianceCode = "ZERO_VARIANCE" as const;
  const lookupRiskFree = buildRiskFreeLookup(riskFreeRates);
  const alignedWithRiskFree = lookupRiskFree
    ? aligned.flatMap((item) => {
        const riskFree = lookupRiskFree(item.portfolioReturn.endDate);
        return riskFree === null ? [] : [{ ...item, riskFree }];
      })
    : [];
  const alphaValue = betaValue !== null && alignedWithRiskFree.length === aligned.length
    ? (mean(alignedWithRiskFree.map((item) => item.portfolioReturn.returnDecimal - item.riskFree)) -
      betaValue * mean(alignedWithRiskFree.map((item) => item.benchmarkReturn - item.riskFree))) *
      RISK_ANNUALIZATION_DAYS
    : null;
  return {
    ...base,
    beta: betaValue === null
      ? unavailable(returns, zeroVarianceCode, aligned.length)
      : metricBounds(returns, betaValue, undefined, aligned.length),
    alpha: alphaValue === null
      ? unavailable(returns, riskFreeRates?.length ? zeroVarianceCode : "RISK_FREE_UNAVAILABLE", alignedWithRiskFree.length)
      : metricBounds(returns, alphaValue, undefined, aligned.length),
    informationRatio: informationRatio === null
      ? unavailable(returns, zeroVarianceCode, aligned.length)
      : metricBounds(returns, informationRatio, undefined, aligned.length),
    trackingError: trackingError === null
      ? unavailable(returns, zeroVarianceCode, aligned.length)
      : metricBounds(returns, trackingError, undefined, aligned.length),
    monthlyReturns: buildCalendarReturns(benchmarkDailyReturns, "month"),
    yearlyReturns: buildCalendarReturns(benchmarkDailyReturns, "year"),
  };
};

export const calculatePortfolioRiskAnalytics = ({
  points,
  period,
  benchmark,
  riskFreeRates,
  isAggregate = false,
}: {
  points: PortfolioHistoryPoint[];
  period: RiskAnalyticsPeriod;
  benchmark?: PortfolioBenchmarkHistorySeries;
  riskFreeRates: RiskFreeRatePoint[] | null;
  isAggregate?: boolean;
}): PortfolioRiskAnalytics => {
  const selectedPoints = selectRiskPeriodPoints(points, period);
  const dailyReturns = deriveDailyCashFlowNeutralReturns(selectedPoints);
  const values = dailyReturns.map((item) => item.returnDecimal);
  const totalReturnValue = values.length ? compound(values) : null;
  const elapsedDays = dailyReturns.length
    ? calendarDaysBetween(dailyReturns[0]!.startDate, dailyReturns.at(-1)!.endDate)
    : 0;
  const annualizedReturnValue = totalReturnValue !== null && elapsedDays > 0 && 1 + totalReturnValue > 0
    ? (1 + totalReturnValue) ** (CAGR_DAYS_PER_YEAR / elapsedDays) - 1
    : null;
  const monthlyReturns = buildCalendarReturns(dailyReturns, "month");
  const yearlyReturns = buildCalendarReturns(dailyReturns, "year");
  const deviation = values.length >= 30 ? sampleStandardDeviation(values) : null;
  const volatility = values.length < 30
    ? unavailable<number>(dailyReturns, "INSUFFICIENT_OBSERVATIONS")
    : hasMeaningfulDeviation(deviation)
      ? metricBounds(dailyReturns, deviation * Math.sqrt(RISK_ANNUALIZATION_DAYS))
      : unavailable<number>(dailyReturns, "ZERO_VARIANCE");
  const lookupRiskFree = buildRiskFreeLookup(riskFreeRates);
  const excess = lookupRiskFree
    ? dailyReturns.flatMap((item) => {
        const riskFree = lookupRiskFree(item.endDate);
        return riskFree === null ? [] : [item.returnDecimal - riskFree];
      })
    : [];
  const riskFreeComplete = excess.length === dailyReturns.length;
  const sharpe = dailyReturns.length < 30
    ? unavailable<number>(dailyReturns, "INSUFFICIENT_OBSERVATIONS")
    : !riskFreeComplete
      ? unavailable<number>(dailyReturns, "RISK_FREE_UNAVAILABLE", excess.length)
      : hasMeaningfulDeviation(deviation)
        ? metricBounds(dailyReturns, mean(excess) / deviation * Math.sqrt(RISK_ANNUALIZATION_DAYS))
        : unavailable<number>(dailyReturns, "ZERO_VARIANCE");
  const downside = excess.map((value) => Math.min(value, 0));
  const downsideDeviation = downside.length
    ? Math.sqrt(mean(downside.map((value) => value ** 2)))
    : null;
  const sortino = dailyReturns.length < 30
    ? unavailable<number>(dailyReturns, "INSUFFICIENT_OBSERVATIONS")
    : !riskFreeComplete
      ? unavailable<number>(dailyReturns, "RISK_FREE_UNAVAILABLE", excess.length)
      : hasMeaningfulDeviation(downsideDeviation)
        ? metricBounds(dailyReturns, mean(excess) / downsideDeviation * Math.sqrt(RISK_ANNUALIZATION_DAYS))
        : unavailable<number>(dailyReturns, "NO_DOWNSIDE");
  const drawdown = calculateMaxDrawdown(dailyReturns);
  const maxDrawdown = drawdown.value?.maxDrawdown ?? 0;
  const calmar = elapsedDays < 365
    ? unavailable<number>(dailyReturns, "INSUFFICIENT_HISTORY")
    : maxDrawdown < 0 && annualizedReturnValue !== null
      ? metricBounds(dailyReturns, annualizedReturnValue / Math.abs(maxDrawdown))
      : unavailable<number>(dailyReturns, "ZERO_DRAWDOWN");
  const sortedBest = [...dailyReturns].sort((left, right) => right.returnDecimal - left.returnDecimal);
  const sortedWorst = [...dailyReturns].sort((left, right) => left.returnDecimal - right.returnDecimal);
  return {
    period,
    points: selectedPoints,
    dailyReturns,
    totalReturn: totalReturnValue === null
      ? unavailable(dailyReturns, "NO_DATA")
      : metricBounds(dailyReturns, totalReturnValue),
    annualizedReturn: annualizedReturnValue === null
      ? unavailable(dailyReturns, "INSUFFICIENT_HISTORY")
      : metricBounds(dailyReturns, annualizedReturnValue),
    bestDay: sortedBest[0]
      ? metricBounds(dailyReturns, sortedBest[0])
      : unavailable(dailyReturns, "NO_DATA"),
    worstDay: sortedWorst[0]
      ? metricBounds(dailyReturns, sortedWorst[0])
      : unavailable(dailyReturns, "NO_DATA"),
    bestMonth: rankCalendarReturn(dailyReturns, monthlyReturns, "best", 2),
    worstMonth: rankCalendarReturn(dailyReturns, monthlyReturns, "worst", 2),
    bestYear: rankCalendarReturn(dailyReturns, yearlyReturns, "best", 2),
    worstYear: rankCalendarReturn(dailyReturns, yearlyReturns, "worst", 2),
    monthlyReturns,
    yearlyReturns,
    volatility,
    drawdown,
    timeUnderWater: calculateTimeUnderWater(dailyReturns),
    sharpe,
    sortino,
    calmar,
    benchmark: calculateBenchmarkRiskMetrics({
      returns: dailyReturns,
      benchmark,
      riskFreeRates,
      isAggregate,
    }),
  };
};

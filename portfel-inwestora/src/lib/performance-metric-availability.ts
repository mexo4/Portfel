import type { PerformanceMetricId } from "@/lib/performance-preferences";

type MaybeValue = { value: unknown };

export type PerformanceMetricAvailabilityInput = {
  hasLatestPoint: boolean;
  hasLatestValueChange: boolean;
  hasFiniteResult: boolean;
  hasReliableCashFlowCurrency: boolean;
  xirrValue: number | null;
  cagrValue: number | null;
  analytics: {
    bestDay: MaybeValue;
    worstDay: MaybeValue;
    bestDailyResult: MaybeValue;
    bestMonth: MaybeValue;
    worstMonth: MaybeValue;
    bestYear: MaybeValue;
    worstYear: MaybeValue;
    volatility: MaybeValue;
    drawdown: MaybeValue;
    timeUnderWater: MaybeValue;
    sharpe: MaybeValue;
    sortino: MaybeValue;
    calmar: MaybeValue;
    benchmark: {
      beta: MaybeValue;
      alpha: MaybeValue;
      informationRatio: MaybeValue;
      trackingError: MaybeValue;
    };
  };
};

const hasValue = (metric: MaybeValue) => metric.value !== null && metric.value !== undefined;

/**
 * Which performance metrics have something to show. A metric that cannot be
 * calculated (no history, an ambiguous XIRR, no benchmark ...) is not drawn at
 * all: a card that only says "Niedostępne" is noise, and it leaves a hole in
 * the grid. Ids that are not listed here are always available.
 */
export const getPerformanceMetricAvailability = (
  input: PerformanceMetricAvailabilityInput
): Partial<Record<PerformanceMetricId, boolean>> => {
  const { analytics } = input;

  return {
    "portfolio-value": input.hasLatestPoint,
    "total-result": input.hasFiniteResult,
    "net-external-capital": input.hasReliableCashFlowCurrency,
    xirr: input.xirrValue !== null,
    cagr: input.cagrValue !== null,
    "latest-value-change": input.hasLatestValueChange,
    "best-day": hasValue(analytics.bestDay),
    "worst-day": hasValue(analytics.worstDay),
    "best-daily-result": hasValue(analytics.bestDailyResult),
    "best-month": hasValue(analytics.bestMonth),
    "worst-month": hasValue(analytics.worstMonth),
    "best-year": hasValue(analytics.bestYear),
    "worst-year": hasValue(analytics.worstYear),
    volatility: hasValue(analytics.volatility),
    "max-drawdown": hasValue(analytics.drawdown),
    "time-under-water": hasValue(analytics.timeUnderWater),
    sharpe: hasValue(analytics.sharpe),
    sortino: hasValue(analytics.sortino),
    calmar: hasValue(analytics.calmar),
    beta: hasValue(analytics.benchmark.beta),
    alpha: hasValue(analytics.benchmark.alpha),
    "information-ratio": hasValue(analytics.benchmark.informationRatio),
    "tracking-error": hasValue(analytics.benchmark.trackingError),
  };
};

/** A metric is drawn when the user chose it and it can be calculated. */
export const isPerformanceMetricShown = (
  id: PerformanceMetricId,
  visibleMetrics: readonly PerformanceMetricId[],
  availability: Partial<Record<PerformanceMetricId, boolean>>
) => visibleMetrics.includes(id) && availability[id] !== false;

export const PERFORMANCE_METRIC_IDS = [
  "total-result",
  "latest-value-change",
  "best-day",
  "best-daily-result",
  "period-return",
  "worst-day",
  "best-month",
  "worst-month",
  "best-year",
  "worst-year",
  "volatility",
  "max-drawdown",
  "time-under-water",
  "sharpe",
  "sortino",
  "calmar",
  "beta",
  "alpha",
  "information-ratio",
  "tracking-error",
  "calendar-results",
] as const;

export type PerformanceMetricId = (typeof PERFORMANCE_METRIC_IDS)[number];

export const DEFAULT_PERFORMANCE_METRICS: PerformanceMetricId[] = [...PERFORMANCE_METRIC_IDS];

export const PERFORMANCE_METRIC_LABELS: Record<PerformanceMetricId, string> = {
  "total-result": "Wynik łączny",
  "latest-value-change": "Ostatnia zmiana wartości",
  "best-day": "Najlepszy dzień",
  "best-daily-result": "Najlepszy wynik dzienny",
  "period-return": "Wynik wybranego okresu",
  "worst-day": "Najgorszy dzień",
  "best-month": "Najlepszy miesiąc",
  "worst-month": "Najgorszy miesiąc",
  "best-year": "Najlepszy rok",
  "worst-year": "Najgorszy rok",
  "volatility": "Zmienność",
  "max-drawdown": "Max Drawdown",
  "time-under-water": "Time Under Water",
  "sharpe": "Sharpe",
  "sortino": "Sortino",
  "calmar": "Calmar",
  "beta": "Beta",
  "alpha": "Alpha Jensena",
  "information-ratio": "Information Ratio",
  "tracking-error": "Tracking Error",
  "calendar-results": "Wyniki kalendarzowe",
};

export const normalizePerformanceMetricIds = (value: unknown): PerformanceMetricId[] => {
  if (!Array.isArray(value)) return [...DEFAULT_PERFORMANCE_METRICS];
  const normalized = value.filter(
    (item, index): item is PerformanceMetricId =>
      typeof item === "string" &&
      PERFORMANCE_METRIC_IDS.includes(item as PerformanceMetricId) &&
      value.indexOf(item) === index
  );
  return normalized.length ? normalized : [...DEFAULT_PERFORMANCE_METRICS];
};

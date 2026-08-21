export const PERFORMANCE_METRIC_IDS = [
  "total-result",
  "latest-value-change",
  "best-day",
  "best-daily-result",
] as const;

export type PerformanceMetricId = (typeof PERFORMANCE_METRIC_IDS)[number];

export const DEFAULT_PERFORMANCE_METRICS: PerformanceMetricId[] = [...PERFORMANCE_METRIC_IDS];

export const PERFORMANCE_METRIC_LABELS: Record<PerformanceMetricId, string> = {
  "total-result": "Wynik łączny",
  "latest-value-change": "Ostatnia zmiana wartości",
  "best-day": "Najlepszy dzień",
  "best-daily-result": "Najlepszy wynik dzienny",
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

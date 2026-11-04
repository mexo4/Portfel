import { round } from "@/lib/utils";

export type ChartRangePreset =
  | "1D"
  | "5D"
  | "1W"
  | "1M"
  | "3M"
  | "6M"
  | "YTD"
  | "1Y"
  | "3Y"
  | "5Y"
  | "MAX";

export type ChartViewport = {
  startIndex: number;
  endIndex: number;
};

type DatedPoint = {
  date: string;
};

export type PortfolioValueChartPoint = {
  date: string;
  portfolioValuePln: number;
  netInvestedPln: number;
  profitLossPln: number;
  timeWeightedReturnPercent: number | null;
};

export type PortfolioValueRangeSummary = {
  valueChangePln: number | null;
  investmentResultPln: number | null;
  timeWeightedReturnPercent: number | null;
  netInvestedChangePln: number | null;
};

/** Summarize the displayed window from the existing history snapshots. */
export const getPortfolioValueRangeSummary = (
  points: PortfolioValueChartPoint[],
): PortfolioValueRangeSummary | null => {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  if (points.length < 2) {
    return {
      valueChangePln: null,
      investmentResultPln: null,
      timeWeightedReturnPercent: null,
      netInvestedChangePln: null,
    };
  }

  const startFactor = first.timeWeightedReturnPercent === null
    ? null
    : 1 + first.timeWeightedReturnPercent / 100;
  const endFactor = last.timeWeightedReturnPercent === null
    ? null
    : 1 + last.timeWeightedReturnPercent / 100;

  return {
    valueChangePln: round(last.portfolioValuePln - first.portfolioValuePln),
    investmentResultPln: round(last.profitLossPln - first.profitLossPln),
    timeWeightedReturnPercent:
      startFactor !== null && endFactor !== null && startFactor > 0 && endFactor >= 0
        ? round(((endFactor / startFactor) - 1) * 100, 2)
        : null,
    netInvestedChangePln: round(last.netInvestedPln - first.netInvestedPln),
  };
};

export const getPaddedChartNumberDomain = (
  values: Array<number | null | undefined>,
) => {
  const numericValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );

  if (numericValues.length === 0) return undefined;

  const minValue = Math.min(...numericValues);
  const maxValue = Math.max(...numericValues);
  const range = maxValue - minValue;
  const maxAbsValue = Math.max(Math.abs(minValue), Math.abs(maxValue), 1);
  const padding =
    range > 0 ? Math.max(range * 0.14, maxAbsValue * 0.003) : Math.max(maxAbsValue * 0.02, 1);
  const lowerBound = minValue >= 0 ? Math.max(0, minValue - padding) : minValue - padding;
  const upperBound = maxValue + padding;

  return [round(lowerBound, 2), round(upperBound, 2)] satisfies [number, number];
};

export const excludeWeekendZeroPoints = <T extends DatedPoint>(
  points: T[],
  isZeroResult: (point: T) => boolean,
) => points.filter((point) => {
  const day = getPointDate(point.date).getUTCDay();
  return !((day === 0 || day === 6) && isZeroResult(point));
});

export const CHART_RANGE_PRESETS: ChartRangePreset[] = [
  "1D",
  "5D",
  "1W",
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "3Y",
  "5Y",
  "MAX",
];

const LEGACY_RANGE_PRESETS: Record<string, ChartRangePreset> = {
  "1Q": "3M",
  ALL: "MAX",
};

const getPointDate = (value: string) => new Date(`${value}T12:00:00.000Z`);

const shiftDate = (date: string, days: number) => {
  const nextDate = getPointDate(date);

  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate.toISOString().slice(0, 10);
};

export const normalizeChartRangePreset = (value: string | null): ChartRangePreset | null => {
  if (!value) {
    return null;
  }

  if (CHART_RANGE_PRESETS.includes(value as ChartRangePreset)) {
    return value as ChartRangePreset;
  }

  return LEGACY_RANGE_PRESETS[value] ?? null;
};

export const getChartRangeStartDate = (preset: ChartRangePreset, lastDate: string) => {
  const nextDate = getPointDate(lastDate);

  switch (preset) {
    case "MAX":
      return null;
    case "1D":
      return shiftDate(lastDate, -1);
    case "5D":
      return shiftDate(lastDate, -5);
    case "1W":
      return shiftDate(lastDate, -7);
    case "1M":
      nextDate.setUTCMonth(nextDate.getUTCMonth() - 1);
      break;
    case "3M":
      nextDate.setUTCMonth(nextDate.getUTCMonth() - 3);
      break;
    case "6M":
      nextDate.setUTCMonth(nextDate.getUTCMonth() - 6);
      break;
    case "YTD":
      nextDate.setUTCMonth(0);
      nextDate.setUTCDate(1);
      break;
    case "1Y":
      nextDate.setUTCFullYear(nextDate.getUTCFullYear() - 1);
      break;
    case "3Y":
      nextDate.setUTCFullYear(nextDate.getUTCFullYear() - 3);
      break;
    case "5Y":
      nextDate.setUTCFullYear(nextDate.getUTCFullYear() - 5);
      break;
  }

  nextDate.setUTCHours(12, 0, 0, 0);
  return nextDate.toISOString().slice(0, 10);
};

export const filterChartPointsByRange = <T extends DatedPoint>(
  points: T[],
  preset: ChartRangePreset
) => {
  const lastPoint = points.at(-1);

  if (!lastPoint || preset === "MAX") {
    return points;
  }

  const startDate = getChartRangeStartDate(preset, lastPoint.date);

  return startDate ? points.filter((point) => point.date >= startDate) : points;
};

export const getSupportedChartRangePresets = <T extends DatedPoint>(points: T[]) => {
  const firstPoint = points[0];
  const lastPoint = points.at(-1);

  if (!firstPoint || !lastPoint) {
    return [] as ChartRangePreset[];
  }

  return CHART_RANGE_PRESETS.filter((preset) => {
    if (preset === "MAX") {
      return true;
    }

    const startDate = getChartRangeStartDate(preset, lastPoint.date);
    return Boolean(startDate && firstPoint.date <= startDate);
  });
};

export const getChartRangeViewport = <T extends DatedPoint>(
  points: T[],
  preset: ChartRangePreset
): ChartViewport | null => {
  const fullViewport = getFullChartViewport(points.length);

  if (!fullViewport || preset === "MAX") {
    return null;
  }

  const startDate = getChartRangeStartDate(preset, points[fullViewport.endIndex].date);

  if (!startDate) {
    return null;
  }

  const startIndex = points.findIndex((point) => point.date >= startDate);

  if (startIndex < 0) {
    return null;
  }

  return {
    startIndex,
    endIndex: fullViewport.endIndex,
  };
};

export const getFullChartViewport = (pointCount: number): ChartViewport | null =>
  pointCount > 0
    ? {
        startIndex: 0,
        endIndex: pointCount - 1,
      }
    : null;

export const normalizeChartViewport = (
  viewport: ChartViewport | null,
  pointCount: number
): ChartViewport | null => {
  const fullViewport = getFullChartViewport(pointCount);

  if (!viewport || !fullViewport) {
    return fullViewport;
  }

  const startIndex = Math.max(0, Math.min(viewport.startIndex, fullViewport.endIndex));
  const endIndex = Math.max(startIndex, Math.min(viewport.endIndex, fullViewport.endIndex));

  return { startIndex, endIndex };
};

const getViewportSpan = (viewport: ChartViewport) => viewport.endIndex - viewport.startIndex + 1;

const getCurrentViewport = (viewport: ChartViewport | null, pointCount: number) =>
  normalizeChartViewport(viewport, pointCount) ?? getFullChartViewport(pointCount);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export const zoomChartViewport = ({
  viewport,
  pointCount,
  factor,
  anchorRatio,
  minimumPoints = 2,
}: {
  viewport: ChartViewport | null;
  pointCount: number;
  factor: number;
  anchorRatio: number;
  minimumPoints?: number;
}): ChartViewport | null => {
  const currentViewport = getCurrentViewport(viewport, pointCount);

  if (!currentViewport || pointCount <= 1 || !Number.isFinite(factor) || factor <= 0) {
    return currentViewport;
  }

  const currentSpan = getViewportSpan(currentViewport);
  const targetSpan = clamp(
    Math.round(currentSpan * factor),
    Math.min(minimumPoints, pointCount),
    pointCount
  );

  if (targetSpan >= pointCount) {
    return null;
  }

  const safeAnchorRatio = clamp(anchorRatio, 0, 1);
  const anchorIndex = currentViewport.startIndex + (currentSpan - 1) * safeAnchorRatio;
  const startIndex = Math.round(
    clamp(anchorIndex - (targetSpan - 1) * safeAnchorRatio, 0, pointCount - targetSpan)
  );

  return {
    startIndex,
    endIndex: startIndex + targetSpan - 1,
  };
};

export const panChartViewport = ({
  viewport,
  pointCount,
  deltaPoints,
}: {
  viewport: ChartViewport | null;
  pointCount: number;
  deltaPoints: number;
}): ChartViewport | null => {
  const currentViewport = getCurrentViewport(viewport, pointCount);

  if (!currentViewport || !Number.isFinite(deltaPoints)) {
    return currentViewport;
  }

  const span = getViewportSpan(currentViewport);

  if (span >= pointCount) {
    return null;
  }

  const startIndex = Math.round(
    clamp(currentViewport.startIndex + deltaPoints, 0, pointCount - span)
  );

  return {
    startIndex,
    endIndex: startIndex + span - 1,
  };
};

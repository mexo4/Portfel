"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipPayloadEntry,
} from "recharts";
import { SEARCH_DEBOUNCE_MS, SEARCH_MODE_OPTIONS } from "@/lib/constants";
import { fetchPortfolioHistory, searchAssets } from "@/lib/api";
import { getMinimumSearchLength, getSearchPlaceholder } from "@/lib/search";
import {
  getPortfolioAssetGroupKey,
  normalizeGpwSymbol,
  normalizeSymbol,
} from "@/lib/ticker";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  round,
  toDateInputValue,
} from "@/lib/utils";
import type {
  AssetSearchMode,
  AssetSearchResult,
  FxRates,
  PortfolioAsset,
  PortfolioAssetHistorySeries,
  PortfolioBenchmarkDefinition,
  PortfolioBenchmarkHistorySeries,
  PortfolioHistoryPoint,
  PortfolioHistoryResponse,
  PortfolioRealizedAdjustment,
  PortfolioSale,
} from "@/types/portfolio";

type PortfolioLineChartsProps = {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
  fxRates: FxRates;
  combinedProfitLossPln: number;
};

type RangePreset = "1D" | "1W" | "1M" | "1Q" | "YTD" | "ALL";
type ChartMode =
  | "value"
  | "return"
  | "drawdown"
  | "portfolio-vs-benchmark"
  | "daily-change";
type ToneClass = "tone-positive" | "tone-negative" | "tone-neutral";

type ChartRow = {
  date: string;
} & Record<string, number | string | null>;

type ReturnPoint = PortfolioHistoryPoint & {
  returnPercent: number | null;
};

type DrawdownPoint = PortfolioHistoryPoint & {
  drawdownPercent: number;
  runningPeakPln: number;
};

type DailyChangePoint = PortfolioHistoryPoint & {
  dailyChangePln: number;
  dailyChangePercent: number;
};

type ChartLineDefinition = {
  dataKey: string;
  label: string;
  color: string;
  variant?: "line" | "area";
  strokeWidth?: number;
  connectNulls?: boolean;
  valueFormatter: (value: number) => string;
  detailFormatter?: (row: ChartRow) => string | null;
};

type ChartStat = {
  label: string;
  value: string;
  tone?: ToneClass;
};

type ChartModel = {
  title: string;
  copy: string;
  data: ChartRow[];
  lines: ChartLineDefinition[];
  summaryLabel: string;
  summaryValue: string;
  deltaLabel: string;
  deltaValue: string;
  deltaTone: ToneClass;
  stats: ChartStat[];
  referenceValue?: number;
  yAxisDomain?: [number, number];
  yAxisTickFormatter: (value: number) => string;
  emptyTitle: string;
  emptyCopy: string;
};

type FallbackSegment = {
  id: string;
  groupKey: string;
  label: string;
  symbol: string;
  kind: PortfolioAsset["kind"];
  startDate: string;
  endDate: string;
  quantity: number;
  startValuePlnPerUnit: number;
  endValuePlnPerUnit: number;
};

type FallbackHistoryState = {
  points: PortfolioHistoryPoint[];
  assetSeries: PortfolioAssetHistorySeries[];
};

const DEFAULT_BENCHMARK_SEARCH_MODE: AssetSearchMode = "etf";
const RANGE_PRESET_STORAGE_KEY = "mexo.lineCharts.rangePreset";

const RANGE_PRESETS: RangePreset[] = ["1D", "1W", "1M", "1Q", "YTD", "ALL"];
const MODE_OPTIONS: Array<{
  value: ChartMode;
  label: string;
  copy: string;
}> = [
  {
    value: "value",
    label: "Wartosc portfela",
    copy: "glowna linia wartosci i kapital netto",
  },
  {
    value: "return",
    label: "Zwrot procentowy",
    copy: "wynik od poczatku w %",
  },
  {
    value: "drawdown",
    label: "Drawdown",
    copy: "spadek od ostatniego maksimum",
  },
  {
    value: "portfolio-vs-benchmark",
    label: "Portfel vs benchmark",
    copy: "stopa zwrotu jak w myfund",
  },
  {
    value: "daily-change",
    label: "Zmiana dzienna",
    copy: "sesja do sesji w PLN",
  },
];

const SERIES_COLORS = [
  "#13314a",
  "#0f766e",
  "#d38d38",
  "#2f6f8f",
  "#b45309",
  "#3c7a57",
];

const EMPTY_HISTORY: PortfolioHistoryResponse = {
  points: [],
  warnings: [],
  assetSeries: [],
  benchmarkSeries: [],
};

const isRangePreset = (value: string | null): value is RangePreset =>
  RANGE_PRESETS.includes(value as RangePreset);

const isGpwMode = (mode: AssetSearchMode) => mode === "stock-gpw";

const normalizeBenchmarkSymbolForMode = (symbol: string, mode: AssetSearchMode) =>
  isGpwMode(mode) ? normalizeGpwSymbol(symbol) : normalizeSymbol(symbol);

const getBenchmarkKey = ({
  kind,
  provider,
  providerId,
  symbol,
}: Pick<PortfolioBenchmarkDefinition, "kind" | "provider" | "providerId" | "symbol">) =>
  [kind, provider, normalizeSymbol(providerId ?? symbol)].join(":");

const toBenchmarkDefinition = (
  result: AssetSearchResult,
  mode: AssetSearchMode
): PortfolioBenchmarkDefinition => {
  const symbol = normalizeBenchmarkSymbolForMode(result.symbol, mode);

  return {
    id: getBenchmarkKey({
      kind: result.kind,
      provider: result.provider,
      providerId: result.providerId,
      symbol,
    }),
    name: result.name,
    symbol,
    kind: result.kind,
    marketCurrency: result.marketCurrency,
    provider: result.provider,
    providerId: result.providerId,
    priceScale: result.priceScale,
  };
};

const getPointDate = (value: string) => new Date(`${value}T12:00:00.000Z`);

const shiftDate = (date: string, days: number) => {
  const nextDate = getPointDate(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate.toISOString().slice(0, 10);
};

const getDateRange = (startDate: string, endDate: string) => {
  const dates: string[] = [];

  for (let cursor = startDate; cursor <= endDate; cursor = shiftDate(cursor, 1)) {
    dates.push(cursor);
  }

  return dates;
};

const getPresetStartDate = (preset: RangePreset, lastDate: string) => {
  const nextDate = getPointDate(lastDate);

  if (preset === "ALL") {
    return null;
  }

  if (preset === "1D") {
    return shiftDate(lastDate, -1);
  }

  if (preset === "1W") {
    return shiftDate(lastDate, -7);
  }

  if (preset === "1M") {
    nextDate.setUTCMonth(nextDate.getUTCMonth() - 1);
    return nextDate.toISOString().slice(0, 10);
  }

  if (preset === "1Q") {
    nextDate.setUTCMonth(nextDate.getUTCMonth() - 3);
    return nextDate.toISOString().slice(0, 10);
  }

  if (preset === "YTD") {
    // Year-to-date: start at Jan 1 of the same year as lastDate
    const start = getPointDate(lastDate);
    start.setUTCMonth(0);
    start.setUTCDate(1);
    start.setUTCHours(12, 0, 0, 0);
    return start.toISOString().slice(0, 10);
  }

  // Fallback to 1 year back for any other preset (shouldn't normally happen)
  nextDate.setUTCFullYear(nextDate.getUTCFullYear() - 1);
  return nextDate.toISOString().slice(0, 10);
};

const filterByRange = <T extends { date: string }>(points: T[], preset: RangePreset) => {
  const lastPoint = points.at(-1);

  if (!lastPoint || preset === "ALL") {
    return points;
  }

  const startDate = getPresetStartDate(preset, lastPoint.date);

  if (!startDate) {
    return points;
  }

  const filteredPoints = points.filter((point) => point.date >= startDate);

  if (filteredPoints.length > 0) {
    return filteredPoints;
  }

  if (preset === "1D" && points.length > 1) {
    return points.slice(-2);
  }

  return points;
};

const formatPercent = (value: number, fractionDigits = 2) =>
  `${new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)}%`;

const formatSignedPercent = (value: number, fractionDigits = 2) =>
  `${value > 0 ? "+" : ""}${formatPercent(value, fractionDigits)}`;

const formatSignedCurrency = (value: number) =>
  `${value > 0 ? "+" : ""}${formatCurrency(value)}`;

const formatSignedPercentagePoints = (value: number, fractionDigits = 2) =>
  `${value > 0 ? "+" : ""}${new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)} p.p.`;

const formatCompactCurrency = (value: number) => {
  const absValue = Math.abs(value);
  const prefix = value < 0 ? "-" : "";

  if (absValue >= 1_000_000) {
    return `${prefix}${formatNumber(absValue / 1_000_000, absValue >= 10_000_000 ? 0 : 1)} mln`;
  }

  if (absValue >= 1_000) {
    return `${prefix}${formatNumber(absValue / 1_000, absValue >= 100_000 ? 0 : 1)} tys.`;
  }

  return `${formatNumber(value, 0)} zl`;
};

const formatAxisPercent = (value: number) => formatPercent(value, 0);

const getChartExportBaseName = (mode: ChartMode, rangePreset: RangePreset) =>
  `mexo-${mode}-${rangePreset.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;

const toCsvCell = (value: string | number | null | undefined) => {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  const text = String(value);

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const formatShortDate = (value: string) =>
  new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "short",
  }).format(getPointDate(value));

const convertToPln = (amount: number, currency: string, fxRates: FxRates) =>
  round(amount * (fxRates[currency] ?? 1));

const getEarliestHistoryDate = ({
  assets,
  sales,
  realizedAdjustments,
}: {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
}) => {
  const dates = [
    ...assets.map((asset) => asset.purchaseDate),
    ...sales.flatMap((sale) => [
      sale.saleDate,
      ...sale.allocations.map((allocation) => allocation.purchaseDate),
    ]),
    ...realizedAdjustments.map((adjustment) => adjustment.date),
  ]
    .map((date) => toDateInputValue(date, ""))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  return dates[0] ?? null;
};

const addAmountToDateMap = (map: Map<string, number>, date: string, amount: number) => {
  if (!Number.isFinite(amount) || amount === 0) {
    return;
  }

  map.set(date, round((map.get(date) ?? 0) + amount));
};

const getSegmentSpanDays = (startDate: string, endDate: string) =>
  Math.max(
    1,
    Math.floor(
      (getPointDate(endDate).getTime() - getPointDate(startDate).getTime()) / 86_400_000
    )
  );

const getInterpolatedSegmentValue = (segment: FallbackSegment, date: string) => {
  if (segment.startDate === segment.endDate) {
    return round(segment.endValuePlnPerUnit * segment.quantity);
  }

  const elapsedDays = Math.max(
    0,
    Math.floor(
      (getPointDate(date).getTime() - getPointDate(segment.startDate).getTime()) / 86_400_000
    )
  );
  const ratio = Math.min(1, elapsedDays / getSegmentSpanDays(segment.startDate, segment.endDate));
  const unitValue = round(
    segment.startValuePlnPerUnit +
      (segment.endValuePlnPerUnit - segment.startValuePlnPerUnit) * ratio,
    6
  );

  return round(unitValue * segment.quantity);
};

const buildFallbackHistory = ({
  assets,
  sales,
  realizedAdjustments,
  fxRates,
}: {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
  fxRates: FxRates;
}): FallbackHistoryState => {
  const startDate = getEarliestHistoryDate({
    assets,
    sales,
    realizedAdjustments,
  });
  const today = toDateInputValue(new Date().toISOString());

  if (!startDate) {
    return {
      points: [],
      assetSeries: [],
    };
  }

  const dates = getDateRange(startDate, today);
  const netInvestedEvents = new Map<string, number>();
  const adjustmentEvents = new Map<string, number>();
  const segments: FallbackSegment[] = [];
  const assetMetaByGroupKey = new Map<
    string,
    {
      groupKey: string;
      label: string;
      symbol: string;
      kind: PortfolioAsset["kind"];
    }
  >();

  for (const asset of assets) {
    const groupKey = getPortfolioAssetGroupKey(asset);

    if (!assetMetaByGroupKey.has(groupKey)) {
      assetMetaByGroupKey.set(groupKey, {
        groupKey,
        label: asset.name,
        symbol: asset.symbol,
        kind: asset.kind,
      });
    }

    addAmountToDateMap(
      netInvestedEvents,
      asset.purchaseDate,
      convertToPln(asset.purchasePrice * asset.quantity, asset.purchaseCurrency, fxRates) +
        asset.feePln
    );

    segments.push({
      id: asset.id,
      groupKey,
      label: asset.name,
      symbol: asset.symbol,
      kind: asset.kind,
      startDate: asset.purchaseDate,
      endDate: today,
      quantity: asset.quantity,
      startValuePlnPerUnit: convertToPln(asset.purchasePrice, asset.purchaseCurrency, fxRates),
      endValuePlnPerUnit: convertToPln(
        asset.latestPrice ?? asset.purchasePrice,
        asset.marketCurrency,
        fxRates
      ),
    });
  }

  for (const sale of sales) {
    addAmountToDateMap(netInvestedEvents, sale.saleDate, -round(sale.realizedInvestedPln));

    for (const allocation of sale.allocations) {
      const kind = allocation.kind ?? sale.kind;
      const symbol = allocation.symbol ?? sale.symbol;
      const groupKey = getPortfolioAssetGroupKey({
        kind,
        symbol,
      });

      if (!assetMetaByGroupKey.has(groupKey)) {
        assetMetaByGroupKey.set(groupKey, {
          groupKey,
          label: allocation.name ?? sale.name,
          symbol,
          kind,
        });
      }

      addAmountToDateMap(
        netInvestedEvents,
        allocation.purchaseDate,
        convertToPln(
          allocation.purchasePrice * allocation.quantity,
          allocation.purchaseCurrency,
          fxRates
        ) + allocation.allocatedBuyFeePln
      );

      const segmentEndDate = shiftDate(sale.saleDate, -1);

      if (segmentEndDate < allocation.purchaseDate) {
        continue;
      }

      segments.push({
        id: `${sale.id}:${allocation.lotId}`,
        groupKey,
        label: allocation.name ?? sale.name,
        symbol,
        kind,
        startDate: allocation.purchaseDate,
        endDate: segmentEndDate,
        quantity: allocation.quantity,
        startValuePlnPerUnit: convertToPln(
          allocation.purchasePrice,
          allocation.purchaseCurrency,
          fxRates
        ),
        endValuePlnPerUnit: convertToPln(sale.salePrice, sale.marketCurrency, fxRates),
      });
    }
  }

  for (const adjustment of realizedAdjustments) {
    addAmountToDateMap(adjustmentEvents, adjustment.date, adjustment.amountPlnSnapshot);
  }

  const assetValueByGroupKey = new Map(
    Array.from(assetMetaByGroupKey.keys()).map((groupKey) => [
      groupKey,
      new Map<string, number>(dates.map((date) => [date, 0] as [string, number])),
    ] as const)
  );
  const points: PortfolioHistoryPoint[] = [];
  let cumulativeNetInvestedPln = 0;
  let cumulativeAdjustmentsPln = 0;
  let cumulativeTimeWeightedReturnFactor = 1;
  let previousPortfolioValuePln: number | null = null;

  for (const date of dates) {
    const externalFlowPln = netInvestedEvents.get(date) ?? 0;
    const realizedAdjustmentPln = adjustmentEvents.get(date) ?? 0;

    cumulativeNetInvestedPln = round(
      cumulativeNetInvestedPln + externalFlowPln
    );
    cumulativeAdjustmentsPln = round(
      cumulativeAdjustmentsPln + realizedAdjustmentPln
    );

    const portfolioValuePln = round(
      segments.reduce((total, segment) => {
        if (date < segment.startDate || date > segment.endDate) {
          return total;
        }

        const segmentValue = getInterpolatedSegmentValue(segment, date);

        assetValueByGroupKey
          .get(segment.groupKey)
          ?.set(
            date,
            round((assetValueByGroupKey.get(segment.groupKey)?.get(date) ?? 0) + segmentValue)
          );

        return total + segmentValue;
      }, 0)
    );

    if (previousPortfolioValuePln !== null && previousPortfolioValuePln > 0) {
      const dailyReturn =
        (portfolioValuePln +
          realizedAdjustmentPln -
          previousPortfolioValuePln -
          externalFlowPln) /
        previousPortfolioValuePln;

      if (Number.isFinite(dailyReturn)) {
        cumulativeTimeWeightedReturnFactor *= 1 + dailyReturn;
      }
    }

    points.push({
      date,
      portfolioValuePln,
      netInvestedPln: round(cumulativeNetInvestedPln),
      profitLossPln: round(
        portfolioValuePln - cumulativeNetInvestedPln + cumulativeAdjustmentsPln
      ),
      timeWeightedReturnPercent: round(
        (cumulativeTimeWeightedReturnFactor - 1) * 100,
        2
      ),
    });

    previousPortfolioValuePln = portfolioValuePln;
  }

  const assetSeries = Array.from(assetMetaByGroupKey.values())
    .map((meta) => ({
      groupKey: meta.groupKey,
      label: meta.label,
      symbol: meta.symbol,
      kind: meta.kind,
      points: dates.map((date) => ({
        date,
        valuePln: round(assetValueByGroupKey.get(meta.groupKey)?.get(date) ?? 0),
      })),
    }))
    .filter((series) => series.points.some((point) => point.valuePln !== 0));

  return {
    points,
    assetSeries,
  };
};

const calculateCapitalReturnPercent = (profitLossPln: number, netInvestedPln: number) =>
  netInvestedPln > 0 && Number.isFinite(profitLossPln) && Number.isFinite(netInvestedPln)
    ? round((profitLossPln / netInvestedPln) * 100, 2)
    : null;

const buildReturnSeries = (points: PortfolioHistoryPoint[]): ReturnPoint[] =>
  points.map((point) => ({
    ...point,
    returnPercent: calculateCapitalReturnPercent(point.profitLossPln, point.netInvestedPln),
  }));

const buildDrawdownSeries = (points: PortfolioHistoryPoint[]): DrawdownPoint[] => {
  let runningPeakPln = 0;

  return points.map((point) => {
    runningPeakPln = Math.max(runningPeakPln, point.portfolioValuePln);

    return {
      ...point,
      runningPeakPln,
      drawdownPercent:
        runningPeakPln > 0
          ? round(((point.portfolioValuePln - runningPeakPln) / runningPeakPln) * 100, 2)
          : 0,
    };
  });
};

const buildDailyChangeSeries = (points: PortfolioHistoryPoint[]): DailyChangePoint[] =>
  points.map((point, index) => {
    const previousPoint = index > 0 ? points[index - 1] : null;
    const dailyChangePln = previousPoint
      ? round(point.portfolioValuePln - previousPoint.portfolioValuePln)
      : 0;
    const dailyChangePercent =
      previousPoint && previousPoint.portfolioValuePln > 0
        ? round((dailyChangePln / previousPoint.portfolioValuePln) * 100, 2)
        : 0;

    return {
      ...point,
      dailyChangePln,
      dailyChangePercent,
    };
  });

const getToneClass = (value: number): ToneClass => {
  if (value > 0) {
    return "tone-positive";
  }

  if (value < 0) {
    return "tone-negative";
  }

  return "tone-neutral";
};

const START_GAP_WARNING_PATTERN =
  /^Historia (.+) ma braki na poczatku zakresu; brakujace dni wyceniono po cenie zakupu\.$/;

const compactWarnings = (warnings: string[]) => {
  const startingGapSymbols: string[] = [];
  const remainingWarnings: string[] = [];

  warnings.forEach((warning) => {
    const match = warning.match(START_GAP_WARNING_PATTERN);

    if (match?.[1]) {
      startingGapSymbols.push(match[1]);
      return;
    }

    remainingWarnings.push(warning);
  });

  if (startingGapSymbols.length > 0) {
    remainingWarnings.unshift(
      startingGapSymbols.length === 1
        ? `Historia ${startingGapSymbols[0]} startuje kilka sesji po poczatku zakresu; pierwsze dni wyceniono po cenie zakupu.`
        : `Czesc aktywow startuje kilka sesji po poczatku zakresu (${startingGapSymbols.join(", ")}); pierwsze dni wyceniono po cenie zakupu.`
    );
  }

  return remainingWarnings;
};

const getFiniteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const getPreviousPointBeforeDate = <T extends { date: string }>(
  points: T[],
  date: string
) => {
  let previousPoint: T | null = null;

  for (const point of points) {
    if (point.date >= date) {
      break;
    }

    previousPoint = point;
  }

  return previousPoint;
};

const calculateRelativeReturnPercent = (
  currentPercent: number | null | undefined,
  baselinePercent: number | null | undefined
) => {
  const currentNumber = getFiniteNumber(currentPercent);
  const baselineNumber = getFiniteNumber(baselinePercent);

  if (currentNumber === null) {
    return null;
  }

  if (baselineNumber === null) {
    return currentNumber;
  }

  const baselineFactor = 1 + baselineNumber / 100;

  if (!Number.isFinite(baselineFactor) || baselineFactor === 0) {
    return currentNumber;
  }

  return round(((1 + currentNumber / 100) / baselineFactor - 1) * 100, 2);
};

const getPaddedNumberDomain = (values: Array<number | null | undefined>) => {
  const numericValues = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );

  if (numericValues.length === 0) {
    return undefined;
  }

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

function ChartTooltip({
  active,
  isFullscreen = false,
  label,
  payload,
  lines,
}: TooltipContentProps & {
  isFullscreen?: boolean;
  lines: ChartLineDefinition[];
}) {
  if (!active || !label || !payload || payload.length === 0) {
    return null;
  }

  const row = payload[0]?.payload as ChartRow | undefined;
  const payloadByKey = new Map(
    payload.map((entry) => [String(entry.dataKey ?? ""), entry] as const)
  );

  return (
    <div
      className={
        isFullscreen
          ? "line-chart-tooltip line-visual-tooltip is-fullscreen"
          : "line-chart-tooltip line-visual-tooltip"
      }
    >
      <p className="table-title">{formatDate(String(label))}</p>
      <div className="line-chart-tooltip-list">
        {lines.map((line) => {
          const entry = payloadByKey.get(line.dataKey) as TooltipPayloadEntry | undefined;
          const value = getFiniteNumber(entry?.value);

          if (value === null) {
            return null;
          }

          return (
            <div key={line.dataKey} className="line-chart-tooltip-row">
              <span className="line-chart-tooltip-key">
                <span
                  className="line-chart-tooltip-dot"
                  style={{ background: line.color }}
                />
                <span className="line-chart-tooltip-label">{line.label}</span>
              </span>
              <div className="line-visual-tooltip-values">
                <strong className="line-chart-tooltip-value">
                  {line.valueFormatter(value)}
                </strong>
                {row && line.detailFormatter ? (
                  <span className="table-note">{line.detailFormatter(row)}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function PortfolioLineCharts({
  assets,
  sales,
  realizedAdjustments,
  fxRates,
  combinedProfitLossPln,
}: PortfolioLineChartsProps) {
  const [mode, setMode] = useState<ChartMode>("value");
  const [rangePreset, setRangePreset] = useState<RangePreset>("1M");
  const [hasLoadedStoredRange, setHasLoadedStoredRange] = useState(false);
  const [hiddenSeriesKeys, setHiddenSeriesKeys] = useState<string[]>([]);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);
  const [selectedBenchmarks, setSelectedBenchmarks] = useState<PortfolioBenchmarkDefinition[]>(
    []
  );
  const [visibleBenchmarkIds, setVisibleBenchmarkIds] = useState<string[]>([]);
  const [benchmarkSearchMode, setBenchmarkSearchMode] = useState<AssetSearchMode>(
    DEFAULT_BENCHMARK_SEARCH_MODE
  );
  const [benchmarkQuery, setBenchmarkQuery] = useState("");
  const [benchmarkResults, setBenchmarkResults] = useState<AssetSearchResult[]>([]);
  const [isSearchingBenchmarks, setIsSearchingBenchmarks] = useState(false);
  const [benchmarkSearchError, setBenchmarkSearchError] = useState<string | null>(null);
  const [serverHistory, setServerHistory] = useState<PortfolioHistoryResponse>(EMPTY_HISTORY);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const chartFrameRef = useRef<HTMLDivElement | null>(null);
  const modalChartFrameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const storedRange = window.localStorage.getItem(RANGE_PRESET_STORAGE_KEY);

    if (isRangePreset(storedRange)) {
      setRangePreset(storedRange);
    }

    setHasLoadedStoredRange(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedStoredRange) {
      return;
    }

    window.localStorage.setItem(RANGE_PRESET_STORAGE_KEY, rangePreset);
  }, [hasLoadedStoredRange, rangePreset]);

  useEffect(() => {
    if (!isChartModalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsChartModalOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isChartModalOpen]);

  const fallbackHistory = useMemo(
    () =>
      buildFallbackHistory({
        assets,
        sales,
        realizedAdjustments,
        fxRates,
      }),
    [assets, fxRates, realizedAdjustments, sales]
  );

  useEffect(() => {
    let isCancelled = false;
    const abortController = new AbortController();

    if (assets.length === 0 && sales.length === 0 && realizedAdjustments.length === 0) {
      setServerHistory(EMPTY_HISTORY);
      setWarnings([]);
      setError(null);
      setIsLoading(false);

      return () => {
        abortController.abort();
      };
    }

    setIsLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetchPortfolioHistory({
          assets,
          sales,
          realizedAdjustments,
          benchmarks: selectedBenchmarks,
          signal: abortController.signal,
        });

        if (isCancelled) {
          return;
        }

        setServerHistory(response);
        setWarnings(response.warnings);
      } catch (fetchError) {
        if (isCancelled) {
          return;
        }

        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          return;
        }

        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Nie udalo sie pobrac historii portfela."
        );
        setServerHistory(EMPTY_HISTORY);
        setWarnings([]);
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
      abortController.abort();
    };
  }, [assets, realizedAdjustments, sales, selectedBenchmarks]);

  const displayPoints =
    serverHistory.points.length > 0 ? serverHistory.points : fallbackHistory.points;
  const displayBenchmarkSeries = serverHistory.benchmarkSeries;
  const isUsingFallbackHistory =
    serverHistory.points.length === 0 && fallbackHistory.points.length > 0;
  const displayWarnings = useMemo(() => compactWarnings(warnings), [warnings]);
  const benchmarkSearchMinimumLength = getMinimumSearchLength(benchmarkSearchMode);
  const hasActiveBenchmarkQuery = benchmarkQuery.trim().length > 0;
  const hasReachedBenchmarkMinimumLength =
    benchmarkQuery.trim().length >= benchmarkSearchMinimumLength;
  const visibleBenchmarkIdSet = useMemo(
    () => new Set(visibleBenchmarkIds),
    [visibleBenchmarkIds]
  );
  const visibleBenchmarkDefinitions = useMemo(
    () => selectedBenchmarks.filter((benchmark) => visibleBenchmarkIdSet.has(benchmark.id)),
    [selectedBenchmarks, visibleBenchmarkIdSet]
  );
  const benchmarkSeriesById = useMemo(
    () => new Map(displayBenchmarkSeries.map((series) => [series.id, series] as const)),
    [displayBenchmarkSeries]
  );

  useEffect(() => {
    const selectedBenchmarkIds = new Set(selectedBenchmarks.map((benchmark) => benchmark.id));

    setVisibleBenchmarkIds((currentIds) =>
      currentIds.filter((benchmarkId) => selectedBenchmarkIds.has(benchmarkId))
    );
  }, [selectedBenchmarks]);

  useEffect(() => {
    const trimmedQuery = benchmarkQuery.trim();

    if (mode !== "portfolio-vs-benchmark" || trimmedQuery.length < benchmarkSearchMinimumLength) {
      setBenchmarkResults([]);
      setBenchmarkSearchError(null);
      setIsSearchingBenchmarks(false);
      return;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setIsSearchingBenchmarks(true);
      setBenchmarkSearchError(null);

      try {
        const nextResults = await searchAssets({
          query: trimmedQuery,
          kind: SEARCH_MODE_OPTIONS.find((option) => option.value === benchmarkSearchMode)?.kind ?? "etf",
          mode: benchmarkSearchMode,
        });

        if (!isCancelled) {
          setBenchmarkResults(nextResults);
        }
      } catch (searchError) {
        if (isCancelled) {
          return;
        }

        setBenchmarkResults([]);
        setBenchmarkSearchError(
          searchError instanceof Error
            ? searchError.message
            : "Nie udalo sie pobrac benchmarkow."
        );
      } finally {
        if (!isCancelled) {
          setIsSearchingBenchmarks(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [benchmarkQuery, benchmarkSearchMinimumLength, benchmarkSearchMode, mode]);

  const visiblePoints = useMemo(
    () => filterByRange(displayPoints, rangePreset),
    [displayPoints, rangePreset]
  );
  const visibleReturnPoints = useMemo(
    () => filterByRange(buildReturnSeries(displayPoints), rangePreset),
    [displayPoints, rangePreset]
  );
  const visibleDrawdownPoints = useMemo(
    () => filterByRange(buildDrawdownSeries(displayPoints), rangePreset),
    [displayPoints, rangePreset]
  );
  const visibleDailyChangePoints = useMemo(
    () => filterByRange(buildDailyChangeSeries(displayPoints), rangePreset),
    [displayPoints, rangePreset]
  );
  const visibleDates = visiblePoints.map((point) => point.date);

  const handleAddBenchmark = (result: AssetSearchResult) => {
    const benchmark = toBenchmarkDefinition(result, benchmarkSearchMode);

    setSelectedBenchmarks((currentBenchmarks) => {
      if (currentBenchmarks.some((currentBenchmark) => currentBenchmark.id === benchmark.id)) {
        return currentBenchmarks;
      }

      return [...currentBenchmarks, benchmark];
    });
    setVisibleBenchmarkIds((currentIds) =>
      currentIds.includes(benchmark.id) ? currentIds : [...currentIds, benchmark.id]
    );
    setBenchmarkQuery("");
    setBenchmarkResults([]);
    setBenchmarkSearchError(null);
    setMode("portfolio-vs-benchmark");
  };

  const handleRemoveBenchmark = (benchmarkId: string) => {
    setSelectedBenchmarks((currentBenchmarks) =>
      currentBenchmarks.filter((benchmark) => benchmark.id !== benchmarkId)
    );
    setVisibleBenchmarkIds((currentIds) =>
      currentIds.filter((visibleBenchmarkId) => visibleBenchmarkId !== benchmarkId)
    );
  };

  const handleToggleBenchmarkVisibility = (benchmarkId: string) => {
    setVisibleBenchmarkIds((currentIds) =>
      currentIds.includes(benchmarkId)
        ? currentIds.filter((visibleBenchmarkId) => visibleBenchmarkId !== benchmarkId)
        : [...currentIds, benchmarkId]
    );
  };

  const chartModel = useMemo<ChartModel>(() => {
    if (mode === "value") {
      const firstPoint = visiblePoints[0];
      const lastPoint = visiblePoints.at(-1);

      if (!firstPoint || !lastPoint) {
        return {
          title: "Wartosc portfela",
          copy: "Glowny widok portfela w PLN z kapitalem netto jako linia odniesienia.",
          data: [],
          lines: [],
          summaryLabel: "Brak danych",
          summaryValue: "0 zl",
          deltaLabel: "Zmiana w zakresie",
          deltaValue: "0 zl",
          deltaTone: "tone-neutral",
          stats: [],
          yAxisTickFormatter: formatCompactCurrency,
          emptyTitle: "Brakuje historii do wykresu wartosci",
          emptyCopy: "Dodaj aktywa albo poczekaj, az pojawi sie seria dziennych punktow.",
        };
      }

      const rangeChangePln = round(lastPoint.portfolioValuePln - firstPoint.portfolioValuePln);
      const totalReturnPercent =
        lastPoint.netInvestedPln > 0
          ? round((lastPoint.profitLossPln / lastPoint.netInvestedPln) * 100, 2)
          : 0;
      const yAxisDomain = getPaddedNumberDomain(
        visiblePoints.flatMap((point) => [point.portfolioValuePln, point.netInvestedPln])
      );

      return {
        title: "Wartosc portfela",
        copy: "Najczystszy widok fintech: dominujaca krzywa portfela z kapitalem netto jako cicha linia odniesienia.",
        data: visiblePoints,
        lines: [
          {
            dataKey: "portfolioValuePln",
            label: "Portfel",
            color: SERIES_COLORS[0],
            variant: "area",
            strokeWidth: 3,
            valueFormatter: (value) => formatCurrency(value),
          },
          {
            dataKey: "netInvestedPln",
            label: "Kapital netto",
            color: SERIES_COLORS[1],
            strokeWidth: 2.2,
            valueFormatter: (value) => formatCurrency(value),
          },
        ],
        summaryLabel: "Wartosc teraz",
        summaryValue: formatCurrency(lastPoint.portfolioValuePln),
        deltaLabel: "Zmiana w zakresie",
        deltaValue: formatSignedCurrency(rangeChangePln),
        deltaTone: getToneClass(rangeChangePln),
        stats: [
          {
            label: "Wynik od poczatku",
            value: formatSignedCurrency(lastPoint.profitLossPln),
            tone: getToneClass(lastPoint.profitLossPln),
          },
          {
            label: "Zwrot od poczatku",
            value: formatSignedPercent(totalReturnPercent),
            tone: getToneClass(totalReturnPercent),
          },
          {
            label: "Kapital netto",
            value: formatCurrency(lastPoint.netInvestedPln),
          },
        ],
        yAxisDomain,
        yAxisTickFormatter: formatCompactCurrency,
        emptyTitle: "Brakuje historii do wykresu wartosci",
        emptyCopy: "Dodaj aktywa albo poczekaj, az pojawi sie seria dziennych punktow.",
      };
    }

    if (mode === "return") {
      const numericReturnPoints = visibleReturnPoints.filter(
        (point) => getFiniteNumber(point.returnPercent) !== null
      );
      const firstPoint = numericReturnPoints[0];
      const lastPoint = numericReturnPoints.at(-1);

      if (!firstPoint || !lastPoint) {
        return {
          title: "Zwrot procentowy",
          copy: "Wynik portfela liczony jako procent kapitalu netto.",
          data: [],
          lines: [],
          summaryLabel: "Brak danych",
          summaryValue: "0,00%",
          deltaLabel: "Zmiana w zakresie",
          deltaValue: "0,00%",
          deltaTone: "tone-neutral",
          stats: [],
          referenceValue: 0,
          yAxisTickFormatter: formatAxisPercent,
          emptyTitle: "Brakuje danych do liczenia zwrotu",
          emptyCopy: "Zwrot pojawi sie, gdy portfel bedzie mial dodatni kapital netto.",
        };
      }

      const maxReturnPercent = Math.max(
        ...numericReturnPoints.map((point) => point.returnPercent!)
      );
      const rangeChangePercent = round(lastPoint.returnPercent! - firstPoint.returnPercent!, 2);

      return {
        title: "Zwrot procentowy",
        copy: "Ten widok pokazuje, jaki procent kapitalu netto stanowi biezacy wynik portfela.",
        data: visibleReturnPoints,
        lines: [
          {
            dataKey: "returnPercent",
            label: "Zwrot od poczatku",
            color: SERIES_COLORS[1],
            strokeWidth: 2.8,
            valueFormatter: (value) => formatSignedPercent(value),
            detailFormatter: (row) =>
              typeof row.profitLossPln === "number"
                ? formatSignedCurrency(row.profitLossPln)
                : null,
          },
        ],
        summaryLabel: "Zwrot teraz",
        summaryValue: formatSignedPercent(lastPoint.returnPercent!),
        deltaLabel: "Zmiana w zakresie",
        deltaValue: formatSignedPercent(rangeChangePercent),
        deltaTone: getToneClass(rangeChangePercent),
        stats: [
          {
            label: "Wynik w PLN",
            value: formatSignedCurrency(lastPoint.profitLossPln),
            tone: getToneClass(lastPoint.profitLossPln),
          },
          {
            label: "Kapital netto",
            value: formatCurrency(lastPoint.netInvestedPln),
          },
          {
            label: "Najwyzej w zakresie",
            value: formatSignedPercent(maxReturnPercent),
            tone: getToneClass(maxReturnPercent),
          },
        ],
        referenceValue: 0,
        yAxisTickFormatter: formatAxisPercent,
        emptyTitle: "Brakuje danych do liczenia zwrotu",
        emptyCopy: "Zwrot pojawi sie, gdy portfel bedzie mial dodatni kapital netto.",
      };
    }

    if (mode === "drawdown") {
      const firstPoint = visibleDrawdownPoints[0];
      const lastPoint = visibleDrawdownPoints.at(-1);

      if (!firstPoint || !lastPoint) {
        return {
          title: "Drawdown",
          copy: "Spadek od najwyzszego punktu do biezacej wyceny.",
          data: [],
          lines: [],
          summaryLabel: "Brak danych",
          summaryValue: "0,00%",
          deltaLabel: "Najglebszy spadek",
          deltaValue: "0,00%",
          deltaTone: "tone-neutral",
          stats: [],
          referenceValue: 0,
          yAxisTickFormatter: formatAxisPercent,
          emptyTitle: "Brakuje danych do drawdownu",
          emptyCopy: "Drawdown potrzebuje ciaglej serii wycen portfela.",
        };
      }

      const worstDrawdown = Math.min(
        ...visibleDrawdownPoints.map((point) => point.drawdownPercent)
      );
      const lastRecoveryPercent = round(100 + lastPoint.drawdownPercent, 2);

      return {
        title: "Drawdown",
        copy: "Widok ryzyka w stylu TradingView: ile portfel oddal od ostatniego maksimum.",
        data: visibleDrawdownPoints,
        lines: [
          {
            dataKey: "drawdownPercent",
            label: "Drawdown",
            color: SERIES_COLORS[4],
            strokeWidth: 2.8,
            valueFormatter: (value) => formatPercent(value),
            detailFormatter: (row) =>
              typeof row.runningPeakPln === "number"
                ? `szczyt ${formatCurrency(row.runningPeakPln)}`
                : null,
          },
        ],
        summaryLabel: "Biezacy drawdown",
        summaryValue: formatPercent(lastPoint.drawdownPercent),
        deltaLabel: "Najglebszy spadek",
        deltaValue: formatPercent(worstDrawdown),
        deltaTone: getToneClass(worstDrawdown),
        stats: [
          {
            label: "Biezaca wartosc",
            value: formatCurrency(lastPoint.portfolioValuePln),
          },
          {
            label: "Ostatni szczyt",
            value: formatCurrency(lastPoint.runningPeakPln),
          },
          {
            label: "Odbicie od dolka",
            value: formatPercent(lastRecoveryPercent),
            tone: getToneClass(lastRecoveryPercent - 100),
          },
        ],
        referenceValue: 0,
        yAxisTickFormatter: formatAxisPercent,
        emptyTitle: "Brakuje danych do drawdownu",
        emptyCopy: "Drawdown potrzebuje ciaglej serii wycen portfela.",
      };
    }

    if (mode === "portfolio-vs-benchmark") {
      if (selectedBenchmarks.length === 0 || visibleDates.length === 0) {
        return {
          title: "Portfel vs benchmark",
          copy: "Porownanie stopy zwrotu portfela z benchmarkami w stylu myfund.",
          data: [],
          lines: [],
          summaryLabel: "Dodaj benchmark",
          summaryValue: "0,00%",
          deltaLabel: "Przewaga",
          deltaValue: "0,00 p.p.",
          deltaTone: "tone-neutral",
          stats: [],
          referenceValue: 0,
          yAxisTickFormatter: formatAxisPercent,
          emptyTitle: "Dodaj benchmark z wyszukiwarki",
          emptyCopy:
            "Wyszukaj akcje, ETF albo krypto, zeby porownac stopy zwrotu w czasie.",
        };
      }

      const visibleDateSet = new Set(visibleDates);
      const firstVisibleDate = visibleDates[0] ?? null;
      const portfolioBaselinePercent =
        rangePreset !== "ALL" && firstVisibleDate
          ? getPreviousPointBeforeDate(displayPoints, firstVisibleDate)
              ?.timeWeightedReturnPercent
          : null;
      const portfolioPercentByDate = new Map(
        visiblePoints.map(
          (point) =>
            [
              point.date,
              calculateRelativeReturnPercent(
                point.timeWeightedReturnPercent,
                portfolioBaselinePercent
              ),
            ] as const
        )
      );
      const portfolioPointByDate = new Map(
        visiblePoints.map((point) => [point.date, point] as const)
      );
      const numericPortfolioPoints = visiblePoints
        .map((point) => ({
          point,
          percent: portfolioPercentByDate.get(point.date) ?? null,
        }))
        .filter((entry) => getFiniteNumber(entry.percent) !== null);
      const lastPortfolioPoint = numericPortfolioPoints.at(-1);
      const portfolioPercent = lastPortfolioPoint?.percent ?? 0;
      const portfolioLine: ChartLineDefinition = {
        dataKey: "portfolio",
        label: "Portfel",
        color: SERIES_COLORS[0],
        strokeWidth: 2.8,
        valueFormatter: (value) => formatSignedPercent(value),
        detailFormatter: (row) => {
          const valuePln = getFiniteNumber(row.portfolioValuePln);
          const profitLossPln = getFiniteNumber(row.portfolioProfitLossPln);

          return [
            valuePln === null ? null : `wartosc ${formatCurrency(valuePln)}`,
            profitLossPln === null ? null : `wynik ${formatSignedCurrency(profitLossPln)}`,
          ]
            .filter(Boolean)
            .join(" | ");
        },
      };
      const visibleBenchmarkModels = visibleBenchmarkDefinitions.reduce<
        Array<{
          color: string;
          currentPercent: number;
          dataKey: string;
          label: string;
          percentByDate: Map<string, number | null>;
          pointByDate: Map<string, PortfolioBenchmarkHistorySeries["points"][number]>;
        }>
      >((models, benchmark, index) => {
        const series = benchmarkSeriesById.get(benchmark.id);

        if (!series) {
          return models;
        }

        const baselinePercent =
          rangePreset !== "ALL" && firstVisibleDate
            ? getPreviousPointBeforeDate(series.points, firstVisibleDate)?.returnPercent
            : null;
        const visibleBenchmarkPoints = series.points.filter((point) =>
          visibleDateSet.has(point.date)
        );
        const percentByDate = new Map(
          visibleBenchmarkPoints.map(
            (point) =>
              [
                point.date,
                calculateRelativeReturnPercent(point.returnPercent, baselinePercent),
              ] as const
          )
        );
        const numericBenchmarkPoints = visibleBenchmarkPoints
          .map((point) => ({
            point,
            percent: percentByDate.get(point.date) ?? null,
          }))
          .filter((entry) => getFiniteNumber(entry.percent) !== null);
        const lastBenchmarkPoint = numericBenchmarkPoints.at(-1);

        if (!lastBenchmarkPoint) {
          return models;
        }

        models.push({
          color: SERIES_COLORS[(index + 1) % SERIES_COLORS.length] ?? SERIES_COLORS[1],
          currentPercent: lastBenchmarkPoint.percent!,
          dataKey: `benchmark${index}`,
          label: series.label,
          percentByDate,
          pointByDate: new Map(series.points.map((point) => [point.date, point] as const)),
        });

        return models;
      }, []);
      const data = visibleDates
        .map((date) => {
          const portfolioPoint = portfolioPointByDate.get(date);
          const row: ChartRow = {
            date,
            portfolio: portfolioPercentByDate.get(date) ?? null,
            portfolioProfitLossPln: portfolioPoint?.profitLossPln ?? null,
            portfolioValuePln: portfolioPoint?.portfolioValuePln ?? null,
          };

          visibleBenchmarkModels.forEach((benchmarkModel) => {
            const point = benchmarkModel.pointByDate.get(date);

            row[benchmarkModel.dataKey] = benchmarkModel.percentByDate.get(date) ?? null;
            row[`${benchmarkModel.dataKey}Price`] = point?.price ?? null;
            row[`${benchmarkModel.dataKey}PricePln`] = point?.pricePln ?? null;
          });

          return row;
        })
        .filter(
          (row) =>
            getFiniteNumber(row.portfolio) !== null ||
            visibleBenchmarkModels.some(
              (benchmarkModel) => getFiniteNumber(row[benchmarkModel.dataKey]) !== null
            )
        );
      const benchmarkLines: ChartLineDefinition[] = visibleBenchmarkModels.map(
        (benchmarkModel) => ({
          dataKey: benchmarkModel.dataKey,
          label: benchmarkModel.label,
          color: benchmarkModel.color,
          strokeWidth: 2.3,
          valueFormatter: (value) => formatSignedPercent(value),
          detailFormatter: (row) => {
            const returnPercent = getFiniteNumber(row[benchmarkModel.dataKey]);
            const price = getFiniteNumber(row[`${benchmarkModel.dataKey}Price`]);
            const pricePln = getFiniteNumber(row[`${benchmarkModel.dataKey}PricePln`]);

            return [
              returnPercent === null ? null : `stopa ${formatSignedPercent(returnPercent)}`,
              price === null ? null : `kurs ${formatNumber(price, 2)}`,
              pricePln === null ? null : `kurs PLN ${formatCurrency(pricePln)}`,
            ]
              .filter(Boolean)
              .join(" | ");
          },
        })
      );
      const missingBenchmarkCount =
        visibleBenchmarkDefinitions.length - visibleBenchmarkModels.length;

      if (visibleBenchmarkDefinitions.length === 0) {
        return {
          title: "Portfel vs benchmark",
          copy: "Dodane benchmarki sa ukryte, a portfel zostaje widoczny jako zmiana procentowa.",
          data,
          lines: [portfolioLine],
          summaryLabel: "Portfel w zakresie",
          summaryValue: formatSignedPercent(portfolioPercent),
          deltaLabel: "Benchmarki",
          deltaValue: "ukryte",
          deltaTone: "tone-neutral",
          stats: [
            {
              label: "Dodane benchmarki",
              value: String(selectedBenchmarks.length),
            },
            {
              label: "Portfel",
              value: formatSignedPercent(portfolioPercent),
              tone: getToneClass(portfolioPercent),
            },
            {
              label: "Wynik laczny",
              value: formatSignedCurrency(combinedProfitLossPln),
              tone: getToneClass(combinedProfitLossPln),
            },
          ],
          referenceValue: 0,
          yAxisTickFormatter: formatAxisPercent,
          emptyTitle: "Brakuje danych portfela",
          emptyCopy: "Ten tryb potrzebuje historii portfela do policzenia stopy zwrotu.",
        };
      }

      if (visibleBenchmarkModels.length === 0) {
        return {
          title: "Portfel vs benchmark",
          copy: "Portfel jest widoczny, ale wybrane benchmarki nie zwrocily uzywalnej historii kursu.",
          data,
          lines: [portfolioLine],
          summaryLabel: "Portfel w zakresie",
          summaryValue: formatSignedPercent(portfolioPercent),
          deltaLabel: "Widoczne benchmarki",
          deltaValue: "brak danych",
          deltaTone: "tone-neutral",
          stats: [
            {
              label: "Portfel",
              value: formatSignedPercent(portfolioPercent),
              tone: getToneClass(portfolioPercent),
            },
            {
              label: "Brak serii",
              value: String(missingBenchmarkCount),
            },
            {
              label: "Wynik laczny",
              value: formatSignedCurrency(combinedProfitLossPln),
              tone: getToneClass(combinedProfitLossPln),
            },
          ],
          referenceValue: 0,
          yAxisTickFormatter: formatAxisPercent,
          emptyTitle: "Brakuje danych portfela",
          emptyCopy: "Ten tryb potrzebuje historii portfela do policzenia stopy zwrotu.",
        };
      }

      const comparisons = visibleBenchmarkModels.map((benchmarkModel) => ({
        label: benchmarkModel.label,
        outperformance: round(portfolioPercent - benchmarkModel.currentPercent, 2),
      }));
      const hasPositiveOutperformance = comparisons.some(
        (comparison) => comparison.outperformance >= 0
      );
      const focusComparison =
        comparisons.length === 1
          ? comparisons[0]!
          : hasPositiveOutperformance
            ? comparisons.reduce((bestComparison, comparison) =>
                comparison.outperformance > bestComparison.outperformance
                  ? comparison
                  : bestComparison
              )
            : comparisons.reduce((worstComparison, comparison) =>
                comparison.outperformance < worstComparison.outperformance
                  ? comparison
                  : worstComparison
              );
      const stats = [
        {
          label: "Portfel",
          value: formatSignedPercent(portfolioPercent),
          tone: getToneClass(portfolioPercent),
        },
        ...visibleBenchmarkModels.map((benchmarkModel) => ({
          label: benchmarkModel.label,
          value: formatSignedPercent(benchmarkModel.currentPercent),
          tone: getToneClass(benchmarkModel.currentPercent),
        })),
        missingBenchmarkCount > 0
          ? {
              label: "Brak serii",
              value: String(missingBenchmarkCount),
            }
          : null,
        {
          label: "Wynik laczny",
          value: formatSignedCurrency(combinedProfitLossPln),
          tone: getToneClass(combinedProfitLossPln),
        },
      ].filter((stat): stat is ChartStat => Boolean(stat));

      return {
        title: "Portfel vs benchmark",
        copy: "Stopa zwrotu portfela i benchmarkow jest liczona dziennie, a zakres odnosi sie do poprzedniego punktu wyceny.",
        data,
        lines: [portfolioLine, ...benchmarkLines],
        summaryLabel: "Stopa portfela",
        summaryValue: formatSignedPercent(portfolioPercent),
        deltaLabel:
          comparisons.length === 1
            ? `Przewaga vs ${focusComparison.label}`
            : focusComparison.outperformance >= 0
              ? `Najwieksza przewaga vs ${focusComparison.label}`
              : `Najwieksze opoznienie vs ${focusComparison.label}`,
        deltaValue: formatSignedPercentagePoints(focusComparison.outperformance),
        deltaTone: getToneClass(focusComparison.outperformance),
        stats,
        referenceValue: 0,
        yAxisTickFormatter: formatAxisPercent,
        emptyTitle: "Brakuje serii benchmarkow",
        emptyCopy:
          "Ten tryb potrzebuje historii kursu benchmarku do policzenia stopy zwrotu.",
      };
    }

    const firstPoint = visibleDailyChangePoints[0];
    const lastPoint = visibleDailyChangePoints.at(-1);

    if (!firstPoint || !lastPoint) {
      return {
        title: "Zmiana dzienna",
        copy: "Dzien do dnia, z szybkim odczytem rytmu portfela.",
        data: [],
        lines: [],
        summaryLabel: "Brak danych",
        summaryValue: "0 zl",
        deltaLabel: "Dzienna stopa",
        deltaValue: "0,00%",
        deltaTone: "tone-neutral",
        stats: [],
        referenceValue: 0,
        yAxisTickFormatter: formatCompactCurrency,
        emptyTitle: "Brakuje danych do zmian dziennych",
        emptyCopy: "Zmiana dzienna pojawi sie po zebraniu kolejnych punktow historii.",
      };
    }

    const bestDayPln = Math.max(
      ...visibleDailyChangePoints.map((point) => point.dailyChangePln)
    );
    const worstDayPln = Math.min(
      ...visibleDailyChangePoints.map((point) => point.dailyChangePln)
    );

    return {
      title: "Zmiana dzienna",
      copy: "Szybki widok sesja do sesji, dobry do oceny zmiennosci i tempa portfela.",
      data: visibleDailyChangePoints,
      lines: [
        {
          dataKey: "dailyChangePln",
          label: "Zmiana dzienna",
          color: SERIES_COLORS[2],
          strokeWidth: 2.6,
          valueFormatter: (value) => formatSignedCurrency(value),
          detailFormatter: (row) =>
            typeof row.dailyChangePercent === "number"
              ? formatSignedPercent(Number(row.dailyChangePercent))
              : null,
        },
      ],
      summaryLabel: "Ostatnia zmiana",
      summaryValue: formatSignedCurrency(lastPoint.dailyChangePln),
      deltaLabel: "Dzienna stopa",
      deltaValue: formatSignedPercent(lastPoint.dailyChangePercent),
      deltaTone: getToneClass(lastPoint.dailyChangePercent),
      stats: [
        {
          label: "Najlepszy dzien",
          value: formatSignedCurrency(bestDayPln),
          tone: getToneClass(bestDayPln),
        },
        {
            label: "Najslabszy dzien",
          value: formatSignedCurrency(worstDayPln),
          tone: getToneClass(worstDayPln),
        },
        {
          label: "Zakres",
          value:
            firstPoint.date && lastPoint.date
              ? `${formatDate(firstPoint.date)} - ${formatDate(lastPoint.date)}`
              : "-",
        },
      ],
      referenceValue: 0,
      yAxisTickFormatter: formatCompactCurrency,
      emptyTitle: "Brakuje danych do zmian dziennych",
      emptyCopy: "Zmiana dzienna pojawi sie po zebraniu kolejnych punktow historii.",
    };
  }, [
    benchmarkSeriesById,
    combinedProfitLossPln,
    displayPoints,
    mode,
    rangePreset,
    selectedBenchmarks,
    visibleBenchmarkDefinitions,
    visibleDailyChangePoints,
    visibleDates,
    visibleDrawdownPoints,
    visiblePoints,
    visibleReturnPoints,
  ]);

  const chartLineKeySignature = chartModel.lines.map((line) => line.dataKey).join("|");

  useEffect(() => {
    const chartLineKeys = new Set(
      chartLineKeySignature ? chartLineKeySignature.split("|") : []
    );

    setHiddenSeriesKeys((currentKeys) => {
      const nextKeys = currentKeys.filter((dataKey) => chartLineKeys.has(dataKey));

      if (
        nextKeys.length === currentKeys.length &&
        nextKeys.every((dataKey, index) => dataKey === currentKeys[index])
      ) {
        return currentKeys;
      }

      return nextKeys;
    });
  }, [chartLineKeySignature]);

  const hiddenSeriesKeySet = useMemo(
    () => new Set(hiddenSeriesKeys),
    [hiddenSeriesKeys]
  );
  const visibleChartLines = useMemo(
    () => chartModel.lines.filter((line) => !hiddenSeriesKeySet.has(line.dataKey)),
    [chartModel.lines, hiddenSeriesKeySet]
  );

  const handleToggleSeriesVisibility = (dataKey: string) => {
    setHiddenSeriesKeys((currentKeys) => {
      const isHidden = currentKeys.includes(dataKey);

      if (isHidden) {
        return currentKeys.filter((currentKey) => currentKey !== dataKey);
      }

      const visibleCount = chartModel.lines.filter(
        (line) => !currentKeys.includes(line.dataKey)
      ).length;

      if (visibleCount <= 1) {
        return currentKeys;
      }

      return [...currentKeys, dataKey];
    });
  };

  const handleResetZoom = () => {
    setRangePreset("ALL");
    setHiddenSeriesKeys([]);
  };

  const getActiveChartSvg = () => {
    const activeFrame = isChartModalOpen ? modalChartFrameRef.current : chartFrameRef.current;

    return activeFrame?.querySelector("svg") ?? null;
  };

  const getSerializedChartSvg = () => {
    const svg = getActiveChartSvg();

    if (!svg) {
      return null;
    }

    const clone = svg.cloneNode(true) as SVGSVGElement;
    const bounds = svg.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(bounds.width));
    const height = Math.max(1, Math.ceil(bounds.height));

    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));

    return {
      height,
      source: `<?xml version="1.0" encoding="UTF-8"?>${new XMLSerializer().serializeToString(
        clone
      )}`,
      width,
    };
  };

  const handleExportSvg = () => {
    const svgExport = getSerializedChartSvg();

    if (!svgExport) {
      return;
    }

    downloadBlob(
      new Blob([svgExport.source], { type: "image/svg+xml;charset=utf-8" }),
      `${getChartExportBaseName(mode, rangePreset)}.svg`
    );
  };

  const handleExportPng = () => {
    const svgExport = getSerializedChartSvg();

    if (!svgExport) {
      return;
    }

    const svgUrl = URL.createObjectURL(
      new Blob([svgExport.source], { type: "image/svg+xml;charset=utf-8" })
    );
    const image = new Image();

    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      canvas.width = svgExport.width * scale;
      canvas.height = svgExport.height * scale;

      if (!context) {
        URL.revokeObjectURL(svgUrl);
        return;
      }

      context.scale(scale, scale);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, svgExport.width, svgExport.height);
      context.drawImage(image, 0, 0, svgExport.width, svgExport.height);
      URL.revokeObjectURL(svgUrl);

      canvas.toBlob((blob) => {
        if (blob) {
          downloadBlob(blob, `${getChartExportBaseName(mode, rangePreset)}.png`);
        }
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
    };
    image.src = svgUrl;
  };

  const handleExportCsv = () => {
    const header = ["date", ...visibleChartLines.map((line) => line.label)];
    const rows = chartModel.data.map((row) =>
      [
        row.date,
        ...visibleChartLines.map((line) => {
          const value = row[line.dataKey];

          return typeof value === "number" ? value : null;
        }),
      ]
        .map(toCsvCell)
        .join(",")
    );

    downloadBlob(
      new Blob([`\uFEFF${[header.map(toCsvCell).join(","), ...rows].join("\n")}`], {
        type: "text/csv;charset=utf-8",
      }),
      `${getChartExportBaseName(mode, rangePreset)}.csv`
    );
  };

  if (
    !isLoading &&
    !error &&
    assets.length === 0 &&
    sales.length === 0 &&
    realizedAdjustments.length === 0
  ) {
    return (
      <section className="panel chart-card chart-card-wide">
        <p className="eyebrow">Wykresy liniowe</p>
        <h2 className="section-title">Najpierw dodaj historie portfela</h2>
        <p className="section-copy">
          Tutaj pojawi sie jeden nowoczesny wykres z wieloma trybami: wartosc,
          zwrot, drawdown, benchmarki i zmiana dzienna.
        </p>
      </section>
    );
  }

  const hasRenderableData = chartModel.data.length > 0 && visibleChartLines.length > 0;
  const handleOpenChartModal = () => {
    if (hasRenderableData) {
      setIsChartModalOpen(true);
    }
  };

  const renderLegend = (isFullscreen = false) => (
    <div
      className={
        isFullscreen
          ? "line-visual-legend line-visual-legend-modal"
          : "line-visual-legend"
      }
    >
      {chartModel.lines.map((line) => {
        const isVisible = !hiddenSeriesKeySet.has(line.dataKey);

        return (
          <button
            key={line.dataKey}
            type="button"
            aria-pressed={isVisible}
            className={
              isVisible
                ? "line-visual-legend-item"
                : "line-visual-legend-item is-muted"
            }
            onClick={() => handleToggleSeriesVisibility(line.dataKey)}
            title={
              isVisible
                ? `Ukryj serie ${line.label}`
                : `Pokaz serie ${line.label}`
            }
          >
            <span
              className="line-visual-legend-dot"
              style={{ background: line.color }}
            />
            <span>{line.label}</span>
          </button>
        );
      })}
    </div>
  );

  const renderChartActions = (isFullscreen = false) => (
    <div className="line-visual-chart-actions" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="ghost-button" onClick={handleResetZoom}>
        Reset zoom
      </button>
      <button
        type="button"
        className="ghost-button"
        disabled={!hasRenderableData}
        onClick={handleExportPng}
      >
        PNG
      </button>
      <button
        type="button"
        className="ghost-button"
        disabled={!hasRenderableData}
        onClick={handleExportSvg}
      >
        SVG
      </button>
      <button
        type="button"
        className="ghost-button"
        disabled={!hasRenderableData}
        onClick={handleExportCsv}
      >
        CSV
      </button>
      {isFullscreen ? (
        <button
          type="button"
          className="ghost-button line-visual-close-button"
          onClick={() => setIsChartModalOpen(false)}
        >
          Zamknij
        </button>
      ) : (
        <button
          type="button"
          className="ghost-button line-visual-expand-button"
          disabled={!hasRenderableData}
          onClick={handleOpenChartModal}
        >
          Powieksz
        </button>
      )}
    </div>
  );

  const renderChartFrame = (isFullscreen = false) => {
    const axisFontSize = isFullscreen ? 15 : 12;
    const axisWidth = isFullscreen ? 104 : 84;
    const chartMargin = isFullscreen
      ? { top: 28, right: 30, left: 14, bottom: 18 }
      : { top: 8, right: 8, left: 0, bottom: 0 };

    return (
      <div
        ref={isFullscreen ? modalChartFrameRef : chartFrameRef}
        className={
          isFullscreen
            ? "line-visual-chart-frame line-visual-modal-chart-frame mt-4"
            : "line-visual-chart-frame mt-4"
        }
        role={isFullscreen ? undefined : "button"}
        tabIndex={isFullscreen ? undefined : 0}
        onClick={isFullscreen ? undefined : handleOpenChartModal}
        onKeyDown={
          isFullscreen
            ? undefined
            : (event) => {
                if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
                  event.preventDefault();
                  handleOpenChartModal();
                }
              }
        }
      >
        <ResponsiveContainer width="100%" height={isFullscreen ? "100%" : 420}>
          <ComposedChart data={chartModel.data} margin={chartMargin}>
            {visibleChartLines.some((line) => line.variant === "area") ? (
              <defs>
                {visibleChartLines
                  .filter((line) => line.variant === "area")
                  .map((line) => (
                    <linearGradient
                      key={`gradient-${line.dataKey}`}
                      id={`gradient-${isFullscreen ? "modal-" : ""}${line.dataKey}`}
                      x1="0"
                      x2="0"
                      y1="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={line.color} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={line.color} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
              </defs>
            ) : null}

            <CartesianGrid
              stroke="rgba(20, 35, 48, 0.08)"
              strokeDasharray="3 10"
              vertical={false}
            />
            <XAxis
              axisLine={false}
              dataKey="date"
              minTickGap={isFullscreen ? 48 : 36}
              tick={{ fill: "#7b8895", fontSize: axisFontSize, fontWeight: 700 }}
              tickFormatter={(value) => formatShortDate(String(value))}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              domain={chartModel.yAxisDomain}
              orientation="right"
              tick={{ fill: "#7b8895", fontSize: axisFontSize, fontWeight: 700 }}
              tickFormatter={(value: number) => chartModel.yAxisTickFormatter(value)}
              tickLine={false}
              width={axisWidth}
            />
            <Tooltip
              allowEscapeViewBox={{ x: false, y: false }}
              content={(props) => (
                <ChartTooltip
                  {...props}
                  isFullscreen={isFullscreen}
                  lines={visibleChartLines}
                />
              )}
              cursor={{
                stroke: "rgba(20, 35, 48, 0.16)",
                strokeDasharray: "6 8",
                strokeWidth: isFullscreen ? 1.6 : 1.2,
              }}
              wrapperStyle={{
                outline: "none",
                pointerEvents: "none",
                zIndex: isFullscreen ? 1200 : 20,
              }}
            />

            {typeof chartModel.referenceValue === "number" ? (
              <ReferenceLine
                stroke="rgba(180, 35, 24, 0.24)"
                strokeDasharray="8 8"
                strokeWidth={1}
                y={chartModel.referenceValue}
              />
            ) : null}

            {visibleChartLines.map((line) =>
              line.variant === "area" ? (
                <Area
                  key={line.dataKey}
                  activeDot={{
                    r: isFullscreen ? 6 : 4.5,
                    fill: line.color,
                    stroke: "#ffffff",
                    strokeWidth: 3,
                  }}
                  animationDuration={isFullscreen ? 640 : 480}
                  animationEasing="ease-out"
                  connectNulls={line.connectNulls}
                  dataKey={line.dataKey}
                  fill={`url(#gradient-${isFullscreen ? "modal-" : ""}${line.dataKey})`}
                  fillOpacity={1}
                  stroke={line.color}
                  strokeWidth={isFullscreen ? (line.strokeWidth ?? 2.8) + 0.8 : line.strokeWidth ?? 2.8}
                  type="monotone"
                />
              ) : (
                <Line
                  key={line.dataKey}
                  activeDot={{
                    r: isFullscreen ? 6 : 4.5,
                    fill: line.color,
                    stroke: "#ffffff",
                    strokeWidth: 3,
                  }}
                  animationDuration={isFullscreen ? 640 : 480}
                  animationEasing="ease-out"
                  connectNulls={line.connectNulls}
                  dataKey={line.dataKey}
                  dot={false}
                  stroke={line.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={isFullscreen ? (line.strokeWidth ?? 2.4) + 0.8 : line.strokeWidth ?? 2.4}
                  type="monotone"
                />
              )
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <>
      <section className="panel chart-card chart-card-wide line-visual-panel">
      <div className="line-visual-topbar">
        <div>
          <p className="eyebrow">Wykresy liniowe</p>
          <h2 className="section-title">Jeden wykres, piec trybow analizy</h2>
          <p className="section-copy">
            Widok inspirowany TradingView i myfund: mniej szumu, szybszy odczyt,
            te same dane w roznych perspektywach.
          </p>
        </div>

        <div className="line-chart-range-tabs line-visual-range">
          {RANGE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={
                rangePreset === preset
                  ? "line-chart-range-tab is-active"
                  : "line-chart-range-tab"
              }
              onClick={() => setRangePreset(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      <div className="line-visual-mode-strip mt-6">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              mode === option.value
                ? "line-visual-mode-tab is-active"
                : "line-visual-mode-tab"
            }
            onClick={() => setMode(option.value)}
          >
            <span className="line-visual-mode-name">{option.label}</span>
            <span className="line-visual-mode-copy">{option.copy}</span>
          </button>
        ))}
      </div>

      {mode === "portfolio-vs-benchmark" ? (
        <section className="line-visual-benchmark-panel mt-6">
          <div className="line-visual-benchmark-head">
            <div>
              <p className="table-title">Wyszukaj benchmark</p>
              <p className="table-note">
                Dodaj akcje, ETF-y lub krypto i porownaj ich stopy zwrotu z portfelem.
              </p>
            </div>
            {selectedBenchmarks.length > 0 ? (
              <span className="search-panel-count">{selectedBenchmarks.length}</span>
            ) : null}
          </div>

          <div className="line-chart-range-tabs line-visual-benchmark-search-modes mt-4">
            {SEARCH_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  benchmarkSearchMode === option.value
                    ? "line-chart-range-tab is-active"
                    : "line-chart-range-tab"
                }
                onClick={() => setBenchmarkSearchMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <label className="field line-visual-benchmark-field mt-4">
            <span>Symbol lub nazwa benchmarku</span>
            <input
              type="text"
              value={benchmarkQuery}
              onChange={(event) => setBenchmarkQuery(event.target.value)}
              placeholder={getSearchPlaceholder(benchmarkSearchMode)}
            />
          </label>

          {selectedBenchmarks.length > 0 ? (
            <div className="line-visual-benchmark-list mt-4">
              {selectedBenchmarks.map((benchmark) => {
                const isVisible = visibleBenchmarkIdSet.has(benchmark.id);

                return (
                  <article
                    key={benchmark.id}
                    className={
                      isVisible
                        ? "line-visual-benchmark-card is-active"
                        : "line-visual-benchmark-card"
                    }
                  >
                    <div className="line-visual-benchmark-card-main">
                      <span className="line-visual-benchmark-card-name">{benchmark.name}</span>
                      <span className="line-visual-benchmark-card-meta">
                        {benchmark.symbol}
                      </span>
                    </div>
                    <label className="line-visual-benchmark-toggle">
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() => handleToggleBenchmarkVisibility(benchmark.id)}
                      />
                      <span>Pokaz</span>
                    </label>
                    <button
                      type="button"
                      className="ghost-button line-visual-benchmark-remove"
                      onClick={() => handleRemoveBenchmark(benchmark.id)}
                    >
                      Usun
                    </button>
                  </article>
                );
              })}
            </div>
          ) : null}

          {(hasActiveBenchmarkQuery || benchmarkResults.length > 0 || benchmarkSearchError) ? (
            <div className="search-stack-panel mt-4">
              <div className="search-panel-header">
                <p className="search-panel-title">Sugestie</p>
                {benchmarkResults.length > 0 ? (
                  <span className="search-panel-count">{benchmarkResults.length}</span>
                ) : null}
              </div>

              {hasActiveBenchmarkQuery && isSearchingBenchmarks ? (
                <p className="field-note">Szukam benchmarkow...</p>
              ) : null}

              {hasActiveBenchmarkQuery && benchmarkSearchError ? (
                <p className="field-note field-note-error">{benchmarkSearchError}</p>
              ) : null}

              {!isSearchingBenchmarks && hasActiveBenchmarkQuery && !hasReachedBenchmarkMinimumLength ? (
                <p className="field-note">
                  Wpisz min. {benchmarkSearchMinimumLength} znaki, aby zobaczyc wyniki.
                </p>
              ) : null}

              {!isSearchingBenchmarks &&
              hasReachedBenchmarkMinimumLength &&
              benchmarkResults.length === 0 &&
              !benchmarkSearchError ? (
                <p className="field-note">Brak wynikow</p>
              ) : null}

              {benchmarkResults.length > 0 ? (
                <div className="search-result-list">
                  {benchmarkResults.map((result) => {
                    const benchmark = toBenchmarkDefinition(result, benchmarkSearchMode);
                    const isSelected = selectedBenchmarks.some(
                      (selectedItem) => selectedItem.id === benchmark.id
                    );

                    return (
                      <button
                        key={`${benchmark.id}:${result.symbol}`}
                        type="button"
                        className="search-result-card text-left"
                        onClick={() => handleAddBenchmark(result)}
                      >
                        <p className="search-result-title">{result.name}</p>
                        <p className="search-result-meta">
                          {result.symbol}
                          {isSelected ? " | dodany" : ""}
                        </p>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="line-visual-summary mt-6">
        <article className="line-visual-hero">
          <span className="line-visual-hero-label">{chartModel.summaryLabel}</span>
          <strong className="line-visual-hero-value">{chartModel.summaryValue}</strong>
          <span className={`line-visual-hero-delta ${chartModel.deltaTone}`}>
            {chartModel.deltaLabel}: {chartModel.deltaValue}
          </span>
        </article>

        {chartModel.stats.map((stat) => (
          <article key={stat.label} className="line-visual-stat-card">
            <span className="line-visual-stat-label">{stat.label}</span>
            <strong className={stat.tone ?? "tone-neutral"}>{stat.value}</strong>
          </article>
        ))}
      </div>

      {isUsingFallbackHistory || isLoading || error || displayWarnings.length > 0 ? (
        <div className="line-visual-status mt-6">
          {isUsingFallbackHistory ? (
            <p className="field-note">
              Pokazujemy lokalna, przyblizona historie. Gdy serwer odda pelniejsza
              serie, wykres podmieni ja automatycznie.
            </p>
          ) : null}
          {isLoading ? (
            <p className="field-note">Dociagam dokladniejsza historie portfela...</p>
          ) : null}
          {error ? <p className="field-note field-note-error">{error}</p> : null}
          {displayWarnings.length > 0 ? (
            <div className="line-chart-warning-list">
              {displayWarnings.slice(0, 4).map((warning) => (
                <p key={warning} className="field-note">
                  {warning}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="line-chart-shell line-visual-chart-shell mt-6">
        {hasRenderableData ? (
          <>
            <div className="line-visual-chart-head">
              <div>
                <p className="table-title">{chartModel.title}</p>
                <p className="table-note">{chartModel.copy}</p>
              </div>

              <div className="line-visual-chart-side">
                {renderChartActions()}
                {renderLegend()}
              </div>
            </div>

            {renderChartFrame()}
          </>
        ) : (
          <div className="line-chart-empty">
            <p className="table-title">{chartModel.emptyTitle}</p>
            <p className="table-note mt-2">{chartModel.emptyCopy}</p>
          </div>
        )}
      </div>
      </section>

      {isChartModalOpen && hasRenderableData ? (
        <div
          className="line-visual-modal-backdrop"
          role="presentation"
          onClick={() => setIsChartModalOpen(false)}
        >
          <section
            aria-label="Powiekszony wykres liniowy"
            className="line-visual-modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="line-visual-modal-head">
              <div>
                <p className="eyebrow">Wykres liniowy</p>
                <h2 className="section-title">{chartModel.title}</h2>
                <p className="section-copy">{chartModel.copy}</p>
              </div>
              {renderChartActions(true)}
            </div>

            {renderLegend(true)}
            {renderChartFrame(true)}
          </section>
        </div>
      ) : null}
    </>
  );
}

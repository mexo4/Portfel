"use client";

import Link from "next/link";
import {
  DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps,
} from "recharts";
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import {
  DASHBOARD_WIDGET_DEFINITIONS, DEFAULT_DASHBOARD_LAYOUT, DEFAULT_MOBILE_DASHBOARD_LAYOUT,
  dashboardScopeLayoutsEqual, getDashboardPresetLayouts,
  getDashboardScopeKey, getDashboardWidgetDefinition, normalizeDashboardLayout,
  normalizeDashboardScopeLayouts, type DashboardDevice, type DashboardLayout,
  type DashboardPresetId, type DashboardScopeLayouts, type DashboardWidgetCategory,
  type DashboardWidgetId, type DashboardWidgetLayout,
} from "@/lib/dashboard-layout";
import { createDashboardMutationCoordinator } from "@/lib/dashboard-mutations";
import {
  buildDashboardReadModel, type DashboardOperationRow, type DashboardReadModel,
} from "@/lib/dashboard-read-model";
import { filterChartPointsByRange, type ChartRangePreset } from "@/lib/chart-viewport";
import { convertFromPln } from "@/lib/pricing";
import { fetchCorporateEvents, fetchDashboardLayout, fetchEspiFeed, fetchPortfolioHistory, saveDashboardLayout } from "@/lib/api";
import {
  getCorporateEventLabel, getUpcomingDividendRelevantDate, type CorporateEvent,
  type CorporateEventsResponse,
} from "@/lib/corporate-events";
import { formatCurrency, formatDate } from "@/lib/utils";
import { ESPI_CATEGORY_LABELS, type EspiReportSummary } from "@/lib/espi";
import { isCurrentWarsawDayGpwSession } from "@/lib/gpw-market-calendar";
import type { PortfolioHistoryResponse, PortfolioOperation } from "@/types/portfolio";

const CATEGORY_LABELS: Record<DashboardWidgetCategory, string> = {
  summary: "Stan", charts: "Wykresy", portfolio: "Portfel", activity: "Aktywność",
  calendar: "Kalendarz i obserwowane",
};

const PRESET_LABELS: Record<DashboardPresetId, string> = {
  default: "Domyślny", minimal: "Minimalny", analytical: "Analityczny", dividend: "Dywidendowy",
};

const SIZE_LABELS = { small: "S", medium: "M", large: "L", full: "XL" } as const;
const RANGE_OPTIONS: ChartRangePreset[] = ["1D", "1M", "YTD", "1Y", "MAX"];
const EMPTY_HISTORY: PortfolioHistoryResponse = { points: [], assetSeries: [], warnings: [], benchmarkSeries: [] };

const OPERATION_LABELS: Record<PortfolioOperation["operationType"], string> = {
  BUY: "Zakup", SELL: "Sprzedaż", DIVIDEND: "Dywidenda", DEPOSIT: "Wpłata",
  WITHDRAW: "Wypłata", TRANSFER: "Przelew", CONVERSION: "Przewalutowanie",
  COUPON: "Kupon obligacji", INTEREST: "Odsetki", FEE: "Opłata", TAX: "Podatek",
  SPLIT: "Split", REVERSE_SPLIT: "Scalenie akcji", BONUS: "Bonus", CUSTOM: "Korekta",
};

const getHistoryScopes = (workspace: ReturnType<typeof usePortfolioWorkspace>) =>
  workspace.isAllPortfoliosSelected ? workspace.portfolios.map((portfolio) => ({
    portfolioId: portfolio.id,
    assets: portfolio.assets,
    sales: portfolio.sales,
    realizedAdjustments: portfolio.realizedAdjustments,
    operations: portfolio.operations ?? [],
    accounts: portfolio.accounts ?? [],
  })) : undefined;

const getHistoryAssetSignature = (asset: ReturnType<typeof usePortfolioWorkspace>["assets"][number]) => ({
  id: asset.id, symbol: asset.symbol, kind: asset.kind, quantity: asset.quantity,
  purchaseDate: asset.purchaseDate, purchasePrice: asset.purchasePrice,
  purchaseCurrency: asset.purchaseCurrency, marketCurrency: asset.marketCurrency,
  provider: asset.provider, providerId: asset.providerId,
});

const getHistorySignature = (workspace: ReturnType<typeof usePortfolioWorkspace>) => JSON.stringify({
  scope: getDashboardScopeKey(workspace.activePortfolioId, workspace.isAllPortfoliosSelected),
  assets: workspace.isAllPortfoliosSelected ? [] : workspace.assets.map(getHistoryAssetSignature),
  sales: workspace.sales,
  adjustments: workspace.effectiveRealizedAdjustments,
  operations: workspace.isAllPortfoliosSelected
    ? []
    : workspace.activePortfolio?.operations ?? [],
  accounts: workspace.isAllPortfoliosSelected
    ? []
    : workspace.activePortfolio?.accounts ?? [],
  scopes: getHistoryScopes(workspace)?.map((scope) => ({
    ...scope,
    assets: scope.assets.map(getHistoryAssetSignature),
  })),
  benchmarks: workspace.isAllPortfoliosSelected ? [] : (workspace.activePortfolio?.benchmarks ?? []),
});

type DashboardData = {
  history: PortfolioHistoryResponse | null;
  model: DashboardReadModel;
  isHistoryLoading: boolean;
  isEventsLoading: boolean;
  isWatchlistLoading: boolean;
  historyError: boolean;
  eventsError: boolean;
  watchlistError: boolean;
};

const DashboardDataContext = createContext<DashboardData | null>(null);
const useDashboardData = () => {
  const value = useContext(DashboardDataContext);
  if (!value) throw new Error("Dashboard data is unavailable.");
  return value;
};

function DashboardDataProvider({ children, scopeKey }: { children: ReactNode; scopeKey: string }) {
  const workspace = usePortfolioWorkspace();
  const [history, setHistory] = useState<PortfolioHistoryResponse | null>(null);
  const [events, setEvents] = useState<CorporateEventsResponse | null>(null);
  const [status, setStatus] = useState({ history: true, events: true });
  const [errors, setErrors] = useState({ history: false, events: false });
  const requestGenerationRef = useRef(0);
  const historySignature = getHistorySignature(workspace);

  useEffect(() => {
    const controller = new AbortController();
    const generation = ++requestGenerationRef.current;
    const parsed = JSON.parse(historySignature) as ReturnType<typeof JSON.parse>;
    const isCurrent = () => !controller.signal.aborted && generation === requestGenerationRef.current;
    setHistory(null);
    setEvents(null);
    setStatus({ history: true, events: true });
    setErrors({ history: false, events: false });

    const hasHistoryInput = parsed.assets.length || parsed.sales.length || parsed.adjustments.length || parsed.operations.length ||
      parsed.scopes?.some((item: { assets: unknown[]; sales: unknown[]; realizedAdjustments: unknown[]; operations?: unknown[] }) =>
        item.assets.length || item.sales.length || item.realizedAdjustments.length || (item.operations?.length ?? 0));
    const historyRequest = hasHistoryInput
      ? fetchPortfolioHistory({
          assets: workspace.isAllPortfoliosSelected ? [] : workspace.assets,
          sales: workspace.sales,
          realizedAdjustments: workspace.effectiveRealizedAdjustments,
          operations: workspace.isAllPortfoliosSelected
            ? []
            : workspace.activePortfolio?.operations ?? [],
          accounts: workspace.isAllPortfoliosSelected
            ? []
            : workspace.activePortfolio?.accounts ?? [],
          benchmarks: workspace.isAllPortfoliosSelected ? [] : (workspace.activePortfolio?.benchmarks ?? []),
          portfolioScopes: getHistoryScopes(workspace),
          signal: controller.signal,
        })
      : Promise.resolve(EMPTY_HISTORY);

    void historyRequest.then((value) => { if (isCurrent()) setHistory(value); })
      .catch(() => { if (isCurrent()) setErrors((current) => ({ ...current, history: true })); })
      .finally(() => { if (isCurrent()) setStatus((current) => ({ ...current, history: false })); });

    const portfolioId = workspace.isAllPortfoliosSelected ? "all" : workspace.activePortfolioId;
    void fetchCorporateEvents({ portfolioId, days: 183, signal: controller.signal })
      .then((value) => { if (isCurrent()) setEvents(value); })
      .catch(() => { if (isCurrent()) setErrors((current) => ({ ...current, events: true })); })
      .finally(() => { if (isCurrent()) setStatus((current) => ({ ...current, events: false })); });

    return () => controller.abort();
  // historySignature is the normalized request identity. The workspace object
  // itself intentionally is not a dependency, avoiding duplicate requests.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historySignature, scopeKey]);

  const model = useMemo(() => buildDashboardReadModel({
    history,
    events,
    watchlist: workspace.watchlistItems,
    groups: workspace.groupedAssets,
    portfolios: workspace.isAllPortfoliosSelected
      ? workspace.portfolios
      : workspace.activePortfolio ? [workspace.activePortfolio] : [],
    fallbackProfitLoss: workspace.summaryCombinedProfitLoss,
    fallbackInvested: workspace.summaryTotalInvested,
    cashValue: workspace.summaryCashValue,
  }), [
    events,
    history,
    workspace.activePortfolio,
    workspace.groupedAssets,
    workspace.isAllPortfoliosSelected,
    workspace.portfolios,
    workspace.summaryCombinedProfitLoss,
    workspace.summaryCashValue,
    workspace.summaryTotalInvested,
    workspace.watchlistItems,
  ]);
  const value = useMemo<DashboardData>(() => ({
    history,
    model,
    isHistoryLoading: status.history,
    isEventsLoading: status.events,
    isWatchlistLoading: workspace.isWatchlistLoading,
    historyError: errors.history,
    eventsError: errors.events,
    watchlistError: workspace.watchlistReadError,
  }), [errors, history, model, status, workspace.isWatchlistLoading, workspace.watchlistReadError]);
  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>;
}

function WidgetShell({ eyebrow, title, href, children }: {
  eyebrow: string; title: string; href?: string; children: ReactNode;
}) {
  return (
    <section className="panel panel-compact dashboard-command-card">
      <div className="dashboard-command-card-head">
        <div><p className="eyebrow">{eyebrow}</p><h2 className="section-title">{title}</h2></div>
        {href ? <Link href={href}>Zobacz</Link> : null}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="dashboard-widget-empty">{children}</p>;
}

function Metric({ label, value, detail, tone }: {
  label: string; value: string; detail: string; tone?: "positive" | "negative";
}) {
  return <article className="panel dashboard-metric-card">
    <span>{label}</span><strong className={tone ? `tone-${tone}` : undefined}>{value}</strong><small>{detail}</small>
  </article>;
}

const formatPercent = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "Brak danych" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

function PortfolioStateWidget() {
  const workspace = usePortfolioWorkspace();
  const data = useDashboardData();
  const metrics = data.model.history;
  const daily = metrics.latest?.cashFlowNeutralResultPln;
  const dailyInBase = daily === undefined ? null : convertFromPln(daily, workspace.activeBaseCurrency, workspace.fxRates);
  const dailyPercent = metrics.latest?.cashFlowNeutralResultPercent ?? null;
  const returnPercent = metrics.returnPercent;
  return <WidgetShell eyebrow="Szybki odczyt" title="Stan portfela">
    <div className="dashboard-state-grid">
      <div><span>Wartość</span><strong>{formatCurrency(workspace.summaryTotalValue, workspace.activeBaseCurrency)}</strong></div>
      <div><span>Zysk / strata</span><strong className={workspace.summaryCombinedProfitLoss >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(workspace.summaryCombinedProfitLoss, workspace.activeBaseCurrency)}</strong></div>
      <div><span>Stopa zwrotu</span><strong>{formatPercent(returnPercent)}</strong></div>
      <div><span>Wynik dzienny</span><strong className={dailyInBase === null ? undefined : dailyInBase >= 0 ? "tone-positive" : "tone-negative"}>{dailyInBase === null ? (data.isHistoryLoading ? "Wczytywanie…" : "Brak danych") : formatCurrency(dailyInBase, workspace.activeBaseCurrency)}</strong><small>{dailyPercent === null ? "neutralny względem przepływów" : `${formatPercent(dailyPercent)} · bez wpłat i wypłat`}</small></div>
    </div>
  </WidgetShell>;
}

function DashboardMetricWidget({ id }: { id: DashboardWidgetId }) {
  const workspace = usePortfolioWorkspace();
  const data = useDashboardData();
  const history = data.model.history;
  const latestDaily = history.latest?.cashFlowNeutralResultPln;
  const dailyBase = latestDaily === undefined ? null : convertFromPln(latestDaily, workspace.activeBaseCurrency, workspace.fxRates);
  const values: Partial<Record<DashboardWidgetId, { label: string; value: string; detail: string; tone?: "positive" | "negative" }>> = {
    "portfolio-value": { label: "Wartość", value: formatCurrency(workspace.summaryTotalValue, workspace.activeBaseCurrency), detail: workspace.isAllPortfoliosSelected ? "Wszystkie portfele" : workspace.activePortfolio?.name ?? "Portfel" },
    "profit-loss": { label: "Zysk / strata", value: formatCurrency(workspace.summaryCombinedProfitLoss, workspace.activeBaseCurrency), detail: "Wynik łączny", tone: workspace.summaryCombinedProfitLoss >= 0 ? "positive" : "negative" },
    "return-rate": { label: "Stopa zwrotu", value: formatPercent(history.returnPercent), detail: "Istniejący kapitał i P/L" },
    "daily-result": { label: "Wynik dzienny", value: dailyBase === null ? (data.isHistoryLoading ? "Wczytywanie…" : "Brak danych") : formatCurrency(dailyBase, workspace.activeBaseCurrency), detail: history.latest?.cashFlowNeutralResultPercent === null || history.latest?.cashFlowNeutralResultPercent === undefined ? "Bez wpłat i wypłat" : `${formatPercent(history.latest.cashFlowNeutralResultPercent)} · bez wpłat i wypłat`, tone: dailyBase === null ? undefined : dailyBase >= 0 ? "positive" : "negative" },
    "invested-capital": { label: "Zainwestowany kapitał", value: formatCurrency(workspace.summaryTotalInvested, workspace.activeBaseCurrency), detail: "Kapitał netto" },
    cash: { label: "Gotówka", value: formatCurrency(workspace.summaryCashValue, workspace.activeBaseCurrency), detail: "Saldo z rachunków" },
    "dividends-ytd": { label: "Dywidendy YTD", value: formatCurrency(workspace.activeDividendYtd, workspace.activeBaseCurrency), detail: "Otrzymane w bieżącym roku" },
  };
  return <Metric {...values[id]!} />;
}

type DashboardChartMode = "value" | "result" | "daily" | "benchmark";

type DashboardChartRow = { date: string; value: number; benchmark?: number | null };

function DashboardChartTooltip({
  active,
  label,
  payload,
  mode,
  currency,
}: TooltipContentProps & { mode: DashboardChartMode; currency: string }) {
  if (!active || !label || !payload?.length) return null;

  const labels = mode === "benchmark"
    ? { value: "Portfel", benchmark: "Benchmark" }
    : { value: mode === "value" ? "Wartość portfela" : mode === "daily" ? "Wynik dzienny" : "Wynik portfela" };

  return <div className="line-chart-tooltip line-visual-tooltip dashboard-chart-tooltip">
    <p className="table-title">{formatDate(String(label))}</p>
    <div className="line-chart-tooltip-list">
      {payload.map((entry) => {
        const key = String(entry.dataKey ?? "value") as "value" | "benchmark";
        if (entry.value === null || entry.value === undefined) return null;
        const value = Number(entry.value);
        if (!Number.isFinite(value)) return null;
        return <div key={key} className="line-chart-tooltip-row">
          <span className="line-chart-tooltip-key"><span className="line-chart-tooltip-dot" style={{ background: entry.color }} /><span className="line-chart-tooltip-label">{labels[key] ?? key}</span></span>
          <strong className="line-chart-tooltip-value">{mode === "benchmark" ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : formatCurrency(value, currency)}</strong>
        </div>;
      })}
    </div>
  </div>;
}

function DashboardChart({ mode }: { mode: DashboardChartMode }) {
  const workspace = usePortfolioWorkspace();
  const data = useDashboardData();
  const [range, setRange] = useState<ChartRangePreset>("1M");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const href = workspace.getReadHref("/analytics/charts");
  const history = data.model.history;
  const points = filterChartPointsByRange(history.points, range);
  const dailyPoints = filterChartPointsByRange(history.dailyPoints, range);
  const benchmark = history.benchmark;
  const benchmarkByDate = new Map(benchmark?.points.map((point) => [point.date, point.returnPercent]) ?? []);
  const chartData: DashboardChartRow[] = mode === "daily" ? dailyPoints.map((point) => ({
    date: point.date,
    value: convertFromPln(point.cashFlowNeutralResultPln, workspace.activeBaseCurrency, workspace.fxRates),
  })) : points.filter((point) => mode !== "benchmark" || point.timeWeightedReturnPercent !== null).map((point) => ({
    date: point.date,
    value: mode === "value"
      ? convertFromPln(point.portfolioValuePln, workspace.activeBaseCurrency, workspace.fxRates)
      : mode === "result"
        ? convertFromPln(point.profitLossPln, workspace.activeBaseCurrency, workspace.fxRates)
        : point.timeWeightedReturnPercent ?? 0,
    benchmark: mode === "benchmark" ? benchmarkByDate.get(point.date) ?? null : null,
  }));
  const title = mode === "value" ? "Wartość portfela" : mode === "result" ? "Wynik portfela" : mode === "daily" ? "Wynik dzienny" : "Portfel vs benchmark";
  const noBenchmark = mode === "benchmark" && (!benchmark || workspace.isAllPortfoliosSelected);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setIsFullscreen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown); };
  }, [isFullscreen]);

  const renderChart = (fullscreen = false) => <ResponsiveContainer width="100%" height="100%">
    {mode === "daily" ? <BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" hide={!fullscreen} tickFormatter={(value) => formatDate(String(value))} /><YAxis hide /><Tooltip content={(props) => <DashboardChartTooltip {...props} mode={mode} currency={workspace.activeBaseCurrency} />} /><Bar dataKey="value" fill="#0f766e" radius={[4, 4, 0, 0]} /></BarChart>
      : mode === "benchmark" ? <LineChart data={chartData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" hide={!fullscreen} tickFormatter={(value) => formatDate(String(value))} /><YAxis hide /><Tooltip content={(props) => <DashboardChartTooltip {...props} mode={mode} currency={workspace.activeBaseCurrency} />} /><Line type="monotone" dataKey="value" stroke="#0f766e" dot={false} strokeWidth={2.5} /><Line type="monotone" dataKey="benchmark" stroke="#c47c2b" dot={false} strokeWidth={2} /></LineChart>
      : <AreaChart data={chartData}><defs><linearGradient id={`dashboard-${mode}${fullscreen ? "-fullscreen" : ""}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0f766e" stopOpacity={0.28} /><stop offset="1" stopColor="#0f766e" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" hide={!fullscreen} tickFormatter={(value) => formatDate(String(value))} /><YAxis hide /><Tooltip content={(props) => <DashboardChartTooltip {...props} mode={mode} currency={workspace.activeBaseCurrency} />} /><Area type="monotone" dataKey="value" stroke="#0f766e" fill={`url(#dashboard-${mode}${fullscreen ? "-fullscreen" : ""})`} strokeWidth={2.5} dot={false} /></AreaChart>}
  </ResponsiveContainer>;

  return <WidgetShell eyebrow="Wykresy" title={title} href={href}>
    <div className="dashboard-mini-chart-toolbar" aria-label="Zakres wykresu">
      {RANGE_OPTIONS.map((item) => <button key={item} type="button" className={range === item ? "is-active" : ""} onClick={() => setRange(item)}>{item}</button>)}
    </div>
    {data.isHistoryLoading ? <EmptyState>Wczytywanie wspólnej historii…</EmptyState> : data.historyError ? <EmptyState>Historia jest chwilowo niedostępna.</EmptyState> : noBenchmark ? <EmptyState>{workspace.isAllPortfoliosSelected ? "Benchmark nie jest syntetyzowany dla Wszystkich portfeli." : "Najpierw ustaw benchmark na stronie Wykresy."}</EmptyState> : chartData.length < 2 ? <EmptyState>Za mało danych do wyświetlenia wykresu.</EmptyState> : <>
      <div className="dashboard-mini-chart" aria-label={`${title}. Dwuklik otwiera pełny ekran.`} onDoubleClick={() => { if (window.matchMedia("(min-width: 861px)").matches) setIsFullscreen(true); }}>{renderChart()}</div>
      {isFullscreen ? <div className="dashboard-chart-modal" role="dialog" aria-modal="true" aria-label={`${title} — pełny ekran`}><div className="dashboard-chart-modal-head"><div><p className="eyebrow">Wykresy</p><h2 className="section-title">{title}</h2></div><button type="button" className="dashboard-widget-icon-button" onClick={() => setIsFullscreen(false)} aria-label="Zamknij pełny ekran">×</button></div><div className="dashboard-chart-modal-canvas">{renderChart(true)}</div></div> : null}
    </>}
  </WidgetShell>;
}

function AllocationWidget({ mode }: { mode: "combined" | "classes" | "geography" }) {
  const workspace = usePortfolioWorkspace();
  const { allocations } = useDashboardData().model;
  const { classes, geography } = allocations;
  const items = mode === "geography" ? geography.map((item) => ({ label: item.country, value: item.totalValue })) : classes.map((item) => ({ label: item.label, value: item.totalValue }));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  const title = mode === "geography" ? "Struktura geograficzna" : mode === "classes" ? "Struktura klas aktywów" : "Struktura portfela";
  return <WidgetShell eyebrow="Koncentracja" title={title} href={workspace.getReadHref("/analytics/structure")}>
    {items.length ? <div className="dashboard-allocation-list">{items.slice(0, mode === "combined" ? 4 : 6).map((item) => {
      const percent = total > 0 ? (item.value / total) * 100 : 0;
      return <div key={item.label}><span><strong>{item.label}</strong><small>{percent.toFixed(1)}%</small></span><i><b style={{ width: `${percent}%` }} /></i></div>;
    })}</div> : <EmptyState>Brak potwierdzonych danych do tej struktury.</EmptyState>}
  </WidgetShell>;
}

function ConcentrationWidget() {
  const workspace = usePortfolioWorkspace();
  const value = useDashboardData().model.concentration;
  return <WidgetShell eyebrow="Portfel" title="Koncentracja" href={workspace.getReadHref("/analytics/structure")}>
    {value.largest ? <div className="dashboard-concentration-grid">
      <div><span>Największa pozycja</span><strong>{value.largest.label}</strong><small>{value.largest.percent.toFixed(1)}%</small></div>
      <div><span>Top 3</span><strong>{value.topThreePercent.toFixed(1)}%</strong></div>
      <div><span>Dominująca klasa</span><strong>{value.dominantClass?.label ?? "Brak danych"}</strong><small>{value.dominantClass ? `${value.dominantClass.percent.toFixed(1)}%` : ""}</small></div>
      <div><span>Geografia</span><strong>{value.dominantGeography?.label ?? "Brak danych"}</strong><small>{value.dominantGeography ? `${value.dominantGeography.percent.toFixed(1)}%` : ""}</small></div>
    </div> : <EmptyState>Koncentracja pojawi się po dodaniu pozycji.</EmptyState>}
  </WidgetShell>;
}

function PositionList({ mode }: { mode: "current" | "largest" | "gains" | "losses" | "recent" }) {
  const workspace = usePortfolioWorkspace();
  const groups = useDashboardData().model.positions[mode];
  const title = mode === "current" ? "Bieżące pozycje" : mode === "largest" ? "Największe pozycje" : mode === "gains" ? "Najwięksi wygrani" : mode === "losses" ? "Najwięksi przegrani" : "Ostatnio dodane pozycje";
  return <WidgetShell eyebrow="Portfel" title={title} href={workspace.getReadHref("/portfolio/positions")}>
    {groups.length ? <div className="dashboard-compact-list">{groups.map((group) => <div key={group.key}>
      <span><strong title={group.name}>{group.name}</strong><small>{group.symbol}{group.portfolioName ? ` · ${group.portfolioName}` : ""}</small></span>
      <span><strong>{formatCurrency(group.totalValue, workspace.activeBaseCurrency)}</strong><small className={group.profitLossBase >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(group.profitLossBase, workspace.activeBaseCurrency)}</small></span>
    </div>)}</div> : <EmptyState>Brak pasujących otwartych pozycji.</EmptyState>}
  </WidgetShell>;
}

const getOperationSymbol = (row: DashboardOperationRow) => {
  if (row.instrumentSymbol) return row.instrumentSymbol;
  const { operation } = row;
  const metadata = operation.metadata as { symbol?: unknown } | undefined;
  return typeof metadata?.symbol === "string" && metadata.symbol.trim()
    ? metadata.symbol
    : OPERATION_LABELS[operation.operationType];
};

const getMetadataNumber = (operation: PortfolioOperation, key: string) => {
  const value = operation.metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const getMetadataString = (operation: PortfolioOperation, key: string) => {
  const value = operation.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const formatOperationDetail = (row: DashboardOperationRow) => {
  const { operation } = row;
  const symbol = getOperationSymbol(row);
  if ((operation.operationType === "BUY" || operation.operationType === "SELL") && operation.quantity) {
    return `${symbol} · ${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 8 }).format(operation.quantity)} szt.`;
  }
  if (operation.operationType === "DIVIDEND") {
    const net = getMetadataNumber(operation, "netAmount") ?? operation.amount;
    return `${symbol} · +${formatCurrency(Math.abs(net), operation.currency)} netto`;
  }
  if (operation.operationType === "CONVERSION") {
    const targetAmount = getMetadataNumber(operation, "targetAmount");
    const targetCurrency = getMetadataString(operation, "targetCurrency");
    if (targetAmount !== null && targetCurrency) {
      return `${formatCurrency(Math.abs(operation.amount), operation.currency)} → ${formatCurrency(Math.abs(targetAmount), targetCurrency)}`;
    }
  }
  if (operation.operationType === "TRANSFER") {
    const targetAmount = getMetadataNumber(operation, "targetAmount") ?? operation.amount;
    const targetCurrency = getMetadataString(operation, "targetCurrency") ?? operation.currency;
    return `${formatCurrency(Math.abs(operation.amount), operation.currency)} → ${formatCurrency(Math.abs(targetAmount), targetCurrency)}`;
  }
  return `${operation.operationType === "DEPOSIT" || operation.operationType === "INTEREST" || operation.operationType === "BONUS" ? "+" : operation.operationType === "WITHDRAW" || operation.operationType === "FEE" || operation.operationType === "TAX" ? "−" : ""}${formatCurrency(Math.abs(operation.amount), operation.currency)}`;
};

function OperationsWidget({ mode }: { mode: "all" | "cash" | "dividends" }) {
  const workspace = usePortfolioWorkspace();
  const operations = useDashboardData().model.operations[mode];
  const title = mode === "all" ? "Ostatnie operacje" : mode === "cash" ? "Ostatnie wpłaty i wypłaty" : "Ostatnie dywidendy";
  return <WidgetShell eyebrow="Aktywność" title={title} href={workspace.getReadHref(mode === "dividends" ? "/portfolio/dividends" : "/portfolio/operations")}>
    {operations.length ? <div className="dashboard-compact-list dashboard-operation-list">{operations.map((row) => <div key={`${row.portfolioName}:${row.operation.id}`}>
      <span><strong>{OPERATION_LABELS[row.operation.operationType]}</strong><small>{formatOperationDetail(row)}</small></span>
      <span><strong>{formatDate(row.operation.date)}</strong><small>{workspace.isAllPortfoliosSelected ? row.portfolioName : row.operation.notes || ""}</small></span>
    </div>)}</div> : <EmptyState>Brak zapisanych operacji tego typu.</EmptyState>}
  </WidgetShell>;
}

const trackingLabel = (event: CorporateEvent) => event.trackingSource === "HELD_AND_WATCHLIST" ? "PORTFEL + OBSERWOWANE" : event.trackingSource === "WATCHLIST" ? "OBSERWOWANE" : "PORTFEL";

function EventsWidget({ mode }: { mode: "reports" | "dividends" | "timeline" | "watched" }) {
  const workspace = usePortfolioWorkspace();
  const data = useDashboardData();
  const items = data.model.events[mode];
  const title = mode === "reports" ? "Wydarzenia GPW" : mode === "dividends" ? "Nadchodzące dywidendy" : mode === "watched" ? "Najbliższe wydarzenia obserwowanych" : "Nadchodzące";
  return <WidgetShell eyebrow="Kalendarz" title={title} href={workspace.getReadHref(mode === "dividends" ? "/portfolio/dividends" : "/market/events")}>
    {data.isEventsLoading ? <EmptyState>Wczytywanie jednego wspólnego kalendarza…</EmptyState> : data.eventsError ? <EmptyState>Kalendarz jest chwilowo niedostępny.</EmptyState> : items.length ? <div className="dashboard-event-list">{items.map((event) => {
      const date = event.eventType === "UPCOMING_DIVIDEND" ? getUpcomingDividendRelevantDate(event) ?? event.eventDate : event.eventDate;
      return <article key={event.id}><time dateTime={date}><strong>{new Date(`${date}T00:00:00`).getDate()}</strong><span>{new Intl.DateTimeFormat("pl-PL", { month: "short" }).format(new Date(`${date}T00:00:00`)).replace(".", "")}</span></time><div><strong>{event.companyName}</strong><span>{event.eventType === "UPCOMING_DIVIDEND" ? `${formatCurrency(event.dividendPerShare ?? 0, event.dividendCurrency ?? "PLN")} / akcję` : getCorporateEventLabel(event)}</span><small>{trackingLabel(event)}</small></div></article>;
    })}</div> : <EmptyState>Brak przyszłych wydarzeń w tym zakresie.</EmptyState>}
  </WidgetShell>;
}

function LatestEspiWidget() {
  const workspace = usePortfolioWorkspace();
  const [items, setItems] = useState<EspiReportSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const trackedSignature = JSON.stringify({
    portfolios: workspace.portfolios.map((portfolio) => ({
      id: portfolio.id,
      assets: portfolio.assets.map((asset) => [asset.id, asset.symbol, asset.quantity]),
    })),
    watchlist: workspace.watchlistItems.map((item) => item.canonicalKey),
  });

  useEffect(() => {
    const controller = new AbortController();
    void fetchEspiFeed({ scope: "mine", limit: 5, signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) {
          setItems(response.items);
          setState("ready");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) {
          setState("error");
        }
      });
    return () => controller.abort();
  }, [trackedSignature]);

  return <WidgetShell eyebrow="Rynek" title="Najnowsze ESPI" href={workspace.getReadHref("/market/espi")}>
    {state === "loading" ? <EmptyState>Wczytywanie raportów ESPI…</EmptyState>
      : state === "error" ? <EmptyState>Raporty ESPI są chwilowo niedostępne.</EmptyState>
        : items.length ? <div className="dashboard-espi-list">{items.map((report) => <Link key={report.id} href={workspace.getReadHref(`/market/espi/${report.id}`)}><span><strong>{report.issuerName}</strong><small>{new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(report.publishedAt))}</small></span><b>{report.title}</b><em>{ESPI_CATEGORY_LABELS[report.category]}</em></Link>)}</div>
          : <EmptyState>Brak nowych raportów posiadanych lub obserwowanych spółek.</EmptyState>}
  </WidgetShell>;
}

function WatchlistWidget({ changesOnly = false }: { changesOnly?: boolean }) {
  const workspace = usePortfolioWorkspace();
  const data = useDashboardData();
  const rows = (changesOnly ? data.model.watchlist.changedRows : data.model.watchlist.rows).slice(0, 6);
  const title = changesOnly ? "Dzisiejsze zmiany obserwowanych" : "Watchlista";
  return <WidgetShell eyebrow="Obserwowane" title={title} href={workspace.getReadHref("/market/watchlist")}>
    {data.isWatchlistLoading ? <EmptyState>Wczytywanie watchlisty…</EmptyState> : data.watchlistError ? <EmptyState>Watchlista jest chwilowo niedostępna.</EmptyState> : rows.length ? <div className="dashboard-compact-list">{rows.map(({ item, group }) => <div key={item.canonicalKey}>
      <span><strong>{item.name}</strong><small>{item.symbol}</small></span>
      <span><strong>{group?.latestUnitPrice ? formatCurrency(group.latestUnitPrice, group.marketCurrency) : "Brak kursu"}</strong><small className={group?.dailyChangePercent === undefined ? undefined : group.dailyChangePercent >= 0 ? "tone-positive" : "tone-negative"}>{group?.dailyChangePercent === undefined ? "Brak snapshotu zmiany" : formatPercent(group.dailyChangePercent)}</small></span>
    </div>)}</div> : <EmptyState>{changesOnly && data.model.watchlist.items.length ? "Istniejące snapshoty nie dostarczają dziś zmiany obserwowanych spółek." : "Watchlista jest pusta."}</EmptyState>}
  </WidgetShell>;
}

function DailySnapshotWidget() {
  const workspace = usePortfolioWorkspace();
  const data = useDashboardData();
  const snapshot = data.model.dailySnapshot;
  const latest = snapshot.latest;
  const dailyResult = latest ? convertFromPln(latest.cashFlowNeutralResultPln, workspace.activeBaseCurrency, workspace.fxRates) : null;
  const raw = latest ? convertFromPln(latest.rawValueChangePln, workspace.activeBaseCurrency, workspace.fxRates) : null;
  const { best, worst, benchmarkPercent: benchmark } = snapshot;
  const isSessionDay = isCurrentWarsawDayGpwSession();
  return <WidgetShell eyebrow={isSessionDay ? "Dzisiaj" : "Dzień wolny od sesji"} title="Co się zmieniło?" href={workspace.getReadHref("/analytics/performance")}>
    {!isSessionDay ? <p className="dashboard-session-note">Najnowsze zmiany pochodzą z ostatniej zakończonej sesji.</p> : null}
    {data.isHistoryLoading ? <EmptyState>Wczytywanie dziennego snapshotu…</EmptyState> : latest ? <div className="dashboard-snapshot-grid">
      <div><span>Zmiana wartości</span><strong className={raw !== null && raw >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(raw ?? 0, workspace.activeBaseCurrency)}</strong></div>
      <div><span>Wynik inwestycyjny</span><strong className={dailyResult !== null && dailyResult >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(dailyResult ?? 0, workspace.activeBaseCurrency)}</strong><small>{latest.cashFlowNeutralResultPercent === null ? "bez przepływów" : `${formatPercent(latest.cashFlowNeutralResultPercent)} · bez przepływów`}</small></div>
      <div><span>Najlepsza pozycja</span><strong>{best?.name ?? "Brak danych"}</strong><small>{best ? formatPercent(best.dailyChangePercent) : ""}</small></div>
      <div><span>Najsłabsza pozycja</span><strong>{worst?.name ?? "Brak danych"}</strong><small>{worst ? formatPercent(worst.dailyChangePercent) : ""}</small></div>
      <div><span>Benchmark</span><strong>{benchmark === null || benchmark === undefined ? "Brak danych" : formatPercent(benchmark)}</strong></div>
    </div> : <EmptyState>Brak co najmniej dwóch punktów historii.</EmptyState>}
  </WidgetShell>;
}

function DashboardWidgetContent({ widgetId }: { widgetId: DashboardWidgetId }) {
  if (widgetId === "portfolio-state") return <PortfolioStateWidget />;
  if (["portfolio-value", "profit-loss", "return-rate", "daily-result", "invested-capital", "cash", "dividends-ytd"].includes(widgetId)) return <DashboardMetricWidget id={widgetId} />;
  if (widgetId === "portfolio-chart") return <DashboardChart mode="value" />;
  if (widgetId === "portfolio-result-chart") return <DashboardChart mode="result" />;
  if (widgetId === "portfolio-vs-benchmark") return <DashboardChart mode="benchmark" />;
  if (widgetId === "daily-result-chart") return <DashboardChart mode="daily" />;
  if (widgetId === "daily-snapshot") return <DailySnapshotWidget />;
  if (widgetId === "portfolio-structure") return <AllocationWidget mode="combined" />;
  if (widgetId === "geographic-structure") return <AllocationWidget mode="geography" />;
  if (widgetId === "asset-class-structure") return <AllocationWidget mode="classes" />;
  if (widgetId === "concentration") return <ConcentrationWidget />;
  if (widgetId === "current-positions") return <PositionList mode="current" />;
  if (widgetId === "largest-positions") return <PositionList mode="largest" />;
  if (widgetId === "biggest-gains") return <PositionList mode="gains" />;
  if (widgetId === "biggest-losses") return <PositionList mode="losses" />;
  if (widgetId === "recently-added") return <PositionList mode="recent" />;
  if (widgetId === "recent-operations") return <OperationsWidget mode="all" />;
  if (widgetId === "recent-cash-flows") return <OperationsWidget mode="cash" />;
  if (widgetId === "recent-dividends") return <OperationsWidget mode="dividends" />;
  if (widgetId === "gpw-events") return <EventsWidget mode="reports" />;
  if (widgetId === "upcoming-dividends") return <EventsWidget mode="dividends" />;
  if (widgetId === "upcoming-timeline") return <EventsWidget mode="timeline" />;
  if (widgetId === "watchlist-events") return <EventsWidget mode="watched" />;
  if (widgetId === "watchlist-daily-changes") return <WatchlistWidget changesOnly />;
  if (widgetId === "latest-espi") return <LatestEspiWidget />;
  return <WatchlistWidget />;
}

function SortableWidget({ widget, isEditing, device, index, total, onRemove, onResize, onMove }: {
  widget: DashboardWidgetLayout; isEditing: boolean; device: DashboardDevice; index: number; total: number;
  onRemove: (id: DashboardWidgetId) => void;
  onResize: (id: DashboardWidgetId, size: DashboardWidgetLayout["size"]) => void;
  onMove: (id: DashboardWidgetId, direction: -1 | 1) => void;
}) {
  const definition = getDashboardWidgetDefinition(widget.id);
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: widget.id, disabled: !isEditing });
  if (!definition) return null;
  return <div ref={setNodeRef} className={`dashboard-widget dashboard-widget--${widget.size}${isEditing ? " is-editing" : ""}${isDragging ? " is-dragging" : ""}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
    {isEditing ? <div className="dashboard-widget-editor" aria-label={`Edytuj widget ${definition.label}`}>
      <button type="button" className="dashboard-widget-drag-handle" aria-label={`Przeciągnij ${definition.label}`} {...attributes} {...listeners}>⠿</button>
      <strong>{definition.label}</strong>
      {device === "desktop" ? <label><span className="sr-only">Rozmiar {definition.label}</span><select value={widget.size} onChange={(event) => onResize(widget.id, event.target.value as DashboardWidgetLayout["size"])}>{definition.sizes.map((size) => <option key={size} value={size}>{SIZE_LABELS[size]}</option>)}</select></label> : <span className="dashboard-mobile-size-label">1 kolumna</span>}
      <div className="dashboard-widget-move-actions">
        <button type="button" className="dashboard-widget-icon-button" onClick={() => onMove(widget.id, -1)} disabled={index === 0} aria-label={`Przenieś ${definition.label} wyżej`}>↑</button>
        <button type="button" className="dashboard-widget-icon-button" onClick={() => onMove(widget.id, 1)} disabled={index === total - 1} aria-label={`Przenieś ${definition.label} niżej`}>↓</button>
        <button type="button" className="dashboard-widget-icon-button is-danger" onClick={() => onRemove(widget.id)} aria-label={`Usuń ${definition.label}`}>×</button>
      </div>
    </div> : null}
    <div className="dashboard-widget-content"><DashboardWidgetContent widgetId={widget.id} /></div>
  </div>;
}

function DashboardCategoryIcon({ category }: { category: DashboardWidgetCategory }) {
  if (category === "charts") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 9 12l4 3 7-9" /></svg>;
  if (category === "portfolio") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M8 6V4h8v2M3 11h18" /></svg>;
  if (category === "activity") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M15 3l4 4-4 4M19 17H5M9 13l-4 4 4 4" /></svg>;
  if (category === "calendar") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="13" width="3" height="7" rx="1" /><rect x="10.5" y="8" width="3" height="12" rx="1" /><rect x="17" y="4" width="3" height="16" rx="1" /></svg>;
}

export default function ConfigurableDashboard() {
  const workspace = usePortfolioWorkspace();
  const scopeKey = getDashboardScopeKey(workspace.activePortfolioId, workspace.isAllPortfoliosSelected);
  const scopeName = workspace.isAllPortfoliosSelected ? "Wszystkie portfele" : workspace.activePortfolio?.name ?? "Portfel";
  const [layouts, setLayouts] = useState<DashboardScopeLayouts>(() => normalizeDashboardScopeLayouts(null));
  const [draft, setDraft] = useState<DashboardScopeLayouts>(() => normalizeDashboardScopeLayouts(null));
  const [displayDevice, setDisplayDevice] = useState<DashboardDevice>("desktop");
  const [isEditing, setIsEditing] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copySource, setCopySource] = useState("");
  const [preset, setPreset] = useState<DashboardPresetId>("default");
  const [libraryQuery, setLibraryQuery] = useState("");
  const loadGenerationRef = useRef(0);
  const mutationCoordinatorRef = useRef(createDashboardMutationCoordinator());
  const copyAbortRef = useRef<AbortController | null>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const libraryTitleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    const query = window.matchMedia("(max-width: 860px)");
    const update = () => setDisplayDevice(query.matches ? "mobile" : "desktop");
    update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    mutationCoordinatorRef.current.enterScope(scopeKey);
    copyAbortRef.current?.abort();
    copyAbortRef.current = null;
    const controller = new AbortController();
    const generation = ++loadGenerationRef.current;
    setIsLoading(true); setError(null); setIsEditing(false); setIsLibraryOpen(false);
    setIsSaving(false); setIsCopying(false); setCopySource("");
    void fetchDashboardLayout(scopeKey, controller.signal).then((response) => {
      if (controller.signal.aborted || generation !== loadGenerationRef.current || response.scopeKey !== scopeKey) return;
      const normalized = normalizeDashboardScopeLayouts(response.layouts);
      setLayouts(normalized); setDraft(normalized);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted && !(reason instanceof DOMException && reason.name === "AbortError")) setError("Nie udało się wczytać układu tego portfela. Pokazujemy układ domyślny.");
    }).finally(() => { if (!controller.signal.aborted && generation === loadGenerationRef.current) setIsLoading(false); });
    return () => { controller.abort(); copyAbortRef.current?.abort(); };
  }, [scopeKey]);

  const displayed = (isEditing ? draft : layouts)[displayDevice];
  const existing = useMemo(() => new Set(draft[displayDevice].widgets.map((item) => item.id)), [draft, displayDevice]);
  const updateDeviceDraft = useCallback((updater: (layout: DashboardLayout) => DashboardLayout) => {
    setDraft((current) => ({ ...current, [displayDevice]: normalizeDashboardLayout(updater(current[displayDevice]), displayDevice === "desktop" ? DEFAULT_DASHBOARD_LAYOUT : DEFAULT_MOBILE_DASHBOARD_LAYOUT) }));
  }, [displayDevice]);

  const visibleDefinitions = useMemo(() => {
    const normalized = libraryQuery.trim().toLocaleLowerCase("pl-PL");
    if (!normalized) return DASHBOARD_WIDGET_DEFINITIONS;
    return DASHBOARD_WIDGET_DEFINITIONS.filter((definition) =>
      `${definition.label} ${definition.description} ${CATEGORY_LABELS[definition.category]}`
        .toLocaleLowerCase("pl-PL")
        .includes(normalized)
    );
  }, [libraryQuery]);

  const persist = useCallback((next: DashboardScopeLayouts, close = false) => {
    const coordinator = mutationCoordinatorRef.current;
    const inFlight = coordinator.getSave(scopeKey);
    if (inFlight) return inFlight;
    const normalized = normalizeDashboardScopeLayouts(next);
    if (dashboardScopeLayoutsEqual(layouts, normalized)) { if (close) setIsEditing(false); return Promise.resolve(true); }
    const savingScope = scopeKey; const previous = layouts; const token = coordinator.capture(savingScope);
    setIsSaving(true); setError(null); setLayouts(normalized);
    const request = saveDashboardLayout(savingScope, normalized).then((response) => {
      if (!coordinator.isCurrent(token) || response.scopeKey !== savingScope) return false;
      const saved = normalizeDashboardScopeLayouts(response.layouts);
      setLayouts(saved); setDraft(saved); if (close) setIsEditing(false); return true;
    }).catch(() => {
      if (coordinator.isCurrent(token)) { setLayouts(previous); setDraft(previous); setError("Nie udało się zapisać układu. Przywróciliśmy ostatnią potwierdzoną wersję."); }
      return false;
    }).finally(() => { if (coordinator.isCurrent(token)) setIsSaving(false); });
    return coordinator.trackSave(savingScope, request);
  }, [layouts, scopeKey]);

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    updateDeviceDraft((current) => {
      const oldIndex = current.widgets.findIndex((item) => item.id === active.id);
      const newIndex = current.widgets.findIndex((item) => item.id === over.id);
      return oldIndex < 0 || newIndex < 0 ? current : { ...current, widgets: arrayMove(current.widgets, oldIndex, newIndex) };
    });
  };

  const closeLibrary = useCallback(() => { setIsLibraryOpen(false); window.requestAnimationFrame(() => triggerRef.current?.focus()); }, []);
  useEffect(() => {
    if (!isLibraryOpen) return;
    const frame = window.requestAnimationFrame(() => libraryTitleRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeLibrary(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(libraryRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),select,[tabindex]:not([tabindex="-1"])') ?? []);
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", onKey); return () => { window.cancelAnimationFrame(frame); window.removeEventListener("keydown", onKey); };
  }, [closeLibrary, isLibraryOpen]);

  const copyLayout = async () => {
    if (!copySource || copySource === scopeKey || isSaving || isCopying) return;
    const coordinator = mutationCoordinatorRef.current;
    const token = coordinator.capture(scopeKey);
    const controller = new AbortController();
    copyAbortRef.current?.abort();
    copyAbortRef.current = controller;
    setIsCopying(true); setError(null);
    try {
      const response = await fetchDashboardLayout(copySource, controller.signal);
      if (!controller.signal.aborted && coordinator.isCurrent(token)) setDraft(normalizeDashboardScopeLayouts(response.layouts));
    } catch (reason) {
      if (!controller.signal.aborted && coordinator.isCurrent(token) && !(reason instanceof DOMException && reason.name === "AbortError")) {
        setError("Nie udało się skopiować wybranego układu.");
      }
    } finally {
      if (copyAbortRef.current === controller) copyAbortRef.current = null;
      if (coordinator.isCurrent(token)) setIsCopying(false);
    }
  };

  const move = (id: DashboardWidgetId, direction: -1 | 1) => updateDeviceDraft((current) => {
    const index = current.widgets.findIndex((item) => item.id === id); const target = index + direction;
    return index < 0 || target < 0 || target >= current.widgets.length ? current : { ...current, widgets: arrayMove(current.widgets, index, target) };
  });
  const portfolioScopes = [{ key: "all", label: "Wszystkie portfele" }, ...workspace.portfolios.map((item) => ({ key: `portfolio:${item.id}`, label: item.name }))].filter((item) => item.key !== scopeKey);

  return <DashboardDataProvider scopeKey={scopeKey}><div className="workspace-page dashboard-builder" aria-busy={isLoading}>
    <section className="workspace-dashboard-intro dashboard-builder-intro"><div><p className="eyebrow">Centrum dowodzenia · {scopeName}</p><h2>Twój pulpit inwestycyjny.</h2><p className="section-copy">Najważniejsze odczyty, koncentracja i kalendarz w układzie zapisanym osobno dla tego zakresu.</p></div><div className="dashboard-builder-actions">
      {isEditing ? <><button type="button" className="ghost-button" onClick={(event) => { triggerRef.current = event.currentTarget; setLibraryQuery(""); setIsLibraryOpen(true); }}>Dodaj widget</button><button type="button" className="ghost-button" disabled={isSaving || isCopying} onClick={() => { setDraft(layouts); setIsEditing(false); }}>Anuluj</button><button type="button" className="primary-button" disabled={isSaving || isCopying} onClick={() => void persist(draft, true)}>{isSaving ? "Zapisywanie…" : isCopying ? "Kopiowanie…" : "Zapisz pulpit"}</button></> : <button type="button" className="primary-button" onClick={() => { setDraft(layouts); setError(null); setIsEditing(true); }}>Edytuj pulpit</button>}
    </div></section>

    {isEditing ? <section className="dashboard-command-workbench" aria-label="Warsztat edycji pulpitu"><div><span>Edytujesz automatycznie</span><strong>{scopeName} · {displayDevice === "desktop" ? "Desktop" : "Mobile"}</strong></div><label>Preset<select value={preset} onChange={(event) => { const nextPreset = event.target.value as DashboardPresetId; const next = getDashboardPresetLayouts(nextPreset); setPreset(nextPreset); setDraft((current) => ({ ...current, [displayDevice]: next[displayDevice] })); }}>{Object.entries(PRESET_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Skopiuj układ z<select value={copySource} disabled={isSaving || isCopying} onChange={(event) => setCopySource(event.target.value)}><option value="">Wybierz zakres</option>{portfolioScopes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label><button type="button" className="ghost-button" disabled={!copySource || isSaving || isCopying} onClick={() => void copyLayout()}>{isCopying ? "Kopiowanie…" : "Skopiuj desktop + mobile"}</button><button type="button" className="ghost-button" disabled={isSaving || isCopying} onClick={() => updateDeviceDraft(() => displayDevice === "desktop" ? DEFAULT_DASHBOARD_LAYOUT : DEFAULT_MOBILE_DASHBOARD_LAYOUT)}>Przywróć domyślny: {displayDevice === "desktop" ? "desktop" : "mobile"}</button></section> : null}
    {error ? <p className="field-note field-note-error">{error}</p> : null}
    {isLoading ? <section className="panel dashboard-empty-layout"><p>Wczytywanie układu pulpitu…</p></section> : isEditing ? <DndContext sensors={sensors} onDragEnd={handleDragEnd}><SortableContext items={displayed.widgets.map((item) => item.id)} strategy={rectSortingStrategy}><div className={`dashboard-widget-grid dashboard-widget-grid--${displayDevice}`} aria-label={`Układ ${displayDevice}`}>{displayed.widgets.map((item, index) => <SortableWidget key={item.id} widget={item} isEditing device={displayDevice} index={index} total={displayed.widgets.length} onRemove={(id) => updateDeviceDraft((current) => ({ ...current, widgets: current.widgets.filter((entry) => entry.id !== id) }))} onResize={(id, size) => updateDeviceDraft((current) => ({ ...current, widgets: current.widgets.map((entry) => entry.id === id ? { ...entry, size } : entry) }))} onMove={move} />)}</div></SortableContext></DndContext> : <div className={`dashboard-widget-grid dashboard-widget-grid--${displayDevice}`} aria-label="Pulpit inwestycyjny">{displayed.widgets.map((item, index) => <SortableWidget key={item.id} widget={item} isEditing={false} device={displayDevice} index={index} total={displayed.widgets.length} onRemove={() => undefined} onResize={() => undefined} onMove={() => undefined} />)}</div>}
    {!isLoading && displayed.widgets.length === 0 ? <section className="panel dashboard-empty-layout"><p className="eyebrow">Pusty pulpit</p><h2 className="section-title">Dodaj pierwszy widget</h2><p className="section-copy">Dane portfela pozostały bez zmian. Otwórz bibliotekę albo przywróć domyślny układ.</p></section> : null}

    {isLibraryOpen ? <div className="dashboard-library-backdrop" role="presentation" onMouseDown={closeLibrary}><section ref={libraryRef} className="dashboard-widget-library" role="dialog" aria-modal="true" aria-labelledby="dashboard-library-title" onMouseDown={(event) => event.stopPropagation()}><div className="dashboard-widget-library-head"><div><p className="eyebrow">Biblioteka · {displayDevice === "desktop" ? "Desktop" : "Mobile"}</p><h2 id="dashboard-library-title" className="section-title" ref={libraryTitleRef} tabIndex={-1}>Dodaj do pulpitu</h2><p className="section-copy">Kompaktowe podglądy istniejących danych. Każdy widget może wystąpić raz.</p></div><button type="button" className="dashboard-widget-icon-button" onClick={closeLibrary} aria-label="Zamknij bibliotekę">×</button></div><label className="dashboard-library-search"><span>Wyszukaj widget</span><input type="search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Np. dywidendy, wykres, gotówka" autoComplete="off" /></label>{visibleDefinitions.length ? (Object.keys(CATEGORY_LABELS) as DashboardWidgetCategory[]).map((category) => { const definitions = visibleDefinitions.filter((definition) => definition.category === category); return definitions.length ? <section className="dashboard-library-group" key={category}><h3><DashboardCategoryIcon category={category} />{CATEGORY_LABELS[category]}</h3><div className="dashboard-library-items">{definitions.map((definition) => { const added = existing.has(definition.id); return <button key={definition.id} type="button" className={added ? "dashboard-library-item is-added" : "dashboard-library-item"} disabled={added} onClick={() => updateDeviceDraft((current) => ({ ...current, widgets: [...current.widgets, { id: definition.id, size: displayDevice === "mobile" ? "full" : definition.defaultSize }] }))}><span><strong>{definition.label}</strong><small>{definition.description}</small></span><em>{added ? "Dodano" : "Dodaj"}</em></button>; })}</div></section> : null; }) : <p className="dashboard-library-empty">Nie znaleziono widgetu pasującego do wyszukiwania.</p>}</section></div> : null}
  </div></DashboardDataProvider>;
}

"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchPerformancePreferences, fetchPoloniaRates, fetchPortfolioHistory, savePerformancePreferences } from "@/lib/api";
import { getBestPortfolioDailyMetrics } from "@/lib/portfolio-daily-metrics";
import { calculatePortfolioRiskAnalytics, getAvailableRiskPeriods, type CalendarReturn, type RiskAnalyticsPeriod, type RiskFreeRatePoint, type RiskMetric, type RiskMetricUnavailableCode } from "@/lib/portfolio-risk-analytics";
import { DEFAULT_PERFORMANCE_METRICS, PERFORMANCE_METRIC_IDS, PERFORMANCE_METRIC_LABELS, type PerformanceMetricId } from "@/lib/performance-preferences";
import { convertFromPln } from "@/lib/pricing";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { CurrencyCode, FxRates, PortfolioAccount, PortfolioAccountType, PortfolioAsset, PortfolioBenchmarkDefinition, PortfolioHistoryResponse, PortfolioHistoryScope, PortfolioOperation, PortfolioRealizedAdjustment, PortfolioSale } from "@/types/portfolio";

type Props = {
  assets: PortfolioAsset[]; sales: PortfolioSale[]; realizedAdjustments: PortfolioRealizedAdjustment[];
  fxRates: FxRates; baseCurrency: CurrencyCode; combinedProfitLoss: number; refreshRevision: number;
  operations?: PortfolioOperation[]; accounts?: PortfolioAccount[]; accountType?: PortfolioAccountType;
  benchmarks?: PortfolioBenchmarkDefinition[]; portfolioScopes?: PortfolioHistoryScope[]; isAggregate?: boolean;
};

const EMPTY_HISTORY: PortfolioHistoryResponse = { points: [], warnings: [], assetSeries: [], benchmarkSeries: [] };
const PERIOD_LABELS: Record<RiskAnalyticsPeriod, string> = { YTD: "YTD", "1Y": "1 rok", "3Y": "3 lata", "5Y": "5 lat", MAX: "MAX" };
const MONTH_LABELS = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru"];
const UNAVAILABLE_LABELS: Record<RiskMetricUnavailableCode, string> = {
  NO_DATA: "Brak danych", INSUFFICIENT_OBSERVATIONS: "Za mało obserwacji", INSUFFICIENT_HISTORY: "Za krótka historia",
  ZERO_VARIANCE: "Brak zmienności", NO_DOWNSIDE: "Brak ujemnych odchyleń", ZERO_DRAWDOWN: "Brak obsunięcia",
  RISK_FREE_UNAVAILABLE: "POLONIA niedostępna", BENCHMARK_REQUIRED: "Wymagany benchmark", AGGREGATE_BENCHMARK_UNAVAILABLE: "Brak wspólnego benchmarku",
};
const percentFormatter = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ratioFormatter = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const formatPercent = (value: number, signed = true) => `${signed && value > 0 ? "+" : ""}${percentFormatter.format(value * 100)}%`;
const toneForValue = (value: number | null | undefined) => value === null || value === undefined || value === 0 ? "tone-neutral" : value > 0 ? "tone-positive" : "tone-negative";
const metricCoverage = <T,>(metric: RiskMetric<T>) => metric.dateFrom && metric.dateTo ? `${formatDate(metric.dateFrom)} – ${formatDate(metric.dateTo)} · ${metric.observationCount} obserwacji` : `${metric.observationCount} obserwacji`;

function MetricCard({ title, metric, value, detail, tone }: { title: string; metric?: RiskMetric<unknown>; value?: ReactNode; detail?: ReactNode; tone?: string }) {
  const unavailableLabel = metric?.value === null && metric.unavailableCode ? UNAVAILABLE_LABELS[metric.unavailableCode] : null;
  return <article className="risk-metric-card"><span>{title}</span><strong className={unavailableLabel ? "performance-metric-unavailable" : tone}>{unavailableLabel ?? value}</strong>{detail ? <small>{detail}</small> : metric ? <small>{metricCoverage(metric)}</small> : null}</article>;
}

const getCalendarLabel = (item: CalendarReturn | null) => item ? item.month ? `${MONTH_LABELS[item.month - 1]} ${item.year}` : String(item.year) : "—";

export default function PortfolioPerformanceResults({ assets, sales, realizedAdjustments, fxRates, baseCurrency, combinedProfitLoss, refreshRevision, operations = [], accounts = [], accountType, benchmarks = [], portfolioScopes, isAggregate = false }: Props) {
  const [historyState, setHistoryState] = useState<{ signature: string; history: PortfolioHistoryResponse; error: string | null }>({ signature: "", history: EMPTY_HISTORY, error: null });
  const [riskFreeState, setRiskFreeState] = useState<{ rates: RiskFreeRatePoint[] | null; sourceUrl: string | null; fetchedAt: string | null; stale: boolean }>({ rates: null, sourceUrl: null, fetchedAt: null, stale: false });
  const [period, setPeriod] = useState<RiskAnalyticsPeriod>("MAX");
  const [visibleMetrics, setVisibleMetrics] = useState<PerformanceMetricId[]>(DEFAULT_PERFORMANCE_METRICS);
  const [draftMetrics, setDraftMetrics] = useState<PerformanceMetricId[]>(DEFAULT_PERFORMANCE_METRICS);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [preferencesNotice, setPreferencesNotice] = useState<{ message: string; isError: boolean } | null>(null);
  const signature = useMemo(() => JSON.stringify({ assets, sales, realizedAdjustments, operations, accounts, accountType, benchmarks, portfolioScopes, refreshRevision }), [accountType, accounts, assets, benchmarks, operations, portfolioScopes, realizedAdjustments, refreshRevision, sales]);

  useEffect(() => { const controller = new AbortController(); void fetchPerformancePreferences(controller.signal).then((response) => { if (controller.signal.aborted) return; setVisibleMetrics(response.visibleMetrics); setDraftMetrics(response.visibleMetrics); setPreferencesNotice(null); }).catch(() => { if (controller.signal.aborted) return; setVisibleMetrics([...DEFAULT_PERFORMANCE_METRICS]); setDraftMetrics([...DEFAULT_PERFORMANCE_METRICS]); setPreferencesNotice({ message: "Używamy domyślnego układu wyników. Dane finansowe pozostają dostępne.", isError: false }); }); return () => controller.abort(); }, []);
  useEffect(() => { const controller = new AbortController(); void fetchPoloniaRates(controller.signal).then((response) => { if (controller.signal.aborted) return; setRiskFreeState({ rates: response.rates, sourceUrl: response.descriptionUrl, fetchedAt: response.fetchedAt, stale: response.stale }); }).catch(() => { if (controller.signal.aborted) return; setRiskFreeState({ rates: null, sourceUrl: null, fetchedAt: null, stale: false }); }); return () => controller.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const payload = JSON.parse(signature) as { assets: PortfolioAsset[]; sales: PortfolioSale[]; realizedAdjustments: PortfolioRealizedAdjustment[]; operations: PortfolioOperation[]; accounts: PortfolioAccount[]; accountType?: PortfolioAccountType; benchmarks: PortfolioBenchmarkDefinition[]; portfolioScopes?: PortfolioHistoryScope[] };
    void fetchPortfolioHistory({ ...payload, signal: controller.signal }).then((history) => { if (!controller.signal.aborted) setHistoryState({ signature, history, error: null }); }).catch(() => { if (!controller.signal.aborted) setHistoryState({ signature, history: EMPTY_HISTORY, error: "Nie udało się pobrać historii potrzebnej do analizy. Wynik łączny nadal jest dostępny." }); });
    return () => controller.abort();
  }, [signature]);

  const isHistoryLoading = historyState.signature !== signature;
  const history = isHistoryLoading ? EMPTY_HISTORY : historyState.history;
  const historyError = isHistoryLoading ? null : historyState.error;
  const availablePeriods = useMemo(() => getAvailableRiskPeriods(history.points), [history.points]);
  useEffect(() => { if (availablePeriods.length && !availablePeriods.includes(period)) setPeriod(availablePeriods.includes("MAX") ? "MAX" : availablePeriods[0]!); }, [availablePeriods, period]);
  const configuredBenchmark = benchmarks[0];
  const benchmarkSeries = useMemo(
    () => history.benchmarkSeries[0] ?? (configuredBenchmark ? { id: configuredBenchmark.id, label: configuredBenchmark.name, points: [] } : undefined),
    [configuredBenchmark, history.benchmarkSeries]
  );
  const analytics = useMemo(() => calculatePortfolioRiskAnalytics({ points: history.points, period, benchmark: benchmarkSeries, riskFreeRates: riskFreeState.rates, isAggregate }), [benchmarkSeries, history.points, isAggregate, period, riskFreeState.rates]);
  const metrics = useMemo(() => getBestPortfolioDailyMetrics(history.points), [history.points]);
  const formatPln = (value: number) => formatCurrency(convertFromPln(value, baseCurrency, fxRates), baseCurrency);
  const formatSignedPln = (value: number) => `${value > 0 ? "+" : ""}${formatPln(value)}`;
  const isVisible = (...ids: PerformanceMetricId[]) => ids.some((id) => visibleMetrics.includes(id));
  const benchmarkYearByKey = new Map(analytics.benchmark.yearlyReturns.map((item) => [item.key, item]));
  const portfolioYearByYear = new Map(analytics.yearlyReturns.map((item) => [item.year, item]));
  const monthlyByYear = new Map<number, Map<number, CalendarReturn>>();
  analytics.monthlyReturns.forEach((item) => { const year = monthlyByYear.get(item.year) ?? new Map<number, CalendarReturn>(); if (item.month) year.set(item.month, item); monthlyByYear.set(item.year, year); });
  const latestYear = analytics.yearlyReturns.at(-1)?.year;
  const save = async () => { if (!draftMetrics.length || isSaving) return; setIsSaving(true); setPreferencesNotice(null); try { const response = await savePerformancePreferences(draftMetrics); setVisibleMetrics(response.visibleMetrics); setDraftMetrics(response.visibleMetrics); setIsEditing(false); } catch { setPreferencesNotice({ message: "Nie udało się zapisać ustawień widoku. Bieżący układ pozostaje aktywny.", isError: true }); } finally { setIsSaving(false); } };

  return <div className="workspace-page workspace-analysis-page"><section className="panel chart-card chart-card-wide workspace-performance-results">
    <div className="performance-results-heading"><div><p className="eyebrow">Wyniki 2.0</p><h2 className="section-title">Wyniki i ryzyko portfela</h2><p className="section-copy">Cash-flow-neutralna analiza jakości wyniku, obsunięć i relacji do benchmarku.</p></div><div className="performance-heading-actions"><div className="risk-period-selector" aria-label="Zakres analizy">{availablePeriods.map((item) => <button key={item} type="button" className={period === item ? "is-active" : ""} onClick={() => setPeriod(item)}>{PERIOD_LABELS[item]}</button>)}</div><button type="button" className="ghost-button" onClick={() => { setDraftMetrics(visibleMetrics); setIsEditing((value) => !value); }}>{isEditing ? "Zamknij" : "Edytuj wyniki"}</button></div></div>
    {isEditing ? <div className="performance-preferences" aria-label="Widoczne wyniki">{PERFORMANCE_METRIC_IDS.map((id) => <label key={id}><input type="checkbox" checked={draftMetrics.includes(id)} onChange={(event) => setDraftMetrics((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{PERFORMANCE_METRIC_LABELS[id]}</label>)}<div><button type="button" className="ghost-button" onClick={() => setDraftMetrics([...DEFAULT_PERFORMANCE_METRICS])}>Przywróć domyślne</button><button type="button" className="primary-button" onClick={() => { void save(); }} disabled={!draftMetrics.length || isSaving}>{isSaving ? "Zapisywanie…" : "Zapisz"}</button></div>{!draftMetrics.length ? <p className="field-note field-note-error">Pozostaw co najmniej jedną metrykę.</p> : null}</div> : null}
    {isHistoryLoading ? <div className="risk-analytics-state"><strong>Wczytywanie…</strong><span>Historia portfela i benchmarku jest przeliczana dla wybranego zakresu.</span></div> : null}
    {!isHistoryLoading && historyError ? <div className="risk-analytics-state is-error"><strong>Analiza jest chwilowo niedostępna</strong><span>{historyError}</span></div> : null}
    {!isHistoryLoading && !historyError && !analytics.dailyReturns.length ? <div className="risk-analytics-state"><strong>Brak danych</strong><span>Dodaj co najmniej dwa dni wiarygodnej wyceny, aby obliczyć zwroty i ryzyko.</span></div> : null}
    {!isHistoryLoading && analytics.dailyReturns.length ? <div className="risk-analytics-sections">
      {isVisible("total-result", "period-return", "latest-value-change", "best-day", "best-daily-result", "worst-day", "best-month", "worst-month", "best-year", "worst-year") ? <section className="risk-section" aria-labelledby="risk-result-title"><div className="risk-section-heading"><div><p className="eyebrow">Wynik</p><h3 id="risk-result-title">Co portfel wypracował</h3></div><span>{PERIOD_LABELS[period]} · {analytics.dailyReturns.length} obserwacji</span></div><div className="risk-metric-grid">
        {visibleMetrics.includes("total-result") ? <MetricCard title="Wynik łączny" value={formatCurrency(combinedProfitLoss, baseCurrency)} tone={toneForValue(combinedProfitLoss)} detail="Istniejący wynik portfela bez zmiany definicji" /> : null}
        {visibleMetrics.includes("period-return") ? <MetricCard title={`Stopa zwrotu · ${PERIOD_LABELS[period]}`} metric={analytics.totalReturn} value={analytics.totalReturn.value !== null ? formatPercent(analytics.totalReturn.value) : undefined} tone={toneForValue(analytics.totalReturn.value)} /> : null}
        {visibleMetrics.includes("latest-value-change") ? <MetricCard title="Ostatnia zmiana wartości" value={metrics.latestRaw ? formatSignedPln(metrics.latestRaw.rawValueChangePln) : "—"} tone={toneForValue(metrics.latestRaw?.rawValueChangePln)} detail={metrics.latestRaw ? `${formatDate(metrics.latestRaw.date)} · względem poprzedniej wyceny` : "Brak poprzedniej wyceny"} /> : null}
        {visibleMetrics.includes("best-day") ? <MetricCard title="Najlepszy dzień" metric={analytics.bestDay} value={analytics.bestDay.value ? formatPercent(analytics.bestDay.value.returnDecimal) : undefined} tone="tone-positive" detail={analytics.bestDay.value ? `${formatSignedPln(analytics.bestDay.value.resultPln)} · ${formatDate(analytics.bestDay.value.endDate)}` : undefined} /> : null}
        {visibleMetrics.includes("worst-day") ? <MetricCard title="Najgorszy dzień" metric={analytics.worstDay} value={analytics.worstDay.value ? formatPercent(analytics.worstDay.value.returnDecimal) : undefined} tone="tone-negative" detail={analytics.worstDay.value ? `${formatSignedPln(analytics.worstDay.value.resultPln)} · ${formatDate(analytics.worstDay.value.endDate)}` : undefined} /> : null}
        {visibleMetrics.includes("best-daily-result") ? <MetricCard title="Najlepszy wynik dzienny" metric={analytics.bestDay} value={analytics.bestDay.value ? formatSignedPln(analytics.bestDay.value.resultPln) : undefined} tone="tone-positive" detail={analytics.bestDay.value ? `Bez przepływów kapitału · ${formatDate(analytics.bestDay.value.endDate)}` : undefined} /> : null}
        {visibleMetrics.includes("best-month") ? <MetricCard title="Najlepszy pełny miesiąc" metric={analytics.bestMonth} value={analytics.bestMonth.value ? formatPercent(analytics.bestMonth.value.returnDecimal) : undefined} tone="tone-positive" detail={getCalendarLabel(analytics.bestMonth.value)} /> : null}
        {visibleMetrics.includes("worst-month") ? <MetricCard title="Najgorszy pełny miesiąc" metric={analytics.worstMonth} value={analytics.worstMonth.value ? formatPercent(analytics.worstMonth.value.returnDecimal) : undefined} tone="tone-negative" detail={getCalendarLabel(analytics.worstMonth.value)} /> : null}
        {visibleMetrics.includes("best-year") ? <MetricCard title="Najlepszy pełny rok" metric={analytics.bestYear} value={analytics.bestYear.value ? formatPercent(analytics.bestYear.value.returnDecimal) : undefined} tone="tone-positive" detail={getCalendarLabel(analytics.bestYear.value)} /> : null}
        {visibleMetrics.includes("worst-year") ? <MetricCard title="Najgorszy pełny rok" metric={analytics.worstYear} value={analytics.worstYear.value ? formatPercent(analytics.worstYear.value.returnDecimal) : undefined} tone="tone-negative" detail={getCalendarLabel(analytics.worstYear.value)} /> : null}
      </div></section> : null}
      {isVisible("volatility", "max-drawdown", "time-under-water") ? <section className="risk-section" aria-labelledby="risk-risk-title"><div className="risk-section-heading"><div><p className="eyebrow">Ryzyko</p><h3 id="risk-risk-title">Głębokość i czas strat</h3></div><span>Annualizacja: 365 dni</span></div><div className="risk-metric-grid risk-metric-grid-featured">
        {visibleMetrics.includes("volatility") ? <MetricCard title="Zmienność annualizowana" metric={analytics.volatility} value={analytics.volatility.value !== null ? formatPercent(analytics.volatility.value, false) : undefined} /> : null}
        {visibleMetrics.includes("max-drawdown") ? <MetricCard title="Max Drawdown" metric={analytics.drawdown} value={analytics.drawdown.value ? formatPercent(analytics.drawdown.value.maxDrawdown, false) : undefined} tone="tone-negative" detail={analytics.drawdown.value ? <>{formatDate(analytics.drawdown.value.peakDate)} → {formatDate(analytics.drawdown.value.troughDate)}<br />Odzyskanie: {analytics.drawdown.value.recoveryDate ? formatDate(analytics.drawdown.value.recoveryDate) : "nadal trwa"} · obecnie {formatPercent(analytics.drawdown.value.currentDrawdown, false)}</> : undefined} /> : null}
        {visibleMetrics.includes("time-under-water") ? <MetricCard title="Time Under Water" metric={analytics.timeUnderWater} value={analytics.timeUnderWater.value?.current ? `${analytics.timeUnderWater.value.current.days} dni obecnie` : "Brak bieżącego obsunięcia"} detail={analytics.timeUnderWater.value?.longestCompleted ? `Najdłuższy zakończony: ${analytics.timeUnderWater.value.longestCompleted.days} dni` : "Brak zakończonego okresu pod wodą"} /> : null}
      </div></section> : null}
      {isVisible("sharpe", "sortino", "calmar") ? <section className="risk-section" aria-labelledby="risk-adjusted-title"><div className="risk-section-heading"><div><p className="eyebrow">Risk-adjusted</p><h3 id="risk-adjusted-title">Wynik względem podjętego ryzyka</h3></div><span>{riskFreeState.sourceUrl ? <a href={riskFreeState.sourceUrl} target="_blank" rel="noreferrer">POLONIA NBP ↗</a> : "POLONIA niedostępna"}{riskFreeState.stale ? " · ostatnia poprawna kopia" : ""}</span></div><div className="risk-metric-grid">
        {visibleMetrics.includes("sharpe") ? <MetricCard title="Sharpe" metric={analytics.sharpe} value={analytics.sharpe.value !== null ? ratioFormatter.format(analytics.sharpe.value) : undefined} /> : null}
        {visibleMetrics.includes("sortino") ? <MetricCard title="Sortino" metric={analytics.sortino} value={analytics.sortino.value !== null ? ratioFormatter.format(analytics.sortino.value) : undefined} /> : null}
        {visibleMetrics.includes("calmar") ? <MetricCard title="Calmar" metric={analytics.calmar} value={analytics.calmar.value !== null ? ratioFormatter.format(analytics.calmar.value) : undefined} detail="Wymaga co najmniej 365 dni historii" /> : null}
      </div><p className="risk-source-note">Stopa wolna od ryzyka: oficjalna dzienna stawka O/N POLONIA, forward-fill między publikacjami, przeliczona na stawkę dzienną. {riskFreeState.fetchedAt ? `Aktualizacja źródła: ${formatDate(riskFreeState.fetchedAt)}.` : "Brak źródła nie jest zastępowany stałą."}</p></section> : null}
      {isVisible("beta", "alpha", "information-ratio", "tracking-error") ? <section className="risk-section" aria-labelledby="risk-benchmark-title"><div className="risk-section-heading"><div><p className="eyebrow">Benchmark</p><h3 id="risk-benchmark-title">Relacja do rynku</h3></div><span>{analytics.benchmark.benchmarkLabel ?? (isAggregate ? "Wszystkie portfele" : "Nie wybrano")}</span></div>{!configuredBenchmark && !isAggregate ? <p className="risk-inline-notice">Wymagany benchmark. Dodaj go w „Wykresy → Portfel vs benchmark”; Wyniki użyją tej samej zapisanej konfiguracji.</p> : null}{isAggregate ? <p className="risk-inline-notice">Widok „Wszystkie portfele” nie ma syntetycznego wspólnego benchmarku. Metryki porównawcze pozostają jawnie niedostępne.</p> : null}<div className="risk-metric-grid">
        {visibleMetrics.includes("beta") ? <MetricCard title="Beta" metric={analytics.benchmark.beta} value={analytics.benchmark.beta.value !== null ? ratioFormatter.format(analytics.benchmark.beta.value) : undefined} /> : null}
        {visibleMetrics.includes("alpha") ? <MetricCard title="Alpha Jensena" metric={analytics.benchmark.alpha} value={analytics.benchmark.alpha.value !== null ? formatPercent(analytics.benchmark.alpha.value) : undefined} /> : null}
        {visibleMetrics.includes("information-ratio") ? <MetricCard title="Information Ratio" metric={analytics.benchmark.informationRatio} value={analytics.benchmark.informationRatio.value !== null ? ratioFormatter.format(analytics.benchmark.informationRatio.value) : undefined} /> : null}
        {visibleMetrics.includes("tracking-error") ? <MetricCard title="Tracking Error" metric={analytics.benchmark.trackingError} value={analytics.benchmark.trackingError.value !== null ? formatPercent(analytics.benchmark.trackingError.value, false) : undefined} /> : null}
      </div></section> : null}
      {visibleMetrics.includes("calendar-results") ? <section className="risk-section" aria-labelledby="risk-calendar-title"><div className="risk-section-heading"><div><p className="eyebrow">Kalendarz</p><h3 id="risk-calendar-title">Wyniki roczne i miesięczne</h3></div><span>„—” oznacza brak wiarygodnych danych</span></div><div className="risk-annual-table-wrap"><table className="risk-annual-table"><thead><tr><th>Rok</th><th>Wynik portfela</th><th>Benchmark</th><th>Różnica</th></tr></thead><tbody>{[...analytics.yearlyReturns].reverse().map((year) => { const benchmarkYear = benchmarkYearByKey.get(year.key); const difference = benchmarkYear ? year.returnDecimal - benchmarkYear.returnDecimal : null; return <tr key={year.key}><th>{year.year}{year.year === latestYear && !year.isComplete ? <small>YTD</small> : null}</th><td className={toneForValue(year.returnDecimal)}>{formatPercent(year.returnDecimal)}</td><td className={benchmarkYear ? toneForValue(benchmarkYear.returnDecimal) : "tone-neutral"}>{benchmarkYear ? formatPercent(benchmarkYear.returnDecimal) : "—"}</td><td className={toneForValue(difference)}>{difference === null ? "—" : formatPercent(difference)}</td></tr>; })}</tbody></table></div>
        <div className="risk-monthly-matrix-wrap" tabIndex={0} aria-label="Miesięczne wyniki portfela"><table className="risk-monthly-matrix"><thead><tr><th>Rok</th>{MONTH_LABELS.map((month) => <th key={month}>{month}</th>)}<th>Rok</th></tr></thead><tbody>{[...monthlyByYear.entries()].sort(([left], [right]) => right - left).map(([year, months]) => { const yearReturn = portfolioYearByYear.get(year); return <tr key={year}><th>{year}{year === latestYear ? <small>YTD</small> : null}</th>{MONTH_LABELS.map((_, index) => { const item = months.get(index + 1); return <td key={index} className={item ? toneForValue(item.returnDecimal) : "tone-neutral"}>{item ? formatPercent(item.returnDecimal) : "—"}</td>; })}<td className={yearReturn ? toneForValue(yearReturn.returnDecimal) : "tone-neutral"}>{yearReturn ? formatPercent(yearReturn.returnDecimal) : "—"}</td></tr>; })}</tbody></table></div>
      </section> : null}
    </div> : null}
    {preferencesNotice ? <p className={`field-note mt-4${preferencesNotice.isError ? " field-note-error" : ""}`}>{preferencesNotice.message}</p> : null}
  </section></div>;
}

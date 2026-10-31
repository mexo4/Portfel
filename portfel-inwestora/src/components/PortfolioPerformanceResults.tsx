"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchPerformancePreferences, fetchPoloniaRates, fetchPortfolioHistory, savePerformancePreferences } from "@/lib/api";
import { getBestPortfolioDailyMetrics } from "@/lib/portfolio-daily-metrics";
import { calculateNetExternalCapital, calculateXirr, type XirrUnavailableCode } from "@/lib/portfolio-money-weighted-return";
import { calculateCagrFromTotalReturn, calculatePortfolioRiskAnalytics, getAvailableRiskPeriods, type CalendarReturn, type RiskAnalyticsPeriod, type RiskFreeRatePoint, type RiskMetric, type RiskMetricUnavailableCode } from "@/lib/portfolio-risk-analytics";
import { DEFAULT_PERFORMANCE_METRICS, PERFORMANCE_METRIC_LABELS, PERFORMANCE_METRIC_SECTIONS, type PerformanceMetricId } from "@/lib/performance-preferences";
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
  RISK_FREE_UNAVAILABLE: "POLONIA niedostępna", HISTORY_INCOMPLETE: "Niepełna historia", BENCHMARK_REQUIRED: "Wymagany benchmark", AGGREGATE_BENCHMARK_UNAVAILABLE: "Brak wspólnego benchmarku",
};
const XIRR_UNAVAILABLE_LABELS: Record<XirrUnavailableCode, string> = {
  NO_EXTERNAL_CASH_FLOWS: "Brak potwierdzonych wpłat lub wypłat zewnętrznych",
  NO_TERMINAL_VALUE: "Brak wiarygodnej aktualnej wartości",
  INVALID_DATE: "Nieprawidłowa data przepływu",
  NO_SIGN_CHANGE: "Brak pełnego cyklu przepływów",
  AMBIGUOUS_CASH_FLOWS: "Niejednoznaczny układ przepływów",
  NO_BRACKET: "Nie udało się wyznaczyć rozwiązania",
  NO_CONVERGENCE: "Nie udało się obliczyć stabilnego wyniku",
};
const percentFormatter = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ratioFormatter = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const formatPercent = (value: number, signed = true) => `${signed && value > 0 ? "+" : ""}${percentFormatter.format(value * 100)}%`;
const toneForValue = (value: number | null | undefined) => value === null || value === undefined || value === 0 ? "tone-neutral" : value > 0 ? "tone-positive" : "tone-negative";
const metricCoverage = <T,>(metric: RiskMetric<T>) => metric.dateFrom && metric.dateTo ? `${formatDate(metric.dateFrom)} – ${formatDate(metric.dateTo)} · ${metric.observationCount} obserwacji` : `${metric.observationCount} obserwacji`;

function MetricCard({ title, metric, value, detail, tone, description }: { title: string; metric?: RiskMetric<unknown>; value?: ReactNode; detail?: ReactNode; tone?: string; description?: string }) {
  const unavailableLabel = metric?.value === null && metric.unavailableCode ? UNAVAILABLE_LABELS[metric.unavailableCode] : null;
  return <article className="risk-metric-card"><div className="risk-metric-label"><span>{title}</span>{description ? <details className="risk-metric-help"><summary aria-label={`Wyjaśnienie metryki: ${title}`}>i</summary><p>{description}</p></details> : null}</div><strong className={unavailableLabel ? "performance-metric-unavailable" : tone}>{unavailableLabel ?? value}</strong>{detail ? <small>{detail}</small> : metric ? <small>{metricCoverage(metric)}</small> : null}</article>;
}

const getCalendarLabel = (item: CalendarReturn | null) => item ? item.month ? `${MONTH_LABELS[item.month - 1]} ${item.year}` : String(item.year) : "—";
const getCalendarCompletenessLabel = (item: CalendarReturn | undefined) => {
  if (!item || item.isComplete) return null;
  const isCurrentYear = item.year === new Date().getFullYear();
  const startsAtYearBoundary = item.dateFrom <= `${item.year}-01-01`;
  return isCurrentYear && startsAtYearBoundary ? "YTD" : "częściowy";
};
const calendarCoverage = (item: CalendarReturn) => `${formatDate(item.dateFrom)} – ${formatDate(item.dateTo)}`;

export default function PortfolioPerformanceResults({ assets, sales, realizedAdjustments, baseCurrency, combinedProfitLoss, refreshRevision, operations = [], accounts = [], accountType, benchmarks = [], portfolioScopes, isAggregate = false }: Props) {
  const [historyState, setHistoryState] = useState<{ signature: string; history: PortfolioHistoryResponse; error: string | null }>({ signature: "", history: EMPTY_HISTORY, error: null });
  const [riskFreeState, setRiskFreeState] = useState<{ rates: RiskFreeRatePoint[] | null; sourceUrl: string | null; fetchedAt: string | null; stale: boolean }>({ rates: null, sourceUrl: null, fetchedAt: null, stale: false });
  const [period, setPeriod] = useState<RiskAnalyticsPeriod>("MAX");
  const [visibleMetrics, setVisibleMetrics] = useState<PerformanceMetricId[]>(DEFAULT_PERFORMANCE_METRICS);
  const [draftMetrics, setDraftMetrics] = useState<PerformanceMetricId[]>(DEFAULT_PERFORMANCE_METRICS);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [preferencesNotice, setPreferencesNotice] = useState<{ message: string; isError: boolean } | null>(null);
  const signature = useMemo(() => JSON.stringify({ assets, sales, realizedAdjustments, operations, accounts, accountType, benchmarks, portfolioScopes, refreshRevision, presentationCurrency: baseCurrency }), [accountType, accounts, assets, baseCurrency, benchmarks, operations, portfolioScopes, realizedAdjustments, refreshRevision, sales]);

  useEffect(() => { const controller = new AbortController(); void fetchPerformancePreferences(controller.signal).then((response) => { if (controller.signal.aborted) return; setVisibleMetrics(response.visibleMetrics); setDraftMetrics(response.visibleMetrics); setPreferencesNotice(null); }).catch(() => { if (controller.signal.aborted) return; setVisibleMetrics([...DEFAULT_PERFORMANCE_METRICS]); setDraftMetrics([...DEFAULT_PERFORMANCE_METRICS]); setPreferencesNotice({ message: "Używamy domyślnego układu wyników. Dane finansowe pozostają dostępne.", isError: false }); }); return () => controller.abort(); }, []);
  useEffect(() => { const controller = new AbortController(); void fetchPoloniaRates(controller.signal).then((response) => { if (controller.signal.aborted) return; setRiskFreeState({ rates: response.rates, sourceUrl: response.descriptionUrl, fetchedAt: response.fetchedAt, stale: response.stale }); }).catch(() => { if (controller.signal.aborted) return; setRiskFreeState({ rates: null, sourceUrl: null, fetchedAt: null, stale: false }); }); return () => controller.abort(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const payload = JSON.parse(signature) as { assets: PortfolioAsset[]; sales: PortfolioSale[]; realizedAdjustments: PortfolioRealizedAdjustment[]; operations: PortfolioOperation[]; accounts: PortfolioAccount[]; accountType?: PortfolioAccountType; benchmarks: PortfolioBenchmarkDefinition[]; portfolioScopes?: PortfolioHistoryScope[]; presentationCurrency: CurrencyCode };
    void fetchPortfolioHistory({ ...payload, signal: controller.signal }).then((history) => { if (!controller.signal.aborted) setHistoryState({ signature, history, error: null }); }).catch(() => { if (!controller.signal.aborted) setHistoryState({ signature, history: EMPTY_HISTORY, error: "Nie udało się pobrać historii potrzebnej do analizy. Wynik łączny nadal jest dostępny." }); });
    return () => controller.abort();
  }, [signature]);

  const isHistoryLoading = historyState.signature !== signature;
  const history = isHistoryLoading ? EMPTY_HISTORY : historyState.history;
  const historyError = isHistoryLoading ? null : historyState.error;
  const analysisPoints = useMemo(() => {
    if (history.presentationCurrency !== baseCurrency) return baseCurrency === "PLN" ? history.points : [];
    return history.points.flatMap((point) =>
      typeof point.presentationPortfolioValue === "number" &&
      typeof point.presentationNetInvested === "number" &&
      typeof point.presentationProfitLoss === "number"
        ? [{
            ...point,
            portfolioValuePln: point.presentationPortfolioValue,
            netInvestedPln: point.presentationNetInvested,
            profitLossPln: point.presentationProfitLoss,
            timeWeightedReturnPercent: point.presentationTimeWeightedReturnPercent ?? null,
          }]
        : []
    );
  }, [baseCurrency, history.points, history.presentationCurrency]);
  const availablePeriods = useMemo(() => getAvailableRiskPeriods(analysisPoints), [analysisPoints]);
  const effectivePeriod = period;
  const isSelectedPeriodUnavailable = Boolean(availablePeriods.length && !availablePeriods.includes(period));
  const configuredBenchmark = benchmarks[0];
  const benchmarkSeries = useMemo(
    () => {
      const series = history.benchmarkSeries[0];
      if (series && history.presentationCurrency === baseCurrency) {
        return { ...series, points: series.points.map((point) => ({ ...point, returnPercent: point.presentationReturnPercent ?? null })) };
      }
      return configuredBenchmark ? { id: configuredBenchmark.id, label: configuredBenchmark.name, points: [] } : undefined;
    },
    [baseCurrency, configuredBenchmark, history.benchmarkSeries, history.presentationCurrency]
  );
  const presentationHistoryStatus = baseCurrency === "PLN" ? history.twrStatus : history.presentationTwrStatus;
  const historyQualityReason = baseCurrency === "PLN"
    ? history.twrStatusReason
    : history.presentationTwrStatusReason ?? history.twrStatusReason;
  const historyQualityReasonText = historyQualityReason
    ? historyQualityReason.length > 1800
      ? `${historyQualityReason.slice(0, 1800)}… (lista skrócona)`
      : historyQualityReason
    : "Co najmniej jedna pozycja nie ma pełnej, potwierdzonej historii wycen lub przepływów.";
  const analytics = useMemo(() => calculatePortfolioRiskAnalytics({
    points: analysisPoints,
    period: effectivePeriod,
    benchmark: benchmarkSeries,
    riskFreeRates: baseCurrency === "PLN" ? riskFreeState.rates : null,
    isAggregate,
    historyStatus: isSelectedPeriodUnavailable
      ? "unavailable"
      : presentationHistoryStatus === "complete"
        ? "complete"
        : presentationHistoryStatus === "unavailable"
          ? "unavailable"
          : "incomplete",
  }), [analysisPoints, baseCurrency, benchmarkSeries, effectivePeriod, isAggregate, isSelectedPeriodUnavailable, presentationHistoryStatus, riskFreeState.rates]);
  const metrics = useMemo(() => getBestPortfolioDailyMetrics(analysisPoints), [analysisPoints]);
  const hasCashFlowLedger = !isHistoryLoading && !historyError && history.externalCashFlows !== undefined;
  const externalCashFlows = useMemo(() => history.externalCashFlows?.flatMap((flow) => {
    const amount = baseCurrency === "PLN" ? flow.amountPln : flow.presentationAmount;
    return typeof amount === "number" && Number.isFinite(amount) ? [{ date: flow.date, amount, kind: flow.kind }] : [];
  }) ?? [], [baseCurrency, history.externalCashFlows]);
  const hasReliableCashFlowCurrency = hasCashFlowLedger && (baseCurrency === "PLN" || !(history.externalCashFlows ?? []).some((flow) => flow.presentationAmount === null || flow.presentationAmount === undefined));
  const netExternalCapital = useMemo(() => calculateNetExternalCapital(externalCashFlows), [externalCashFlows]);
  const latestPoint = analysisPoints.at(-1);
  const xirr = useMemo(() => !hasCashFlowLedger || !hasReliableCashFlowCurrency || presentationHistoryStatus !== "complete"
    ? { value: null, unavailableCode: "NO_TERMINAL_VALUE" as const, iterations: 0 }
    : calculateXirr({ externalCashFlows, terminalValue: latestPoint?.portfolioValuePln ?? null, terminalDate: latestPoint?.date ?? null }), [externalCashFlows, hasCashFlowLedger, hasReliableCashFlowCurrency, latestPoint?.date, latestPoint?.portfolioValuePln, presentationHistoryStatus]);
  const cagr = useMemo(() => presentationHistoryStatus !== "complete" || isSelectedPeriodUnavailable
    ? null
    : calculateCagrFromTotalReturn({ totalReturn: analytics.totalReturn.value, startDate: analytics.totalReturn.dateFrom, endDate: analytics.totalReturn.dateTo }), [analytics.totalReturn.dateFrom, analytics.totalReturn.dateTo, analytics.totalReturn.value, isSelectedPeriodUnavailable, presentationHistoryStatus]);
  const formatPln = (value: number) => formatCurrency(value, baseCurrency);
  const formatSignedPln = (value: number) => `${value > 0 ? "+" : ""}${formatPln(value)}`;
  const isVisible = (...ids: PerformanceMetricId[]) => ids.some((id) => visibleMetrics.includes(id));
  const allMetricIdsInSectionVisible = (ids: PerformanceMetricId[]) => ids.every((id) => draftMetrics.includes(id));
  const benchmarkYearByKey = new Map(analytics.benchmark.yearlyReturns.map((item) => [item.key, item]));
  const portfolioYearByYear = new Map(analytics.yearlyReturns.map((item) => [item.year, item]));
  const monthlyByYear = new Map<number, Map<number, CalendarReturn>>();
  analytics.monthlyReturns.forEach((item) => { const year = monthlyByYear.get(item.year) ?? new Map<number, CalendarReturn>(); if (item.month) year.set(item.month, item); monthlyByYear.set(item.year, year); });
  const hasReturnHistory = !isHistoryLoading && !historyError && history.points.length > 0;
  const benchmarkIsComparable = Boolean(configuredBenchmark && !isAggregate && analytics.benchmark.beta.value !== null);
  const save = async () => { if (!draftMetrics.length || isSaving) return; setIsSaving(true); setPreferencesNotice(null); try { const response = await savePerformancePreferences(draftMetrics); setVisibleMetrics(response.visibleMetrics); setDraftMetrics(response.visibleMetrics); setIsEditing(false); } catch { setPreferencesNotice({ message: "Nie udało się zapisać ustawień widoku. Bieżący układ pozostaje aktywny.", isError: true }); } finally { setIsSaving(false); } };

  return <div className="workspace-page workspace-analysis-page"><section className="panel chart-card chart-card-wide workspace-performance-results">
    <div className="performance-results-heading"><div><p className="eyebrow">Wyniki 3.0</p><h2 className="section-title">Wynik, ryzyko i jakość danych</h2><p className="section-copy">Nominalny wynik, zwrot niezależny od przepływów i ryzyko są pokazane osobno — bez mieszania definicji.</p></div><div className="performance-heading-actions"><div className="risk-period-selector" aria-label="Zakres analizy">{availablePeriods.map((item) => <button key={item} type="button" className={effectivePeriod === item ? "is-active" : ""} onClick={() => setPeriod(item)}>{PERIOD_LABELS[item]}</button>)}</div><button type="button" className="ghost-button" onClick={() => { setDraftMetrics(visibleMetrics); setIsEditing((value) => !value); }}>{isEditing ? "Zamknij" : "Edytuj wyniki"}</button></div></div>
    {isEditing ? (
      <div className="performance-preferences" aria-label="Widoczne wyniki">
        {PERFORMANCE_METRIC_SECTIONS.map((section) => (
          <fieldset key={section.title} className="performance-preferences-section">
            <legend>{section.title}</legend>
            <label className="performance-preferences-all">
              <input
                type="checkbox"
                checked={allMetricIdsInSectionVisible(section.metricIds)}
                onChange={(event) => setDraftMetrics((current) => event.target.checked
                  ? Array.from(new Set([...current, ...section.metricIds]))
                  : current.filter((id) => !section.metricIds.includes(id)))}
              />
              Cała sekcja
            </label>
            {section.metricIds.map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={draftMetrics.includes(id)}
                  onChange={(event) => setDraftMetrics((current) => event.target.checked
                    ? [...current, id]
                    : current.filter((item) => item !== id))}
                />
                {PERFORMANCE_METRIC_LABELS[id]}
              </label>
            ))}
          </fieldset>
        ))}
        <div className="performance-preferences-actions">
          <button type="button" className="ghost-button" onClick={() => setDraftMetrics([...DEFAULT_PERFORMANCE_METRICS])}>Przywróć domyślne</button>
          <button type="button" className="primary-button" onClick={() => { void save(); }} disabled={!draftMetrics.length || isSaving}>{isSaving ? "Zapisywanie…" : "Zapisz"}</button>
        </div>
        {!draftMetrics.length ? <p className="field-note field-note-error">Pozostaw co najmniej jedną metrykę.</p> : null}
      </div>
    ) : null}
    {isHistoryLoading ? <div className="risk-analytics-state"><strong>Wczytywanie…</strong><span>Historia portfela i benchmarku jest przeliczana dla wybranego zakresu.</span></div> : null}
    {!isHistoryLoading && historyError ? <div className="risk-analytics-state is-error"><strong>Analiza jest chwilowo niedostępna</strong><span>{historyError}</span></div> : null}
    {!isHistoryLoading && !historyError && !history.points.length ? <div className="risk-analytics-state"><strong>Brak danych</strong><span>Dodaj co najmniej jedną wiarygodną wycenę, aby zobaczyć podsumowanie. Zwroty i ryzyko wymagają historii z co najmniej dwóch dni.</span></div> : null}
    {isVisible("portfolio-value", "total-result", "net-external-capital", "twr", "xirr", "cagr") || hasReturnHistory ? <div className="risk-analytics-sections">
      {hasReturnHistory ? isSelectedPeriodUnavailable ? <div className="risk-inline-notice">Zakres „{PERIOD_LABELS[effectivePeriod]}” nie ma pełnej historii. Nie zastępujemy go zakresem MAX — wybierz dostępny zakres, aby zobaczyć zwroty i ryzyko.</div> : presentationHistoryStatus !== "complete" ? <div className="risk-inline-notice">{baseCurrency === "PLN" ? "Historia źródłowych wycen, przepływów lub kursów walut potrzebnych do obliczeń jest niepełna. Sama zmiana waluty prezentacji na PLN tego nie uzupełnia." : "Historia w wybranej walucie jest niepełna lub zawiera niezweryfikowany FX."} Nominalna wartość pozostaje widoczna, ale TWR, CAGR, ryzyko i benchmark nie są pokazywane jako wiarygodne.<details className="risk-history-diagnostic"><summary>Pokaż, co blokuje wiarygodny zwrot</summary><p>{historyQualityReasonText}</p></details></div> : <div className="risk-inline-notice is-positive">Dane zwrotu są kompletne dla wybranego zakresu i waluty prezentacji.</div> : null}
      {isVisible("portfolio-value", "total-result", "net-external-capital", "twr", "xirr", "cagr") ? <section className="risk-section" aria-labelledby="risk-summary-title"><div className="risk-section-heading"><div><p className="eyebrow">Podsumowanie</p><h3 id="risk-summary-title">Wartość, wynik i jakość zwrotu</h3></div><span>Wartość, wynik i przepływy: od początku · TWR/CAGR: {PERIOD_LABELS[effectivePeriod]}</span></div><div className="risk-metric-grid risk-metric-grid-summary">
        {visibleMetrics.includes("portfolio-value") ? <MetricCard title="Aktualna wartość" value={latestPoint ? formatPln(latestPoint.portfolioValuePln) : "Niedostępne"} detail={latestPoint ? "Wycena na ostatni dostępny dzień" : "Wymaga pobrania historii wycen"} description="Bieżąca wycena portfela w wybranej walucie prezentacji." /> : null}
        {visibleMetrics.includes("total-result") ? <MetricCard title="Wynik nominalny" value={formatCurrency(combinedProfitLoss, baseCurrency)} tone={toneForValue(combinedProfitLoss)} detail="Od początku · wynik portfela, nie stopa zwrotu" description="Różnica pomiędzy aktualną wartością a kosztem według istniejącego modelu portfela." /> : null}
        {visibleMetrics.includes("net-external-capital") ? <MetricCard title="Kapitał zewnętrzny netto" value={hasReliableCashFlowCurrency ? formatSignedPln(netExternalCapital.net) : "Niedostępne"} tone={hasReliableCashFlowCurrency ? toneForValue(netExternalCapital.net) : undefined} detail={hasReliableCashFlowCurrency ? `Od początku · wpłaty ${formatPln(netExternalCapital.deposits)} · wypłaty ${formatPln(netExternalCapital.withdrawals)}` : !hasCashFlowLedger ? "Brak kompletnego rejestru wpłat i wypłat" : "Brak wiarygodnego FX dla przepływów"} description="Wyłącznie potwierdzone wpłaty i wypłaty zewnętrzne; transakcje i transfery wewnętrzne są wykluczone." /> : null}
        {visibleMetrics.includes("twr") ? <MetricCard title={`TWR · ${PERIOD_LABELS[effectivePeriod]}`} metric={analytics.totalReturn} value={analytics.totalReturn.value !== null ? formatPercent(analytics.totalReturn.value) : undefined} tone={toneForValue(analytics.totalReturn.value)} detail="Zwrot geometryczny bez wpływu wpłat i wypłat" description="Time-Weighted Return mierzy wynik inwestowania niezależnie od momentu wpłat i wypłat." /> : null}
        {visibleMetrics.includes("xirr") ? <MetricCard title="XIRR" value={xirr.value !== null ? formatPercent(xirr.value) : "Niedostępne"} tone={toneForValue(xirr.value)} detail={xirr.value !== null ? "Od początku · zwrot ważony datami przepływów" : !hasCashFlowLedger ? "Brak kompletnego rejestru wpłat i wypłat" : !hasReliableCashFlowCurrency ? "Brak wiarygodnego FX dla przepływów" : presentationHistoryStatus !== "complete" ? "Wymaga kompletnej historii" : XIRR_UNAVAILABLE_LABELS[xirr.unavailableCode!]} description="Money-weighted return uwzględnia rzeczywiste daty potwierdzonych wpłat i wypłat." /> : null}
        {visibleMetrics.includes("cagr") ? <MetricCard title={`CAGR · ${PERIOD_LABELS[effectivePeriod]}`} value={cagr !== null ? formatPercent(cagr) : "Niedostępne"} tone={toneForValue(cagr)} detail={cagr !== null ? "Średnie tempo roczne dla wybranego zakresu" : "Wymaga kompletnej historii co najmniej 365 dni"} description="Geometryczne średnie tempo roczne; nie jest dostępne dla historii krótszej niż rok." /> : null}
      </div></section> : null}
      {hasReturnHistory && isVisible("latest-value-change", "best-day", "best-daily-result", "worst-day", "best-month", "worst-month", "best-year", "worst-year") ? <section className="risk-section" aria-labelledby="risk-result-title"><div className="risk-section-heading"><div><p className="eyebrow">Statystyki wyniku</p><h3 id="risk-result-title">Najlepsze i najsłabsze okresy</h3></div><span>{PERIOD_LABELS[effectivePeriod]} · {analytics.dailyReturns.length} obserwacji</span></div><div className="risk-metric-grid">
        {visibleMetrics.includes("latest-value-change") ? <MetricCard title="Ostatnia zmiana wartości" value={metrics.latestRaw ? formatSignedPln(metrics.latestRaw.rawValueChangePln) : "—"} tone={toneForValue(metrics.latestRaw?.rawValueChangePln)} detail={metrics.latestRaw ? `${formatDate(metrics.latestRaw.date)} · względem poprzedniej wyceny` : "Brak poprzedniej wyceny"} /> : null}
        {visibleMetrics.includes("best-day") ? <MetricCard title="Najlepszy dzień" metric={analytics.bestDay} value={analytics.bestDay.value ? formatPercent(analytics.bestDay.value.returnDecimal) : undefined} tone={toneForValue(analytics.bestDay.value?.returnDecimal)} detail={analytics.bestDay.value ? `${formatSignedPln(analytics.bestDay.value.resultPln)} · ${formatDate(analytics.bestDay.value.endDate)}` : undefined} description="Najwyższy zwrot procentowy jednego dnia po wyłączeniu przepływów kapitału." /> : null}
        {visibleMetrics.includes("worst-day") ? <MetricCard title="Najgorszy dzień" metric={analytics.worstDay} value={analytics.worstDay.value ? formatPercent(analytics.worstDay.value.returnDecimal) : undefined} tone={toneForValue(analytics.worstDay.value?.returnDecimal)} detail={analytics.worstDay.value ? `${formatSignedPln(analytics.worstDay.value.resultPln)} · ${formatDate(analytics.worstDay.value.endDate)}` : undefined} description="Najniższy zwrot procentowy jednego dnia po wyłączeniu przepływów kapitału." /> : null}
        {visibleMetrics.includes("best-daily-result") ? <MetricCard title="Największy wynik dzienny" metric={analytics.bestDailyResult} value={analytics.bestDailyResult.value ? formatSignedPln(analytics.bestDailyResult.value.resultPln) : undefined} tone={toneForValue(analytics.bestDailyResult.value?.resultPln)} detail={analytics.bestDailyResult.value ? `${formatPercent(analytics.bestDailyResult.value.returnDecimal)} · bez przepływów · ${formatDate(analytics.bestDailyResult.value.endDate)}` : undefined} description="Najwyższa kwotowa zmiana P/L w pojedynczym dniu, niezależna od wpłat i wypłat." /> : null}
        {visibleMetrics.includes("best-month") ? <MetricCard title="Najlepszy pełny miesiąc" metric={analytics.bestMonth} value={analytics.bestMonth.value ? formatPercent(analytics.bestMonth.value.returnDecimal) : undefined} tone={toneForValue(analytics.bestMonth.value?.returnDecimal)} detail={getCalendarLabel(analytics.bestMonth.value)} description="Najwyższy zwrot spośród wyłącznie pełnych miesięcy kalendarzowych." /> : null}
        {visibleMetrics.includes("worst-month") ? <MetricCard title="Najgorszy pełny miesiąc" metric={analytics.worstMonth} value={analytics.worstMonth.value ? formatPercent(analytics.worstMonth.value.returnDecimal) : undefined} tone={toneForValue(analytics.worstMonth.value?.returnDecimal)} detail={getCalendarLabel(analytics.worstMonth.value)} description="Najniższy zwrot spośród wyłącznie pełnych miesięcy kalendarzowych." /> : null}
        {visibleMetrics.includes("best-year") && analytics.bestYear.value ? <MetricCard title="Najlepszy pełny rok" metric={analytics.bestYear} value={formatPercent(analytics.bestYear.value.returnDecimal)} tone={toneForValue(analytics.bestYear.value.returnDecimal)} detail={getCalendarLabel(analytics.bestYear.value)} description="Najwyższy wynik spośród wyłącznie pełnych lat kalendarzowych." /> : null}
        {visibleMetrics.includes("worst-year") && analytics.worstYear.value ? <MetricCard title="Najgorszy pełny rok" metric={analytics.worstYear} value={formatPercent(analytics.worstYear.value.returnDecimal)} tone={toneForValue(analytics.worstYear.value.returnDecimal)} detail={getCalendarLabel(analytics.worstYear.value)} description="Najniższy wynik spośród wyłącznie pełnych lat kalendarzowych." /> : null}
      </div></section> : null}
      {hasReturnHistory && isVisible("volatility", "max-drawdown", "time-under-water") ? <section className="risk-section" aria-labelledby="risk-risk-title"><div className="risk-section-heading"><div><p className="eyebrow">Ryzyko</p><h3 id="risk-risk-title">Głębokość i czas strat</h3></div><span>Annualizacja: 365 dni</span></div><div className="risk-metric-grid risk-metric-grid-featured">
        {visibleMetrics.includes("volatility") ? <MetricCard title="Zmienność annualizowana" metric={analytics.volatility} value={analytics.volatility.value !== null ? formatPercent(analytics.volatility.value, false) : undefined} description="Roczna skala odchyleń dziennych zwrotów; większa wartość oznacza większe wahania." /> : null}
        {visibleMetrics.includes("max-drawdown") ? <MetricCard title="Max Drawdown" metric={analytics.drawdown} value={analytics.drawdown.value ? formatPercent(analytics.drawdown.value.maxDrawdown, false) : undefined} tone={toneForValue(analytics.drawdown.value?.maxDrawdown)} detail={analytics.drawdown.value ? <>{formatDate(analytics.drawdown.value.peakDate)} → {formatDate(analytics.drawdown.value.troughDate)}<br />Odzyskanie: {analytics.drawdown.value.recoveryDate ? formatDate(analytics.drawdown.value.recoveryDate) : "nadal trwa"} · obecnie {formatPercent(analytics.drawdown.value.currentDrawdown, false)}</> : undefined} description="Najgłębszy spadek od poprzedniego szczytu wartości portfela." /> : null}
        {visibleMetrics.includes("time-under-water") ? <MetricCard title="Time Under Water" metric={analytics.timeUnderWater} value={analytics.timeUnderWater.value?.current ? `${analytics.timeUnderWater.value.current.days} dni obecnie` : "Brak bieżącego obsunięcia"} detail={analytics.timeUnderWater.value?.longestCompleted ? `Najdłuższy zakończony: ${analytics.timeUnderWater.value.longestCompleted.days} dni` : "Brak zakończonego okresu pod wodą"} description="Czas od poprzedniego szczytu do odzyskania wartości portfela." /> : null}
      </div></section> : null}
      {hasReturnHistory && isVisible("sharpe", "sortino", "calmar") ? <section className="risk-section" aria-labelledby="risk-adjusted-title"><div className="risk-section-heading"><div><p className="eyebrow">Risk-adjusted</p><h3 id="risk-adjusted-title">Wynik względem podjętego ryzyka</h3></div><span>{baseCurrency !== "PLN" ? `Brak stopy wolnej od ryzyka dla ${baseCurrency}` : riskFreeState.sourceUrl ? <a href={riskFreeState.sourceUrl} target="_blank" rel="noreferrer">POLONIA NBP ↗</a> : "POLONIA niedostępna"}{baseCurrency === "PLN" && riskFreeState.stale ? " · ostatnia poprawna kopia" : ""}</span></div><div className="risk-metric-grid">
        {visibleMetrics.includes("sharpe") ? <MetricCard title="Sharpe" metric={analytics.sharpe} value={analytics.sharpe.value !== null ? ratioFormatter.format(analytics.sharpe.value) : undefined} description="Nadwyżkowy zwrot względem stopy wolnej od ryzyka na jednostkę całkowitej zmienności." /> : null}
        {visibleMetrics.includes("sortino") ? <MetricCard title="Sortino" metric={analytics.sortino} value={analytics.sortino.value !== null ? ratioFormatter.format(analytics.sortino.value) : undefined} description="Nadwyżkowy zwrot na jednostkę wyłącznie niekorzystnej zmienności." /> : null}
        {visibleMetrics.includes("calmar") ? <MetricCard title="Calmar" metric={analytics.calmar} value={analytics.calmar.value !== null ? ratioFormatter.format(analytics.calmar.value) : undefined} detail="Wymaga co najmniej 365 dni historii" description="CAGR podzielony przez maksymalne obsunięcie kapitału." /> : null}
      </div><p className="risk-source-note">{baseCurrency === "PLN" ? `Stopa wolna od ryzyka: oficjalna dzienna stawka O/N POLONIA, forward-fill między publikacjami, przeliczona na stawkę dzienną. ${riskFreeState.fetchedAt ? `Aktualizacja źródła: ${formatDate(riskFreeState.fetchedAt)}.` : "Brak źródła nie jest zastępowany stałą."}` : `Metryki wymagające stopy wolnej od ryzyka są ukryte, ponieważ dostępna stawka POLONIA jest denominowana w PLN, a prezentacja jest w ${baseCurrency}.`}</p></section> : null}
      {hasReturnHistory && isVisible("beta", "alpha", "information-ratio", "tracking-error") ? <section className="risk-section" aria-labelledby="risk-benchmark-title"><div className="risk-section-heading"><div><p className="eyebrow">Benchmark</p><h3 id="risk-benchmark-title">Relacja do rynku</h3></div><span>{analytics.benchmark.benchmarkLabel ?? (isAggregate ? "Zakres wielu portfeli" : "Nie wybrano")}</span></div>{benchmarkIsComparable ? <div className="risk-metric-grid risk-metric-grid-benchmark">
        {visibleMetrics.includes("beta") ? <MetricCard title="Beta" metric={analytics.benchmark.beta} value={analytics.benchmark.beta.value !== null ? ratioFormatter.format(analytics.benchmark.beta.value) : undefined} description="Wrażliwość zwrotów portfela na zmiany benchmarku." /> : null}
        {visibleMetrics.includes("alpha") ? <MetricCard title="Alpha Jensena" metric={analytics.benchmark.alpha} value={analytics.benchmark.alpha.value !== null ? formatPercent(analytics.benchmark.alpha.value) : undefined} description="Szacowany zwrot ponad wynik oczekiwany przy danej becie i stopie wolnej od ryzyka." /> : null}
        {visibleMetrics.includes("information-ratio") ? <MetricCard title="Information Ratio" metric={analytics.benchmark.informationRatio} value={analytics.benchmark.informationRatio.value !== null ? ratioFormatter.format(analytics.benchmark.informationRatio.value) : undefined} description="Nadwyżkowy zwrot względem benchmarku na jednostkę aktywnego ryzyka." /> : null}
        {visibleMetrics.includes("tracking-error") ? <MetricCard title="Tracking Error" metric={analytics.benchmark.trackingError} value={analytics.benchmark.trackingError.value !== null ? formatPercent(analytics.benchmark.trackingError.value, false) : undefined} description="Annualizowana zmienność różnicy pomiędzy zwrotem portfela a benchmarku." /> : null}
      </div> : <p className="risk-inline-notice">{isAggregate ? "Zakres obejmujący wiele portfeli nie używa syntetycznego benchmarku." : !configuredBenchmark ? "Wymagany benchmark. Dodaj go w „Wykresy → Portfel vs benchmark”; Wyniki użyją tej samej zapisanej konfiguracji." : analytics.benchmark.beta.unavailableCode === "HISTORY_INCOMPLETE" ? "Porównanie benchmarku wymaga kompletnej historii cen i FX dla wybranego zakresu." : "Za mało zsynchronizowanych, porównywalnych obserwacji portfela i benchmarku."}</p>}</section> : null}
      {hasReturnHistory && visibleMetrics.includes("calendar-results") ? <section className="risk-section" aria-labelledby="risk-calendar-title"><div className="risk-section-heading"><div><p className="eyebrow">Kalendarz zwrotów</p><h3 id="risk-calendar-title">Wyniki roczne i miesięczne</h3></div><span>Każdy niepełny okres ma własne oznaczenie i zakres dat</span></div>{analytics.yearlyReturns.length ? <><div className="risk-annual-table-wrap"><table className="risk-annual-table"><thead><tr><th>Rok</th><th>Wynik portfela</th><th>Benchmark</th><th>Różnica</th></tr></thead><tbody>{[...analytics.yearlyReturns].reverse().map((year) => { const benchmarkYear = benchmarkYearByKey.get(year.key); const difference = benchmarkYear ? year.returnDecimal - benchmarkYear.returnDecimal : null; const state = getCalendarCompletenessLabel(year); return <tr key={year.key}><th title={calendarCoverage(year)}>{year.year}{state ? <small>{state}</small> : null}</th><td className={toneForValue(year.returnDecimal)}>{formatPercent(year.returnDecimal)}</td><td className={benchmarkYear ? toneForValue(benchmarkYear.returnDecimal) : "tone-neutral"}>{benchmarkYear ? formatPercent(benchmarkYear.returnDecimal) : "—"}</td><td className={toneForValue(difference)}>{difference === null ? "—" : formatPercent(difference)}</td></tr>; })}</tbody></table></div>
        <div className="risk-monthly-matrix-wrap" tabIndex={0} aria-label="Miesięczne wyniki portfela"><table className="risk-monthly-matrix"><thead><tr><th>Rok</th>{MONTH_LABELS.map((month) => <th key={month}>{month}</th>)}<th>Rok</th></tr></thead><tbody>{[...monthlyByYear.entries()].sort(([left], [right]) => right - left).map(([year, months]) => { const yearReturn = portfolioYearByYear.get(year); const yearState = getCalendarCompletenessLabel(yearReturn); return <tr key={year}><th title={yearReturn ? calendarCoverage(yearReturn) : undefined}>{year}{yearState ? <small>{yearState}</small> : null}</th>{MONTH_LABELS.map((_, index) => { const item = months.get(index + 1); const state = getCalendarCompletenessLabel(item); return <td key={index} className={item ? toneForValue(item.returnDecimal) : "tone-neutral"} title={item ? `${calendarCoverage(item)}${state ? ` · ${state}` : ""}` : undefined}>{item ? <>{formatPercent(item.returnDecimal)}{state ? <small>{state}</small> : null}</> : "—"}</td>; })}<td className={yearReturn ? toneForValue(yearReturn.returnDecimal) : "tone-neutral"}>{yearReturn ? formatPercent(yearReturn.returnDecimal) : "—"}</td></tr>; })}</tbody></table></div>
      </> : <p className="risk-inline-notice">Kalendarz zwrotów wymaga kompletnej historii dla wybranego zakresu.</p>}</section> : null}
    </div> : null}
    {preferencesNotice ? <p className={`field-note mt-4${preferencesNotice.isError ? " field-note-error" : ""}`}>{preferencesNotice.message}</p> : null}
  </section></div>;
}

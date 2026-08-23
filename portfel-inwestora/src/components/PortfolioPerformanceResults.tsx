"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchPerformancePreferences, fetchPortfolioHistory, savePerformancePreferences } from "@/lib/api";
import { getBestPortfolioDailyMetrics } from "@/lib/portfolio-daily-metrics";
import { DEFAULT_PERFORMANCE_METRICS, PERFORMANCE_METRIC_IDS, PERFORMANCE_METRIC_LABELS, type PerformanceMetricId } from "@/lib/performance-preferences";
import { convertFromPln } from "@/lib/pricing";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { CurrencyCode, FxRates, PortfolioAsset, PortfolioHistoryPoint, PortfolioHistoryScope, PortfolioRealizedAdjustment, PortfolioSale } from "@/types/portfolio";

type Props = { assets: PortfolioAsset[]; sales: PortfolioSale[]; realizedAdjustments: PortfolioRealizedAdjustment[]; fxRates: FxRates; baseCurrency: CurrencyCode; combinedProfitLoss: number; portfolioScopes?: PortfolioHistoryScope[] };

export default function PortfolioPerformanceResults({ assets, sales, realizedAdjustments, fxRates, baseCurrency, combinedProfitLoss, portfolioScopes }: Props) {
  const [historyState, setHistoryState] = useState<{ signature: string; points: PortfolioHistoryPoint[]; error: string | null }>({ signature: "", points: [], error: null });
  const [visibleMetrics, setVisibleMetrics] = useState<PerformanceMetricId[]>(DEFAULT_PERFORMANCE_METRICS);
  const [draftMetrics, setDraftMetrics] = useState<PerformanceMetricId[]>(DEFAULT_PERFORMANCE_METRICS);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [preferencesNotice, setPreferencesNotice] = useState<{ message: string; isError: boolean } | null>(null);
  const signature = useMemo(() => JSON.stringify({ assets, sales, realizedAdjustments, portfolioScopes }), [assets, portfolioScopes, realizedAdjustments, sales]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPerformancePreferences(controller.signal).then((response) => {
      if (controller.signal.aborted) return;
      setVisibleMetrics(response.visibleMetrics);
      setDraftMetrics(response.visibleMetrics);
      setPreferencesNotice(null);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setVisibleMetrics([...DEFAULT_PERFORMANCE_METRICS]);
      setDraftMetrics([...DEFAULT_PERFORMANCE_METRICS]);
      setPreferencesNotice({ message: "Używamy domyślnego układu wyników. Twoje dane finansowe pozostają dostępne.", isError: false });
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const payload = JSON.parse(signature) as { assets: PortfolioAsset[]; sales: PortfolioSale[]; realizedAdjustments: PortfolioRealizedAdjustment[]; portfolioScopes?: PortfolioHistoryScope[] };
    void fetchPortfolioHistory({ ...payload, signal: controller.signal }).then((response) => {
      if (controller.signal.aborted) return;
      setHistoryState({ signature, points: response.points, error: null });
    }).catch(() => {
      if (controller.signal.aborted) return;
      setHistoryState({ signature, points: [], error: "Nie udało się pobrać historii potrzebnej do metryk dziennych. Wynik łączny nadal jest dostępny." });
    });
    return () => controller.abort();
  }, [signature]);

  const isHistoryLoading = historyState.signature !== signature;
  const historyError = isHistoryLoading ? null : historyState.error;
  const metrics = useMemo(() => getBestPortfolioDailyMetrics(isHistoryLoading ? [] : historyState.points), [historyState.points, isHistoryLoading]);
  const formatPln = (value: number) => formatCurrency(convertFromPln(value, baseCurrency, fxRates), baseCurrency);
  const historyValue = (content: ReactNode) => isHistoryLoading ? <span className="performance-metric-loading">Wczytywanie…</span> : historyError ? <span className="performance-metric-unavailable">Niedostępne</span> : content;
  const save = async () => {
    if (!draftMetrics.length || isSaving) return;
    setIsSaving(true); setPreferencesNotice(null);
    try {
      const response = await savePerformancePreferences(draftMetrics);
      setVisibleMetrics(response.visibleMetrics); setDraftMetrics(response.visibleMetrics); setIsEditing(false);
    } catch { setPreferencesNotice({ message: "Nie udało się zapisać ustawień widoku. Wyniki nadal działają z bieżącym układem.", isError: true }); }
    finally { setIsSaving(false); }
  };

  return <div className="workspace-page workspace-analysis-page"><section className="panel chart-card chart-card-wide workspace-performance-results">
    <div className="performance-results-heading"><div><p className="eyebrow">Wyniki</p><h2 className="section-title">Wyniki portfela</h2><p className="section-copy">Wybierz istniejące metryki, które chcesz widzieć. Obliczenia pozostają bez zmian.</p></div><button type="button" className="ghost-button" onClick={() => { setDraftMetrics(visibleMetrics); setIsEditing((value) => !value); }}>{isEditing ? "Zamknij" : "Edytuj wyniki"}</button></div>
    {isEditing ? <div className="performance-preferences" aria-label="Widoczne wyniki">{PERFORMANCE_METRIC_IDS.map((id) => <label key={id}><input type="checkbox" checked={draftMetrics.includes(id)} onChange={(event) => setDraftMetrics((current) => event.target.checked ? [...current, id] : current.filter((item) => item !== id))} />{PERFORMANCE_METRIC_LABELS[id]}</label>)}<div><button type="button" className="ghost-button" onClick={() => setDraftMetrics([...DEFAULT_PERFORMANCE_METRICS])}>Przywróć domyślne</button><button type="button" className="primary-button" onClick={() => { void save(); }} disabled={!draftMetrics.length || isSaving}>{isSaving ? "Zapisywanie…" : "Zapisz"}</button></div>{!draftMetrics.length ? <p className="field-note field-note-error">Pozostaw co najmniej jedną metrykę.</p> : null}</div> : null}
    <div className="workspace-performance-metric-grid mt-6">
      {visibleMetrics.includes("total-result") ? <article><span>Wynik łączny</span><strong className={combinedProfitLoss >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(combinedProfitLoss, baseCurrency)}</strong></article> : null}
      {visibleMetrics.includes("latest-value-change") ? <article><span>Ostatnia zmiana wartości</span>{historyValue(metrics.latestRaw ? <><strong className={metrics.latestRaw.rawValueChangePln >= 0 ? "tone-positive" : "tone-negative"}>{formatPln(metrics.latestRaw.rawValueChangePln)}</strong><small>{formatDate(metrics.latestRaw.date)} · względem poprzedniej wyceny</small></> : <strong>Brak danych</strong>)}</article> : null}
      {visibleMetrics.includes("best-day") ? <article><span>Najlepszy dzień</span>{historyValue(metrics.bestRaw ? <><strong className={metrics.bestRaw.rawValueChangePln >= 0 ? "tone-positive" : "tone-negative"}>{formatPln(metrics.bestRaw.rawValueChangePln)}</strong><small>{formatDate(metrics.bestRaw.date)}</small></> : <strong>Brak danych</strong>)}</article> : null}
      {visibleMetrics.includes("best-daily-result") ? <article><span>Najlepszy wynik dzienny</span>{historyValue(metrics.bestCashFlowNeutral ? <><strong className={metrics.bestCashFlowNeutral.cashFlowNeutralResultPln >= 0 ? "tone-positive" : "tone-negative"}>{formatPln(metrics.bestCashFlowNeutral.cashFlowNeutralResultPln)}</strong><small>Po wyłączeniu przepływów kapitału · {formatDate(metrics.bestCashFlowNeutral.date)}</small></> : <><strong>Brak danych</strong><small>Po wyłączeniu przepływów kapitału</small></>)}</article> : null}
    </div>
    {historyError ? <p className="field-note field-note-error mt-4">{historyError}</p> : null}{preferencesNotice ? <p className={`field-note mt-4${preferencesNotice.isError ? " field-note-error" : ""}`}>{preferencesNotice.message}</p> : null}
  </section></div>;
}

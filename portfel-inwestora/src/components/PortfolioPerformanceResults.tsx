"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchPortfolioHistory } from "@/lib/api";
import { getBestPortfolioDailyMetrics } from "@/lib/portfolio-daily-metrics";
import { convertFromPln } from "@/lib/pricing";
import { formatCurrency, formatDate } from "@/lib/utils";
import type {
  CurrencyCode,
  FxRates,
  PortfolioAsset,
  PortfolioHistoryPoint,
  PortfolioHistoryScope,
  PortfolioRealizedAdjustment,
  PortfolioSale,
} from "@/types/portfolio";

type PortfolioPerformanceResultsProps = {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
  fxRates: FxRates;
  baseCurrency: CurrencyCode;
  combinedProfitLoss: number;
  portfolioScopes?: PortfolioHistoryScope[];
};

export default function PortfolioPerformanceResults({
  assets,
  sales,
  realizedAdjustments,
  fxRates,
  baseCurrency,
  combinedProfitLoss,
  portfolioScopes,
}: PortfolioPerformanceResultsProps) {
  const [points, setPoints] = useState<PortfolioHistoryPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const signature = useMemo(
    () => JSON.stringify({ assets, sales, realizedAdjustments, portfolioScopes }),
    [assets, portfolioScopes, realizedAdjustments, sales]
  );

  useEffect(() => {
    const controller = new AbortController();
    const payload = JSON.parse(signature) as {
      assets: PortfolioAsset[];
      sales: PortfolioSale[];
      realizedAdjustments: PortfolioRealizedAdjustment[];
      portfolioScopes?: PortfolioHistoryScope[];
    };

    void fetchPortfolioHistory({ ...payload, signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) {
          setPoints(response.points);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Nie udało się obliczyć wyników.");
        }
      });

    return () => controller.abort();
  }, [signature]);

  const metrics = useMemo(() => getBestPortfolioDailyMetrics(points), [points]);
  const formatPln = (value: number) => formatCurrency(convertFromPln(value, baseCurrency, fxRates), baseCurrency);

  return (
    <div className="workspace-page workspace-analysis-page">
      <section className="panel chart-card chart-card-wide workspace-performance-results">
        <p className="eyebrow">Wyniki</p>
        <h2 className="section-title">Wyniki portfela</h2>
        <p className="section-copy">Liczby podsumowujące pozostają oddzielone od pełnej historii i wykresów.</p>
        <div className="workspace-performance-metric-grid mt-6">
          <article><span>Wynik łączny</span><strong className={combinedProfitLoss >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(combinedProfitLoss, baseCurrency)}</strong></article>
          <article><span>Ostatnia zmiana wartości</span><strong className={metrics.latestRaw && metrics.latestRaw.rawValueChangePln >= 0 ? "tone-positive" : "tone-negative"}>{metrics.latestRaw ? formatPln(metrics.latestRaw.rawValueChangePln) : "Brak danych"}</strong><small>{metrics.latestRaw ? `${formatDate(metrics.latestRaw.date)} · względem poprzedniej wyceny` : ""}</small></article>
          <article><span>Najlepszy dzień</span><strong className={metrics.bestRaw && metrics.bestRaw.rawValueChangePln >= 0 ? "tone-positive" : "tone-negative"}>{metrics.bestRaw ? formatPln(metrics.bestRaw.rawValueChangePln) : "Brak danych"}</strong><small>{metrics.bestRaw ? formatDate(metrics.bestRaw.date) : ""}</small></article>
          <article><span>Najlepszy wynik dzienny</span><strong className={metrics.bestCashFlowNeutral && metrics.bestCashFlowNeutral.cashFlowNeutralResultPln >= 0 ? "tone-positive" : "tone-negative"}>{metrics.bestCashFlowNeutral ? formatPln(metrics.bestCashFlowNeutral.cashFlowNeutralResultPln) : "Brak danych"}</strong><small>Po wyłączeniu przepływów kapitału{metrics.bestCashFlowNeutral ? ` · ${formatDate(metrics.bestCashFlowNeutral.date)}` : ""}</small></article>
        </div>
        {error ? <p className="field-note field-note-error mt-4">{error}</p> : null}
      </section>
    </div>
  );
}

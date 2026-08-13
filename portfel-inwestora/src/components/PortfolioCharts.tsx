"use client";

import { useEffect, useMemo, useState } from "react";
import TruncatedText from "@/components/TruncatedText";
import { fetchBenchmarkComparisons } from "@/lib/api";
import { getGeographicAllocation } from "@/lib/geographic-allocation";
import { buildPortfolioBenchmarkInvestments } from "@/lib/portfolio-state";
import { convertFromPln, getGroupedPortfolioAssets } from "@/lib/pricing";
import { isGpwSymbol } from "@/lib/ticker";
import { formatCurrency, round } from "@/lib/utils";
import type {
  BenchmarkComparison,
  CurrencyCode,
  FxRates,
  PortfolioAsset,
  PortfolioRealizedAdjustment,
  PortfolioSale,
} from "@/types/portfolio";

type PortfolioChartsProps = {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
  fxRates: FxRates;
  baseCurrency: CurrencyCode;
  combinedProfitLoss: number;
  view?: "all" | "structure" | "benchmarks";
};

type AssetClassBreakdownTarget = Pick<PortfolioAsset, "kind" | "symbol">;

const CHART_COLORS = [
  "#0f766e",
  "#d38d38",
  "#13314a",
  "#2f6f8f",
  "#b45309",
  "#3c7a57",
];

const ASSET_CLASS_BREAKDOWN = [
  {
    id: "stock-gpw",
    label: "Akcje GPW",
    color: CHART_COLORS[0],
    matches: (asset: AssetClassBreakdownTarget) =>
      asset.kind === "stock" && isGpwSymbol(asset.symbol),
  },
  {
    id: "stock-global",
    label: "Akcje zagraniczne",
    color: CHART_COLORS[1],
    matches: (asset: AssetClassBreakdownTarget) =>
      asset.kind === "stock" && !isGpwSymbol(asset.symbol),
  },
  {
    id: "etf",
    label: "ETF",
    color: CHART_COLORS[2],
    matches: (asset: AssetClassBreakdownTarget) => asset.kind === "etf",
  },
  {
    id: "crypto",
    label: "Krypto",
    color: CHART_COLORS[3],
    matches: (asset: AssetClassBreakdownTarget) => asset.kind === "crypto",
  },
  {
    id: "bond",
    label: "Obligacje",
    color: CHART_COLORS[4],
    matches: (asset: AssetClassBreakdownTarget) => asset.kind === "bond",
  },
] as const;

const COMPARISON_COLORS: Record<string, string> = {
  portfolio: "#13314a",
  sp500: "#0f766e",
  nasdaq100: "#2f6f8f",
  wig20: "#d38d38",
  bitcoin: "#b45309",
};

const toPercent = (value: number, total: number) => {
  if (total <= 0) return 0;
  return (value / total) * 100;
};

const createDonutBackground = (
  items: Array<{
    color: string;
    share: number;
  }>
) => {
  if (items.length === 0) {
    return "conic-gradient(#e7e2da 0 100%)";
  }

  let current = 0;

  return `conic-gradient(${items
    .map((item) => {
      const start = current;
      const end = current + item.share;
      current = end;
      return `${item.color} ${start}% ${end}%`;
    })
    .join(", ")})`;
};

export default function PortfolioCharts({
  assets,
  sales,
  fxRates,
  baseCurrency,
  combinedProfitLoss,
  view = "all",
}: PortfolioChartsProps) {
  const [benchmarkComparisons, setBenchmarkComparisons] = useState<BenchmarkComparison[]>([]);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);
  const [isLoadingBenchmarks, setIsLoadingBenchmarks] = useState(false);

  const groupedAssets = useMemo(
    () => getGroupedPortfolioAssets(assets, fxRates, baseCurrency),
    [assets, baseCurrency, fxRates]
  );
  const totalValue = groupedAssets.reduce(
    (total, asset) => total + asset.totalValue,
    0
  );
  const benchmarkInvestments = useMemo(
    () => buildPortfolioBenchmarkInvestments(assets, sales, fxRates),
    [assets, sales, fxRates]
  );
  const comparisonInvested = useMemo(
    () =>
      convertFromPln(
        benchmarkInvestments.reduce((total, investment) => total + investment.amountPln, 0),
        baseCurrency,
        fxRates
      ),
    [baseCurrency, benchmarkInvestments, fxRates]
  );
  const toCapitalReturnPercent = (profitLossPln: number, netInvestedPln: number) =>
    netInvestedPln > 0 && Number.isFinite(profitLossPln) && Number.isFinite(netInvestedPln)
      ? round((profitLossPln / netInvestedPln) * 100, 2)
      : 0;

  useEffect(() => {
    if (benchmarkInvestments.length === 0) {
      setBenchmarkComparisons([]);
      setBenchmarkError(null);
      return;
    }

    let isCancelled = false;
    setIsLoadingBenchmarks(true);
    setBenchmarkError(null);

    void (async () => {
      try {
        const comparisons = await fetchBenchmarkComparisons(benchmarkInvestments);

        if (!isCancelled) {
          setBenchmarkComparisons(comparisons);
        }
      } catch (error) {
        if (!isCancelled) {
          setBenchmarkError(
            error instanceof Error
              ? error.message
              : "Nie udalo sie pobrac benchmarkow."
          );
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingBenchmarks(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [benchmarkInvestments]);

  if (groupedAssets.length === 0 && benchmarkInvestments.length === 0) {
    return (
      <section className="panel chart-card">
        <p className="eyebrow">Wykresy</p>
        <h2 className="section-title">Najpierw dodaj aktywa</h2>
        <p className="section-copy">
          Gdy pojawia sie pierwsze pozycje, tutaj od razu zobaczysz strukture,
          porownanie z benchmarkami i ranking wynikow.
        </p>
      </section>
    );
  }

  const topAssets = [...groupedAssets]
    .sort((left, right) => right.totalValue - left.totalValue)
    .slice(0, 6)
    .map((asset, index) => ({
      ...asset,
      share: toPercent(asset.totalValue, totalValue),
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));

  const kindBreakdown = ASSET_CLASS_BREAKDOWN
    .map((definition) => {
      const total = groupedAssets
        .filter((asset) => definition.matches(asset))
        .reduce((sum, asset) => sum + asset.totalValue, 0);

      return {
        id: definition.id,
        label: definition.label,
        total,
        share: toPercent(total, totalValue),
        color: definition.color,
      };
    })
    .filter((item) => item.total > 0);
  const geographicBreakdown = getGeographicAllocation(groupedAssets).map((item, index) => ({
    ...item,
    share: toPercent(item.totalValue, totalValue),
    color: CHART_COLORS[index % CHART_COLORS.length],
  }));

  const performanceRanking = [...groupedAssets].sort(
    (left, right) => right.totalProfitLoss - left.totalProfitLoss
  );
  const topWinners = performanceRanking
    .filter((asset) => asset.totalProfitLoss > 0)
    .slice(0, 3);
  const topLosers = [...performanceRanking]
    .reverse()
    .filter((asset) => asset.totalProfitLoss < 0)
    .slice(0, 3);

  const portfolioComparison: BenchmarkComparison = {
    id: "portfolio",
    label: "Twoj portfel",
    investedPln: comparisonInvested,
    currentValuePln: round(totalValue),
    profitLossPln: combinedProfitLoss,
    returnPercent: toCapitalReturnPercent(combinedProfitLoss, comparisonInvested),
  };

  const comparisonItems = [
    portfolioComparison,
    ...benchmarkComparisons.map((item) => ({
      ...item,
      investedPln: convertFromPln(item.investedPln, baseCurrency, fxRates),
      currentValuePln: convertFromPln(item.currentValuePln, baseCurrency, fxRates),
      profitLossPln: convertFromPln(item.profitLossPln, baseCurrency, fxRates),
    })),
  ].map((item) => ({
    ...item,
    returnPercent: toCapitalReturnPercent(item.profitLossPln, item.investedPln),
  }));
  const maxAbsoluteReturn = Math.max(
    6,
    ...comparisonItems.map((item) => Math.abs(item.returnPercent))
  );

  return (
    <div className="charts-grid">
      {view !== "structure" ? <section className="panel chart-card chart-card-wide">
        <p className="eyebrow">Porownanie</p>
        <h2 className="section-title">Portfel vs benchmarki</h2>
        <p className="section-copy">
          Benchmarki liczymy na tych samych przeplywach gotowki co portfel, a procent
          pokazuje wynik wzgledem kapitalu netto.
        </p>

        <div className="comparison-list mt-6">
          {comparisonItems.map((item) => {
            const width = (Math.abs(item.returnPercent) / maxAbsoluteReturn) * 50;
            const left = item.returnPercent >= 0 ? 50 : 50 - width;

            return (
              <article key={item.id} className="comparison-card">
                <div className="comparison-header">
                  <div>
                    <p className="table-title">{item.label}</p>
                    <p className="table-note">
                      inwestycja: {formatCurrency(item.investedPln, baseCurrency)} · dzisiaj:{" "}
                      {formatCurrency(item.currentValuePln, baseCurrency)}
                    </p>                    <p className="table-note">
                      zwrot: {item.returnPercent >= 0 ? "+" : ""}
                      {item.returnPercent.toFixed(2)}%
                    </p>                  </div>
                  <strong
                    className={
                      item.profitLossPln >= 0 ? "tone-positive" : "tone-negative"
                    }
                  >
                    {item.returnPercent >= 0 ? "+" : ""}
                    {item.returnPercent.toFixed(2)}%
                  </strong>
                </div>

                <div className="comparison-track">
                  <div className="comparison-zero" />
                  <div
                    className={
                      item.returnPercent >= 0
                        ? "comparison-fill is-positive"
                        : "comparison-fill is-negative"
                    }
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 1.6)}%`,
                      background:
                        COMPARISON_COLORS[item.id] ?? CHART_COLORS[0],
                    }}
                  />
                </div>

                <p className="table-note mt-3">
                  {item.profitLossPln >= 0 ? "zysk" : "strata"}:{" "}
                  {formatCurrency(item.profitLossPln, baseCurrency)}
                </p>
              </article>
            );
          })}
        </div>

        {isLoadingBenchmarks ? (
          <p className="field-note mt-4">Laduje benchmarki do porownania...</p>
        ) : null}
        {benchmarkError ? (
          <p className="field-note field-note-error mt-4">{benchmarkError}</p>
        ) : null}
      </section> : null}

      {view !== "benchmarks" ? <section className="panel chart-card">
        <p className="eyebrow">Struktura</p>
        <h2 className="section-title">Najwieksze pozycje portfela</h2>
        <p className="section-copy">
          Szybko widzisz, ktore aktywa dominuja w wartosci calego portfela.
        </p>

        <div className="chart-stack mt-6">
          {topAssets.map((asset) => (
            <article key={asset.key} className="chart-row">
              <div className="chart-row-copy">
                <div>
                  <TruncatedText
                    as="p"
                    className="table-title"
                    text={`${asset.name} (${asset.symbol})`}
                  >
                    {asset.name} <span className="table-note">({asset.symbol})</span>
                  </TruncatedText>
                  <p className="table-note">
                    {asset.share.toFixed(1)}% portfela · {formatCurrency(asset.totalValue, baseCurrency)}
                  </p>
                </div>
                <strong>{formatCurrency(asset.totalProfitLoss, baseCurrency)}</strong>
              </div>

              <div className="chart-bar-track">
                <div
                  className="chart-bar-fill"
                  style={{
                    width: `${Math.max(asset.share, 6)}%`,
                    background: asset.color,
                  }}
                />
              </div>
            </article>
          ))}
        </div>
      </section> : null}

      {view !== "benchmarks" ? <section className="panel chart-card">
        <p className="eyebrow">Dywersyfikacja</p>
        <h2 className="section-title">Udzial klas aktywow</h2>
        <p className="section-copy">
          Podzial portfela na akcje, ETF-y, krypto i obligacje.
        </p>

        <div className="donut-layout mt-6">
          <div
            className="donut-chart"
            style={{ background: createDonutBackground(kindBreakdown) }}
          >
            <div className="donut-hole">
              <span className="table-note">Razem</span>
              <strong>{formatCurrency(totalValue, baseCurrency)}</strong>
            </div>
          </div>

          <div className="legend-list">
            {kindBreakdown.map((item) => (
              <div key={item.id} className="legend-item">
                <span
                  className="legend-swatch"
                  style={{ background: item.color }}
                />
                <div>
                  <p className="table-title">{item.label}</p>
                  <p className="table-note">
                    {item.share.toFixed(1)}% · {formatCurrency(item.total, baseCurrency)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section> : null}

      {view !== "benchmarks" ? <section className="panel chart-card">
        <p className="eyebrow">Geografia</p>
        <h2 className="section-title">Ekspozycja krajowa</h2>
        <p className="section-copy">
          Tylko akcje z potwierdzonym krajem emitenta. ETF-y bez zweryfikowanego look-through nie są tu przypisywane.
        </p>
        {geographicBreakdown.length ? <div className="legend-list mt-6">
          {geographicBreakdown.map((item) => (
            <div key={item.country} className="legend-item">
              <span className="legend-swatch" style={{ background: item.color }} />
              <div>
                <p className="table-title">{item.country}</p>
                <p className="table-note">{item.share.toFixed(1)}% · {formatCurrency(item.totalValue, baseCurrency)}</p>
              </div>
            </div>
          ))}
        </div> : <p className="workspace-empty-state mt-6">Brak potwierdzonych metadanych kraju emitenta dla obecnych akcji.</p>}
      </section> : null}

      {view !== "benchmarks" ? <section className="panel chart-card chart-card-wide">
        <p className="eyebrow">Wynik</p>
        <h2 className="section-title">Najmocniejsze i najslabsze pozycje</h2>
        <p className="section-copy">
          Taki widok szybko pokazuje, co aktualnie ciagnie portfel w gore, a co
          go obciaza.
        </p>

        <div className="chart-split mt-6">
          <div className="ranking-card">
            <p className="table-title">Najwiekszy zysk</p>
            <div className="ranking-list mt-4">
              {topWinners.length > 0 ? (
                topWinners.map((asset) => (
                  <div key={asset.key} className="ranking-row">
                    <div>
                      <TruncatedText
                        as="p"
                        className="table-title"
                        text={`${asset.name} (${asset.symbol})`}
                      >
                        {asset.name} <span className="table-note">({asset.symbol})</span>
                      </TruncatedText>
                      <p className="table-note">{formatCurrency(asset.totalValue, baseCurrency)}</p>
                    </div>
                    <strong className="tone-positive">
                      {formatCurrency(asset.totalProfitLoss, baseCurrency)}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="table-note">
                  Na razie nie ma pozycji na plusie, wiec ranking jest pusty.
                </p>
              )}
            </div>
          </div>

          <div className="ranking-card">
            <p className="table-title">Najwieksza strata</p>
            <div className="ranking-list mt-4">
              {topLosers.length > 0 ? (
                topLosers.map((asset) => (
                  <div key={asset.key} className="ranking-row">
                    <div>
                      <TruncatedText
                        as="p"
                        className="table-title"
                        text={`${asset.name} (${asset.symbol})`}
                      >
                        {asset.name} <span className="table-note">({asset.symbol})</span>
                      </TruncatedText>
                      <p className="table-note">{formatCurrency(asset.totalValue, baseCurrency)}</p>
                    </div>
                    <strong className="tone-negative">
                      {formatCurrency(asset.totalProfitLoss, baseCurrency)}
                    </strong>
                  </div>
                ))
              ) : (
                <p className="table-note">
                  Na razie nie ma pozycji ze strata, wiec ranking jest pusty.
                </p>
              )}
            </div>
          </div>
        </div>
      </section> : null}
    </div>
  );
}

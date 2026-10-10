"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import AssetTable from "@/components/AssetTable";
import ConfigurableDashboard from "@/components/ConfigurableDashboard";
import CorporateEventsPanel from "@/components/CorporateEventsPanel";
import UpcomingDividendsPanel from "@/components/UpcomingDividendsPanel";
import WatchlistWorkspace from "@/components/WatchlistWorkspace";
import PortfolioCharts from "@/components/PortfolioCharts";
import PortfolioLineCharts from "@/components/PortfolioLineCharts";
import PortfolioPerformanceResults from "@/components/PortfolioPerformanceResults";
import PortfolioPositionCards from "@/components/PortfolioPositionCards";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { formatCurrency, formatDate } from "@/lib/utils";
import { fetchPortfolioHistory } from "@/lib/api";
import { getPortfolioDividends } from "@/lib/dividend-engine";
import { ensurePortfolioCoreModel } from "@/lib/operation-engine";
import { convertFromPln } from "@/lib/pricing";
import type { PortfolioHistoryResponse } from "@/types/portfolio";

const getWorkspaceHistoryScopes = (workspace: ReturnType<typeof usePortfolioWorkspace>) =>
  workspace.isAllPortfoliosSelected
    ? workspace.selectedPortfolios.map((portfolio) => ({
        portfolioId: portfolio.id,
        accountType: portfolio.accountType,
        assets: portfolio.assets,
        sales: portfolio.sales,
        realizedAdjustments: portfolio.realizedAdjustments,
        operations: portfolio.operations ?? [],
        accounts: portfolio.accounts ?? [],
      }))
    : undefined;

const workspaceHistoryProps = (workspace: ReturnType<typeof usePortfolioWorkspace>) => ({
  assets: workspace.assets,
  sales: workspace.sales,
  realizedAdjustments: workspace.effectiveRealizedAdjustments,
  fxRates: workspace.fxRates,
  baseCurrency: workspace.activeBaseCurrency,
  combinedProfitLoss: workspace.summaryCombinedProfitLoss,
  refreshRevision: workspace.refreshRevision,
  operations: workspace.activePortfolio?.operations ?? [],
  accounts: workspace.activePortfolio?.accounts ?? [],
  accountType: workspace.activePortfolio?.accountType,
  benchmarks: workspace.isAllPortfoliosSelected ? [] : (workspace.activePortfolio?.benchmarks ?? []),
  portfolioScopes: getWorkspaceHistoryScopes(workspace),
});

const workspaceChartProps = (workspace: ReturnType<typeof usePortfolioWorkspace>) => ({
  assets: workspace.assets,
  sales: workspace.sales,
  realizedAdjustments: workspace.effectiveRealizedAdjustments,
  fxRates: workspace.fxRates,
  baseCurrency: workspace.activeBaseCurrency,
  combinedProfitLoss: workspace.summaryCombinedProfitLoss,
  cashValue: workspace.summaryCashValue,
  portfolioScopes: getWorkspaceHistoryScopes(workspace),
});

export function WorkspaceDashboardPage() {
  return <ConfigurableDashboard />;
}

export function WorkspacePositionsPage() {
  const workspace = usePortfolioWorkspace();
  const isAddAssetOpen = useSearchParams().get("add") === "asset";
  const resetAssetEntryForm = workspace.resetAssetEntryForm;
  useEffect(() => {
    if (isAddAssetOpen) resetAssetEntryForm();
    return () => { if (isAddAssetOpen) resetAssetEntryForm(); };
  }, [isAddAssetOpen, resetAssetEntryForm]);
  return <div className="workspace-page"><section className="workspace-page-actions"><p>{workspace.isAllPortfoliosSelected ? "Widok łączny jest tylko do odczytu. Pozycje o takim samym tickerze pozostają rozdzielone według portfela." : isAddAssetOpen ? "Formularz operacji jest otwarty." : "Zarządzaj pozycjami i przeglądaj ich bieżącą wycenę."}</p>{workspace.isAllPortfoliosSelected ? <Link href={workspace.getReadHref("/portfolios")} className="primary-button">Wybierz portfel do zmian</Link> : <Link href={workspace.getReadHref(isAddAssetOpen ? "/portfolio/positions" : "/portfolio/positions?add=asset")} className="primary-button">{isAddAssetOpen ? "Zamknij formularz" : "Dodaj transakcję"}</Link>}</section>{workspace.displayedSyncError ? <p className="field-note field-note-error">{workspace.displayedSyncError}</p> : null}{isAddAssetOpen && !workspace.isAllPortfoliosSelected ? workspace.assetEntryWorkspace : null}<div className="workspace-desktop-only"><AssetTable assets={workspace.assets} groups={workspace.groupedAssets} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} filter={workspace.filter} sortMode={workspace.assetSortMode} isRefreshing={workspace.isRefreshing} isReadOnly={workspace.isAllPortfoliosSelected} isManualPricePending={workspace.isManualPricePending} manualPriceError={workspace.manualPriceError} onUpdateManualPrice={workspace.onUpdateManualPrice} onClearManualPrice={workspace.onClearManualPrice} onFilterChange={workspace.onFilterChange} onSortModeChange={workspace.onSortModeChange} onReorderGroups={workspace.onReorderGroups} onRemove={workspace.onRemoveAsset} /></div><div className="workspace-mobile-only"><PortfolioPositionCards assets={workspace.assets} groups={workspace.groupedAssets} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} filter={workspace.filter} sortMode={workspace.assetSortMode} isRefreshing={workspace.isRefreshing} isManualPricePending={workspace.isManualPricePending} manualPriceError={workspace.manualPriceError} onUpdateManualPrice={workspace.onUpdateManualPrice} onClearManualPrice={workspace.onClearManualPrice} onSortModeChange={workspace.onSortModeChange} onRemove={workspace.onRemoveAsset} /></div></div>;
}

export function WorkspaceOperationsPage() {
  const workspace = usePortfolioWorkspace();
  const operations = workspace.selectedPortfolios.flatMap((portfolio) => (portfolio.operations ?? []).map((operation) => ({ operation, portfolio }))).sort((left, right) => right.operation.date.localeCompare(left.operation.date));
  return <div className="workspace-page workspace-operation-page"><section className="workspace-page-actions"><p>{workspace.isAllPortfoliosSelected ? `Historia operacji dla zakresu: ${workspace.portfolioScopeLabel}. Każdy wpis zachowuje źródłowy portfel.` : "Historia sprzedaży i ręczne korekty wyniku aktywnego portfela."}</p>{workspace.isAllPortfoliosSelected ? <Link href={workspace.getReadHref("/portfolios")} className="primary-button">Wybierz portfel do zmian</Link> : <Link href={workspace.getReadHref("/portfolio/positions?add=asset")} className="primary-button">Dodaj operację</Link>}</section>{workspace.isAllPortfoliosSelected ? <section className="panel workspace-aggregate-operation-list"><p className="eyebrow">{workspace.portfolioScopeLabel}</p><h2 className="section-title">Operacje</h2>{operations.length ? operations.slice(0, 100).map(({ operation, portfolio }) => <div key={`${portfolio.id}:${operation.id}`}><span><strong>{portfolio.name}</strong><small>{operation.operationType} · {formatDate(operation.date)}</small></span><strong>{typeof operation.metadata.symbol === "string" ? operation.metadata.symbol : "Operacja"}</strong></div>) : <p className="workspace-empty-state">Nie ma jeszcze operacji.</p>}</section> : workspace.operationsWorkspace}</div>;
}

export function WorkspaceDividendsPage() {
  const workspace = usePortfolioWorkspace();
  const eventScopeProps = workspace.portfolioScope.mode === "CUSTOM"
    ? { portfolioId: "custom", portfolioIds: workspace.selectedPortfolioIds }
    : { portfolioId: workspace.isAllRealPortfoliosSelected ? "all" : workspace.activePortfolioId, portfolioIds: undefined };
  if (!workspace.isAllPortfoliosSelected) return <div className="workspace-page"><UpcomingDividendsPanel key={workspace.activePortfolioId} {...eventScopeProps} />{workspace.incomeWorkspace}</div>;
  return <div className="workspace-page"><section className="panel"><p className="eyebrow">Dywidendy</p><h2 className="section-title">Dywidendy · {workspace.portfolioScopeLabel}</h2><p className="section-copy">Podsumowanie jest agregowane wyłącznie do odczytu; dodawanie i edycja wymagają konkretnego portfela.</p><div className="workspace-performance-metric-grid mt-6"><article><span>Dywidendy YTD</span><strong>{formatCurrency(workspace.activeDividendYtd, workspace.activeBaseCurrency)}</strong></article><article><span>W tym miesiącu</span><strong>{formatCurrency(workspace.activeDividendMonth, workspace.activeBaseCurrency)}</strong></article><article><span>Roczny dochód</span><strong>{formatCurrency(workspace.activeDividendAnnualIncome, workspace.activeBaseCurrency)}</strong></article></div><Link href={workspace.getReadHref("/portfolios")} className="ghost-button mt-6">Wybierz portfel do zmian</Link></section><UpcomingDividendsPanel key={`${workspace.portfolioScopeLabel}:${workspace.selectedPortfolioIds.join(",")}`} {...eventScopeProps} /><AggregateDividendHistory />{workspace.incomeWorkspace}</div>;
}

export function WorkspaceImportPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-import-page"><section className="workspace-page-actions"><p>{workspace.isAllPortfoliosSelected ? "Import wymaga wskazania jednego portfela docelowego." : "Import tworzy rzeczywiste operacje w aktywnym portfelu. Kurs bieżący nie blokuje zapisu transakcji."}</p><Link href={workspace.getReadHref(workspace.isAllPortfoliosSelected ? "/portfolios" : "/portfolio/positions")} className="ghost-button">{workspace.isAllPortfoliosSelected ? "Wybierz portfel" : "Wróć do pozycji"}</Link></section>{workspace.isAllPortfoliosSelected ? null : workspace.importWorkspace}</div>; }

export function WorkspacePerformancePage() { const workspace = usePortfolioWorkspace(); return <PortfolioPerformanceResults {...workspaceHistoryProps(workspace)} isAggregate={workspace.isAllPortfoliosSelected} />; }
export function WorkspaceChartsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-analysis-page"><PortfolioLineCharts initialMode="value" {...workspaceHistoryProps(workspace)} onBenchmarksChange={workspace.isAllPortfoliosSelected ? undefined : workspace.onBenchmarksChange} /></div>; }
export function WorkspaceStructurePage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-analysis-page"><PortfolioCharts view="structure" {...workspaceChartProps(workspace)} /></div>; }
export function WorkspaceInstrumentsPage() {
  const workspace = usePortfolioWorkspace();
  const isAllPortfoliosSelected = workspace.isAllPortfoliosSelected;
  const resetAssetEntryForm = workspace.resetAssetEntryForm;
  useEffect(() => {
    if (!isAllPortfoliosSelected) resetAssetEntryForm();
    return () => { if (!isAllPortfoliosSelected) resetAssetEntryForm(); };
  }, [isAllPortfoliosSelected, resetAssetEntryForm]);
  return <div className="workspace-page workspace-instruments-page">{workspace.isAllPortfoliosSelected ? <section className="panel"><p className="eyebrow">Instrumenty</p><h2 className="section-title">Wybierz portfel docelowy</h2><p className="section-copy">Wyszukiwanie pozostaje dostępne, ale zapis instrumentu wymaga konkretnego portfela.</p><Link href={workspace.getReadHref("/portfolios")} className="ghost-button">Wybierz portfel</Link></section> : workspace.assetEntryWorkspace}</div>;
}
export function WorkspaceWatchlistPage() { return <WatchlistWorkspace />; }
export function WorkspaceEventsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page"><CorporateEventsPanel portfolioId={workspace.portfolioScope.mode === "CUSTOM" ? "custom" : workspace.isAllRealPortfoliosSelected ? "all" : workspace.activePortfolioId} portfolioIds={workspace.portfolioScope.mode === "CUSTOM" ? workspace.selectedPortfolioIds : undefined} /></div>; }
export function WorkspaceGeneralMeetingsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page"><CorporateEventsPanel portfolioId={workspace.portfolioScope.mode === "CUSTOM" ? "custom" : workspace.isAllRealPortfoliosSelected ? "all" : workspace.activePortfolioId} portfolioIds={workspace.portfolioScope.mode === "CUSTOM" ? workspace.selectedPortfolioIds : undefined} variant="general-meetings" /></div>; }
export function WorkspaceSettingsPage() { return <div className="workspace-page workspace-settings-page">{usePortfolioWorkspace().settingsWorkspace}</div>; }
function SelectedPortfolioOverview() {
  const workspace = usePortfolioWorkspace();
  const [history, setHistory] = useState<PortfolioHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const selectedKey = workspace.selectedPortfolioIds.join(",");
  const selectedDataKey = workspace.selectedPortfolioSummaries.map(({ portfolio, summary }) =>
    `${portfolio.id}:${portfolio.updatedAt}:${portfolio.operations?.length ?? 0}:${summary.totalValuePln}:${summary.combinedProfitLossPln}`
  ).join("|") + `:${workspace.refreshRevision}`;

  useEffect(() => {
    const controller = new AbortController();
    setHistory(null);
    setIsLoading(true);
    setHasError(false);
    void fetchPortfolioHistory({
      assets: [], sales: [], realizedAdjustments: [],
      portfolioScopes: workspace.selectedPortfolios.map((portfolio) => ({
        portfolioId: portfolio.id,
        accountType: portfolio.accountType,
        assets: portfolio.assets,
        sales: portfolio.sales,
        realizedAdjustments: portfolio.realizedAdjustments,
        operations: portfolio.operations ?? [],
        accounts: portfolio.accounts ?? [],
      })),
      signal: controller.signal,
    }).then(setHistory).catch((error: unknown) => {
      if (!controller.signal.aborted && !(error instanceof DOMException && error.name === "AbortError")) setHasError(true);
    }).finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
    // Keep the read model fresh when the same selected set receives new trades or prices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDataKey, selectedKey]);

  const returnPercent = history?.points.at(-1)?.timeWeightedReturnPercent ?? null;
  const totalValuePln = workspace.selectedPortfolioSummaries.reduce((sum, item) => sum + item.summary.totalValuePln, 0);
  return <section className="panel portfolio-scope-overview" aria-busy={isLoading}>
    <div className="portfolio-scope-overview-head"><div><p className="eyebrow">Analizowany zakres</p><h2 className="section-title">{workspace.portfolioScopeLabel}</h2><p className="section-copy">Wirtualny widok tylko do odczytu; rzeczywiste rachunki i ich transakcje pozostają rozdzielone.</p></div><span>{workspace.selectedPortfolios.length} {workspace.selectedPortfolios.length === 1 ? "portfel" : "portfeli"}</span></div>
    <div className="workspace-performance-metric-grid mt-5">
      <article><span>Łączna wartość</span><strong>{formatCurrency(workspace.summaryTotalValue, workspace.activeBaseCurrency)}</strong></article>
      <article><span>Zysk / strata</span><strong className={workspace.summaryCombinedProfitLoss >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(workspace.summaryCombinedProfitLoss, workspace.activeBaseCurrency)}</strong></article>
      <article><span>Łączna stopa zwrotu · TWR</span><strong>{isLoading ? "Wczytywanie…" : hasError ? "Niedostępna" : returnPercent === null ? "Brak wiarygodnej historii" : `${returnPercent >= 0 ? "+" : ""}${returnPercent.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}%`}</strong></article>
    </div>
    {workspace.selectedPortfolioSummaries.length ? <div className="portfolio-scope-breakdown mt-5" aria-label="Wartość według portfela">{workspace.selectedPortfolioSummaries.map(({ portfolio, summary }) => {
      const share = totalValuePln > 0 ? Math.max(0, Math.min(100, summary.totalValuePln / totalValuePln * 100)) : 0;
      return <button key={portfolio.id} type="button" onClick={() => workspace.onPortfolioChange(portfolio.id)}><span><strong>{portfolio.name}</strong><small>{formatCurrency(summary.totalValue, summary.currency)} · {share.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%</small></span><span className="portfolio-scope-breakdown-track" aria-hidden="true"><i style={{ width: `${share}%` }} /></span><span aria-hidden="true">›</span></button>;
    })}</div> : null}
  </section>;
}

function AggregateDividendHistory() {
  const workspace = usePortfolioWorkspace();
  const dividends = useMemo(() => workspace.selectedPortfolios.flatMap((portfolio) =>
    getPortfolioDividends(ensurePortfolioCoreModel(portfolio), workspace.fxRates)
      .map((dividend) => ({ portfolio, dividend }))
  ).sort((left, right) => right.dividend.paymentDate.localeCompare(left.dividend.paymentDate)), [workspace.fxRates, workspace.selectedPortfolios]);

  return <section className="panel workspace-aggregate-dividends">
    <div className="sprint-panel-head"><div><p className="eyebrow">Historia dywidend</p><h2 className="section-title">Wypłaty · {workspace.portfolioScopeLabel}</h2></div><span className="tag">{dividends.length} wypłat</span></div>
    {dividends.length ? <ul className="workspace-aggregate-dividend-list">{dividends.slice(0, 100).map(({ portfolio, dividend }) => <li key={`${portfolio.id}:${dividend.id}`}>
      <span><strong>{dividend.symbol} · {dividend.instrumentName}</strong><small>{portfolio.name} · {formatDate(dividend.paymentDate)} · {dividend.isAutomatic ? "Automatycznie" : "Ręcznie"}</small></span>
      <span><strong>{formatCurrency(dividend.netAmount, dividend.currency)} netto</strong><small>{formatCurrency(convertFromPln(dividend.netAmountPln, workspace.activeBaseCurrency, workspace.fxRates), workspace.activeBaseCurrency)} · brutto {formatCurrency(dividend.grossAmount, dividend.currency)}</small></span>
    </li>)}</ul> : <p className="workspace-empty-state">Brak zapisanych wypłat w wybranym zakresie.</p>}
    {dividends.length > 100 ? <p className="field-note mt-4">Wyświetlono 100 z {dividends.length} wypłat; pozostałe dane pozostają zapisane w swoich portfelach.</p> : null}
  </section>;
}

export function WorkspacePortfoliosPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-portfolios-page"><SelectedPortfolioOverview />{workspace.portfolioManagementWorkspace}</div>; }
export function WorkspaceWealthPage() { return <div className="workspace-page workspace-wealth-page">{usePortfolioWorkspace().wealthWorkspace}</div>; }

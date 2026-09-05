"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
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

const getWorkspaceHistoryScopes = (workspace: ReturnType<typeof usePortfolioWorkspace>) =>
  workspace.isAllPortfoliosSelected
    ? workspace.portfolios.map((portfolio) => ({
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
  return <div className="workspace-page"><section className="workspace-page-actions"><p>{workspace.isAllPortfoliosSelected ? "Widok łączny jest tylko do odczytu. Pozycje o takim samym tickerze pozostają rozdzielone według portfela." : isAddAssetOpen ? "Formularz operacji jest otwarty." : "Zarządzaj pozycjami i przeglądaj ich bieżącą wycenę."}</p>{workspace.isAllPortfoliosSelected ? <Link href="/portfolios" className="primary-button">Wybierz portfel do zmian</Link> : <Link href={isAddAssetOpen ? "/portfolio/positions" : "/portfolio/positions?add=asset"} className="primary-button">{isAddAssetOpen ? "Zamknij formularz" : "Dodaj transakcję"}</Link>}</section>{workspace.displayedSyncError ? <p className="field-note field-note-error">{workspace.displayedSyncError}</p> : null}{isAddAssetOpen && !workspace.isAllPortfoliosSelected ? workspace.assetEntryWorkspace : null}<div className="workspace-desktop-only"><AssetTable assets={workspace.assets} groups={workspace.groupedAssets} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} filter={workspace.filter} sortMode={workspace.assetSortMode} isRefreshing={workspace.isRefreshing} onFilterChange={workspace.onFilterChange} onSortModeChange={workspace.onSortModeChange} onReorderGroups={workspace.onReorderGroups} onRemove={workspace.onRemoveAsset} /></div><div className="workspace-mobile-only"><PortfolioPositionCards assets={workspace.assets} groups={workspace.groupedAssets} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} filter={workspace.filter} sortMode={workspace.assetSortMode} isRefreshing={workspace.isRefreshing} onSortModeChange={workspace.onSortModeChange} onRemove={workspace.onRemoveAsset} /></div></div>;
}

export function WorkspaceOperationsPage() {
  const workspace = usePortfolioWorkspace();
  const operations = workspace.portfolios.flatMap((portfolio) => (portfolio.operations ?? []).map((operation) => ({ operation, portfolio }))).sort((left, right) => right.operation.date.localeCompare(left.operation.date));
  return <div className="workspace-page workspace-operation-page"><section className="workspace-page-actions"><p>{workspace.isAllPortfoliosSelected ? "Łączna historia operacji jest pokazana z oznaczeniem źródłowego portfela." : "Historia sprzedaży i ręczne korekty wyniku aktywnego portfela."}</p>{workspace.isAllPortfoliosSelected ? <Link href="/portfolios" className="primary-button">Wybierz portfel do zmian</Link> : <Link href="/portfolio/positions?add=asset" className="primary-button">Dodaj operację</Link>}</section>{workspace.isAllPortfoliosSelected ? <section className="panel workspace-aggregate-operation-list"><p className="eyebrow">Wszystkie portfele</p><h2 className="section-title">Operacje</h2>{operations.length ? operations.slice(0, 100).map(({ operation, portfolio }) => <div key={`${portfolio.id}:${operation.id}`}><span><strong>{portfolio.name}</strong><small>{operation.operationType} · {formatDate(operation.date)}</small></span><strong>{typeof operation.metadata.symbol === "string" ? operation.metadata.symbol : "Operacja"}</strong></div>) : <p className="workspace-empty-state">Nie ma jeszcze operacji.</p>}</section> : workspace.operationsWorkspace}</div>;
}

export function WorkspaceDividendsPage() {
  const workspace = usePortfolioWorkspace();
  if (!workspace.isAllPortfoliosSelected) return <div className="workspace-page"><UpcomingDividendsPanel key={workspace.activePortfolioId} portfolioId={workspace.activePortfolioId} />{workspace.incomeWorkspace}</div>;
  return <div className="workspace-page"><section className="panel"><p className="eyebrow">Dywidendy</p><h2 className="section-title">Dywidendy wszystkich portfeli</h2><p className="section-copy">Podsumowanie jest agregowane wyłącznie do odczytu; dodawanie i edycja wymagają konkretnego portfela.</p><div className="workspace-performance-metric-grid mt-6"><article><span>Dywidendy YTD</span><strong>{formatCurrency(workspace.activeDividendYtd, workspace.activeBaseCurrency)}</strong></article><article><span>W tym miesiącu</span><strong>{formatCurrency(workspace.activeDividendMonth, workspace.activeBaseCurrency)}</strong></article><article><span>Roczny dochód</span><strong>{formatCurrency(workspace.activeDividendAnnualIncome, workspace.activeBaseCurrency)}</strong></article></div><Link href="/portfolios" className="ghost-button mt-6">Wybierz portfel do zmian</Link></section><UpcomingDividendsPanel key="all" portfolioId="all" />{workspace.incomeWorkspace}</div>;
}

export function WorkspaceImportPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-import-page"><section className="workspace-page-actions"><p>{workspace.isAllPortfoliosSelected ? "Import wymaga wskazania jednego portfela docelowego." : "Import tworzy rzeczywiste operacje w aktywnym portfelu. Kurs bieżący nie blokuje zapisu transakcji."}</p><Link href={workspace.isAllPortfoliosSelected ? "/portfolios" : "/portfolio/positions"} className="ghost-button">{workspace.isAllPortfoliosSelected ? "Wybierz portfel" : "Wróć do pozycji"}</Link></section>{workspace.isAllPortfoliosSelected ? null : workspace.importWorkspace}</div>; }

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
  return <div className="workspace-page workspace-instruments-page">{workspace.isAllPortfoliosSelected ? <section className="panel"><p className="eyebrow">Instrumenty</p><h2 className="section-title">Wybierz portfel docelowy</h2><p className="section-copy">Wyszukiwanie pozostaje dostępne, ale zapis instrumentu wymaga konkretnego portfela.</p><Link href="/portfolios" className="ghost-button">Wybierz portfel</Link></section> : workspace.assetEntryWorkspace}</div>;
}
export function WorkspaceWatchlistPage() { return <WatchlistWorkspace />; }
export function WorkspaceEventsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page"><CorporateEventsPanel portfolioId={workspace.isAllPortfoliosSelected ? "all" : workspace.activePortfolioId} /></div>; }
export function WorkspaceGeneralMeetingsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page"><CorporateEventsPanel portfolioId={workspace.isAllPortfoliosSelected ? "all" : workspace.activePortfolioId} variant="general-meetings" /></div>; }
export function WorkspaceSettingsPage() { return <div className="workspace-page workspace-settings-page">{usePortfolioWorkspace().settingsWorkspace}</div>; }
export function WorkspacePortfoliosPage() { return <div className="workspace-page workspace-portfolios-page">{usePortfolioWorkspace().portfolioManagementWorkspace}</div>; }
export function WorkspaceWealthPage() { return <div className="workspace-page workspace-wealth-page">{usePortfolioWorkspace().wealthWorkspace}</div>; }

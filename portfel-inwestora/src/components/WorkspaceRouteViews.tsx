"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AssetTable from "@/components/AssetTable";
import CorporateEventsPanel from "@/components/CorporateEventsPanel";
import UpcomingDividendsPanel from "@/components/UpcomingDividendsPanel";
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
        assets: portfolio.assets,
        sales: portfolio.sales,
        realizedAdjustments: portfolio.realizedAdjustments,
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
  portfolioScopes: getWorkspaceHistoryScopes(workspace),
});

const workspaceChartProps = (workspace: ReturnType<typeof usePortfolioWorkspace>) => ({
  assets: workspace.assets,
  sales: workspace.sales,
  realizedAdjustments: workspace.effectiveRealizedAdjustments,
  fxRates: workspace.fxRates,
  baseCurrency: workspace.activeBaseCurrency,
  combinedProfitLoss: workspace.summaryCombinedProfitLoss,
  portfolioScopes: getWorkspaceHistoryScopes(workspace),
});

export function WorkspaceDashboardPage() {
  const workspace = usePortfolioWorkspace();
  const positionsPreview = workspace.groupedAssets.slice(0, 5);
  const allocationPreview = Array.from(
    workspace.groupedAssets.reduce((items, group) => {
      items.set(group.kind, (items.get(group.kind) ?? 0) + group.totalValue);
      return items;
    }, new Map<(typeof workspace.groupedAssets)[number]["kind"], number>()).entries()
  ).sort((left, right) => right[1] - left[1]);

  return <div className="workspace-page workspace-dashboard">
    <section className="workspace-dashboard-intro"><div><p className="eyebrow">{workspace.isAllPortfoliosSelected ? "Wszystkie portfele" : workspace.activePortfolio?.name ?? "Aktywny portfel"}</p><h2>Najważniejsze informacje, bez przeładowania.</h2></div>{workspace.isAllPortfoliosSelected ? <Link href="/portfolios" className="primary-button">Wybierz portfel do zmian</Link> : <Link href="/portfolio/positions?add=asset" className="primary-button">Dodaj aktywo</Link>}</section>
    {workspace.summaryPanel}
    <section className="workspace-dashboard-income" aria-label="Dywidendy portfela"><div><span>Dywidendy YTD</span><strong>{formatCurrency(workspace.activeDividendYtd, workspace.activeBaseCurrency)}</strong></div><div><span>W tym miesiącu</span><strong>{formatCurrency(workspace.activeDividendMonth, workspace.activeBaseCurrency)}</strong></div><div><span>Roczny dochód</span><strong>{formatCurrency(workspace.activeDividendAnnualIncome, workspace.activeBaseCurrency)}</strong></div><Link href={workspace.getReadHref("/portfolio/dividends")}>Dywidendy →</Link></section>
    <div className="workspace-dashboard-grid">
      <section className="workspace-dashboard-chart"><PortfolioLineCharts {...workspaceHistoryProps(workspace)} /></section>
      <section className="panel panel-compact workspace-dashboard-positions"><div className="workspace-section-head"><div><p className="eyebrow">Portfel</p><h2 className="section-title">Największe pozycje</h2></div><Link href={workspace.getReadHref("/portfolio/positions")}>Wszystkie</Link></div>{positionsPreview.length ? <div className="workspace-preview-list">{positionsPreview.map((group) => <div key={group.key}><span><strong>{group.name}</strong><small>{group.symbol} · {group.quantity}{group.portfolioName ? ` · ${group.portfolioName}` : ""}</small></span><span><strong>{formatCurrency(group.totalValue, workspace.activeBaseCurrency)}</strong><small className={group.profitLossBase >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(group.profitLossBase, workspace.activeBaseCurrency)}</small></span></div>)}</div> : <p className="workspace-empty-state">Dodaj pierwszy instrument, aby zobaczyć pozycje.</p>}</section>
      <section className="panel panel-compact workspace-dashboard-allocation"><div className="workspace-section-head"><div><p className="eyebrow">Struktura</p><h2 className="section-title">Klasy aktywów</h2></div><Link href={workspace.getReadHref("/analytics/structure")}>Analizuj</Link></div>{allocationPreview.length ? <div className="workspace-allocation-list">{allocationPreview.map(([kind, value]) => <div key={kind}><span>{kind === "stock" ? "Akcje" : kind === "etf" ? "ETF" : kind === "crypto" ? "Krypto" : "Obligacje"}</span><strong>{workspace.summaryTotalValue > 0 ? `${Math.round((value / workspace.summaryTotalValue) * 100)}%` : "0%"}</strong></div>)}</div> : <p className="workspace-empty-state">Struktura pojawi się po dodaniu aktywów.</p>}</section>
      <CorporateEventsPanel portfolioId={workspace.isAllPortfoliosSelected ? "all" : workspace.activePortfolioId} />
    </div>
  </div>;
}

export function WorkspacePositionsPage() {
  const workspace = usePortfolioWorkspace();
  const isAddAssetOpen = useSearchParams().get("add") === "asset";
  return <div className="workspace-page"><section className="workspace-page-actions"><p>{workspace.isAllPortfoliosSelected ? "Widok łączny jest tylko do odczytu. Pozycje o takim samym tickerze pozostają rozdzielone według portfela." : isAddAssetOpen ? "Formularz operacji jest otwarty." : "Zarządzaj pozycjami i przeglądaj ich bieżącą wycenę."}</p>{workspace.isAllPortfoliosSelected ? <Link href="/portfolios" className="primary-button">Wybierz portfel do zmian</Link> : <Link href={isAddAssetOpen ? "/portfolio/positions" : "/portfolio/positions?add=asset"} className="primary-button">{isAddAssetOpen ? "Zamknij formularz" : "Dodaj aktywo"}</Link>}</section>{workspace.displayedSyncError ? <p className="field-note field-note-error">{workspace.displayedSyncError}</p> : null}{isAddAssetOpen && !workspace.isAllPortfoliosSelected ? workspace.assetEntryWorkspace : null}<div className="workspace-desktop-only"><AssetTable assets={workspace.assets} groups={workspace.groupedAssets} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} filter={workspace.filter} sortMode={workspace.assetSortMode} isRefreshing={workspace.isRefreshing} onFilterChange={workspace.onFilterChange} onSortModeChange={workspace.onSortModeChange} onReorderGroups={workspace.onReorderGroups} onRemove={workspace.onRemoveAsset} /></div><div className="workspace-mobile-only"><PortfolioPositionCards assets={workspace.assets} groups={workspace.groupedAssets} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} filter={workspace.filter} sortMode={workspace.assetSortMode} isRefreshing={workspace.isRefreshing} onSortModeChange={workspace.onSortModeChange} onRemove={workspace.onRemoveAsset} /></div></div>;
}

export function WorkspaceOperationsPage() {
  const workspace = usePortfolioWorkspace();
  const operations = workspace.portfolios.flatMap((portfolio) => (portfolio.operations ?? []).map((operation) => ({ operation, portfolio }))).sort((left, right) => right.operation.date.localeCompare(left.operation.date));
  return <div className="workspace-page workspace-operation-page"><section className="workspace-page-actions"><p>{workspace.isAllPortfoliosSelected ? "Łączna historia operacji jest pokazana z oznaczeniem źródłowego portfela." : "Historia sprzedaży i ręczne korekty wyniku aktywnego portfela."}</p>{workspace.isAllPortfoliosSelected ? <Link href="/portfolios" className="primary-button">Wybierz portfel do zmian</Link> : <Link href="/portfolio/positions?add=asset" className="primary-button">Dodaj operację</Link>}</section>{workspace.isAllPortfoliosSelected ? <section className="panel workspace-aggregate-operation-list"><p className="eyebrow">Wszystkie portfele</p><h2 className="section-title">Operacje</h2>{operations.length ? operations.slice(0, 100).map(({ operation, portfolio }) => <div key={`${portfolio.id}:${operation.id}`}><span><strong>{portfolio.name}</strong><small>{operation.operationType} · {formatDate(operation.date)}</small></span><strong>{typeof operation.metadata.symbol === "string" ? operation.metadata.symbol : "Operacja"}</strong></div>) : <p className="workspace-empty-state">Nie ma jeszcze operacji.</p>}</section> : workspace.operationsWorkspace}</div>;
}

export function WorkspaceDividendsPage() {
  const workspace = usePortfolioWorkspace();
  if (!workspace.isAllPortfoliosSelected) return <div className="workspace-page"><UpcomingDividendsPanel key={workspace.activePortfolioId} portfolioId={workspace.activePortfolioId} />{workspace.incomeWorkspace}</div>;
  return <div className="workspace-page"><section className="panel"><p className="eyebrow">Dywidendy</p><h2 className="section-title">Dywidendy wszystkich portfeli</h2><p className="section-copy">Podsumowanie jest agregowane wyłącznie do odczytu; dodawanie i edycja wymagają konkretnego portfela.</p><div className="workspace-performance-metric-grid mt-6"><article><span>Dywidendy YTD</span><strong>{formatCurrency(workspace.activeDividendYtd, workspace.activeBaseCurrency)}</strong></article><article><span>W tym miesiącu</span><strong>{formatCurrency(workspace.activeDividendMonth, workspace.activeBaseCurrency)}</strong></article><article><span>Roczny dochód</span><strong>{formatCurrency(workspace.activeDividendAnnualIncome, workspace.activeBaseCurrency)}</strong></article></div><Link href="/portfolios" className="ghost-button mt-6">Wybierz portfel do zmian</Link></section><UpcomingDividendsPanel key="all" portfolioId="all" /></div>;
}

export function WorkspaceImportPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-import-page"><section className="workspace-page-actions"><p>{workspace.isAllPortfoliosSelected ? "Import wymaga wskazania jednego portfela docelowego." : "Import tworzy rzeczywiste operacje w aktywnym portfelu. Kurs bieżący nie blokuje zapisu transakcji."}</p><Link href={workspace.isAllPortfoliosSelected ? "/portfolios" : "/portfolio/positions"} className="ghost-button">{workspace.isAllPortfoliosSelected ? "Wybierz portfel" : "Wróć do pozycji"}</Link></section>{workspace.isAllPortfoliosSelected ? null : workspace.importWorkspace}</div>; }

export function WorkspacePerformancePage() { const workspace = usePortfolioWorkspace(); return <PortfolioPerformanceResults {...workspaceChartProps(workspace)} />; }
export function WorkspaceChartsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-analysis-page"><PortfolioLineCharts initialMode="value" showDailyInvestmentResult {...workspaceHistoryProps(workspace)} /></div>; }
export function WorkspaceStructurePage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-analysis-page"><PortfolioCharts view="structure" {...workspaceChartProps(workspace)} /></div>; }
export function WorkspaceBenchmarksPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-analysis-page"><PortfolioCharts view="benchmarks" {...workspaceChartProps(workspace)} /></div>; }
export function WorkspaceInstrumentsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-instruments-page">{workspace.isAllPortfoliosSelected ? <section className="panel"><p className="eyebrow">Instrumenty</p><h2 className="section-title">Wybierz portfel docelowy</h2><p className="section-copy">Wyszukiwanie pozostaje dostępne, ale zapis instrumentu wymaga konkretnego portfela.</p><Link href="/portfolios" className="ghost-button">Wybierz portfel</Link></section> : workspace.assetEntryWorkspace}</div>; }
export function WorkspaceEventsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page"><CorporateEventsPanel portfolioId={workspace.isAllPortfoliosSelected ? "all" : workspace.activePortfolioId} /></div>; }
export function WorkspaceSettingsPage() { return <div className="workspace-page workspace-settings-page">{usePortfolioWorkspace().settingsWorkspace}</div>; }
export function WorkspacePortfoliosPage() { return <div className="workspace-page workspace-portfolios-page">{usePortfolioWorkspace().portfolioManagementWorkspace}</div>; }
export function WorkspaceWealthPage() { return <div className="workspace-page workspace-wealth-page">{usePortfolioWorkspace().wealthWorkspace}</div>; }

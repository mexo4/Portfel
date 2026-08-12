"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AssetTable from "@/components/AssetTable";
import CorporateEventsPanel from "@/components/CorporateEventsPanel";
import PortfolioCharts from "@/components/PortfolioCharts";
import PortfolioLineCharts from "@/components/PortfolioLineCharts";
import PortfolioPositionCards from "@/components/PortfolioPositionCards";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { formatCurrency } from "@/lib/utils";

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
    <section className="workspace-dashboard-intro"><div><p className="eyebrow">{workspace.activePortfolio?.name ?? "Aktywny portfel"}</p><h2>Najważniejsze informacje, bez przeładowania.</h2></div><Link href="/portfolio/positions?add=asset" className="primary-button">Dodaj aktywo</Link></section>
    {workspace.summaryPanel}
    <section className="workspace-dashboard-income" aria-label="Dywidendy portfela"><div><span>Dywidendy YTD</span><strong>{formatCurrency(workspace.activeDividendYtd, workspace.activeBaseCurrency)}</strong></div><div><span>W tym miesiącu</span><strong>{formatCurrency(workspace.activeDividendMonth, workspace.activeBaseCurrency)}</strong></div><div><span>Roczny dochód</span><strong>{formatCurrency(workspace.activeDividendAnnualIncome, workspace.activeBaseCurrency)}</strong></div><Link href="/portfolio/dividends">Dywidendy →</Link></section>
    <div className="workspace-dashboard-grid">
      <section className="workspace-dashboard-chart"><PortfolioLineCharts assets={workspace.assets} sales={workspace.sales} realizedAdjustments={workspace.effectiveRealizedAdjustments} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} combinedProfitLoss={workspace.summaryCombinedProfitLoss} refreshRevision={workspace.refreshRevision} /></section>
      <section className="panel panel-compact workspace-dashboard-positions"><div className="workspace-section-head"><div><p className="eyebrow">Portfel</p><h2 className="section-title">Największe pozycje</h2></div><Link href="/portfolio/positions">Wszystkie</Link></div>{positionsPreview.length ? <div className="workspace-preview-list">{positionsPreview.map((group) => <div key={group.key}><span><strong>{group.name}</strong><small>{group.symbol} · {group.quantity}</small></span><span><strong>{formatCurrency(group.totalValue, workspace.activeBaseCurrency)}</strong><small className={group.profitLossBase >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(group.profitLossBase, workspace.activeBaseCurrency)}</small></span></div>)}</div> : <p className="workspace-empty-state">Dodaj pierwszy instrument, aby zobaczyć pozycje.</p>}</section>
      <section className="panel panel-compact workspace-dashboard-allocation"><div className="workspace-section-head"><div><p className="eyebrow">Struktura</p><h2 className="section-title">Klasy aktywów</h2></div><Link href="/analytics/structure">Analizuj</Link></div>{allocationPreview.length ? <div className="workspace-allocation-list">{allocationPreview.map(([kind, value]) => <div key={kind}><span>{kind === "stock" ? "Akcje" : kind === "etf" ? "ETF" : kind === "crypto" ? "Krypto" : "Obligacje"}</span><strong>{workspace.summaryTotalValue > 0 ? `${Math.round((value / workspace.summaryTotalValue) * 100)}%` : "0%"}</strong></div>)}</div> : <p className="workspace-empty-state">Struktura pojawi się po dodaniu aktywów.</p>}</section>
      <CorporateEventsPanel key={workspace.activePortfolioId} portfolioId={workspace.activePortfolioId} />
    </div>
  </div>;
}

export function WorkspacePositionsPage() {
  const workspace = usePortfolioWorkspace();
  const isAddAssetOpen = useSearchParams().get("add") === "asset";
  return <div className="workspace-page"><section className="workspace-page-actions"><p>{isAddAssetOpen ? "Formularz operacji jest otwarty." : "Zarządzaj pozycjami i przeglądaj ich bieżącą wycenę."}</p><Link href={isAddAssetOpen ? "/portfolio/positions" : "/portfolio/positions?add=asset"} className="primary-button">{isAddAssetOpen ? "Zamknij formularz" : "Dodaj aktywo"}</Link></section>{workspace.displayedSyncError ? <p className="field-note field-note-error">{workspace.displayedSyncError}</p> : null}{isAddAssetOpen ? workspace.assetEntryWorkspace : null}<div className="workspace-desktop-only"><AssetTable assets={workspace.assets} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} filter={workspace.filter} sortMode={workspace.assetSortMode} isRefreshing={workspace.isRefreshing} onFilterChange={workspace.onFilterChange} onSortModeChange={workspace.onSortModeChange} onReorderGroups={workspace.onReorderGroups} onRemove={workspace.onRemoveAsset} /></div><div className="workspace-mobile-only"><PortfolioPositionCards assets={workspace.assets} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} filter={workspace.filter} isRefreshing={workspace.isRefreshing} onRemove={workspace.onRemoveAsset} /></div></div>;
}

export function WorkspaceOperationsPage() { return <div className="workspace-page workspace-operation-page"><section className="workspace-page-actions"><p>Historia sprzedaży i ręczne korekty wyniku aktywnego portfela.</p><Link href="/portfolio/positions?add=asset" className="primary-button">Dodaj operację</Link></section>{usePortfolioWorkspace().operationsWorkspace}</div>; }
export function WorkspaceDividendsPage() { return <div className="workspace-page">{usePortfolioWorkspace().incomeWorkspace}</div>; }
export function WorkspaceImportPage() { return <div className="workspace-page workspace-import-page"><section className="workspace-page-actions"><p>Import tworzy rzeczywiste operacje w aktywnym portfelu. Kurs bieżący nie blokuje zapisu transakcji.</p><Link href="/portfolio/positions" className="ghost-button">Wróć do pozycji</Link></section>{usePortfolioWorkspace().importWorkspace}</div>; }

function WorkspaceLineChart({ initialMode }: { initialMode: "value" | "return" }) {
  const workspace = usePortfolioWorkspace();
  return <PortfolioLineCharts key={initialMode} initialMode={initialMode} assets={workspace.assets} sales={workspace.sales} realizedAdjustments={workspace.effectiveRealizedAdjustments} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} combinedProfitLoss={workspace.summaryCombinedProfitLoss} refreshRevision={workspace.refreshRevision} />;
}
export function WorkspacePerformancePage() { return <div className="workspace-page workspace-analysis-page"><WorkspaceLineChart initialMode="return" /></div>; }
export function WorkspaceChartsPage() { return <div className="workspace-page workspace-analysis-page"><WorkspaceLineChart initialMode="value" /></div>; }
export function WorkspaceStructurePage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-analysis-page"><PortfolioCharts view="structure" assets={workspace.assets} sales={workspace.sales} realizedAdjustments={workspace.realizedAdjustments} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} combinedProfitLoss={workspace.summaryCombinedProfitLoss} /></div>; }
export function WorkspaceBenchmarksPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-analysis-page"><PortfolioCharts view="benchmarks" assets={workspace.assets} sales={workspace.sales} realizedAdjustments={workspace.realizedAdjustments} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} combinedProfitLoss={workspace.summaryCombinedProfitLoss} /></div>; }

export function WorkspaceInstrumentsPage() { return <div className="workspace-page workspace-instruments-page">{usePortfolioWorkspace().assetEntryWorkspace}</div>; }
export function WorkspaceEventsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page"><CorporateEventsPanel key={workspace.activePortfolioId} portfolioId={workspace.activePortfolioId} /></div>; }
export function WorkspaceSettingsPage() { return <div className="workspace-page workspace-settings-page">{usePortfolioWorkspace().settingsWorkspace}</div>; }

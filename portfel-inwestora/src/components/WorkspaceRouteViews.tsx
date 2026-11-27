"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cloneElement, isValidElement, useEffect, useMemo, useState, type ReactNode } from "react";
import AssetTable from "@/components/AssetTable";
import ClosedCalendar from "@/components/ClosedCalendar";
import ClosedInvestmentsWorkspace from "@/components/ClosedInvestmentsWorkspace";
import PortfolioHealthWorkspace from "@/components/PortfolioHealthWorkspace";
import { usePageView } from "@/components/usePageView";
import ConfigurableDashboard from "@/components/ConfigurableDashboard";
import CurrencyExposure from "@/components/CurrencyExposure";
import StructureOverTime from "@/components/StructureOverTime";
import WealthTimeline from "@/components/WealthTimeline";
import CorporateEventsPanel from "@/components/CorporateEventsPanel";
import DividendIncomeDashboard from "@/components/DividendIncomeDashboard";
import GpwEventsWorkspace from "@/components/GpwEventsWorkspace";
import InstrumentChartsWorkspace from "@/components/InstrumentChartsWorkspace";
import IncomeCurrencyAmount from "@/components/IncomeCurrencyAmount";
import UpcomingDividendsPanel from "@/components/UpcomingDividendsPanel";
import WatchlistWorkspace from "@/components/WatchlistWorkspace";
import PortfolioCharts from "@/components/PortfolioCharts";
import PortfolioLineCharts from "@/components/PortfolioLineCharts";
import PortfolioPerformanceResults from "@/components/PortfolioPerformanceResults";
import PortfolioPositionCards from "@/components/PortfolioPositionCards";
import PositionsWorkspace from "@/components/PositionsWorkspace";
import ReportsWorkspace from "@/components/ReportsWorkspace";
import TaxReportWorkspace from "@/components/TaxReportWorkspace";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getPortfolioDividends } from "@/lib/dividend-engine";
import { ensurePortfolioCoreModel } from "@/lib/operation-engine";
import { convertFromPln } from "@/lib/pricing";

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
  presentationCurrency: workspace.presentationCurrency,
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
  const searchParams = useSearchParams();
  const isAddAssetOpen = searchParams.get("add") === "asset";
  const entryLotId = searchParams.get("walor");
  const entryTargetId = workspace.isAllPortfoliosSelected ? searchParams.get("cel") : null;
  const entrySide = searchParams.get("strona") === "sprzedaj" ? "sell" : "buy";
  const resetAssetEntryForm = workspace.resetAssetEntryForm;
  const prefillAssetEntry = workspace.prefillAssetEntry;
  useEffect(() => {
    if (isAddAssetOpen) resetAssetEntryForm();
    return () => { if (isAddAssetOpen) resetAssetEntryForm(); };
  }, [isAddAssetOpen, resetAssetEntryForm]);
  // Declared after the reset on purpose: the form is cleared first, then filled.
  useEffect(() => {
    if (isAddAssetOpen) prefillAssetEntry({ lotId: entryLotId, targetPortfolioId: entryTargetId, side: entrySide });
  }, [entryLotId, entrySide, entryTargetId, isAddAssetOpen, prefillAssetEntry]);
  const [view, setView] = useState<"list" | "table">(() => {
    try { return typeof window !== "undefined" && window.localStorage.getItem("mexo.positions.view") === "table" ? "table" : "list"; } catch { return "list"; }
  });
  const changeView = (next: "list" | "table") => { setView(next); try { window.localStorage.setItem("mexo.positions.view", next); } catch { /* the choice is a convenience */ } };
  const toolbar = <><div className="view-switch" role="group" aria-label="Widok pozycji"><button type="button" aria-pressed={view === "list"} onClick={() => changeView("list")}>Lista z podglądem</button><button type="button" aria-pressed={view === "table"} onClick={() => changeView("table")}>Tabela</button></div><Link href={workspace.getReadHref(isAddAssetOpen ? "/portfolio/positions" : "/portfolio/positions?add=asset")} className="primary-button">{isAddAssetOpen ? "Zamknij formularz" : "Dodaj transakcję"}</Link></>;
  return <div className="workspace-page">{view === "table" || isAddAssetOpen ? <section className="workspace-page-actions positions-toolbar">{toolbar}</section> : null}{workspace.displayedSyncError ? <p className="field-note field-note-error">{workspace.displayedSyncError}</p> : null}{isAddAssetOpen ? workspace.assetEntryWorkspace : null}{view === "list" ? <PositionsWorkspace toolbar={isAddAssetOpen ? undefined : toolbar} /> : <><div className="workspace-desktop-only"><AssetTable assets={workspace.assets} groups={workspace.groupedAssets} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} filter={workspace.filter} sortMode={workspace.assetSortMode} isRefreshing={workspace.isRefreshing} isReadOnly={workspace.isAllPortfoliosSelected} isManualPricePending={workspace.isManualPricePending} manualPriceError={workspace.manualPriceError} onUpdateManualPrice={workspace.onUpdateManualPrice} onClearManualPrice={workspace.onClearManualPrice} onFilterChange={workspace.onFilterChange} onSortModeChange={workspace.onSortModeChange} onReorderGroups={workspace.onReorderGroups} onRemove={workspace.onRemoveAsset} /></div><div className="workspace-mobile-only"><PortfolioPositionCards assets={workspace.assets} groups={workspace.groupedAssets} fxRates={workspace.fxRates} baseCurrency={workspace.activeBaseCurrency} filter={workspace.filter} sortMode={workspace.assetSortMode} isRefreshing={workspace.isRefreshing} isManualPricePending={workspace.isManualPricePending} manualPriceError={workspace.manualPriceError} onUpdateManualPrice={workspace.onUpdateManualPrice} onClearManualPrice={workspace.onClearManualPrice} onSortModeChange={workspace.onSortModeChange} onRemove={workspace.onRemoveAsset} /></div></>}</div>;
}

/** The income workspace shows one view per page: Dywidendy and Gotówka are separate pages. */
const withIncomeView = (element: ReactNode, view: "dividends" | "cash") =>
  isValidElement<{ view?: "dividends" | "cash" }>(element) ? cloneElement(element, { view }) : element;

export function WorkspaceCashPage() {
  const workspace = usePortfolioWorkspace();
  return <div className="workspace-page">{withIncomeView(workspace.incomeWorkspace, "cash")}</div>;
}

export function WorkspaceOperationsPage() {
  const workspace = usePortfolioWorkspace();
  return <div className="workspace-page workspace-operation-page">{workspace.operationsWorkspace}</div>;
}

export function WorkspaceDividendsPage() {
  const workspace = usePortfolioWorkspace();
  const { view } = usePageView("dividends");
  const aggregateDividends = useMemo(() => workspace.selectedPortfolios.flatMap((portfolio) =>
    getPortfolioDividends(ensurePortfolioCoreModel(portfolio), workspace.fxRates)
  ), [workspace.fxRates, workspace.selectedPortfolios]);
  const eventScopeProps = workspace.portfolioScope.mode === "CUSTOM"
    ? { portfolioId: "custom", portfolioIds: workspace.selectedPortfolioIds }
    : { portfolioId: workspace.isAllRealPortfoliosSelected ? "all" : workspace.activePortfolioId, portfolioIds: undefined };
  if (!workspace.isAllPortfoliosSelected) return <div className="workspace-page">{withIncomeView(workspace.incomeWorkspace, "dividends")}</div>;
  return (
    <div className="workspace-page workspace-aggregate-income-page">
      <section className="workspace-page-actions workspace-aggregate-income-controls">
        <div className="workspace-aggregate-income-scope">
          <p className="eyebrow">Analizowany zakres</p>
          <p className="section-copy">{workspace.portfolioScopeLabel} · {workspace.selectedPortfolios.length} {workspace.selectedPortfolios.length === 1 ? "portfel" : "portfeli"} · widok łączny, bez mieszania rachunków źródłowych</p>
        </div>
        <span className="income-currency-tag">Waluta prezentacji <strong>{workspace.presentationCurrency}</strong></span>
      </section>
      {view === "dochod" ? (
        <DividendIncomeDashboard
          dividends={aggregateDividends}
          portfolios={workspace.selectedPortfolios}
          fxRates={workspace.fxRates}
          verifiedFxCurrencies={workspace.verifiedFxCurrencies}
          currency={workspace.presentationCurrency}
          mode="aggregate"
        />
      ) : null}
      {view === "dodaj" ? workspace.aggregateDividendWorkspace : null}
      {view === "nadchodzace" ? <UpcomingDividendsPanel key={`${workspace.portfolioScopeLabel}:${workspace.selectedPortfolioIds.join(",")}`} {...eventScopeProps} presentationCurrency={workspace.presentationCurrency} fxRates={workspace.fxRates} verifiedFxCurrencies={workspace.verifiedFxCurrencies} /> : null}
      {view === "historia" ? <AggregateDividendHistory /> : null}
    </div>
  );
}

export function WorkspaceImportPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-import-page"><section className="workspace-page-actions"><p>{workspace.isAllPortfoliosSelected ? "Import wymaga wskazania jednego portfela docelowego." : "Import tworzy rzeczywiste operacje w aktywnym portfelu. Kurs bieżący nie blokuje zapisu transakcji."}</p><Link href={workspace.getReadHref(workspace.isAllPortfoliosSelected ? "/portfolios" : "/portfolio/positions")} className="ghost-button">{workspace.isAllPortfoliosSelected ? "Wybierz portfel" : "Wróć do pozycji"}</Link></section>{workspace.isAllPortfoliosSelected ? null : workspace.importWorkspace}</div>; }

export function WorkspacePerformancePage() { const workspace = usePortfolioWorkspace(); return <PortfolioPerformanceResults {...workspaceHistoryProps(workspace)} isAggregate={workspace.isAllPortfoliosSelected} breakdownPortfolios={workspace.selectedPortfolios} />; }
export function WorkspaceChartsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-analysis-page"><PortfolioLineCharts initialMode="value" historyUserId={workspace.account.id} {...workspaceHistoryProps(workspace)} onBenchmarksChange={workspace.isAllPortfoliosSelected ? undefined : workspace.onBenchmarksChange} /></div>; }
export function WorkspaceClosedInvestmentsPage() {
  const workspace = usePortfolioWorkspace();
  const { view } = usePageView("closed");
  return <div className="workspace-page">{view === "kalendarz" ? <ClosedCalendar portfolios={workspace.selectedPortfolios} /> : <ClosedInvestmentsWorkspace portfolios={workspace.selectedPortfolios} />}</div>;
}

export function WorkspaceReportsPage() {
  return <div className="workspace-page workspace-analysis-page"><ReportsWorkspace /></div>;
}

export function WorkspaceAssetChartsPage() {
  return <div className="workspace-page workspace-analysis-page"><InstrumentChartsWorkspace /></div>;
}

export function WorkspaceTaxesPage() {
  const workspace = usePortfolioWorkspace();
  return <div className="workspace-page"><TaxReportWorkspace portfolios={workspace.selectedPortfolios} scopeLabel={workspace.portfolioScopeLabel} /></div>;
}

export function WorkspaceStructurePage() {
  const workspace = usePortfolioWorkspace();
  const { view } = usePageView("structure");
  return (
    <div className="workspace-page workspace-analysis-page">
      {view === "sklad" ? <PortfolioCharts view="structure" {...workspaceChartProps(workspace)} /> : null}
      {view === "w-czasie" ? <StructureOverTime key={workspace.selectedPortfolioIds.join(",")} /> : null}
      {view === "waluty" ? <CurrencyExposure /> : null}
    </div>
  );
}

export function WorkspaceHealthPage() {
  return <div className="workspace-page workspace-analysis-page"><PortfolioHealthWorkspace /></div>;
}
export function WorkspaceInstrumentsPage() {
  const workspace = usePortfolioWorkspace();
  const isAllPortfoliosSelected = workspace.isAllPortfoliosSelected;
  const resetAssetEntryForm = workspace.resetAssetEntryForm;
  useEffect(() => {
    if (!isAllPortfoliosSelected) resetAssetEntryForm();
    return () => { if (!isAllPortfoliosSelected) resetAssetEntryForm(); };
  }, [isAllPortfoliosSelected, resetAssetEntryForm]);
  return <div className="workspace-page workspace-instruments-page">{workspace.isAllPortfoliosSelected ? <section className="panel"><p className="eyebrow">Instrumenty · {workspace.portfolioScopeLabel}</p><h2 className="section-title">Dodaj instrument do portfela</h2><p className="section-copy">Wyszukiwanie i dodawanie działają w wybranym zakresie; zapis wymaga jawnego wskazania rzeczywistego portfela.</p></section> : null}{workspace.assetEntryWorkspace}</div>;
}
export function WorkspaceWatchlistPage() { return <WatchlistWorkspace />; }
export function WorkspaceEventsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page"><GpwEventsWorkspace portfolioId={workspace.portfolioScope.mode === "CUSTOM" ? "custom" : workspace.isAllRealPortfoliosSelected ? "all" : workspace.activePortfolioId} portfolioIds={workspace.portfolioScope.mode === "CUSTOM" ? workspace.selectedPortfolioIds : undefined} /></div>; }
export function WorkspaceGeneralMeetingsPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page"><CorporateEventsPanel portfolioId={workspace.portfolioScope.mode === "CUSTOM" ? "custom" : workspace.isAllRealPortfoliosSelected ? "all" : workspace.activePortfolioId} portfolioIds={workspace.portfolioScope.mode === "CUSTOM" ? workspace.selectedPortfolioIds : undefined} variant="general-meetings" /></div>; }
export function WorkspaceSettingsPage() { return <div className="workspace-page workspace-settings-page">{usePortfolioWorkspace().settingsWorkspace}</div>; }
const getPositionsLabel = (count: number) =>
  count === 1 ? "pozycja" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? "pozycje" : "pozycji";

function SelectedPortfolioOverview() {
  const workspace = usePortfolioWorkspace();
  const totalValuePln = workspace.selectedPortfolioSummaries.reduce((sum, item) => sum + item.summary.totalValuePln, 0);
  const marketValuePln = workspace.selectedPortfolioSummaries.reduce((sum, item) => sum + item.summary.marketValuePln, 0);
  const cashValuePln = workspace.selectedPortfolioSummaries.reduce((sum, item) => sum + item.summary.cashValuePln, 0);
  const positionsCount = workspace.selectedPortfolioSummaries.reduce((sum, item) => sum + item.summary.positionsCount, 0);
  const formatInPresentationCurrency = (valuePln: number) =>
    formatCurrency(convertFromPln(valuePln, workspace.presentationCurrency, workspace.fxRates), workspace.presentationCurrency);
  return <section className="panel portfolio-scope-overview">
    <div className="portfolio-scope-overview-head"><div><p className="eyebrow">Analizowany zakres</p><h2 className="section-title">{workspace.portfolioScopeLabel}</h2><p className="section-copy">Wirtualny widok tylko do odczytu; rzeczywiste rachunki i ich transakcje pozostają rozdzielone.</p></div><span>{workspace.selectedPortfolios.length} {workspace.selectedPortfolios.length === 1 ? "portfel" : "portfeli"}</span></div>
    <div className="workspace-performance-metric-grid portfolio-scope-overview-metrics mt-5">
      <article><span>Łączna wartość</span><strong>{formatCurrency(workspace.summaryTotalValue, workspace.activeBaseCurrency)}</strong></article>
      <article><span>Zysk / strata</span><strong className={workspace.summaryCombinedProfitLoss >= 0 ? "tone-positive" : "tone-negative"}>{formatCurrency(workspace.summaryCombinedProfitLoss, workspace.activeBaseCurrency)}</strong></article>
      {positionsCount > 0 ? <article><span>Wartość pozycji · {positionsCount} {getPositionsLabel(positionsCount)}</span><strong>{formatInPresentationCurrency(marketValuePln)}</strong></article> : null}
      {Math.abs(cashValuePln) >= 0.005 ? <article><span>Gotówka</span><strong className={cashValuePln < 0 ? "tone-negative" : undefined}>{formatInPresentationCurrency(cashValuePln)}</strong></article> : null}
    </div>
    {workspace.selectedPortfolioSummaries.length ? <div className="portfolio-scope-breakdown mt-5" aria-label="Wartość według portfela">{workspace.selectedPortfolioSummaries.map(({ portfolio, summary }) => {
      const share = totalValuePln > 0 ? Math.max(0, Math.min(100, summary.totalValuePln / totalValuePln * 100)) : 0;
      return <button key={portfolio.id} type="button" onClick={() => workspace.onPortfolioChange(portfolio.id)}><span><strong>{portfolio.name}</strong><small>{formatCurrency(convertFromPln(summary.totalValuePln, workspace.presentationCurrency, workspace.fxRates), workspace.presentationCurrency)} · {share.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%</small></span><span className="portfolio-scope-breakdown-track" aria-hidden="true"><i style={{ width: `${share}%` }} /></span><span aria-hidden="true">›</span></button>;
    })}</div> : null}
  </section>;
}

function AggregateDividendHistory() {
  const workspace = usePortfolioWorkspace();
  const [query, setQuery] = useState("");
  const [portfolioId, setPortfolioId] = useState("ALL");
  const [currency, setCurrency] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sort, setSort] = useState<"date-desc" | "date-asc" | "amount-desc">("date-desc");
  const [limit, setLimit] = useState(50);
  const dividends = useMemo(() => workspace.selectedPortfolios.flatMap((portfolio) =>
    getPortfolioDividends(ensurePortfolioCoreModel(portfolio), workspace.fxRates)
      .map((dividend) => ({ portfolio, dividend }))
  ).sort((left, right) => right.dividend.paymentDate.localeCompare(left.dividend.paymentDate)), [workspace.fxRates, workspace.selectedPortfolios]);
  const currencies = useMemo(() => Array.from(new Set(dividends.map(({ dividend }) => dividend.currency))).sort(), [dividends]);
  const effectivePortfolioId = portfolioId === "ALL" || workspace.selectedPortfolios.some((portfolio) => portfolio.id === portfolioId) ? portfolioId : "ALL";
  const effectiveCurrency = currency === "ALL" || currencies.includes(currency) ? currency : "ALL";
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pl-PL");
    if (startDate && endDate && startDate > endDate) return [];
    return dividends
      .filter(({ portfolio }) => effectivePortfolioId === "ALL" || portfolio.id === effectivePortfolioId)
      .filter(({ dividend }) => effectiveCurrency === "ALL" || dividend.currency === effectiveCurrency)
      .filter(({ dividend }) => !startDate || dividend.paymentDate >= startDate)
      .filter(({ dividend }) => !endDate || dividend.paymentDate <= endDate)
      .filter(({ portfolio, dividend }) => !normalizedQuery || `${dividend.symbol} ${dividend.instrumentName} ${portfolio.name}`.toLocaleLowerCase("pl-PL").includes(normalizedQuery))
      .sort((left, right) => sort === "amount-desc"
        ? right.dividend.netAmountPln - left.dividend.netAmountPln
        : sort === "date-asc"
          ? left.dividend.paymentDate.localeCompare(right.dividend.paymentDate)
          : right.dividend.paymentDate.localeCompare(left.dividend.paymentDate));
  }, [dividends, effectiveCurrency, effectivePortfolioId, endDate, query, sort, startDate]);

  return <section className="panel workspace-aggregate-dividends">
    <div className="sprint-panel-head"><div><p className="eyebrow">Historia dywidend</p><h2 className="section-title">Wypłaty · {workspace.portfolioScopeLabel}</h2></div><span className="tag">{filtered.length} wyników</span></div>
    <div className="income-history-filters mt-5" aria-label="Filtry zagregowanej historii dywidend">
      <label className="field income-history-search"><span>Spółka, ticker lub portfel</span><input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(50); }} placeholder="np. PZU, XTB" /></label>
      <label className="field"><span>Portfel źródłowy</span><select value={effectivePortfolioId} onChange={(event) => { setPortfolioId(event.target.value); setLimit(50); }}><option value="ALL">Wszystkie portfele</option>{workspace.selectedPortfolios.map((portfolio) => <option value={portfolio.id} key={portfolio.id}>{portfolio.name}</option>)}</select></label>
      <label className="field"><span>Waluta źródłowa</span><select value={effectiveCurrency} onChange={(event) => { setCurrency(event.target.value); setLimit(50); }}><option value="ALL">Wszystkie waluty</option>{currencies.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
      <label className="field"><span>Wypłata od</span><input type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); setLimit(50); }} /></label>
      <label className="field"><span>Wypłata do</span><input type="date" value={endDate} onChange={(event) => { setEndDate(event.target.value); setLimit(50); }} /></label>
      <label className="field"><span>Sortowanie</span><select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setLimit(50); }}><option value="date-desc">Najnowsze wypłaty</option><option value="date-asc">Najstarsze wypłaty</option><option value="amount-desc">Najwyższa kwota netto</option></select></label>
    </div>
    {filtered.length ? <ul className="workspace-aggregate-dividend-list">{filtered.slice(0, limit).map(({ portfolio, dividend }) => <li key={`${portfolio.id}:${dividend.id}`}>
      <span className="income-aggregate-dividend-source"><strong>{dividend.symbol} · {dividend.instrumentName}</strong><small>{portfolio.name} · wypłata {formatDate(dividend.paymentDate)} · {dividend.currency} · {dividend.isAutomatic ? "Automatycznie" : "Ręcznie"}</small></span>
      <span className="income-aggregate-dividend-values">
        <IncomeCurrencyAmount amount={dividend.netAmount} sourceCurrency={dividend.currency} presentationCurrency={workspace.presentationCurrency} fxRates={workspace.fxRates} verifiedCurrencies={workspace.verifiedFxCurrencies} amountInPln={dividend.hasReliablePlnAnchor ? dividend.netAmountPln : undefined} suffix="netto" />
        <span className="income-aggregate-dividend-detail"><small>Brutto</small><IncomeCurrencyAmount amount={dividend.grossAmount} sourceCurrency={dividend.currency} presentationCurrency={workspace.presentationCurrency} fxRates={workspace.fxRates} verifiedCurrencies={workspace.verifiedFxCurrencies} amountInPln={dividend.hasReliablePlnAnchor ? dividend.grossAmountPln : undefined} /></span>
        <span className="income-aggregate-dividend-detail"><small>Podatek</small><IncomeCurrencyAmount amount={dividend.withholdingTax + dividend.domesticTax} sourceCurrency={dividend.currency} presentationCurrency={workspace.presentationCurrency} fxRates={workspace.fxRates} verifiedCurrencies={workspace.verifiedFxCurrencies} amountInPln={dividend.hasReliablePlnAnchor ? dividend.grossAmountPln - dividend.netAmountPln : undefined} /></span>
      </span>
    </li>)}</ul> : <p className="workspace-empty-state">{dividends.length ? "Brak zapisanych wypłat pasujących do filtrów." : "Brak zapisanych wypłat w wybranym zakresie."}</p>}
    {filtered.length > limit ? <div className="income-history-more"><span>Wyświetlono {Math.min(limit, filtered.length)} z {filtered.length}</span><button type="button" className="ghost-button" onClick={() => setLimit((current) => current + 50)}>Pokaż kolejne</button></div> : null}
  </section>;
}

export function WorkspacePortfoliosPage() { const workspace = usePortfolioWorkspace(); return <div className="workspace-page workspace-portfolios-page"><SelectedPortfolioOverview />{workspace.portfolioManagementWorkspace}</div>; }
export function WorkspaceWealthPage() {
  const workspace = usePortfolioWorkspace();
  const { view } = usePageView("wealth");
  return (
    <div className="workspace-page workspace-wealth-page">
      {/* The form keeps what was typed while another tab is open, so it is hidden, not removed. */}
      <div hidden={view === "w-czasie"}>{workspace.wealthWorkspace}</div>
      {view === "w-czasie" ? <WealthTimeline /> : null}
    </div>
  );
}

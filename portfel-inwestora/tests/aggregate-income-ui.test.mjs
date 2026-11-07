import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("aggregate income view separates dividends from cash and preserves scope context", async () => {
  const [route, cashWorkspace, dividendWorkspace, corporateRoute, upcomingPanel, portfolioApp, positionCards, styles, dividendDashboard] = await Promise.all([
    readFile(new URL("../src/components/WorkspaceRouteViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/CashWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DividendCashWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/corporate-events/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/UpcomingDividendsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/PortfolioApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/PortfolioPositionCards.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DividendIncomeDashboard.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(route, /useState<"dividends" \| "cash">\("dividends"\)/);
  assert.match(route, /if \(!workspace\.isAllPortfoliosSelected\) return[\s\S]*?workspace\.incomeWorkspace/);
  assert.match(route, /role="group" aria-label="Widok dywidend i gotówki"/);
  assert.match(route, /aria-pressed=\{aggregateIncomeView === "dividends"\}/);
  assert.match(route, /aria-pressed=\{aggregateIncomeView === "cash"\}/);
  const dividendBranchStart = route.indexOf('aggregateIncomeView === "dividends" ? (');
  const dividendBranchEnd = route.indexOf(") : null}", dividendBranchStart);
  assert.notEqual(dividendBranchStart, -1);
  assert.notEqual(dividendBranchEnd, -1);
  const dividendBranch = route.slice(dividendBranchStart, dividendBranchEnd);
  assert.match(dividendBranch, /workspace\.aggregateDividendWorkspace/);
  assert.match(dividendBranch, /<DividendIncomeDashboard/);
  assert.match(dividendBranch, /dividends=\{aggregateDividends\}/);
  assert.match(dividendBranch, /portfolios=\{workspace\.selectedPortfolios\}/);
  assert.match(dividendBranch, /currency=\{workspace\.presentationCurrency\}/);
  assert.match(dividendBranch, /mode="aggregate"/);
  assert.doesNotMatch(dividendBranch, /workspace-performance-metric-grid|Wybierz portfel do zmian/);
  assert.match(dividendBranch, /UpcomingDividendsPanel[\s\S]*?AggregateDividendHistory \/>/);
  assert.doesNotMatch(dividendBranch, /workspace\.incomeWorkspace/);
  const cashPanelStart = route.indexOf('<div className="workspace-aggregate-cash-view"', dividendBranchEnd);
  const nextRoutePage = route.indexOf("export function WorkspaceImportPage", cashPanelStart);
  const cashPanel = route.slice(cashPanelStart, nextRoutePage);
  assert.notEqual(cashPanelStart, -1);
  assert.match(cashPanel, /hidden=\{aggregateIncomeView !== "cash"\}[\s\S]*?\{workspace\.incomeWorkspace\}/);
  assert.doesNotMatch(cashPanel, /UpcomingDividendsPanel|AggregateDividendHistory/);
  assert.match(route, /workspace\.portfolioScopeLabel/);

  // Cash remains aggregate-read-only and keeps each balance/history row tied to its source portfolio.
  assert.match(cashWorkspace, /if \(!aggregate\) return selectedPortfolio \? buildCashHistory\(selectedPortfolio\)[\s\S]*?: \[\]/);
  assert.match(cashWorkspace, /return portfolios\.flatMap/);
  assert.match(cashWorkspace, /accountName: `\$\{item\.name\} · \$\{entry\.accountName\}`/);
  assert.match(cashWorkspace, /selectedSourceAccount\.portfolioId !== selectedPortfolio\.id/);
  assert.match(cashWorkspace, /aggregate \? <span className="tag">Widok łączny<\/span>/);
  assert.match(cashWorkspace, /useState\(isAllPortfoliosSelected \? "" : activePortfolioId\)/);
  assert.match(cashWorkspace, /<PortfolioTargetSelector[\s\S]*?id="cash-target-portfolio"/);
  assert.match(cashWorkspace, /!selectedPortfolio \|\| \(aggregate && !targetPortfolioId\)/);
  const cashSummaryStart = cashWorkspace.indexOf('<div className="panel cash-summary-panel"');
  const cashFormStart = cashWorkspace.indexOf('<article className="panel cash-form-panel', cashSummaryStart);
  assert.doesNotMatch(cashWorkspace.slice(cashSummaryStart, cashFormStart), /cash-target-portfolio/);
  assert.match(cashWorkspace, /Portfel źródłowy/);
  assert.match(cashWorkspace, /effectiveHistoryCurrency = historyCurrency === "ALL" \|\| historyCurrencies\.includes\(historyCurrency\)/);
  assert.match(cashWorkspace, /effectiveHistoryPortfolioId = historyPortfolioId === "ALL" \|\| portfolios\.some/);
  assert.match(portfolioApp, /const incomeScopeKey = `\$\{portfolioScope\.mode\}:[\s\S]*?:active:\$\{activePortfolioId\}`;/);
  assert.match(portfolioApp, /resolvePortfolioOperationTarget/);
  assert.match(portfolioApp, /persistOperationTargetChange/);
  assert.match(portfolioApp, /<DividendCashWorkspace[\s\S]*?isAggregateMode[\s\S]*?targetPortfolioId=\{operationTargetPortfolioId\}/);
  assert.match(positionCards, /!workspace\.isAllPortfoliosSelected \? \([\s\S]*?onRemove\(lot\.id\)/);
  assert.match(portfolioApp, /<PortfolioIncomeWorkspace key=\{incomeScopeKey\}/);
  assert.match(styles, /\.workspace-aggregate-income-tabs button \{ flex: 1 1 0; min-width: 0; \}/);
  assert.match(styles, /\.workspace-aggregate-cash-view\[hidden\] \{ display: none; \}/);
  assert.match(cashWorkspace, /Saldo według waluty/);
  assert.match(cashWorkspace, /Gotówka według portfela/);
  assert.match(cashWorkspace, /Portfel źródłowy/);
  assert.match(styles, /\.income-dividend-chart \{ width: 100%; height: 264px; min-height: 264px;/);
  assert.match(styles, /\.income-history-filters/);
  assert.match(dividendDashboard, /paymentDate <= today/);
  assert.match(dividendDashboard, /convertFromPln\(amountPln, currency, fxRates\)/);
  assert.match(dividendDashboard, /detail: `\$\{periodRows\.filter/);
  assert.match(dividendDashboard, /while \(cursor <= end\)/);
  assert.match(dividendDashboard, /if \(sourceRows\.length === 0\) return \{ data: \[\], portfolioIds, sourceBreakdown \}/);
  assert.match(dividendDashboard, /<Tooltip content=\{\(tooltipProps\) => <DividendChartTooltip/);
  assert.match(dividendDashboard, /formatCurrency\(value, currency\)/);
  assert.match(dividendDashboard, /getDividendChartCurrencyLines\(/);
  assert.match(dividendDashboard, /Kwota źródłowa/);
  assert.match(dividendDashboard, /Skala wykresu: \{currency\}/);
  assert.match(dividendDashboard, /getPortfolioColor\(portfolioId\)/);
  assert.doesNotMatch(styles, /\.income-dividend-kpi > strong \{[^}]*text-overflow: ellipsis/);
  assert.match(dividendWorkspace, /Wypłata od/);
  assert.match(dividendWorkspace, /Wypłata do/);
  assert.match(dividendWorkspace, /!entryOnly && !isAggregateMode && activeView === "dividends" \? <UpcomingDividendsPanel/);
  const singleRouteStart = route.indexOf("if (!workspace.isAllPortfoliosSelected) return");
  const aggregateRouteStart = route.indexOf("\n  return (", singleRouteStart);
  const singleRoute = route.slice(singleRouteStart, aggregateRouteStart);
  assert.doesNotMatch(singleRoute, /UpcomingDividendsPanel/);
  assert.match(route.slice(route.indexOf("function AggregateDividendHistory")), /Wypłata od[\s\S]*?Wypłata do/);
  assert.match(cashWorkspace, /effectiveHistorySort === "date-desc"/);
  assert.match(cashWorkspace, /effectiveHistorySort = historySort === "amount-desc" && effectiveHistoryCurrency === "ALL" \? "date-desc" : historySort/);
  assert.match(cashWorkspace, /disabled=\{effectiveHistoryCurrency === "ALL"\}[\s\S]*?Najwyższa kwota w wybranej walucie/);
  assert.match(cashWorkspace, /value="default">Domyślna kolejność/);
  assert.match(corporateRoute, /heldPortfolioNamesByKey/);
  assert.match(upcomingPanel, /event\.heldPortfolioNames\.join\(", "\)/);
  assert.match(upcomingPanel, /Obserwowane · bez pozycji w portfelu/);
});

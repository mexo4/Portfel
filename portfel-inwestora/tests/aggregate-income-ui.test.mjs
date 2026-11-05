import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("aggregate income view separates dividends from cash and preserves scope context", async () => {
  const [route, cashWorkspace, portfolioApp, styles] = await Promise.all([
    readFile(new URL("../src/components/WorkspaceRouteViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/CashWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/PortfolioApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/globals.css", import.meta.url), "utf8"),
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
  assert.match(cashWorkspace, /if \(!aggregate\) return buildCashHistory\(selectedPortfolio\)[\s\S]*?return portfolios\.flatMap/);
  assert.match(cashWorkspace, /accountName: `\$\{item\.name\} · \$\{entry\.accountName\}`/);
  assert.match(cashWorkspace, /selectedSourceAccount\.portfolioId !== selectedPortfolio\.id/);
  assert.match(cashWorkspace, /aggregate \? <span className="tag">Widok łączny<\/span>/);
  assert.doesNotMatch(cashWorkspace, /Wszystkie portfele/);
  assert.match(portfolioApp, /const incomeScopeKey = `\$\{portfolioScope\.mode\}:[\s\S]*?:active:\$\{activePortfolioId\}`;/);
  assert.match(portfolioApp, /<PortfolioIncomeWorkspace key=\{incomeScopeKey\}/);
  assert.match(styles, /\.workspace-aggregate-income-tabs button \{ flex: 1 1 0; min-width: 0; \}/);
  assert.match(styles, /\.workspace-aggregate-cash-view\[hidden\] \{ display: none; \}/);
});

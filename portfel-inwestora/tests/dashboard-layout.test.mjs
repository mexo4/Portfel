import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DASHBOARD_LAYOUT_VERSION,
  DEFAULT_DASHBOARD_LAYOUT,
  DEFAULT_MOBILE_DASHBOARD_LAYOUT,
  dashboardLayoutsEqual,
  dashboardScopeLayoutsEqual,
  getDashboardPresetLayouts,
  getDashboardScopeKey,
  normalizeDashboardLayout,
  normalizeDashboardScopeLayouts,
} from "../src/lib/dashboard-layout.ts";
import { buildDashboardReadModel, getDashboardUpcomingEvents } from "../src/lib/dashboard-read-model.ts";
import { createDashboardMutationCoordinator } from "../src/lib/dashboard-mutations.ts";
import { getAuthorizedDashboardScope } from "../src/lib/dashboard-scope-auth.ts";
import { buildPortfolioDailyMetricPoints } from "../src/lib/portfolio-daily-metrics.ts";
import { getWorkspaceReadHref, ALL_PORTFOLIOS_ID } from "../src/lib/portfolio-selection.ts";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("new users receive non-empty desktop and mobile defaults", () => {
  assert.deepEqual(normalizeDashboardLayout(null), DEFAULT_DASHBOARD_LAYOUT);
  assert.equal(DEFAULT_DASHBOARD_LAYOUT.version, DASHBOARD_LAYOUT_VERSION);
  assert.ok(DEFAULT_DASHBOARD_LAYOUT.widgets.length >= 4);
  assert.ok(DEFAULT_MOBILE_DASHBOARD_LAYOUT.widgets.length >= 4);
});

test("dashboard layout accepts intentional empty state and sanitizes unsafe values", () => {
  assert.deepEqual(normalizeDashboardLayout({ version: 1, widgets: [] }), { version: 1, widgets: [] });
  assert.deepEqual(normalizeDashboardLayout({ version: 99, widgets: [] }), DEFAULT_DASHBOARD_LAYOUT);
  assert.deepEqual(normalizeDashboardLayout({
    version: 1,
    widgets: [
      { id: "portfolio-value", size: "full" },
      { id: "portfolio-value", size: "small" },
      { id: "unknown-widget", size: "small" },
    ],
  }), { version: 1, widgets: [{ id: "portfolio-value", size: "small" }] });
});

test("daily-result is a supported cash-flow-neutral KPI with a constrained size", () => {
  const result = normalizeDashboardLayout({
    version: DASHBOARD_LAYOUT_VERSION,
    widgets: [{ id: "daily-result", size: "large" }, { id: "portfolio-value", size: "small" }],
  });
  assert.deepEqual(result.widgets, [
    { id: "daily-result", size: "small" },
    { id: "portfolio-value", size: "small" },
  ]);
});

test("layout preserves safe reorder and size choices without financial payloads", () => {
  const layout = normalizeDashboardLayout({
    version: 1,
    widgets: [{ id: "portfolio-chart", size: "large" }, { id: "profit-loss", size: "medium" }],
  });
  assert.equal(dashboardLayoutsEqual(layout, normalizeDashboardLayout(layout)), true);
  assert.equal(JSON.stringify(layout).includes("portfolioValue"), false);
  assert.equal(JSON.stringify(layout).includes("operations"), false);
});

test("desktop and mobile remain independent per real portfolio or all scope", () => {
  const layouts = normalizeDashboardScopeLayouts({
    desktop: { version: 1, widgets: [{ id: "portfolio-chart", size: "full" }] },
    mobile: { version: 1, widgets: [{ id: "daily-result", size: "small" }] },
  });
  assert.notDeepEqual(layouts.desktop, layouts.mobile);
  assert.equal(dashboardScopeLayoutsEqual(layouts, normalizeDashboardScopeLayouts(layouts)), true);
  assert.equal(getDashboardScopeKey("portfolio-1", false), "portfolio:portfolio-1");
  assert.equal(getDashboardScopeKey("portfolio-1", true), "all");
  assert.deepEqual(normalizeDashboardScopeLayouts(null).mobile, DEFAULT_MOBILE_DASHBOARD_LAYOUT);
});

test("presets return independent non-empty desktop and mobile clones", () => {
  const minimal = getDashboardPresetLayouts("minimal");
  const again = getDashboardPresetLayouts("minimal");
  assert.ok(minimal.desktop.widgets.length > 0);
  assert.ok(minimal.mobile.widgets.length > 0);
  minimal.desktop.widgets.pop();
  assert.notEqual(minimal.desktop.widgets.length, again.desktop.widgets.length);
});

test("shared read model calculates daily percentage once and supplies every widget view", () => {
  const group = {
    key: "dnp", name: "Dino Polska", symbol: "DNP.PL", kind: "stock",
    provider: "stooq", marketCurrency: "PLN", totalValue: 1_110,
    profitLossBase: 60, quantity: 10, latestUnitPrice: 111,
    hasDailyChange: true, dailyChangePercent: 2.5,
    lots: [{ symbol: "DNP.PL", provider: "stooq", marketCurrency: "PLN", issuerCountry: "Polska", createdAt: "2026-08-20T10:00:00Z" }],
  };
  const dividend = {
    id: "dividend-1", instrumentId: "instrument-1", ticker: "DNP.PL", companyName: "Dino Polska",
    eventType: "UPCOMING_DIVIDEND", eventDate: "2026-09-10", paymentDate: "2026-09-12",
    status: "CONFIRMED", active: true, discoveredAt: "2026-01-01", updatedAt: "2026-01-01",
    trackingSource: "HELD_AND_WATCHLIST",
  };
  const operation = { id: "op-1", operationType: "DIVIDEND", date: "2026-08-20", amount: 12, currency: "PLN", metadata: {} };
  const model = buildDashboardReadModel({
    history: {
      points: [
        { date: "2026-08-19", portfolioValuePln: 1_000, netInvestedPln: 1_000, profitLossPln: 0, timeWeightedReturnPercent: 0 },
        { date: "2026-08-20", portfolioValuePln: 1_110, netInvestedPln: 1_050, profitLossPln: 60, timeWeightedReturnPercent: 5.71 },
      ],
      assetSeries: [], warnings: [], benchmarkSeries: [],
    },
    events: { events: [dividend, { ...dividend }] },
    watchlist: [{ id: "watch-1", canonicalKey: "gpw:ticker:DNP", symbol: "DNP.PL", name: "Dino Polska", marketCurrency: "PLN", createdAt: "2026-01-01", updatedAt: "2026-01-01" }],
    groups: [group],
    portfolios: [{ name: "Główny", operations: [operation] }],
    fallbackProfitLoss: 60,
    fallbackInvested: 1_050,
  });

  assert.equal(model.history.latest.cashFlowNeutralResultPln, 60);
  assert.equal(model.history.latest.cashFlowNeutralResultPercent, 6);
  assert.equal(model.history.returnPercent, 5.71);
  assert.equal(model.allocations.classes[0].label, "Akcje GPW");
  assert.equal(model.positions.gains[0].symbol, "DNP.PL");
  assert.equal(model.operations.dividends[0].operation.id, "op-1");
  assert.equal(model.events.dividends.length, 1);
  assert.equal(model.watchlist.rows[0].group.symbol, "DNP.PL");
  assert.equal(model.dailySnapshot.best.symbol, "DNP.PL");
  assert.equal(model.dailySnapshot.benchmarkPercent, null);
});

test("daily metric helper does not classify a contribution as investment result", () => {
  const points = buildPortfolioDailyMetricPoints([
    { date: "2026-08-19", portfolioValuePln: 1_000, netInvestedPln: 1_000, profitLossPln: 0, timeWeightedReturnPercent: 0 },
    { date: "2026-08-20", portfolioValuePln: 1_500, netInvestedPln: 1_500, profitLossPln: 0, timeWeightedReturnPercent: 0 },
  ]);
  assert.equal(points[0].rawValueChangePln, 500);
  assert.equal(points[0].cashFlowNeutralResultPln, 0);
  assert.equal(points[0].cashFlowNeutralResultPercent, 0);
});

test("dashboard scope ownership is enforced behaviorally", () => {
  const owned = new Set(["portfolio-1"]);
  assert.equal(getAuthorizedDashboardScope(new Request("http://localhost/api/dashboard-layout?scope=all"), owned), "all");
  assert.equal(getAuthorizedDashboardScope(new Request("http://localhost/api/dashboard-layout?scope=portfolio:portfolio-1"), owned), "portfolio:portfolio-1");
  assert.equal(getAuthorizedDashboardScope(new Request("http://localhost/api/dashboard-layout?scope=portfolio:foreign"), owned), null);
  assert.equal(getAuthorizedDashboardScope(new Request("http://localhost/api/dashboard-layout?scope=invalid"), owned), null);
});

test("scope mutation coordinator allows a new scope while stale save is pending", async () => {
  const coordinator = createDashboardMutationCoordinator();
  coordinator.enterScope("portfolio:one");
  const staleToken = coordinator.capture();
  let resolveStale;
  const staleSave = new Promise((resolve) => { resolveStale = resolve; });
  coordinator.trackSave("portfolio:one", staleSave);

  coordinator.enterScope("all");
  assert.equal(coordinator.isCurrent(staleToken), false);
  assert.equal(coordinator.getSave("all"), undefined);
  const currentToken = coordinator.capture();
  const currentSave = coordinator.trackSave("all", Promise.resolve(true));
  assert.equal(await currentSave, true);
  assert.equal(coordinator.isCurrent(currentToken), true);

  resolveStale(true);
  assert.equal(await staleSave, true);
  assert.equal(coordinator.currentScopeKey, "all");
});

test("dashboard dividend links use the real route and preserve all scope", async () => {
  const dashboard = await readSource("src/components/ConfigurableDashboard.tsx");
  assert.doesNotMatch(dashboard, /\/income\/dividends/);
  assert.equal(
    getWorkspaceReadHref("/portfolio/dividends", ALL_PORTFOLIOS_ID, "USD"),
    "/portfolio/dividends?portfolio=all&currency=USD"
  );
});

test("dashboard exposes scope persistence, presets, spatial DnD and keyboard fallback", async () => {
  const [component, apiRoute, serverStore] = await Promise.all([
    readSource("src/components/ConfigurableDashboard.tsx"),
    readSource("src/app/api/dashboard-layout/route.ts"),
    readSource("src/lib/server/dashboard-layout.ts"),
  ]);
  assert.match(component, /Edytuj pulpit/);
  assert.match(component, /Dodaj widget/);
  assert.match(component, /Przywróć domyślny/);
  assert.match(component, /rectSortingStrategy/);
  assert.match(component, /Przenieś .* wyżej/);
  assert.match(component, /Przenieś .* niżej/);
  assert.match(component, /fetchCorporateEvents/);
  assert.match(component, /Skopiuj desktop \+ mobile/);
  assert.match(apiRoute, /getCurrentAccountData/);
  assert.match(apiRoute, /getAuthorizedDashboardScope/);
  assert.match(serverStore, /INSERT INTO user_dashboard_layout_scopes/);
  assert.match(serverStore, /IS DISTINCT FROM/);
});

test("dashboard persistence is user-scoped and leaves portfolio storage untouched", async () => {
  const [database, serverStore] = await Promise.all([
    readSource("src/lib/server/db.ts"), readSource("src/lib/server/dashboard-layout.ts"),
  ]);
  assert.match(database, /CREATE TABLE IF NOT EXISTS user_dashboard_layout_scopes/);
  assert.match(database, /PRIMARY KEY \(user_id, scope_key\)/);
  assert.match(database, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(serverStore, /portfolio_json/);
  assert.doesNotMatch(serverStore, /core_operations/);
});

test("upcoming timeline deduplicates one held and watched company event", () => {
  const event = {
    id: "event-1", instrumentId: "instrument-1", ticker: "DNP.PL", companyName: "Dino Polska",
    eventType: "HALF_YEAR_REPORT", eventDate: "2026-08-20", fiscalPeriod: "H1", fiscalYear: 2026,
    status: "CONFIRMED", active: true, discoveredAt: "2026-01-01", updatedAt: "2026-01-01",
    trackingSource: "HELD_AND_WATCHLIST",
  };
  const result = getDashboardUpcomingEvents([event, { ...event }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].trackingSource, "HELD_AND_WATCHLIST");
});

test("dashboard shared data source has one request owner per resource and suppresses stale generations", async () => {
  const [dashboard, portfolioApp, watchlistWorkspace] = await Promise.all([
    readSource("src/components/ConfigurableDashboard.tsx"),
    readSource("src/components/PortfolioApp.tsx"),
    readSource("src/components/WatchlistWorkspace.tsx"),
  ]);
  assert.equal((dashboard.match(/fetchCorporateEvents\(/g) ?? []).length, 1);
  assert.equal((dashboard.match(/fetchPortfolioHistory\(/g) ?? []).length, 1);
  assert.equal((`${dashboard}\n${portfolioApp}\n${watchlistWorkspace}`.match(/fetchWatchlist\(/g) ?? []).length, 1);
  assert.match(dashboard, /watchlist: workspace\.watchlistItems/);
  assert.match(dashboard, /generation === requestGenerationRef\.current/);
  assert.match(dashboard, /response\.scopeKey !== scopeKey/);
  assert.doesNotMatch(dashboard.slice(dashboard.indexOf("const getHistorySignature"), dashboard.indexOf("type DashboardData")), /refreshRevision/);
});

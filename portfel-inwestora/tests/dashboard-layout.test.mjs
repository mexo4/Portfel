import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DASHBOARD_LAYOUT_VERSION,
  DEFAULT_DASHBOARD_LAYOUT,
  dashboardLayoutsEqual,
  normalizeDashboardLayout,
} from "../src/lib/dashboard-layout.ts";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("new users receive a non-empty, versioned dashboard layout", () => {
  const layout = normalizeDashboardLayout(null);

  assert.equal(layout.version, DASHBOARD_LAYOUT_VERSION);
  assert.deepEqual(layout, DEFAULT_DASHBOARD_LAYOUT);
  assert.ok(layout.widgets.length >= 4);
  assert.equal(new Set(layout.widgets.map((widget) => widget.id)).size, layout.widgets.length);
});

test("dashboard layout accepts an intentional empty dashboard but rejects stale unsafe payloads", () => {
  assert.deepEqual(normalizeDashboardLayout({ version: 1, widgets: [] }), {
    version: 1,
    widgets: [],
  });

  assert.deepEqual(normalizeDashboardLayout({ version: 99, widgets: [] }), DEFAULT_DASHBOARD_LAYOUT);
  assert.deepEqual(
    normalizeDashboardLayout({
      version: 1,
      widgets: [
        { id: "portfolio-value", size: "full" },
        { id: "portfolio-value", size: "small" },
        { id: "unknown-widget", size: "small" },
      ],
    }),
    {
      version: 1,
      widgets: [{ id: "portfolio-value", size: "small" }],
    }
  );
});

test("dashboard layout preserves safe reorder and size choices without financial data", () => {
  const layout = normalizeDashboardLayout({
    version: 1,
    widgets: [
      { id: "portfolio-chart", size: "large" },
      { id: "profit-loss", size: "medium" },
    ],
  });

  assert.deepEqual(layout.widgets, [
    { id: "portfolio-chart", size: "large" },
    { id: "profit-loss", size: "medium" },
  ]);
  assert.equal(dashboardLayoutsEqual(layout, normalizeDashboardLayout(layout)), true);
  assert.equal(JSON.stringify(layout).includes("portfolioValue"), false);
  assert.equal(JSON.stringify(layout).includes("operations"), false);
});

test("return widget reuses the canonical chart view rather than calculating a dashboard-only ROI", async () => {
  const [dashboard, workspace] = await Promise.all([
    readSource("src/components/ConfigurableDashboard.tsx"),
    readSource("src/components/PortfolioWorkspaceContext.tsx"),
  ]);

  assert.match(dashboard, /case "return-rate":[\s\S]*initialMode="return"/);
  assert.doesNotMatch(dashboard, /summaryReturnPercent/);
  assert.doesNotMatch(workspace, /summaryReturnPercent/);
});

test("recent operations respect one selected portfolio and use all only for the aggregate scope", async () => {
  const dashboard = await readSource("src/components/ConfigurableDashboard.tsx");

  assert.match(dashboard, /const scopedPortfolios = workspace\.isAllPortfoliosSelected[\s\S]*\? workspace\.portfolios[\s\S]*\? \[workspace\.activePortfolio\]/);
  assert.match(dashboard, /const operations = scopedPortfolios/);
});

test("dashboard exposes server persistence, edit controls and non-pointer reordering fallback", async () => {
  const [component, apiRoute, serverStore] = await Promise.all([
    readSource("src/components/ConfigurableDashboard.tsx"),
    readSource("src/app/api/dashboard-layout/route.ts"),
    readSource("src/lib/server/dashboard-layout.ts"),
  ]);

  assert.match(component, /Edytuj pulpit/);
  assert.match(component, /Dodaj widget/);
  assert.match(component, /Przywróć domyślny układ/);
  assert.match(component, /useSortable/);
  assert.match(component, /Przenieś .* wyżej/);
  assert.match(component, /Przenieś .* niżej/);
  assert.match(component, /PortfolioLineCharts/);
  assert.match(component, /dailyInvestmentResultOnly/);
  assert.match(component, /CorporateEventsPanel/);
  assert.match(component, /UpcomingDividendsPanel/);
  assert.match(apiRoute, /getCurrentAuthenticatedUser/);
  assert.match(serverStore, /INSERT INTO user_dashboard_layouts/);
  assert.match(serverStore, /normalizeDashboardLayout/);
});

test("dashboard persistence is user-scoped and leaves portfolio storage untouched", async () => {
  const [database, serverStore] = await Promise.all([
    readSource("src/lib/server/db.ts"),
    readSource("src/lib/server/dashboard-layout.ts"),
  ]);

  assert.match(database, /CREATE TABLE IF NOT EXISTS user_dashboard_layouts/);
  assert.match(database, /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(serverStore, /portfolio_json/);
  assert.doesNotMatch(serverStore, /core_operations/);
});

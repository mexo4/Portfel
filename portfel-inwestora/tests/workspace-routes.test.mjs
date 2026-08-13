import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getWorkspaceRoute } from "../src/lib/workspace-routes.ts";

test("maps every public workspace URL to one independently mountable view", () => {
  const cases = [
    ["/dashboard", "dashboard"],
    ["/portfolio/positions?add=asset", "positions"],
    ["/portfolio/operations", "operations"],
    ["/portfolio/dividends", "dividends"],
    ["/portfolio/import", "import"],
    ["/analytics/performance", "performance"],
    ["/analytics/charts", "charts"],
    ["/analytics/structure", "structure"],
    ["/analytics/benchmarks", "benchmarks"],
    ["/market/instruments", "instruments"],
    ["/market/events", "events"],
    ["/settings", "settings"],
  ];

  for (const [path, expected] of cases) {
    assert.equal(getWorkspaceRoute(path), expected);
  }
  assert.equal(getWorkspaceRoute("/unknown"), "dashboard");
});

test("each workspace URL has a route-owned view rather than a null page placeholder", async () => {
  const pages = [
    ["src/app/(workspace)/dashboard/page.tsx", "WorkspaceDashboardPage"],
    ["src/app/(workspace)/portfolio/positions/page.tsx", "WorkspacePositionsPage"],
    ["src/app/(workspace)/portfolio/operations/page.tsx", "WorkspaceOperationsPage"],
    ["src/app/(workspace)/analytics/performance/page.tsx", "WorkspacePerformancePage"],
    ["src/app/(workspace)/analytics/charts/page.tsx", "WorkspaceChartsPage"],
    ["src/app/(workspace)/analytics/structure/page.tsx", "WorkspaceStructurePage"],
    ["src/app/(workspace)/analytics/benchmarks/page.tsx", "WorkspaceBenchmarksPage"],
    ["src/app/(workspace)/market/instruments/page.tsx", "WorkspaceInstrumentsPage"],
    ["src/app/(workspace)/market/events/page.tsx", "WorkspaceEventsPage"],
    ["src/app/(workspace)/settings/page.tsx", "WorkspaceSettingsPage"],
  ];

  for (const [path, component] of pages) {
    const source = await readFile(path, "utf8");
    assert.match(source, new RegExp(`return <${component} />`));
    assert.doesNotMatch(source, /return null/);
  }
});

test("dashboard route delegates aggregate data views to the configurable dashboard", async () => {
  const [routes, dashboard] = await Promise.all([
    readFile("src/components/WorkspaceRouteViews.tsx", "utf8"),
    readFile("src/components/ConfigurableDashboard.tsx", "utf8"),
  ]);
  const source = dashboard;
  assert.match(routes, /import ConfigurableDashboard/);
  assert.match(routes, /export function WorkspaceDashboardPage\(\) \{\s*return <ConfigurableDashboard \/>;\s*\}/);
  assert.match(dashboard, /workspace\.isAllPortfoliosSelected[\s\S]*workspace\.portfolios\.map/);
  assert.match(dashboard, /portfolioScopes: getWorkspaceHistoryScopes\(workspace\)/);
  assert.match(dashboard, /CorporateEventsPanel portfolioId=\{portfolioId\}/);
  assert.doesNotMatch(source, /Historia łączna wymaga osobnego modelu/);
});

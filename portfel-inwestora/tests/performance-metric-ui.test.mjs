import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const results = read("src/components/PortfolioPerformanceResults.tsx");
const overview = read("src/components/WorkspaceRouteViews.tsx");
const css = read("src/app/globals.css");

// Reported on production: an empty cell in the summary grid (and in the overview of
// several portfolios), a card that only said "Niedostępne", and an "i" button that
// showed nothing because its popover opened upwards inside a grid that clips its
// content. These pin the fixes; the layout itself is checked in a browser.

const rule = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} exists`);
  return css.slice(start, css.indexOf("}", start) + 1);
};

test("the info popover is drawn in a portal with fixed positioning, not inside the clipping grid", () => {
  assert.match(results, /function MetricInfo\(/);
  assert.match(results, /createPortal\(<div id=\{popoverId\} role="note" className="risk-metric-popover"/);
  assert.doesNotMatch(results, /<details className="risk-metric-help"/);
  assert.match(rule(".risk-metric-popover"), /position: fixed;/);
  assert.doesNotMatch(css, /\.risk-metric-help/);
});

test("the info popover opens below, or above when there is no room, and closes on outside click, Escape, scroll and resize", () => {
  assert.match(results, /const hasRoomBelow = window\.innerHeight - rect\.bottom >= 170;/);
  assert.match(results, /bottom: window\.innerHeight - rect\.top \+ 8/);
  for (const closer of ['addEventListener("pointerdown"', 'addEventListener("keydown"', 'addEventListener("scroll", close, true)', 'addEventListener("resize", close)']) {
    assert.ok(results.includes(closer), closer);
  }
  assert.match(results, /aria-expanded=\{open\}/);
});

test("the portal waits for the mount, as a portal cannot be hydrated", () => {
  assert.match(results, /const getServerMountedSnapshot = \(\) => false;/);
  assert.match(results, /open && isMounted && position \? createPortal/);
});

test("the metric grid lets the last row stretch, so there is no empty cell", () => {
  const grid = rule(".risk-metric-grid");

  assert.match(grid, /display: flex;/);
  assert.match(grid, /flex-wrap: wrap;/);
  assert.doesNotMatch(grid, /grid-template-columns/);
  assert.doesNotMatch(css, /\.risk-metric-grid-summary,\n\.risk-metric-grid-featured \{\n  grid-template-columns/);
  assert.match(css, /\.risk-metric-grid-summary > \.risk-metric-card,\n\.risk-metric-grid-featured > \.risk-metric-card \{\n  flex-basis: calc\(\(100% - 2px\) \/ 3\);/);
});

test("a metric that cannot be calculated is not drawn", () => {
  assert.doesNotMatch(results, /visibleMetrics\.includes\("/);
  assert.match(results, /const shown = \(id: PerformanceMetricId\) => isPerformanceMetricShown\(id, visibleMetrics, metricAvailability\);/);
  assert.match(results, /const isVisible = \(\.\.\.ids: PerformanceMetricId\[\]\) => ids\.some\(shown\);/);
  assert.doesNotMatch(results, /UNAVAILABLE_LABELS: Record<RiskMetricUnavailableCode/);
  assert.doesNotMatch(results, /unavailableLabel/);
});

test("the summary has a capital rate card next to the nominal result", () => {
  assert.match(results, /Stopa kapitałowa · \$\{PERIOD_LABELS\[effectivePeriod\]\}/);
  assert.match(results, /calculateWindowCapitalReturnPercent\(selectRiskPeriodPoints\(analysisPoints, effectivePeriod\), effectivePeriod === "MAX"\)/);
});

test("the overview of several portfolios shows value, result, positions and cash without a history fetch", () => {
  const body = overview.slice(overview.indexOf("function SelectedPortfolioOverview()"));

  assert.match(body, /Wartość pozycji · \{positionsCount\} \{getPositionsLabel\(positionsCount\)\}/);
  assert.match(body, /<span>Gotówka<\/span>/);
  assert.match(body, /Math\.abs\(cashValuePln\) >= 0\.005/);
  assert.doesNotMatch(body, /fetchPortfolioHistory/);
  assert.match(css, /\.portfolio-scope-overview-metrics \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(190px, 1fr\)\);/);
  assert.match(css, /\.portfolio-scope-overview-metrics > article:last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/);
});

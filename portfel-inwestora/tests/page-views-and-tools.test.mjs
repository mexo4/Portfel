import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { getPageViews, PAGE_VIEWS, resolvePageView, withPageView } = await import("../src/lib/page-views.ts");
const { assessPortfolioHealth } = await import("../src/lib/portfolio-health.ts");
const { buildCalendarMonth, listClosingMonths, shiftMonth } = await import("../src/lib/closed-calendar.ts");
const { calculatePeriodReturns } = await import("../src/lib/period-returns.ts");
const { buildWaterfall } = await import("../src/lib/profit-breakdown.ts");

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const params = (query) => new URLSearchParams(query);

test("each view of a page has an address of its own and unknown ones fall back to the first", () => {
  assert.equal(resolvePageView("performance", params("")), "podsumowanie");
  assert.equal(resolvePageView("performance", params("widok=ryzyko")), "ryzyko");
  assert.equal(resolvePageView("performance", params("widok=cos")), "podsumowanie");
  assert.equal(withPageView("/analytics/performance?portfolio=all", "performance", "zrodla"), "/analytics/performance?portfolio=all&widok=zrodla");
  assert.equal(withPageView("/analytics/performance?portfolio=all&widok=zrodla", "performance", "podsumowanie"), "/analytics/performance?portfolio=all");
  // A dividend link prefilled with a holding opens the form; leaving it keeps the other tabs reachable.
  assert.equal(resolvePageView("dividends", params("walor=lot-1")), "dodaj");
  assert.equal(withPageView("/portfolio/dividends?walor=lot-1", "dividends", "dochod"), "/portfolio/dividends?walor=lot-1&widok=dochod");
  assert.equal(withPageView("/portfolio/dividends?walor=lot-1&widok=dochod", "dividends", "dodaj"), "/portfolio/dividends?walor=lot-1");
  assert.deepEqual(getPageViews("positions"), []);
  for (const views of Object.values(PAGE_VIEWS)) assert.equal(new Set(views.map((view) => view.id)).size, views.length);
});

test("every page with views reads the open one, and the shell shows the tab row", async () => {
  const sources = (await Promise.all([
    "src/components/WorkspaceRouteViews.tsx", "src/components/PortfolioPerformanceResults.tsx", "src/components/ReportsWorkspace.tsx",
    "src/components/InstrumentChartsWorkspace.tsx", "src/components/DividendCashWorkspace.tsx", "src/components/WealthWorkspace.tsx",
  ].map(readSource))).join("\n");
  for (const route of Object.keys(PAGE_VIEWS)) assert.match(sources, new RegExp(`usePageView\\("${route}"\\)`), route);
  assert.match(await readSource("src/components/AppWorkspaceShell.tsx"), /<PageViewTabs route=\{route\}/);
  assert.match(await readSource("src/app/(workspace)/analytics/health/page.tsx"), /WorkspaceHealthPage/);
});

const holding = (name, value, extra = {}) => ({ key: name, name, isEtf: false, value, isValued: true, dailyChange: null, profitLossPercent: 5, priceDate: "2026-11-26", ...extra });
const assess = (holdings, extra = {}) => assessPortfolioHealth({ holdings, cash: [], currencies: [], baseCurrency: "PLN", today: "2026-11-27", ...extra });

test("a balanced portfolio passes every rule", () => {
  const health = assess(["A", "B", "C", "D", "E", "F"].map((name) => holding(name, 100)));
  assert.equal(health.score, 100);
  assert.deepEqual(health.findings, []);
  assert.equal(health.passed.length, 10);
});

test("each rule that fires names itself and takes its points off the score", () => {
  const health = assess(
    [holding("Duża", 500), holding("ETF", 400, { isEtf: true }), holding("C", 50, { profitLossPercent: -30 }), holding("D", 50, { priceDate: "2026-11-01" })],
    { cash: [{ account: "Konto PLN (Główny)", value: -20 }], currencies: [{ id: "USD", label: "USD", percent: 62 }] }
  );
  assert.deepEqual(health.findings.map((finding) => [finding.id, finding.severity]), [
    ["negative-cash", "important"], ["stale-prices", "attention"], ["top-three", "attention"], ["single-holding", "attention"],
    ["single-etf", "note"], ["currency", "note"], ["losses", "note"],
  ]);
  assert.equal(health.score, 100 - 20 - 3 * 10 - 3 * 3);
  assert.ok(health.findings.every((finding) => finding.rule.length > 10));
});

test("the same instrument in two portfolios counts once, and nothing held gives no score", () => {
  const health = assess([holding("A", 130, { key: "stock:A" }), holding("A", 130, { key: "stock:A" }), ...["B", "C", "D", "E", "F", "G"].map((name) => holding(name, 100))]);
  // 260 of 860 is 30%: one finding, not two holdings of 15% each.
  assert.deepEqual(health.findings.map((finding) => finding.id), ["single-holding"]);
  assert.equal(assess([]).score, null);
});

test("today's movement is reported when two holdings make most of it", () => {
  const health = assess([10, 8, 0.5, 0.5, 0.5, 0.5].map((change, index) => holding(`H${index}`, 100, { dailyChange: change })));
  assert.deepEqual(health.findings.map((finding) => finding.id), ["daily-movers"]);
});

const trade = (saleDate, profitLossPln) => ({ id: `${saleDate}:${profitLossPln}`, saleDate, profitLossPln });

test("the closing calendar adds up each day and starts weeks on Monday", () => {
  const trades = [trade("2026-11-03", 10), trade("2026-11-03", -4), trade("2026-11-30", -20), trade("2026-10-02", 1)];
  assert.deepEqual(listClosingMonths(trades), ["2026-10", "2026-11"]);
  const month = buildCalendarMonth(trades, "2026-11");
  // 1 November 2026 is a Sunday, so the first week has six empty cells before it.
  assert.equal(month.weeks[0].filter((cell) => cell === null).length, 6);
  assert.ok(month.weeks.every((week) => week.length === 7));
  const third = month.weeks.flat().find((cell) => cell?.date === "2026-11-03");
  assert.deepEqual([third.profitLossPln, third.trades.length], [6, 2]);
  assert.deepEqual([month.profitLossPln, month.closes, month.daysWithCloses, month.largestDayPln], [-14, 3, 2, 20]);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("period returns compare the last quote with the one at the start of each period", () => {
  const points = [
    { date: "2023-11-20", close: 50 }, { date: "2025-11-26", close: 80 }, { date: "2026-05-26", close: 90 },
    { date: "2026-10-27", close: 100 }, { date: "2026-11-19", close: 96 }, { date: "2026-11-26", close: 120 },
  ];
  assert.deepEqual(calculatePeriodReturns(points, "2026-11-27"), { "7d": 25, "30d": 20, "6m": 33.33, "1y": 50, "3y": 140 });
});

test("a period the history does not reach, or an old last quote, gives no number", () => {
  assert.deepEqual(calculatePeriodReturns([{ date: "2026-11-01", close: 10 }, { date: "2026-11-26", close: 11 }], "2026-11-27"), { "7d": null, "30d": null, "6m": null, "1y": null, "3y": null });
  assert.deepEqual(Object.values(calculatePeriodReturns([{ date: "2020-01-01", close: 10 }, { date: "2026-09-01", close: 11 }], "2026-11-27")), [null, null, null, null, null]);
});

test("the waterfall steps run from zero to the whole result", () => {
  const source = (key, amountPln) => ({ key, label: key, description: "", amountPln });
  const waterfall = buildWaterfall({ sources: [source("open-price", 100), source("open-fx", -150), source("open-fees", 0), source("dividends", 80)], nominalPln: -50, explainedPln: 30, flowsProfitLossPln: null });
  assert.deepEqual(waterfall.steps.map((step) => [step.key, step.fromPln, step.toPln]), [["open-price", 0, 100], ["open-fx", 100, -50], ["dividends", -50, 30]]);
  assert.equal(waterfall.total.toPln, 30);
  assert.deepEqual(waterfall.scale, { low: -50, high: 100 });
});

test("a double click on the preview chart opens the analysis page, and candles are green and red", async () => {
  const positions = await readSource("src/components/PositionsWorkspace.tsx");
  assert.match(positions, /className="positions-chart-open"[^>]*onDoubleClick=\{\(\) => \{ if \(analysisHref\) router\.push\(analysisHref\); \}\}/);
  assert.match(await readSource("src/components/InstrumentCandleChart.tsx"), /close >= open \? CANDLE_UP : CANDLE_DOWN/);
  assert.match(await readSource("src/components/instrument-chart-parts.tsx"), /CANDLE_UP = "#26a269";\r?\nexport const CANDLE_DOWN = "#e0453a";/);
});

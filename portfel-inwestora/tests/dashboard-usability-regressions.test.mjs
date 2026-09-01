import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { countAssetsWithoutUsableQuote } from "../src/lib/api.ts";
import { buildDashboardReadModel, getDashboardHistoryMetrics } from "../src/lib/dashboard-read-model.ts";
import { getGpwNonTradingDays, isCurrentWarsawDayGpwSession, isGpwTradingDay } from "../src/lib/gpw-market-calendar.ts";
import { SUPPORTED_CURRENCIES } from "../src/lib/constants.ts";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("dashboard capital return uses the canonical history snapshot instead of open-position fallbacks", () => {
  const metrics = getDashboardHistoryMetrics({
    points: [{
      date: "2026-08-21",
      portfolioValuePln: 5_479.47,
      netInvestedPln: 3_934.18,
      profitLossPln: 1_545.29,
      timeWeightedReturnPercent: -487.63,
    }],
    assetSeries: [],
    warnings: [],
    benchmarkSeries: [],
  }, -2_910.57, 3_934.18);

  assert.equal(metrics.returnPercent, 39.28);
  assert.deepEqual(metrics.latestPoint, {
    date: "2026-08-21",
    portfolioValuePln: 5_479.47,
    netInvestedPln: 3_934.18,
    profitLossPln: 1_545.29,
    timeWeightedReturnPercent: -487.63,
  });
  assert.equal(getDashboardHistoryMetrics(null, -250, 5_000).returnPercent, -5);
  assert.equal(getDashboardHistoryMetrics(null, 500, 0).returnPercent, null);
});

test("dashboard operation rows resolve real instruments and keep all operation types", () => {
  const conversion = {
    id: "fx-1", portfolioId: "p-1", accountId: "a-1", assetId: null,
    operationType: "CONVERSION", quantity: null, price: null, currency: "PLN",
    exchangeRate: null, fee: 0, tax: 0, amount: 1_000, date: "2026-08-21", notes: "",
    metadata: { targetCurrency: "USD", targetAmount: 238.4 }, createdAt: "2026-08-21", updatedAt: "2026-08-21",
  };
  const buy = { ...conversion, id: "buy-1", assetId: "instrument-dnp", operationType: "BUY", quantity: 3, price: 40, amount: 120, metadata: {} };
  const model = buildDashboardReadModel({
    history: null, events: null, watchlist: [], groups: [], fallbackProfitLoss: 0, fallbackInvested: 0,
    portfolios: [{ name: "Główny", operations: [conversion, buy], instruments: [{ id: "instrument-dnp", symbol: "DNP.PL", name: "Dino Polska" }] }],
  });
  assert.equal(model.operations.all.length, 2);
  assert.equal(model.operations.all.find((row) => row.operation.id === "buy-1")?.instrumentSymbol, "DNP.PL");
  assert.equal(model.operations.cash[0].operation.operationType, "CONVERSION");
});

test("GPW session status includes weekends and known exchange holidays", () => {
  assert.equal(isGpwTradingDay("2026-08-23"), false);
  assert.equal(isCurrentWarsawDayGpwSession(new Date("2026-08-23T10:00:00.000Z")), false);
  assert.equal(getGpwNonTradingDays(2026).has("2026-04-03"), true);
  assert.equal(isGpwTradingDay("2026-04-03"), false);
  assert.equal(isGpwTradingDay("2026-08-21"), true);
});

test("cached quotes suppress user-facing refresh failures while genuinely missing prices remain actionable", () => {
  assert.equal(countAssetsWithoutUsableQuote([{ id: "cached", latestPrice: 87.41 }]), 0);
  assert.equal(countAssetsWithoutUsableQuote([{ id: "missing" }, { id: "zero", latestPrice: 0 }]), 2);
});

test("cash currency choices come from the shared supported-currency architecture", async () => {
  for (const currency of ["PLN", "USD", "EUR", "GBP", "CHF"]) assert.ok(SUPPORTED_CURRENCIES.includes(currency));
  const cash = await readSource("src/components/CashWorkspace.tsx");
  assert.match(cash, /SUPPORTED_CURRENCIES/);
  assert.match(cash, /currencyOptions\.map/);
});

test("dashboard editor auto-detects viewport, applies presets immediately and searches its library", async () => {
  const dashboard = await readSource("src/components/ConfigurableDashboard.tsx");
  assert.match(dashboard, /matchMedia\("\(max-width: 860px\)"\)/);
  assert.doesNotMatch(dashboard, /setEditDevice|Wariant urządzenia|>Zastosuj</);
  assert.match(dashboard, /const nextPreset = event\.target\.value/);
  assert.match(dashboard, /setDraft\(\(current\) => \(\{ \.\.\.current, \[displayDevice\]: next\[displayDevice\] \}\)\)/);
  assert.match(dashboard, /Wyszukaj widget/);
  assert.match(dashboard, /libraryQuery/);
  assert.match(dashboard, /onDoubleClick/);
  assert.match(dashboard, /DashboardChartTooltip/);
});

test("asset entry resets on every open, close and successful add", async () => {
  const [app, context, routes] = await Promise.all([
    readSource("src/components/PortfolioApp.tsx"),
    readSource("src/components/PortfolioWorkspaceContext.tsx"),
    readSource("src/components/WorkspaceRouteViews.tsx"),
  ]);
  assert.match(context, /resetAssetEntryForm/);
  assert.match(app, /const resetAssetEntryForm = useCallback/);
  assert.match(app, /setDraft\(createDraftFromMode\("stock-global"\)\)/);
  assert.match(app, /setLastAddedResult\(null\)/);
  assert.match(routes, /if \(isAddAssetOpen\) resetAssetEntryForm\(\)/);
  assert.match(routes, /return \(\) => \{ if \(isAddAssetOpen\) resetAssetEntryForm\(\); \}/);
});

test("results use friendly fallback states and never expose raw request errors", async () => {
  const panel = await readSource("src/components/PortfolioPerformanceResults.tsx");
  assert.match(panel, /Używamy domyślnego układu wyników/);
  assert.match(panel, /Wynik łączny nadal jest dostępny/);
  assert.doesNotMatch(panel, /reason instanceof Error \? reason\.message/);
});

test("dashboard grid stretches rows instead of leaving holes below shorter neighbours", async () => {
  const styles = await readSource("src/app/globals.css");
  assert.match(styles, /\.dashboard-widget-grid \{[^}]*align-items: stretch/);
  assert.match(styles, /\.dashboard-widget-content \{[^}]*height: 100%/);
});

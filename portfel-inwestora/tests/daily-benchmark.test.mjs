import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BENCHMARK_SEARCH_RESULT_LIMIT,
  createPortfolioBenchmarkDefinition,
  hasExactCoreBenchmarkMatch,
  rankBenchmarkSearchResults,
} from "../src/lib/benchmark-search.ts";
import { buildPortfolioDailyMetricPoints } from "../src/lib/portfolio-daily-metrics.ts";
import { aggregatePortfolioHistoryPoints, buildBuyCashflowEvents, getAggregateTwrStatus, getHistoryTradingDayPredicate, getPortfolioTwrFxWarnings, hasUnreliableHistoryGap } from "../src/lib/server/portfolio-history.ts";
import { buildCalendarReturns, deriveDailyCashFlowNeutralReturns } from "../src/lib/portfolio-risk-analytics.ts";
import { isGpwTradingDay } from "../src/lib/gpw-market-calendar.ts";
import { isXetraTradingDay } from "../src/lib/market-session-calendar.ts";
import { getDashboardHistoryMetrics } from "../src/lib/dashboard-read-model.ts";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("benchmark discovery puts the plain S&P 500 index first", () => {
  for (const query of ["S&P 500", "S&P500", "sp 500"]) {
    const [first] = rankBenchmarkSearchResults(query);

    assert.equal(first?.name, "S&P 500");
    assert.equal(first?.symbol, "^GSPC");
    assert.equal(first?.provider, "yahoo");
    assert.equal(first?.marketCurrency, "USD");
    assert.equal(hasExactCoreBenchmarkMatch(query), true);
  }
});

test("benchmark discovery deduplicates and caps an otherwise huge provider response", () => {
  const providerResults = Array.from({ length: 100 }, (_, index) => ({
    symbol: `SP${index}`,
    name: `S&P 500 variant ${index}`,
    kind: "etf",
    marketCurrency: "USD",
    provider: "eodhd",
    providerId: index % 2 === 0 ? "DUPLICATE" : `SP${index}`,
    source: "api",
  }));

  const results = rankBenchmarkSearchResults("sp", providerResults);

  assert.ok(results.length <= BENCHMARK_SEARCH_RESULT_LIMIT);
  assert.equal(new Set(results.map((result) => `${result.provider}:${result.providerId}`)).size, results.length);
});

test("a benchmark in another quote currency remains selectable because it is comparison-only", () => {
  const [sp500] = rankBenchmarkSearchResults("S&P 500");
  const benchmark = createPortfolioBenchmarkDefinition(sp500, "etf");

  assert.equal(benchmark.symbol, "^GSPC");
  assert.equal(benchmark.marketCurrency, "USD");
  assert.equal(benchmark.provider, "yahoo");
  assert.equal(benchmark.id, "stock:yahoo:^GSPC");
  assert.equal("purchaseCurrency" in benchmark, false);
});

test("daily investment-result values are cash-flow neutral P/L deltas", () => {
  const daily = buildPortfolioDailyMetricPoints([
    {
      date: "2026-08-10",
      portfolioValuePln: 1000,
      netInvestedPln: 1000,
      profitLossPln: 0,
      timeWeightedReturnPercent: 0,
    },
    {
      // A 500 PLN deposit changes raw value, but not investment performance.
      date: "2026-08-11",
      portfolioValuePln: 1500,
      netInvestedPln: 1500,
      profitLossPln: 0,
      timeWeightedReturnPercent: 0,
    },
    {
      date: "2026-08-12",
      portfolioValuePln: 1575,
      netInvestedPln: 1500,
      profitLossPln: 75,
      timeWeightedReturnPercent: 5,
    },
    {
      date: "2026-08-13",
      portfolioValuePln: 1525,
      netInvestedPln: 1500,
      profitLossPln: 25,
      timeWeightedReturnPercent: 1.67,
    },
  ]);

  assert.deepEqual(
    daily.map((point) => point.cashFlowNeutralResultPln),
    [0, 75, -50]
  );
});

test("daily investment result has an honest empty state with fewer than two observations", () => {
  const daily = buildPortfolioDailyMetricPoints([
    {
      date: "2026-08-10",
      portfolioValuePln: 1000,
      netInvestedPln: 1000,
      profitLossPln: 0,
      timeWeightedReturnPercent: 0,
    },
  ]);

  assert.deepEqual(daily, []);
});

test("all-portfolios PLN aggregate feeds the same cash-flow-neutral daily result", () => {
  const allPortfolioPoints = aggregatePortfolioHistoryPoints([
    {
      points: [
        { date: "2026-08-10", portfolioValuePln: 100, netInvestedPln: 100, profitLossPln: 0, timeWeightedReturnPercent: 0 },
        { date: "2026-08-11", portfolioValuePln: 110, netInvestedPln: 100, profitLossPln: 10, timeWeightedReturnPercent: 10 },
      ],
    },
    {
      points: [
        { date: "2026-08-10", portfolioValuePln: 400, netInvestedPln: 400, profitLossPln: 0, timeWeightedReturnPercent: 0 },
        { date: "2026-08-11", portfolioValuePln: 920, netInvestedPln: 900, profitLossPln: 20, timeWeightedReturnPercent: 5 },
      ],
    },
  ]);

  const daily = buildPortfolioDailyMetricPoints(allPortfolioPoints);

  assert.deepEqual(daily.map((point) => point.cashFlowNeutralResultPln), [30]);
  assert.equal(daily[0]?.rawValueChangePln, 530);
});

test("custom aggregate carries each selected portfolio's last observation across different dates", () => {
  const points = aggregatePortfolioHistoryPoints([
    { points: [
      { date: "2026-08-10", portfolioValuePln: 100, netInvestedPln: 100, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2026-08-12", portfolioValuePln: 110, netInvestedPln: 100, profitLossPln: 10, timeWeightedReturnPercent: 10 },
    ] },
    { points: [
      { date: "2026-08-11", portfolioValuePln: 50, netInvestedPln: 50, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2026-08-12", portfolioValuePln: 55, netInvestedPln: 50, profitLossPln: 5, timeWeightedReturnPercent: 10 },
    ] },
  ]);

  assert.deepEqual(points.map(({ date, portfolioValuePln, profitLossPln }) => ({ date, portfolioValuePln, profitLossPln })), [
    { date: "2026-08-10", portfolioValuePln: 100, profitLossPln: 0 },
    { date: "2026-08-11", portfolioValuePln: 150, profitLossPln: 0 },
    { date: "2026-08-12", portfolioValuePln: 165, profitLossPln: 15 },
  ]);
  assert.equal(points.at(-1)?.timeWeightedReturnPercent, 10);
});

test("custom aggregate TWR does not count a later portfolio's inception profit as a return", () => {
  const points = aggregatePortfolioHistoryPoints([
    { points: [
      { date: "2026-08-10", portfolioValuePln: 100, netInvestedPln: 100, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2026-08-11", portfolioValuePln: 110, netInvestedPln: 100, profitLossPln: 10, timeWeightedReturnPercent: 10 },
      { date: "2026-08-12", portfolioValuePln: 121, netInvestedPln: 100, profitLossPln: 21, timeWeightedReturnPercent: 21 },
    ] },
    { points: [
      { date: "2026-08-11", portfolioValuePln: 200, netInvestedPln: 180, profitLossPln: 20, timeWeightedReturnPercent: 0 },
      { date: "2026-08-12", portfolioValuePln: 220, netInvestedPln: 180, profitLossPln: 40, timeWeightedReturnPercent: 10 },
    ] },
  ]);

  assert.equal(points[1]?.timeWeightedReturnPercent, 10);
  assert.equal(points[2]?.timeWeightedReturnPercent, 21);
  assert.equal(points[2]?.profitLossPln, 61);

  const dailyReturns = deriveDailyCashFlowNeutralReturns(points);
  assert.deepEqual(dailyReturns.map((item) => item.returnDecimal), [0.1, 0.1]);
  assert.deepEqual(dailyReturns.map((item) => item.resultPln), [10, 31]);
  const monthly = buildCalendarReturns(dailyReturns, "month")[0];
  const yearly = buildCalendarReturns(dailyReturns, "year")[0];
  assert.ok(Math.abs((monthly?.returnDecimal ?? Number.NaN) - 0.21) < 1e-12);
  assert.ok(Math.abs((yearly?.returnDecimal ?? Number.NaN) - 0.21) < 1e-12);
  assert.equal(yearly?.resultAmount, 41);
  assert.equal(yearly?.isComplete, false);
});

test("partial-year calendar separates positive nominal result from negative TWR", () => {
  const points = aggregatePortfolioHistoryPoints([{
    points: [
      { date: "2025-07-31", portfolioValuePln: 100, netInvestedPln: 100, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2025-08-01", portfolioValuePln: 50, netInvestedPln: 100, profitLossPln: -50, timeWeightedReturnPercent: -50 },
      // A 1,000 PLN external deposit changes capital, not investment return.
      { date: "2025-09-01", portfolioValuePln: 1_050, netInvestedPln: 1_100, profitLossPln: -50, timeWeightedReturnPercent: -50 },
      { date: "2025-12-31", portfolioValuePln: 1_155, netInvestedPln: 1_100, profitLossPln: 55, timeWeightedReturnPercent: -45 },
    ],
  }]);

  const yearly = buildCalendarReturns(deriveDailyCashFlowNeutralReturns(points), "year")[0];

  assert.equal(yearly?.resultAmount, 55);
  // The ordinary capital return is nominal period P/L divided by net capital
  // invested at the period end: +55 / 1,100 = +5%, unlike the flow-neutral TWR.
  assert.equal(yearly?.capitalReturnDecimal, 0.05);
  assert.ok(Math.abs((yearly?.returnDecimal ?? Number.NaN) - -0.45) < 1e-12);
  assert.equal(yearly?.isComplete, false);
  assert.equal(yearly?.dateFrom, "2025-07-31");
  assert.equal(yearly?.dateTo, "2025-12-31");
});

test("calendar simple return is unavailable when ending net invested capital is not positive", () => {
  const returns = [{
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    returnDecimal: 0.1,
    resultPln: 10,
    netInvestedAmount: 0,
    previousValuePln: 100,
    valuePln: 110,
  }];

  assert.equal(buildCalendarReturns(returns, "month")[0]?.capitalReturnDecimal, null);
});

test("custom aggregate weights returns by capital rather than averaging portfolio percentages", () => {
  const points = aggregatePortfolioHistoryPoints([
    { points: [
      { date: "2026-08-10", portfolioValuePln: 10_000, netInvestedPln: 10_000, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2026-08-11", portfolioValuePln: 11_000, netInvestedPln: 10_000, profitLossPln: 1_000, timeWeightedReturnPercent: 10 },
    ] },
    { points: [
      { date: "2026-08-10", portfolioValuePln: 2_000, netInvestedPln: 2_000, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2026-08-11", portfolioValuePln: 2_600, netInvestedPln: 2_000, profitLossPln: 600, timeWeightedReturnPercent: 30 },
    ] },
  ]);

  assert.equal(points.at(-1)?.timeWeightedReturnPercent, 13.33);
  assert.notEqual(points.at(-1)?.timeWeightedReturnPercent, 20);
});

test("presentation-currency TWR follows daily values after historical FX conversion", () => {
  // A constant USD holding is worth 1,000 PLN at inception (2 PLN/USD) and
  // still 500 USD the next day (2.2 PLN/USD). PLN appreciates by 10%, but the
  // USD-denominated portfolio had no investment return.
  const points = aggregatePortfolioHistoryPoints([{
    points: [
      {
        date: "2026-08-10",
        portfolioValuePln: 1_000,
        netInvestedPln: 1_000,
        profitLossPln: 0,
        timeWeightedReturnPercent: 0,
        presentationPortfolioValue: 500,
        presentationNetInvested: 500,
        presentationProfitLoss: 0,
        presentationTimeWeightedReturnPercent: 0,
      },
      {
        date: "2026-08-11",
        portfolioValuePln: 1_100,
        netInvestedPln: 1_000,
        profitLossPln: 100,
        timeWeightedReturnPercent: 10,
        presentationPortfolioValue: 500,
        presentationNetInvested: 500,
        presentationProfitLoss: 0,
        presentationTimeWeightedReturnPercent: 0,
      },
    ],
  }]);

  assert.equal(points.at(-1)?.timeWeightedReturnPercent, 10);
  assert.equal(points.at(-1)?.presentationTimeWeightedReturnPercent, 0);
  assert.equal(points.at(-1)?.dailyTimeWeightedReturnDecimal, 0.1);
  assert.equal(points.at(-1)?.presentationDailyTimeWeightedReturnDecimal, 0);
});

test("presentation-only FX gaps do not invalidate the independently computed PLN TWR", () => {
  const warningsByCode = new Map([
    ["PLN", []],
    ["USD", ["Brakuje historycznego kursu FX USD dla zakresu 2020-01-01–2020-02-01."]],
  ]);

  assert.deepEqual(getPortfolioTwrFxWarnings(["PLN"], warningsByCode), []);
  assert.deepEqual(getPortfolioTwrFxWarnings(["PLN", "USD"], warningsByCode), [
    "Brakuje historycznego kursu FX USD dla zakresu 2020-01-01–2020-02-01.",
  ]);
});

test("dashboard latest value and capital return use normalized presentation-currency points", () => {
  const metrics = getDashboardHistoryMetrics({
    presentationCurrency: "USD",
    points: [{
      date: "2026-08-11",
      portfolioValuePln: 4_400,
      netInvestedPln: 4_400,
      profitLossPln: 0,
      timeWeightedReturnPercent: 10,
      presentationPortfolioValue: 2_000,
      presentationNetInvested: 2_000,
      presentationProfitLoss: 0,
      presentationTimeWeightedReturnPercent: 0,
    }],
    warnings: [],
    assetSeries: [],
    benchmarkSeries: [],
  });

  assert.equal(metrics.latestPoint?.portfolioValuePln, 2_000);
  assert.equal(metrics.returnPercent, 0);
});

test("custom aggregate correctly nets portfolios with positive and negative daily performance", () => {
  const points = aggregatePortfolioHistoryPoints([
    { points: [
      { date: "2026-08-10", portfolioValuePln: 1_000, netInvestedPln: 1_000, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2026-08-11", portfolioValuePln: 1_100, netInvestedPln: 1_000, profitLossPln: 100, timeWeightedReturnPercent: 10 },
    ] },
    { points: [
      { date: "2026-08-10", portfolioValuePln: 2_000, netInvestedPln: 2_000, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2026-08-11", portfolioValuePln: 1_800, netInvestedPln: 2_000, profitLossPln: -200, timeWeightedReturnPercent: -10 },
    ] },
  ]);

  // Combined return is (-100 P/L) / 3,000 starting value, not an average of +10% and -10%.
  assert.equal(points.at(-1)?.profitLossPln, -100);
  assert.equal(points.at(-1)?.timeWeightedReturnPercent, -3.33);
});

test("legacy sales without a cash-impact operation are explicitly identified as incomplete TWR input", () => {
  const sale = { id: "sale-1", saleDate: "2026-08-11", realizedInvestedPln: 900, allocations: [] };
  const legacy = buildBuyCashflowEvents([], [sale], new Map(), []);
  const mirrored = buildBuyCashflowEvents([], [sale], new Map(), [
    { id: "op-sale-1", operationType: "SELL", metadata: { cashImpact: true, saleId: "sale-1" } },
  ]);

  assert.equal(legacy.hasUnmirroredSale, true);
  assert.equal(mirrored.hasUnmirroredSale, false);
});

test("TWR completeness checks missing trading sessions instead of raw calendar days", () => {
  assert.equal(hasUnreliableHistoryGap([
    { date: "2026-08-10", close: 100 },
    { date: "2026-08-13", close: 101 },
  ], "2026-08-10", "2026-08-13"), false);
  assert.equal(hasUnreliableHistoryGap([
    { date: "2026-08-10", close: 100 },
    { date: "2026-08-21", close: 103 },
  ], "2026-08-10", "2026-08-21"), true);
  // GPW was closed on Christmas Eve (from 2025), Christmas Day, Boxing Day,
  // and then the weekend. The six-day calendar interval contains no missing
  // exchange session and must not invalidate the portfolio TWR.
  assert.equal(hasUnreliableHistoryGap([
    { date: "2025-12-23", close: 100 },
    { date: "2025-12-29", close: 101 },
  ], "2025-12-23", "2025-12-29", isGpwTradingDay), false);
  // Xetra/Frankfurt are also closed on Dec 24-26; the weekend follows, so
  // Dec 23 -> Dec 29 is not a multi-session price-history gap there either.
  assert.equal(hasUnreliableHistoryGap([
    { date: "2025-12-23", close: 100 },
    { date: "2025-12-29", close: 101 },
  ], "2025-12-23", "2025-12-29", isXetraTradingDay), false);
  // Three missing open sessions remain a real data-quality gap.
  assert.equal(hasUnreliableHistoryGap([
    { date: "2025-12-29", close: 100 },
    { date: "2026-01-05", close: 101 },
  ], "2025-12-29", "2026-01-05", isGpwTradingDay), true);
  // A real Xetra data outage spanning three open sessions must still block
  // completeness; the calendar only exempts official venue holidays.
  assert.equal(hasUnreliableHistoryGap([
    { date: "2025-12-29", close: 100 },
    { date: "2026-01-06", close: 101 },
  ], "2025-12-29", "2026-01-06", isXetraTradingDay), true);
  // Unlike exchange-traded securities, crypto is expected to have weekend data.
  assert.equal(hasUnreliableHistoryGap([
    { date: "2026-08-07", close: 100 },
    { date: "2026-08-13", close: 101 },
  ], "2026-08-07", "2026-08-13", () => true), true);
});

test("2B7C.DE uses Xetra session calendar for history completeness", () => {
  assert.equal(isXetraTradingDay("2025-12-24"), false);
  assert.equal(isXetraTradingDay("2025-12-30"), true);
  assert.equal(isXetraTradingDay("2025-12-31"), false);
  assert.equal(isXetraTradingDay("2026-01-01"), false);

  const isTradingDay = getHistoryTradingDayPredicate({
    symbol: "2B7C.DE",
    providerId: "2B7C.DE",
    kind: "etf",
  });
  assert.equal(isTradingDay, isXetraTradingDay);
  assert.equal(hasUnreliableHistoryGap([
    { date: "2025-12-23", close: 100 },
    { date: "2025-12-29", close: 101 },
  ], "2025-12-23", "2025-12-29", isTradingDay), false);

  const byMic = getHistoryTradingDayPredicate({
    symbol: "VWRL",
    kind: "etf",
    mic: "XETR",
  });
  assert.equal(byMic, isXetraTradingDay);
});

test("aggregate TWR is unavailable or incomplete if any non-empty component history is unreliable", () => {
  assert.equal(getAggregateTwrStatus([]), "unavailable");
  assert.equal(getAggregateTwrStatus([{ twrStatus: "complete" }, { twrStatus: "complete" }]), "complete");
  assert.equal(getAggregateTwrStatus([{ twrStatus: "complete" }, { twrStatus: "incomplete" }]), "incomplete");
  assert.equal(getAggregateTwrStatus([{ twrStatus: "unavailable" }]), "unavailable");
});

test("a selected portfolio-to-portfolio transfer does not create aggregate profit", () => {
  const points = aggregatePortfolioHistoryPoints([
    { points: [
      { date: "2026-08-10", portfolioValuePln: 1_000, netInvestedPln: 1_000, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2026-08-11", portfolioValuePln: 0, netInvestedPln: 0, profitLossPln: 0, timeWeightedReturnPercent: 0 },
    ] },
    { points: [
      { date: "2026-08-10", portfolioValuePln: 500, netInvestedPln: 500, profitLossPln: 0, timeWeightedReturnPercent: 0 },
      { date: "2026-08-11", portfolioValuePln: 1_500, netInvestedPln: 1_500, profitLossPln: 0, timeWeightedReturnPercent: 0 },
    ] },
  ]);

  assert.equal(points[0]?.portfolioValuePln, 1_500);
  assert.equal(points[1]?.portfolioValuePln, 1_500);
  assert.equal(points[1]?.profitLossPln, 0);
  assert.equal(points[1]?.timeWeightedReturnPercent, 0);
});

test("charts render cash-flow-neutral daily-result bars only inside the shared sixth mode", async () => {
  const source = await readSource("src/components/PortfolioLineCharts.tsx");

  assert.match(source, /buildPortfolioDailyMetricPoints\(displayPoints\)/);
  assert.match(source, /cashFlowNeutralResultPln/);
  assert.match(source, /<Bar[\s\S]*dataKey="investmentResult"/);
  assert.match(source, /investmentResult >= 0 \? "#087657" : "#b42318"/);
  assert.match(source, /<ReferenceLine[\s\S]*y=\{0\}/);
  assert.match(source, /Brakuje danych do wyniku dziennego/);
  assert.match(source, /renderDailyInvestmentResultChartFrame\(\)/);
  assert.doesNotMatch(source, /dailyInvestmentResultOnly|line-visual-daily-result-panel/);
  assert.match(source, /<Line[\s\S]*dataKey=\{line\.dataKey\}/);
});

test("daily result is the sixth integrated mode on the Wykresy route", async () => {
  const source = await readSource("src/components/WorkspaceRouteViews.tsx");
  const chartsSource = await readSource("src/components/PortfolioLineCharts.tsx");
  const dashboard = source.slice(
    source.indexOf("export function WorkspaceDashboardPage"),
    source.indexOf("export function WorkspacePositionsPage")
  );
  const charts = source.slice(
    source.indexOf("export function WorkspaceChartsPage"),
    source.indexOf("export function WorkspaceStructurePage")
  );

  assert.doesNotMatch(dashboard, /showDailyInvestmentResult/);
  assert.doesNotMatch(charts, /showDailyInvestmentResult/);
  assert.match(chartsSource, /\| "daily-investment-result"/);
  assert.match(chartsSource, /value: "daily-investment-result",[\s\S]*?label: "Wynik dzienny"/);
  assert.match(chartsSource, /Jeden wykres, sześć trybów analizy/);
  assert.match(
    chartsSource,
    /mode === "daily-investment-result" \? \([\s\S]*?renderDailyInvestmentResultChartFrame\(\)/
  );
});

test("benchmark UI has a core-index short circuit, abortable provider search, and no global search rewrite", async () => {
  const source = await readSource("src/components/PortfolioLineCharts.tsx");

  assert.match(source, /hasExactCoreBenchmarkMatch\(trimmedQuery\)/);
  assert.match(source, /rankBenchmarkSearchResults\(trimmedQuery, nextResults\)/);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /searchEtfInstruments\(/);
});

test("benchmark work stays outside the global asset-search route", async () => {
  const globalSearch = await readSource("src/app/api/search/route.ts");

  assert.doesNotMatch(globalSearch, /CORE_BENCHMARKS|rankBenchmarkSearchResults|createPortfolioBenchmarkDefinition/);
});

test("current-position primary values use the same natural numeric feature as dividend summaries", async () => {
  const styles = await readSource("src/app/globals.css");
  const selector = styles.match(
    /\.portfolio-positions-table \.portfolio-number,[\s\S]*?\.workspace-position-card \.portfolio-number \{([\s\S]*?)\n\}/
  );

  assert.ok(selector);
  assert.match(selector[1], /font-variant-numeric:\s*normal/);
  assert.match(selector[1], /font-feature-settings:\s*normal/);
  assert.match(selector[1], /font-kerning:\s*auto/);
  assert.doesNotMatch(selector[1], /tabular-nums/);
});

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
import { aggregatePortfolioHistoryPoints } from "../src/lib/server/portfolio-history.ts";

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

test("charts render an additive daily-result bar visualization without replacing the main chart", async () => {
  const source = await readSource("src/components/PortfolioLineCharts.tsx");

  assert.match(source, /line-visual-daily-result-panel/);
  assert.match(source, /buildPortfolioDailyMetricPoints\(displayPoints\)/);
  assert.match(source, /cashFlowNeutralResultPln/);
  assert.match(source, /<Bar[\s\S]*dataKey="investmentResult"/);
  assert.match(source, /investmentResult >= 0 \? "#087657" : "#b42318"/);
  assert.match(source, /<ReferenceLine[\s\S]*y=\{0\}/);
  assert.match(source, /Brakuje danych do wyniku dziennego/);
  assert.match(source, /renderDailyInvestmentResultPanel\(\)/);
  assert.match(source, /<Line[\s\S]*dataKey=\{line\.dataKey\}/);
});

test("daily-result panel is explicitly enabled only by the Wykresy route", async () => {
  const source = await readSource("src/components/WorkspaceRouteViews.tsx");
  const dashboard = source.slice(
    source.indexOf("export function WorkspaceDashboardPage"),
    source.indexOf("export function WorkspacePositionsPage")
  );
  const charts = source.slice(
    source.indexOf("export function WorkspaceChartsPage"),
    source.indexOf("export function WorkspaceStructurePage")
  );

  assert.doesNotMatch(dashboard, /showDailyInvestmentResult/);
  assert.match(charts, /showDailyInvestmentResult/);
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
    /\.portfolio-positions-table td:nth-child\(4\) \.financial-value,[\s\S]*?\.portfolio-positions-table td:nth-child\(5\) \.financial-value \{([\s\S]*?)\n\}/
  );

  assert.ok(selector);
  assert.match(selector[1], /font-variant-numeric:\s*normal/);
  assert.match(selector[1], /font-feature-settings:\s*normal/);
  assert.match(selector[1], /font-kerning:\s*auto/);
  assert.doesNotMatch(selector[1], /tabular-nums/);
});

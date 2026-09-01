import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  buildCalendarReturns,
  calculatePortfolioRiskAnalytics,
  deriveDailyCashFlowNeutralReturns,
  getAvailableRiskPeriods,
  selectRiskPeriodPoints,
} from "../src/lib/portfolio-risk-analytics.ts";
import { parsePoloniaWorkbook } from "../src/lib/server/polonia.ts";

const nextDate = (date, days = 1) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const buildPoints = (returns, startDate = "2024-01-01", initialValue = 100) => {
  const points = [{ date: startDate, portfolioValuePln: initialValue, netInvestedPln: initialValue, profitLossPln: 0, timeWeightedReturnPercent: 0 }];
  let value = initialValue;
  let profit = 0;
  returns.forEach((dailyReturn, index) => {
    profit += value * dailyReturn;
    value += value * dailyReturn;
    points.push({ date: nextDate(startDate, index + 1), portfolioValuePln: value, netInvestedPln: initialValue, profitLossPln: profit, timeWeightedReturnPercent: null });
  });
  return points;
};

const zeroRates = (points) => points.map((point) => ({ date: point.date, annualRate: 0 }));

test("daily return is derived from P/L delta and previous portfolio value", () => {
  const points = [
    { date: "2026-01-01", portfolioValuePln: 100, netInvestedPln: 100, profitLossPln: 0, timeWeightedReturnPercent: 0 },
    { date: "2026-01-02", portfolioValuePln: 1100, netInvestedPln: 1100, profitLossPln: 0, timeWeightedReturnPercent: 900 },
    { date: "2026-01-03", portfolioValuePln: 100, netInvestedPln: 100, profitLossPln: 0, timeWeightedReturnPercent: -90 },
  ];
  assert.deepEqual(deriveDailyCashFlowNeutralReturns(points).map((point) => point.returnDecimal), [0, 0]);
});

test("steadily growing portfolio has no drawdown and reports zero-variance risk metrics", () => {
  const points = buildPoints(Array(40).fill(0.01));
  const result = calculatePortfolioRiskAnalytics({ points, period: "MAX", riskFreeRates: zeroRates(points) });
  assert.equal(result.drawdown.value.maxDrawdown, 0);
  assert.equal(result.timeUnderWater.value.current, null);
  assert.equal(result.volatility.unavailableCode, "ZERO_VARIANCE");
});

test("-20% drawdown records peak, trough and full recovery", () => {
  const points = buildPoints([-0.2, 0.25], "2026-01-01");
  const result = calculatePortfolioRiskAnalytics({ points, period: "MAX", riskFreeRates: zeroRates(points) });
  assert.ok(Math.abs(result.drawdown.value.maxDrawdown + 0.2) < 1e-12);
  assert.equal(result.drawdown.value.peakDate, "2026-01-01");
  assert.equal(result.drawdown.value.troughDate, "2026-01-02");
  assert.equal(result.drawdown.value.recoveryDate, "2026-01-03");
  assert.equal(result.timeUnderWater.value.longestCompleted.days, 2);
});

test("ongoing drawdown remains an active time-under-water episode", () => {
  const points = buildPoints([-0.1, -0.05], "2026-02-01");
  const result = calculatePortfolioRiskAnalytics({ points, period: "MAX", riskFreeRates: zeroRates(points) });
  assert.equal(result.drawdown.value.recoveryDate, null);
  assert.equal(result.timeUnderWater.value.current.startDate, "2026-02-01");
  assert.equal(result.timeUnderWater.value.current.days, 2);
});

test("known aligned benchmark produces beta equal to two", () => {
  const benchmarkReturns = Array.from({ length: 65 }, (_, index) => index % 2 === 0 ? 0.002 : -0.001);
  const portfolioReturns = benchmarkReturns.map((value) => value * 2);
  const points = buildPoints(portfolioReturns);
  let price = 100;
  const benchmarkPoints = [{ date: points[0].date, price, pricePln: price, returnPercent: 0 }];
  benchmarkReturns.forEach((value, index) => { price *= 1 + value; benchmarkPoints.push({ date: points[index + 1].date, price, pricePln: price, returnPercent: null }); });
  const result = calculatePortfolioRiskAnalytics({ points, period: "MAX", riskFreeRates: zeroRates(points), benchmark: { id: "test", label: "Test", points: benchmarkPoints } });
  assert.ok(Math.abs(result.benchmark.beta.value - 2) < 1e-10);
});

test("missing benchmark is unavailable instead of zero", () => {
  const points = buildPoints(Array(65).fill(0.001));
  const result = calculatePortfolioRiskAnalytics({ points, period: "MAX", riskFreeRates: zeroRates(points) });
  assert.equal(result.benchmark.beta.value, null);
  assert.equal(result.benchmark.beta.unavailableCode, "BENCHMARK_REQUIRED");
});

test("all-portfolios aggregate explicitly rejects a synthetic benchmark", () => {
  const points = buildPoints(Array(65).fill(0.001));
  const result = calculatePortfolioRiskAnalytics({ points, period: "MAX", riskFreeRates: zeroRates(points), isAggregate: true });
  assert.equal(result.benchmark.trackingError.unavailableCode, "AGGREGATE_BENCHMARK_UNAVAILABLE");
});

test("short history does not fabricate volatility", () => {
  const points = buildPoints(Array(10).fill(0.001));
  const result = calculatePortfolioRiskAnalytics({ points, period: "MAX", riskFreeRates: zeroRates(points) });
  assert.equal(result.volatility.value, null);
  assert.equal(result.volatility.unavailableCode, "INSUFFICIENT_OBSERVATIONS");
});

test("period selection keeps the baseline point immediately before its start", () => {
  const points = buildPoints(Array(500).fill(0.0001), "2024-01-01");
  const selected = selectRiskPeriodPoints(points, "1Y");
  assert.equal(selected.length, 367);
  assert.ok(getAvailableRiskPeriods(points).includes("YTD"));
  assert.ok(getAvailableRiskPeriods(points).includes("1Y"));
  assert.ok(getAvailableRiskPeriods(points).includes("MAX"));
});

test("monthly and yearly results compound daily returns", () => {
  const returns = deriveDailyCashFlowNeutralReturns(buildPoints([0.1, 0.1], "2024-01-01"));
  assert.ok(Math.abs(buildCalendarReturns(returns, "month")[0].returnDecimal - 0.21) < 1e-12);
  assert.ok(Math.abs(buildCalendarReturns(returns, "year")[0].returnDecimal - 0.21) < 1e-12);
});

test("no downside makes Sortino unavailable", () => {
  const points = buildPoints(Array(40).fill(0.001));
  const result = calculatePortfolioRiskAnalytics({ points, period: "MAX", riskFreeRates: zeroRates(points) });
  assert.equal(result.sortino.value, null);
  assert.equal(result.sortino.unavailableCode, "NO_DOWNSIDE");
});

test("missing POLONIA makes Sharpe unavailable", () => {
  const points = buildPoints(Array.from({ length: 40 }, (_, index) => index % 2 ? 0.001 : -0.0005));
  const result = calculatePortfolioRiskAnalytics({ points, period: "MAX", riskFreeRates: null });
  assert.equal(result.sharpe.unavailableCode, "RISK_FREE_UNAVAILABLE");
});

test("benchmark pairing requires the exact start and end interval", () => {
  const points = buildPoints(Array(65).fill(0.001));
  const benchmarkPoints = points.filter((_, index) => index % 2 === 0).map((point, index) => ({ date: point.date, price: 100 + index, pricePln: 100 + index, returnPercent: null }));
  const result = calculatePortfolioRiskAnalytics({ points, period: "MAX", riskFreeRates: zeroRates(points), benchmark: { id: "gapped", label: "Gapped", points: benchmarkPoints } });
  assert.equal(result.benchmark.beta.observationCount, 0);
  assert.equal(result.benchmark.beta.unavailableCode, "INSUFFICIENT_OBSERVATIONS");
});

test("POLONIA XLSX parser reads normalized Excel dates and annual decimal rates", () => {
  const worksheet = `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>46023</v></c><c r="B2"><v>0.0525</v></c></row></sheetData></worksheet>`;
  const workbook = zipSync({ "xl/worksheets/sheet1.xml": strToU8(worksheet) });
  assert.deepEqual(parsePoloniaWorkbook(workbook), [{ date: "2026-01-01", annualRate: 0.0525 }]);
});

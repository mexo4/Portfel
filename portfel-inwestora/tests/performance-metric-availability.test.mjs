import assert from "node:assert/strict";
import test from "node:test";
import {
  getPerformanceMetricAvailability,
  isPerformanceMetricShown,
} from "../src/lib/performance-metric-availability.ts";
import { calculateWindowCapitalReturnPercent } from "../src/lib/portfolio-performance.ts";
import { DEFAULT_PERFORMANCE_METRICS } from "../src/lib/performance-preferences.ts";

const present = { value: { returnDecimal: 0.01 } };
const missing = { value: null };

const input = (overrides = {}, analyticsOverrides = {}) => ({
  hasLatestPoint: true,
  hasLatestValueChange: true,
  hasFiniteResult: true,
  hasReliableCashFlowCurrency: true,
  xirrValue: 0.35,
  cagrValue: 0.3,
  analytics: {
    bestDay: present, worstDay: present, bestDailyResult: present, bestMonth: present, worstMonth: present,
    bestYear: present, worstYear: present, volatility: { value: 0.15 }, drawdown: present, timeUnderWater: present,
    sharpe: { value: 1 }, sortino: { value: 1 }, calmar: { value: 1 },
    benchmark: { beta: { value: 1 }, alpha: { value: 0 }, informationRatio: { value: 0 }, trackingError: { value: 0.02 } },
    ...analyticsOverrides,
  },
  ...overrides,
});

test("everything that can be calculated is available", () => {
  const availability = getPerformanceMetricAvailability(input());

  assert.ok(Object.values(availability).every(Boolean));
  assert.ok(Object.keys(availability).length >= 22);
});

test("an XIRR that cannot be solved (ambiguous flows) is not available, so its card is not drawn", () => {
  const availability = getPerformanceMetricAvailability(input({ xirrValue: null }));

  assert.equal(availability.xirr, false);
  assert.equal(availability.cagr, true);
  assert.equal(isPerformanceMetricShown("xirr", DEFAULT_PERFORMANCE_METRICS, availability), false);
  assert.equal(isPerformanceMetricShown("cagr", DEFAULT_PERFORMANCE_METRICS, availability), true);
});

test("risk and benchmark metrics without a value are not available", () => {
  const availability = getPerformanceMetricAvailability(
    input({}, {
      calmar: missing,
      sortino: missing,
      benchmark: { beta: missing, alpha: missing, informationRatio: missing, trackingError: missing },
    })
  );

  for (const id of ["calmar", "sortino", "beta", "alpha", "information-ratio", "tracking-error"]) {
    assert.equal(availability[id], false, id);
  }
  assert.equal(availability.sharpe, true);
});

test("a zero is a value: a flat metric is shown, a missing one is not", () => {
  const availability = getPerformanceMetricAvailability(input({}, { volatility: { value: 0 }, sharpe: missing }));

  assert.equal(availability.volatility, true);
  assert.equal(availability.sharpe, false);
});

test("a metric the user switched off stays off even when it is available", () => {
  const availability = getPerformanceMetricAvailability(input());

  assert.equal(isPerformanceMetricShown("cagr", ["xirr"], availability), false);
  assert.equal(isPerformanceMetricShown("xirr", ["xirr"], availability), true);
  // an id without an availability entry (the calendar results) is available
  assert.equal(isPerformanceMetricShown("calendar-results", ["calendar-results"], availability), true);
});

test("the capital rate of the whole history counts the result from zero", () => {
  // 1,711 PLN result on 7,019 PLN of net capital, including the first day's -12.73.
  const points = [
    { profitLossPln: -12.73, netInvestedPln: 1_062.74 },
    { profitLossPln: 1_711.33, netInvestedPln: 7_019.28 },
  ];

  assert.equal(calculateWindowCapitalReturnPercent(points, true), 24.38);
});

test("the capital rate of a later window starts from the baseline point before it", () => {
  const points = [
    { profitLossPln: 500, netInvestedPln: 5_000 },
    { profitLossPln: 900, netInvestedPln: 5_000 },
    { profitLossPln: 1_500, netInvestedPln: 6_000 },
  ];

  assert.equal(calculateWindowCapitalReturnPercent(points, false), 16.67, "(1,500 - 500) / 6,000");
});

test("no capital rate without positive net invested capital or without points", () => {
  assert.equal(calculateWindowCapitalReturnPercent([], true), null);
  assert.equal(calculateWindowCapitalReturnPercent([{ profitLossPln: 10, netInvestedPln: 0 }], true), null);
  assert.equal(calculateWindowCapitalReturnPercent([{ profitLossPln: 10, netInvestedPln: -5 }], true), null);
});

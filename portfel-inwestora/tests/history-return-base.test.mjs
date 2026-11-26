import assert from "node:assert/strict";
import test from "node:test";
import { calculateDailyReturn, getDailyReturnBase } from "../src/lib/daily-return.ts";
import { aggregatePortfolioHistoryPoints, buildPortfolioHistory } from "../src/lib/server/portfolio-history.ts";
import { calculatePortfolioRiskAnalytics, deriveDailyCashFlowNeutralReturns } from "../src/lib/portfolio-risk-analytics.ts";
import { buildPortfolioDailyMetricPoints } from "../src/lib/portfolio-daily-metrics.ts";

const returnOf = (result, options) => calculateDailyReturn(result, getDailyReturnBase(options));
const round4 = (value) => (value === null ? null : Math.round(value * 10_000) / 10_000);

test("a deposit invested the same day is part of that day's capital", () => {
  // 100 on the account, 10 000 paid in and invested, the new purchase down 1% at the close.
  assert.equal(round4(returnOf(-100, { previousValue: 100, externalFlow: 10_000 })), -0.0099);
  // A withdrawal leaves the money that was at work during the day unchanged.
  assert.equal(round4(returnOf(10, { previousValue: 1_000, externalFlow: -900 })), 0.01);
});

test("purchases with no recorded deposit still count as invested money", () => {
  // Day 1: bought for 400 with nothing paid in: value 0, cash shortfall 400.
  assert.equal(returnOf(0, { previousValue: 0, externalFlow: 0, shortfall: 400 }), 0);
  // Day 2: the holding gains 8 on 400, not "infinitely much" on a value of 0.
  assert.equal(round4(returnOf(8, { previousValue: 0, previousShortfall: 400, externalFlow: 0, shortfall: 400 })), 0.02);
  // Selling everything and buying again: the proceeds are reused before anything new is counted.
  assert.equal(returnOf(0, { previousValue: 40, previousShortfall: 0, externalFlow: 0, shortfall: 360 }), 0);
  assert.equal(getDailyReturnBase({ previousValue: 40, externalFlow: 0, shortfall: 360 }), 400);
});

test("no percentage is made out of dust", () => {
  assert.equal(returnOf(0.2, { previousValue: 0.1, externalFlow: 0 }), null);
  assert.equal(returnOf(0, { previousValue: 0, externalFlow: 0 }), null);
  assert.equal(returnOf(5, { previousValue: -173, externalFlow: 0 }), null);
});

const point = (date, value, netInvested, profit, extra = {}) => ({
  date, portfolioValuePln: value, netInvestedPln: netInvested, profitLossPln: profit, timeWeightedReturnPercent: null, ...extra,
});

test("the combined view keeps a portfolio without deposits, on its real capital", () => {
  // Portfolio without deposits: value = result only, the money spent shows as a shortfall.
  const withoutDeposits = [
    point("2026-07-22", 42, 0, 42, { cashShortfallPln: 1_000 }),
    point("2026-07-23", 10, 0, 10, { cashShortfallPln: 1_000 }),
  ];
  const [, alone] = aggregatePortfolioHistoryPoints([{ points: withoutDeposits }]);
  assert.equal(round4(alone.dailyTimeWeightedReturnDecimal), -0.0307); // -32 on 1 042, not -76%

  const funded = [point("2026-07-22", 1_000, 1_000, 0), point("2026-07-23", 1_010, 1_000, 10)];
  const [, both] = aggregatePortfolioHistoryPoints([{ points: withoutDeposits }, { points: funded }]);
  assert.equal(round4(both.dailyTimeWeightedReturnDecimal), round4((-32 + 10) / (1_042 + 1_000)));
  assert.equal(both.dailyReturnBasePln, 2_042);
});

test("amounts of the best and worst day come from the same base as the percentage", () => {
  const points = [
    point("2026-07-22", 100, 100, 0, { dailyTimeWeightedReturnDecimal: null }),
    point("2026-07-23", 10_000, 10_100, -100, { dailyTimeWeightedReturnDecimal: -100 / 10_100, dailyReturnBasePln: 10_100 }),
  ];
  const [daily] = deriveDailyCashFlowNeutralReturns(points);
  assert.equal(Math.round(daily.resultPln * 100) / 100, -100);
  assert.equal(buildPortfolioDailyMetricPoints(points)[0].cashFlowNeutralResultPercent, -0.99);
});

test("a day after a negative value is not dropped when the history gives its return", () => {
  const points = [
    point("2026-07-22", -38, 0, -38, { dailyTimeWeightedReturnDecimal: null }),
    point("2026-07-23", -30, 0, -30, { dailyTimeWeightedReturnDecimal: 0.02, dailyReturnBasePln: 400 }),
  ];
  assert.deepEqual(deriveDailyCashFlowNeutralReturns(points).map((item) => item.returnDecimal), [0.02]);
});

const operation = (id, operationType, date, amount, extra = {}) => ({
  id, portfolioId: "p", accountId: "p:account:cash:PLN", assetId: null, operationType, quantity: null, price: null,
  currency: "PLN", exchangeRate: 1, fee: 0, tax: 0, amount, date, notes: "", metadata: { cashImpact: true, kind: "cash" },
  createdAt: `${date}T10:00:00.000Z`, updatedAt: `${date}T10:00:00.000Z`, ...extra,
});
const account = { id: "p:account:cash:PLN", portfolioId: "p", name: "Gotówka PLN", kind: "cash", currency: "PLN", isDefault: true, metadata: {}, createdAt: "", updatedAt: "" };

test("the history reports missing deposits, and a deposit recorded later is not a gain", async () => {
  // Ledger entries only, so no market data is needed: money spent first, paid in a day later.
  const history = await buildPortfolioHistory({
    assets: [], sales: [], realizedAdjustments: [], accounts: [account],
    operations: [
      operation("spend", "FEE", "2026-03-02", 500),
      operation("late", "DEPOSIT", "2026-03-03", 1_000),
      operation("interest", "INTEREST", "2026-03-04", 5),
    ],
  });
  assert.equal(history.cashShortfallSince, "2026-03-02");
  const byDate = new Map(history.points.map((item) => [item.date, item]));
  assert.equal(byDate.get("2026-03-02").cashShortfallPln, 500);
  assert.equal(byDate.get("2026-03-03").cashShortfallPln, undefined);
  assert.equal(byDate.get("2026-03-03").dailyTimeWeightedReturnDecimal, 0);
  assert.equal(round4(byDate.get("2026-03-04").dailyTimeWeightedReturnDecimal), 0.01);
  const analytics = calculatePortfolioRiskAnalytics({ points: history.points, period: "MAX", riskFreeRates: null });
  assert.ok(analytics.dailyReturns.every((item) => Number.isFinite(item.returnDecimal)));
});

test("a funded history carries no shortfall", async () => {
  const history = await buildPortfolioHistory({
    assets: [], sales: [], realizedAdjustments: [], accounts: [account],
    operations: [operation("in", "DEPOSIT", "2026-03-02", 1_000), operation("fee", "FEE", "2026-03-03", 10)],
  });
  assert.equal(history.cashShortfallSince, undefined);
  const second = history.points.find((item) => item.date === "2026-03-03");
  assert.equal(second.cashShortfallPln, undefined);
  assert.equal(round4(second.dailyTimeWeightedReturnDecimal), -0.01);
});

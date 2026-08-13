import { round } from "@/lib/utils";
import type { PortfolioHistoryPoint } from "@/types/portfolio";

export type PortfolioDailyMetricPoint = PortfolioHistoryPoint & {
  rawValueChangePln: number;
  cashFlowNeutralResultPln: number;
};

/**
 * The existing "Najlepszy dzień" is the raw movement in portfolio value.
 * The second metric intentionally uses the change in the engine's P/L value:
 * `profitLoss = value - netInvested + adjustments`, so cash injected into a
 * portfolio cannot be presented as investment performance. It reuses the
 * same accounting semantics as the server history rather than inventing a
 * separate cash-flow formula in the UI.
 */
export const buildPortfolioDailyMetricPoints = (
  points: PortfolioHistoryPoint[]
): PortfolioDailyMetricPoint[] =>
  points.slice(1).map((point, index) => {
    const previous = points[index]!;
    return {
      ...point,
      rawValueChangePln: round(point.portfolioValuePln - previous.portfolioValuePln),
      cashFlowNeutralResultPln: round(point.profitLossPln - previous.profitLossPln),
    };
  });

export const getBestPortfolioDailyMetrics = (points: PortfolioHistoryPoint[]) => {
  const dailyPoints = buildPortfolioDailyMetricPoints(points);
  // This is deliberately the most recent raw valuation movement, not the
  // historical maximum and not the cash-flow-neutral performance result.
  // The results panel presents it as the current day-over-day readout.
  const latestRaw = dailyPoints.at(-1) ?? null;
  const bestRaw = dailyPoints.reduce<PortfolioDailyMetricPoint | null>(
    (best, point) => (!best || point.rawValueChangePln > best.rawValueChangePln ? point : best),
    null
  );
  const bestCashFlowNeutral = dailyPoints.reduce<PortfolioDailyMetricPoint | null>(
    (best, point) =>
      !best || point.cashFlowNeutralResultPln > best.cashFlowNeutralResultPln ? point : best,
    null
  );

  return { dailyPoints, latestRaw, bestRaw, bestCashFlowNeutral };
};

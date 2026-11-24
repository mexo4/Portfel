import { round } from "@/lib/utils";

/** Canonical capital-return definition shared by portfolio analytics and widgets. */
export const calculateCapitalReturnPercent = (
  profitLossPln: number,
  netInvestedPln: number
) =>
  netInvestedPln > 0 && Number.isFinite(profitLossPln) && Number.isFinite(netInvestedPln)
    ? round((profitLossPln / netInvestedPln) * 100, 2)
    : null;

/** Capital return for a selected history window, based on its P/L delta. */
export const calculatePeriodCapitalReturnPercent = (
  startProfitLossPln: number,
  endProfitLossPln: number,
  endingNetInvestedPln: number
) => Number.isFinite(startProfitLossPln) && Number.isFinite(endProfitLossPln)
  ? calculateCapitalReturnPercent(endProfitLossPln - startProfitLossPln, endingNetInvestedPln)
  : null;

/**
 * Capital rate of the analysed window: its result over the net invested capital
 * at its end. `points` are the window's history points; for a window that does
 * not start at the beginning of the history the first point is the baseline
 * that precedes it. From the inception the result is counted from zero, so the
 * first day's own result is not lost. `null` when there is no capital to relate
 * the result to.
 */
export const calculateWindowCapitalReturnPercent = (
  points: ReadonlyArray<{ profitLossPln: number; netInvestedPln: number }>,
  startsAtInception: boolean
) => {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;

  return calculatePeriodCapitalReturnPercent(
    startsAtInception ? 0 : first.profitLossPln,
    last.profitLossPln,
    last.netInvestedPln
  );
};

/** Matching percentage for the history engine's cash-flow-neutral daily result. */
export const calculateCashFlowNeutralDailyReturnPercent = (
  cashFlowNeutralResultPln: number,
  previousPortfolioValuePln: number
) =>
  previousPortfolioValuePln > 0 &&
  Number.isFinite(cashFlowNeutralResultPln) &&
  Number.isFinite(previousPortfolioValuePln)
    ? round((cashFlowNeutralResultPln / previousPortfolioValuePln) * 100, 2)
    : null;

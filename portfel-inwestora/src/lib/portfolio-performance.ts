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

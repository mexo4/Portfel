import { getCfdFigures } from "@/lib/cfd";
import { getCurrencyConversionRate, type PortfolioAssetGroup } from "@/lib/portfolio-engine";
import { round } from "@/lib/utils";
import type { FxRates } from "@/types/portfolio";

/*
 * What the list of positions shows for open CFDs. These figures are for display only: the
 * portfolio's value counts just the result of a CFD, because the margin deposit never leaves the
 * cash balance.
 */

/** The margin deposit plus the result, in the presentation currency. Null without a known deposit or price. */
export const getCfdHeldValue = (group: PortfolioAssetGroup, fxRates: FxRates) => {
  const { margin } = getCfdFigures(group.lots);
  if (margin === null || !group.hasBaseValuation) return null;
  return round(margin * getCurrencyConversionRate(group.marketCurrency, group.baseCurrency, fxRates) + group.profitLossBase);
};

/**
 * Today's price move of several CFDs, weighted by the size of their contracts and counted in each
 * position's favour. A CFD without a daily quote is left out.
 */
export const getCfdDailyPercent = (groups: PortfolioAssetGroup[], fxRates: FxRates) => {
  let change = 0;
  let before = 0;
  for (const group of groups) {
    if (!group.hasDailyChange || !group.previousClose || group.currentUnitPrice === undefined) continue;
    const size = group.quantity * group.contractMultiplier * getCurrencyConversionRate(group.marketCurrency, group.baseCurrency, fxRates);
    change += (group.currentUnitPrice - group.previousClose) * size * (group.positionDirection === "SHORT" ? -1 : 1);
    before += group.previousClose * size;
  }
  return before > 0 ? (change / before) * 100 : null;
};

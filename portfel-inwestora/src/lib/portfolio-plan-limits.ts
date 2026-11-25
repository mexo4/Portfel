import { FREE_PLAN_ASSET_LIMIT } from "@/lib/constants";
import { canAddAsset, canCreatePortfolio, type EntitlementSubject } from "@/lib/entitlements";
import { getPortfolioAssetGroupKey } from "@/lib/ticker";
import type { PortfolioBook } from "@/types/portfolio";

/**
 * Plan limits for a portfolio-book write. Only growth is limited: a user who already has more
 * portfolios or positions than the plan allows (for example after the limits changed) can still
 * edit everything, but cannot add another portfolio, or another position to a portfolio that is
 * at or over the limit. Returns the message to show, or null when the write is allowed.
 */
export const findPortfolioPlanLimitViolation = (
  subject: EntitlementSubject,
  previousBook: Pick<PortfolioBook, "portfolios">,
  nextBook: Pick<PortfolioBook, "portfolios">
): string | null => {
  const previousCount = previousBook.portfolios.length;
  if (nextBook.portfolios.length > previousCount && !canCreatePortfolio(subject, previousCount)) {
    return "Plan nie pozwala utworzyć kolejnego portfela. Istniejące dane pozostają dostępne.";
  }

  for (const nextPortfolio of nextBook.portfolios) {
    const previousPortfolio = previousBook.portfolios.find((item) => item.id === nextPortfolio.id);
    const previousAssetCount = new Set(previousPortfolio?.assets.map(getPortfolioAssetGroupKey) ?? []).size;
    const nextAssetCount = new Set(nextPortfolio.assets.map(getPortfolioAssetGroupKey)).size;
    if (nextAssetCount > previousAssetCount && !canAddAsset(subject, previousAssetCount)) {
      return `Plan Free pozwala zapisać do ${FREE_PLAN_ASSET_LIMIT} pozycji w portfelu. Istniejące dane nie zostały zmienione.`;
    }
  }

  return null;
};

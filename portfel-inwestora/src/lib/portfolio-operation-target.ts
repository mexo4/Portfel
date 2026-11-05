import type { InvestmentPortfolio } from "@/types/portfolio";

export type PortfolioOperationTargetResult =
  | { ok: true; portfolio: InvestmentPortfolio }
  | { ok: false; reason: "TARGET_REQUIRED" | "TARGET_OUT_OF_SCOPE" | "TARGET_NOT_FOUND" };

/** Resolve writes without ever falling back to the first portfolio in an aggregate scope. */
export const resolvePortfolioOperationTarget = ({
  portfolios,
  selectedPortfolioIds,
  isAggregate,
  targetPortfolioId,
  activePortfolioId,
}: {
  portfolios: InvestmentPortfolio[];
  selectedPortfolioIds: readonly string[];
  isAggregate: boolean;
  targetPortfolioId: string;
  activePortfolioId: string;
}): PortfolioOperationTargetResult => {
  const portfolioId = isAggregate ? targetPortfolioId : activePortfolioId;
  if (!portfolioId) return { ok: false, reason: "TARGET_REQUIRED" };
  if (isAggregate && !selectedPortfolioIds.includes(portfolioId)) {
    return { ok: false, reason: "TARGET_OUT_OF_SCOPE" };
  }
  const portfolio = portfolios.find((candidate) => candidate.id === portfolioId);
  return portfolio
    ? { ok: true, portfolio }
    : { ok: false, reason: "TARGET_NOT_FOUND" };
};

export const isPortfolioOperationTargetCurrent = ({
  targetPortfolioId,
  currentTargetPortfolioId,
  targetPortfolioIds,
  originalScopeKey,
  currentScopeKey,
}: {
  targetPortfolioId: string;
  currentTargetPortfolioId: string;
  targetPortfolioIds: readonly string[];
  originalScopeKey: string;
  currentScopeKey: string;
}) =>
  Boolean(targetPortfolioId) &&
  targetPortfolioId === currentTargetPortfolioId &&
  targetPortfolioIds.includes(targetPortfolioId) &&
  originalScopeKey === currentScopeKey;

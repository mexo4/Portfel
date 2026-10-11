/** Resolve an explicitly requested portfolio without silently falling back. */
export const resolveRequestedPortfolio = <T extends { id: string }>(
  portfolios: readonly T[],
  requestedId: string | null | undefined,
  defaultId: string
): T | null => {
  if (typeof requestedId === "string") {
    const explicitId = requestedId.trim();
    return explicitId ? portfolios.find((portfolio) => portfolio.id === explicitId) ?? null : null;
  }
  return portfolios.find((portfolio) => portfolio.id === defaultId) ?? portfolios[0] ?? null;
};

export const isAccountOwnedByPortfolio = (
  account: { portfolioId?: string } | null | undefined,
  portfolioId: string
) => Boolean(account && account.portfolioId === portfolioId);

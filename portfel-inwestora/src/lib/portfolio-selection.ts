/** A UI-only selector value. It is deliberately not a portfolio record ID. */
export const ALL_PORTFOLIOS_ID = "__mexo_all_portfolios__";

export const isAllPortfoliosSelection = (portfolioId: string | undefined) =>
  portfolioId === ALL_PORTFOLIOS_ID;

export const getPersistedPortfolioSelectionId = (
  selectedPortfolioId: string,
  portfolioIds: ReadonlyArray<string>,
  fallbackPortfolioId: string
) =>
  !isAllPortfoliosSelection(selectedPortfolioId) && portfolioIds.includes(selectedPortfolioId)
    ? selectedPortfolioId
    : fallbackPortfolioId;

/** Keeps virtual all-portfolios state on read routes without persisting it. */
export const getWorkspaceReadHref = (
  href: string,
  selectedPortfolioId: string,
  presentationCurrency: string
) => {
  if (!isAllPortfoliosSelection(selectedPortfolioId)) return href;

  const [path, existingQuery = ""] = href.split("?", 2);
  const params = new URLSearchParams(existingQuery);
  params.set("portfolio", "all");
  params.set("currency", presentationCurrency);
  return `${path}?${params.toString()}`;
};

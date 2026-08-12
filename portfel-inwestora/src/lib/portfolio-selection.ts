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

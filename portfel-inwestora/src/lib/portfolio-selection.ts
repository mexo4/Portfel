/** UI-only virtual selection. It is never persisted as a portfolio record. */
export const ALL_PORTFOLIOS_ID = "__mexo_all_portfolios__";
export const CUSTOM_PORTFOLIOS_ID = "__mexo_custom_portfolios__";

export type PortfolioScopeSelection =
  | { mode: "ALL" }
  | { mode: "SINGLE"; portfolioId: string }
  | { mode: "CUSTOM"; portfolioIds: string[] };

export const isAllPortfoliosSelection = (portfolioId: string | undefined) =>
  portfolioId === ALL_PORTFOLIOS_ID;

export const isCustomPortfoliosSelection = (portfolioId: string | undefined) =>
  portfolioId === CUSTOM_PORTFOLIOS_ID;

export const normalizePortfolioScope = (
  selection: PortfolioScopeSelection,
  portfolioIds: ReadonlyArray<string>
): PortfolioScopeSelection => {
  const uniquePortfolioIds = Array.from(new Set(portfolioIds.filter(Boolean)));
  if (selection.mode === "ALL") return { mode: "ALL" };
  if (selection.mode === "SINGLE") {
    return uniquePortfolioIds.includes(selection.portfolioId)
      ? selection
      : { mode: "ALL" };
  }

  const allowedIds = new Set(uniquePortfolioIds);
  const selectedIds = Array.from(new Set(selection.portfolioIds)).filter((id) =>
    allowedIds.has(id)
  );
  if (selectedIds.length === 0 || selectedIds.length === uniquePortfolioIds.length) {
    return { mode: "ALL" };
  }
  if (selectedIds.length === 1) return { mode: "SINGLE", portfolioId: selectedIds[0]! };
  return { mode: "CUSTOM", portfolioIds: selectedIds };
};

/** URL state is user-scoped by authorization: IDs are always intersected with the caller's own portfolio list. */
export const parsePortfolioScope = (
  params: Pick<URLSearchParams, "get">,
  portfolioIds: ReadonlyArray<string>
): PortfolioScopeSelection => {
  const encoded = params.get("portfolio");
  if (encoded === "all") return { mode: "ALL" };
  if (encoded === "custom") {
    return normalizePortfolioScope(
      { mode: "CUSTOM", portfolioIds: (params.get("portfolios") ?? "").split(",") },
      portfolioIds
    );
  }
  if (encoded) {
    const single = normalizePortfolioScope({ mode: "SINGLE", portfolioId: encoded }, portfolioIds);
    if (single.mode === "SINGLE") return single;
  }
  // Analytics defaults to a virtual aggregate; the active persisted portfolio
  // remains untouched and is still used by all concrete mutation endpoints.
  return { mode: "ALL" };
};

export const getPortfolioScopeIds = (
  selection: PortfolioScopeSelection,
  portfolioIds: ReadonlyArray<string>
) => {
  const normalized = normalizePortfolioScope(selection, portfolioIds);
  if (normalized.mode === "ALL") return [...portfolioIds];
  return normalized.mode === "SINGLE" ? [normalized.portfolioId] : normalized.portfolioIds;
};

/** Returns null rather than silently widening a request that contains foreign IDs. */
export const getAuthorizedPortfolioScopeIds = (
  requestedIds: ReadonlyArray<string>,
  ownedPortfolioIds: ReadonlyArray<string>,
  maxSelection = 50
): string[] | null => {
  const requested = Array.from(new Set(requestedIds.map((id) => id.trim()).filter(Boolean)));
  if (requested.length > maxSelection) return null;
  const owned = new Set(ownedPortfolioIds);
  if (requested.some((id) => !owned.has(id))) return null;
  return requested;
};

export const getPortfolioScopeLabel = (
  selection: PortfolioScopeSelection,
  portfolios: ReadonlyArray<{ id: string; name: string }>
) => {
  const normalized = normalizePortfolioScope(selection, portfolios.map(({ id }) => id));
  if (normalized.mode === "ALL") return "Wszystkie portfele";
  if (normalized.mode === "SINGLE") {
    return portfolios.find(({ id }) => id === normalized.portfolioId)?.name ?? "Portfel";
  }
  return `${normalized.portfolioIds.length} portfeli`;
};

export const getPersistedPortfolioSelectionId = (
  selectedPortfolioId: string,
  portfolioIds: ReadonlyArray<string>,
  fallbackPortfolioId: string
) =>
  !isAllPortfoliosSelection(selectedPortfolioId) &&
  !isCustomPortfoliosSelection(selectedPortfolioId) &&
  portfolioIds.includes(selectedPortfolioId)
    ? selectedPortfolioId
    : fallbackPortfolioId;

/** Serializes one global scope to every read-route URL without touching activePortfolioId. */
export const getWorkspaceReadHref = (
  href: string,
  selectedPortfolioId: string,
  presentationCurrency: string,
  selection?: PortfolioScopeSelection
) => {
  const normalized = selection ?? (isAllPortfoliosSelection(selectedPortfolioId)
    ? { mode: "ALL" as const }
    : isCustomPortfoliosSelection(selectedPortfolioId)
      ? { mode: "ALL" as const }
      : null);
  if (!normalized) return href;

  const [path, existingQuery = ""] = href.split("?", 2);
  const params = new URLSearchParams(existingQuery);
  params.delete("portfolios");

  if (normalized.mode === "ALL") {
    params.set("portfolio", "all");
    params.set("currency", presentationCurrency);
  } else if (normalized.mode === "SINGLE") {
    params.set("portfolio", normalized.portfolioId);
    params.delete("currency");
  } else {
    params.set("portfolio", "custom");
    params.set("portfolios", normalized.portfolioIds.join(","));
    params.set("currency", presentationCurrency);
  }

  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
};

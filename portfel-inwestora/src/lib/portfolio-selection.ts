/** UI-only virtual selection. It is never persisted as a portfolio record. */
export const ALL_PORTFOLIOS_ID = "__mexo_all_portfolios__";
export const CUSTOM_PORTFOLIOS_ID = "__mexo_custom_portfolios__";

export type PortfolioScopeSelection =
  | { mode: "ALL" }
  | { mode: "SINGLE"; portfolioId: string }
  | { mode: "CUSTOM"; portfolioIds: string[] };

export type PortfolioScopeSyncAction = "WAIT" | "ACKNOWLEDGE" | "APPLY_URL_SCOPE" | "NOOP";

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

/** Scope equality is semantic: CUSTOM selections compare by IDs, not checkbox order. */
export const arePortfolioScopesEqual = (
  left: PortfolioScopeSelection,
  right: PortfolioScopeSelection,
  portfolioIds: ReadonlyArray<string>
) => {
  const normalizedLeft = normalizePortfolioScope(left, portfolioIds);
  const normalizedRight = normalizePortfolioScope(right, portfolioIds);
  if (normalizedLeft.mode !== normalizedRight.mode) return false;
  if (normalizedLeft.mode === "ALL" && normalizedRight.mode === "ALL") return true;
  if (normalizedLeft.mode === "SINGLE" && normalizedRight.mode === "SINGLE") {
    return normalizedLeft.portfolioId === normalizedRight.portfolioId;
  }
  if (normalizedLeft.mode !== "CUSTOM" || normalizedRight.mode !== "CUSTOM") return false;
  const leftIds = [...normalizedLeft.portfolioIds].sort();
  const rightIds = [...normalizedRight.portfolioIds].sort();
  return leftIds.length === rightIds.length && leftIds.every((id, index) => id === rightIds[index]);
};

/**
 * Resolves the active real portfolio after a stale-write conflict without
 * allowing the server's older activePortfolioId to override the route the
 * user is currently viewing. The saved server book itself remains authoritative.
 */
export const getPreferredActivePortfolioId = (
  scope: PortfolioScopeSelection,
  currentActivePortfolioId: string,
  portfolioIds: ReadonlyArray<string>
) => {
  if (scope.mode === "SINGLE" && portfolioIds.includes(scope.portfolioId)) {
    return scope.portfolioId;
  }
  if (portfolioIds.includes(currentActivePortfolioId)) return currentActivePortfolioId;
  return portfolioIds[0] ?? "";
};

/**
 * Prevents the URL -> active-book sync effect from interpreting an in-flight
 * app-initiated navigation's old URL as a new user selection. A URL change to
 * somewhere other than the pending target is treated as external navigation.
 */
export const getPortfolioScopeSyncAction = ({
  urlScope,
  lastObservedUrlScope,
  pendingScope,
  activePortfolioId,
  isMutationPending,
  portfolioIds,
}: {
  urlScope: PortfolioScopeSelection;
  lastObservedUrlScope: PortfolioScopeSelection;
  pendingScope: PortfolioScopeSelection | null;
  activePortfolioId: string;
  isMutationPending: boolean;
  portfolioIds: ReadonlyArray<string>;
}): PortfolioScopeSyncAction => {
  if (isMutationPending) return "WAIT";

  if (pendingScope) {
    if (arePortfolioScopesEqual(urlScope, pendingScope, portfolioIds)) return "ACKNOWLEDGE";
    if (arePortfolioScopesEqual(urlScope, lastObservedUrlScope, portfolioIds)) return "WAIT";
    return "APPLY_URL_SCOPE";
  }

  return urlScope.mode === "SINGLE" && urlScope.portfolioId !== activePortfolioId
    ? "APPLY_URL_SCOPE"
    : "NOOP";
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
    params.set("currency", presentationCurrency);
  } else {
    params.set("portfolio", "custom");
    params.set("portfolios", normalized.portfolioIds.join(","));
    params.set("currency", presentationCurrency);
  }

  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
};

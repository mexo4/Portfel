import { isDashboardScopeKey } from "@/lib/dashboard-layout";

export const getAuthorizedDashboardScope = (
  request: Request,
  portfolioIds: Set<string>
) => {
  const scopeKey = new URL(request.url).searchParams.get("scope") ?? "all";
  if (!isDashboardScopeKey(scopeKey)) return null;
  if (scopeKey === "all") return scopeKey;
  if (scopeKey.startsWith("portfolios:")) {
    const selectedIds = scopeKey.slice("portfolios:".length).split(",");
    return selectedIds.length >= 2 && selectedIds.every((id) => portfolioIds.has(id))
      ? scopeKey
      : null;
  }
  return portfolioIds.has(scopeKey.slice("portfolio:".length)) ? scopeKey : null;
};

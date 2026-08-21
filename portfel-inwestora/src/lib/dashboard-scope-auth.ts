import { isDashboardScopeKey } from "@/lib/dashboard-layout";

export const getAuthorizedDashboardScope = (
  request: Request,
  portfolioIds: Set<string>
) => {
  const scopeKey = new URL(request.url).searchParams.get("scope") ?? "all";
  if (!isDashboardScopeKey(scopeKey)) return null;
  if (scopeKey === "all") return scopeKey;
  return portfolioIds.has(scopeKey.slice("portfolio:".length)) ? scopeKey : null;
};

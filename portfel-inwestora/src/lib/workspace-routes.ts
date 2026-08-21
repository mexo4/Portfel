export type WorkspaceRouteKey =
  | "dashboard"
  | "positions"
  | "operations"
  | "dividends"
  | "import"
  | "performance"
  | "charts"
  | "structure"
  | "instruments"
  | "watchlist"
  | "events"
  | "portfolios"
  | "wealth"
  | "settings";

/** Maps public workspace URLs without sharing state between unrelated pages. */
export const getWorkspaceRoute = (pathname: string | null): WorkspaceRouteKey => {
  if (!pathname || pathname === "/" || pathname === "/app") return "dashboard";
  if (pathname.startsWith("/portfolio/positions")) return "positions";
  if (pathname.startsWith("/portfolio/operations")) return "operations";
  if (pathname.startsWith("/portfolio/dividends")) return "dividends";
  if (pathname.startsWith("/portfolio/import")) return "import";
  if (pathname.startsWith("/analytics/performance")) return "performance";
  if (pathname.startsWith("/analytics/charts")) return "charts";
  if (pathname.startsWith("/analytics/structure")) return "structure";
  if (pathname.startsWith("/analytics/benchmarks")) return "charts";
  if (pathname.startsWith("/market/instruments")) return "instruments";
  if (pathname.startsWith("/market/watchlist")) return "watchlist";
  if (pathname.startsWith("/market/events")) return "events";
  if (pathname.startsWith("/portfolios")) return "portfolios";
  if (pathname.startsWith("/wealth")) return "wealth";
  if (pathname.startsWith("/settings")) return "settings";
  return "dashboard";
};

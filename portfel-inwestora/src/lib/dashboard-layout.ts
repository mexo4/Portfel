export const DASHBOARD_LAYOUT_VERSION = 1 as const;

export const DASHBOARD_WIDGET_IDS = [
  "portfolio-state", "portfolio-value", "profit-loss", "return-rate", "daily-result",
  "invested-capital", "cash", "dividends-ytd", "portfolio-chart", "portfolio-result-chart",
  "portfolio-vs-benchmark", "daily-result-chart", "daily-snapshot", "portfolio-structure",
  "geographic-structure", "asset-class-structure", "concentration", "largest-positions",
  "biggest-gains", "biggest-losses", "current-positions", "recently-added",
  "recent-operations", "recent-cash-flows", "recent-dividends", "upcoming-dividends",
  "gpw-events", "upcoming-timeline", "watchlist", "watchlist-events", "watchlist-daily-changes",
] as const;

export const DASHBOARD_WIDGET_SIZES = ["small", "medium", "large", "full"] as const;
export const DASHBOARD_DEVICES = ["desktop", "mobile"] as const;
export const DASHBOARD_PRESET_IDS = ["default", "minimal", "analytical", "dividend"] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];
export type DashboardWidgetSize = (typeof DASHBOARD_WIDGET_SIZES)[number];
export type DashboardDevice = (typeof DASHBOARD_DEVICES)[number];
export type DashboardPresetId = (typeof DASHBOARD_PRESET_IDS)[number];
export type DashboardWidgetCategory = "summary" | "charts" | "portfolio" | "activity" | "calendar";

export type DashboardWidgetDefinition = {
  id: DashboardWidgetId;
  category: DashboardWidgetCategory;
  label: string;
  description: string;
  sizes: readonly DashboardWidgetSize[];
  defaultSize: DashboardWidgetSize;
};

export type DashboardWidgetLayout = { id: DashboardWidgetId; size: DashboardWidgetSize };
export type DashboardLayout = { version: typeof DASHBOARD_LAYOUT_VERSION; widgets: DashboardWidgetLayout[] };
export type DashboardScopeLayouts = { desktop: DashboardLayout; mobile: DashboardLayout };

const widget = (
  id: DashboardWidgetId,
  category: DashboardWidgetCategory,
  label: string,
  description: string,
  sizes: readonly DashboardWidgetSize[],
  defaultSize: DashboardWidgetSize
): DashboardWidgetDefinition => ({ id, category, label, description, sizes, defaultSize });

export const DASHBOARD_WIDGET_DEFINITIONS: readonly DashboardWidgetDefinition[] = [
  widget("portfolio-state", "summary", "Stan portfela", "Wartość, wynik, zwrot i ostatni wynik dzienny w jednym skrócie.", ["medium", "large", "full"], "full"),
  widget("portfolio-value", "summary", "Wartość", "Bieżąca wartość portfela.", ["small", "medium"], "small"),
  widget("profit-loss", "summary", "Zysk / strata", "Łączny wynik portfela.", ["small", "medium"], "small"),
  widget("return-rate", "summary", "Stopa zwrotu", "Stopa zwrotu względem zainwestowanego kapitału.", ["small", "medium"], "small"),
  widget("daily-result", "summary", "Wynik dzienny", "Najnowszy wynik neutralny względem wpłat i wypłat.", ["small", "medium"], "small"),
  widget("invested-capital", "summary", "Zainwestowany kapitał", "Kapitał pracujący w wybranym zakresie.", ["small", "medium"], "small"),
  widget("cash", "summary", "Gotówka", "Saldo gotówki z istniejącego silnika portfela.", ["small", "medium"], "small"),
  widget("dividends-ytd", "summary", "Dywidendy YTD", "Otrzymane dywidendy w bieżącym roku.", ["small", "medium"], "small"),
  widget("portfolio-chart", "charts", "Wartość portfela", "Kompaktowy podgląd historii wartości.", ["large", "full"], "full"),
  widget("portfolio-result-chart", "charts", "Wynik portfela", "Kompaktowy podgląd historii wyniku.", ["large", "full"], "large"),
  widget("portfolio-vs-benchmark", "charts", "Portfel vs benchmark", "Porównanie z zapisanym benchmarkiem portfela.", ["large", "full"], "full"),
  widget("daily-result-chart", "charts", "Wynik dzienny", "Dzienny wynik inwestycyjny bez przepływów kapitału.", ["large", "full"], "large"),
  widget("daily-snapshot", "summary", "Co się zmieniło?", "Dzisiejsza zmiana, wynik i skrajne pozycje.", ["medium", "large", "full"], "large"),
  widget("portfolio-structure", "portfolio", "Struktura portfela", "Najważniejsze klasy aktywów.", ["medium", "large"], "medium"),
  widget("geographic-structure", "portfolio", "Struktura geograficzna", "Potwierdzona ekspozycja geograficzna akcji.", ["medium", "large"], "medium"),
  widget("asset-class-structure", "portfolio", "Struktura klas aktywów", "Udział klas aktywów i rynków akcji.", ["medium", "large"], "medium"),
  widget("concentration", "portfolio", "Koncentracja", "Top 1, Top 3 i dominujące ekspozycje.", ["medium", "large"], "medium"),
  widget("largest-positions", "portfolio", "Największe pozycje", "Największe udziały w portfelu.", ["medium", "large"], "medium"),
  widget("biggest-gains", "portfolio", "Najwięksi wygrani", "Pozycje z najwyższym bieżącym P/L.", ["medium", "large"], "medium"),
  widget("biggest-losses", "portfolio", "Najwięksi przegrani", "Pozycje z najniższym bieżącym P/L.", ["medium", "large"], "medium"),
  widget("current-positions", "portfolio", "Bieżące pozycje", "Skrócona lista otwartych pozycji.", ["large", "full"], "large"),
  widget("recently-added", "portfolio", "Ostatnio dodane pozycje", "Najnowsze otwarte pozycje.", ["medium", "large"], "medium"),
  widget("recent-operations", "activity", "Ostatnie operacje", "Najnowsze wpisy w historii.", ["medium", "large", "full"], "medium"),
  widget("recent-cash-flows", "activity", "Ostatnie wpłaty i wypłaty", "Najnowsze przepływy gotówkowe.", ["medium", "large"], "medium"),
  widget("recent-dividends", "activity", "Ostatnie dywidendy", "Ostatnio zaksięgowane wypłaty.", ["medium", "large"], "medium"),
  widget("upcoming-dividends", "calendar", "Nadchodzące dywidendy", "Najbliższe oficjalne wydarzenia dywidendowe.", ["medium", "large", "full"], "medium"),
  widget("gpw-events", "calendar", "Wydarzenia GPW", "Najbliższe potwierdzone raporty.", ["medium", "large", "full"], "medium"),
  widget("upcoming-timeline", "calendar", "Nadchodzące", "Wspólna, deduplikowana oś raportów i dywidend.", ["medium", "large", "full"], "large"),
  widget("watchlist", "calendar", "Watchlista", "Obserwowane spółki i dostępne kursy.", ["medium", "large"], "medium"),
  widget("watchlist-events", "calendar", "Najbliższe wydarzenia obserwowanych", "Wydarzenia spółek dodanych do obserwowanych.", ["medium", "large"], "medium"),
  widget("watchlist-daily-changes", "calendar", "Dzisiejsze zmiany obserwowanych", "Zmiany tylko wtedy, gdy istniejący snapshot je dostarcza.", ["medium", "large"], "medium"),
] as const;

const definitionsById = new Map(DASHBOARD_WIDGET_DEFINITIONS.map((definition) => [definition.id, definition]));
export const getDashboardWidgetDefinition = (id: string) => definitionsById.get(id as DashboardWidgetId);

const makeLayout = (widgets: DashboardWidgetLayout[]): DashboardLayout => ({ version: DASHBOARD_LAYOUT_VERSION, widgets });

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = makeLayout([
  { id: "portfolio-state", size: "full" }, { id: "portfolio-chart", size: "full" },
  { id: "daily-snapshot", size: "large" }, { id: "largest-positions", size: "medium" },
  { id: "upcoming-timeline", size: "large" }, { id: "biggest-gains", size: "medium" },
  { id: "biggest-losses", size: "medium" }, { id: "dividends-ytd", size: "small" },
  { id: "portfolio-structure", size: "medium" }, { id: "recent-operations", size: "medium" },
]);

export const DEFAULT_MOBILE_DASHBOARD_LAYOUT: DashboardLayout = makeLayout([
  { id: "portfolio-state", size: "full" }, { id: "portfolio-chart", size: "full" },
  { id: "daily-snapshot", size: "large" }, { id: "upcoming-timeline", size: "large" },
  { id: "largest-positions", size: "medium" }, { id: "biggest-gains", size: "medium" },
  { id: "biggest-losses", size: "medium" }, { id: "dividends-ytd", size: "small" },
  { id: "portfolio-structure", size: "medium" }, { id: "recent-operations", size: "medium" },
]);

export const DEFAULT_DASHBOARD_SCOPE_LAYOUTS: DashboardScopeLayouts = {
  desktop: DEFAULT_DASHBOARD_LAYOUT,
  mobile: DEFAULT_MOBILE_DASHBOARD_LAYOUT,
};

const PRESET_LAYOUTS: Record<DashboardPresetId, DashboardScopeLayouts> = {
  default: DEFAULT_DASHBOARD_SCOPE_LAYOUTS,
  minimal: {
    desktop: makeLayout([{ id: "portfolio-state", size: "full" }, { id: "portfolio-chart", size: "full" }, { id: "upcoming-timeline", size: "large" }]),
    mobile: makeLayout([{ id: "portfolio-state", size: "full" }, { id: "portfolio-chart", size: "full" }, { id: "upcoming-timeline", size: "large" }]),
  },
  analytical: {
    desktop: makeLayout([
      { id: "portfolio-state", size: "full" }, { id: "portfolio-chart", size: "full" },
      { id: "portfolio-result-chart", size: "large" }, { id: "portfolio-vs-benchmark", size: "full" },
      { id: "concentration", size: "medium" }, { id: "geographic-structure", size: "medium" },
      { id: "asset-class-structure", size: "medium" }, { id: "biggest-gains", size: "medium" },
      { id: "biggest-losses", size: "medium" },
    ]),
    mobile: makeLayout([
      { id: "portfolio-state", size: "full" }, { id: "portfolio-chart", size: "full" },
      { id: "portfolio-result-chart", size: "large" }, { id: "portfolio-vs-benchmark", size: "full" },
      { id: "concentration", size: "medium" }, { id: "asset-class-structure", size: "medium" },
      { id: "geographic-structure", size: "medium" }, { id: "biggest-gains", size: "medium" },
      { id: "biggest-losses", size: "medium" },
    ]),
  },
  dividend: {
    desktop: makeLayout([
      { id: "dividends-ytd", size: "small" }, { id: "upcoming-dividends", size: "large" },
      { id: "upcoming-timeline", size: "large" }, { id: "recent-dividends", size: "medium" },
      { id: "recent-operations", size: "medium" },
    ]),
    mobile: makeLayout([
      { id: "dividends-ytd", size: "small" }, { id: "upcoming-dividends", size: "large" },
      { id: "upcoming-timeline", size: "large" }, { id: "recent-dividends", size: "medium" },
      { id: "recent-operations", size: "medium" },
    ]),
  },
};

const cloneLayout = (value: DashboardLayout): DashboardLayout => ({
  version: DASHBOARD_LAYOUT_VERSION,
  widgets: value.widgets.map((item) => ({ ...item })),
});

export const getDashboardPresetLayouts = (preset: DashboardPresetId): DashboardScopeLayouts => ({
  desktop: cloneLayout(PRESET_LAYOUTS[preset].desktop), mobile: cloneLayout(PRESET_LAYOUTS[preset].mobile),
});

const isDashboardWidgetSize = (value: unknown): value is DashboardWidgetSize =>
  typeof value === "string" && DASHBOARD_WIDGET_SIZES.includes(value as DashboardWidgetSize);

export const normalizeDashboardLayout = (value: unknown, fallback: DashboardLayout = DEFAULT_DASHBOARD_LAYOUT): DashboardLayout => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return cloneLayout(fallback);
  const raw = value as { version?: unknown; widgets?: unknown };
  if (raw.version !== DASHBOARD_LAYOUT_VERSION || !Array.isArray(raw.widgets)) return cloneLayout(fallback);
  const seen = new Set<DashboardWidgetId>();
  const widgets: DashboardWidgetLayout[] = [];
  for (const entry of raw.widgets.slice(0, DASHBOARD_WIDGET_IDS.length)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const candidate = entry as { id?: unknown; size?: unknown };
    const definition = typeof candidate.id === "string" ? getDashboardWidgetDefinition(candidate.id) : undefined;
    if (!definition || seen.has(definition.id)) continue;
    seen.add(definition.id);
    widgets.push({
      id: definition.id,
      size: isDashboardWidgetSize(candidate.size) && definition.sizes.includes(candidate.size)
        ? candidate.size : definition.defaultSize,
    });
  }
  if (raw.widgets.length > 0 && widgets.length === 0) return cloneLayout(fallback);
  return { version: DASHBOARD_LAYOUT_VERSION, widgets };
};

export const normalizeDashboardScopeLayouts = (value: unknown): DashboardScopeLayouts => {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<DashboardScopeLayouts> : {};
  return {
    desktop: normalizeDashboardLayout(raw.desktop, DEFAULT_DASHBOARD_LAYOUT),
    mobile: normalizeDashboardLayout(raw.mobile, DEFAULT_MOBILE_DASHBOARD_LAYOUT),
  };
};

export const dashboardLayoutsEqual = (left: DashboardLayout, right: DashboardLayout) =>
  left.version === right.version && left.widgets.length === right.widgets.length &&
  left.widgets.every((item, index) => item.id === right.widgets[index]?.id && item.size === right.widgets[index]?.size);

export const dashboardScopeLayoutsEqual = (left: DashboardScopeLayouts, right: DashboardScopeLayouts) =>
  dashboardLayoutsEqual(left.desktop, right.desktop) && dashboardLayoutsEqual(left.mobile, right.mobile);

export const getDashboardScopeKey = (portfolioId: string, isAll: boolean) =>
  isAll ? "all" : `portfolio:${portfolioId}`;

export const isDashboardScopeKey = (value: string) => value === "all" || /^portfolio:[^:]+$/.test(value);

export const DASHBOARD_LAYOUT_VERSION = 1 as const;

export const DASHBOARD_WIDGET_IDS = [
  "portfolio-value",
  "profit-loss",
  "return-rate",
  "dividends-ytd",
  "portfolio-chart",
  "portfolio-vs-benchmark",
  "current-positions",
  "biggest-gains",
  "biggest-losses",
  "portfolio-structure",
  "recent-operations",
  "gpw-events",
  "upcoming-dividends",
] as const;

export const DASHBOARD_WIDGET_SIZES = ["small", "medium", "large", "full"] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];
export type DashboardWidgetSize = (typeof DASHBOARD_WIDGET_SIZES)[number];
export type DashboardWidgetCategory =
  | "summary"
  | "charts"
  | "portfolio"
  | "calendar";

export type DashboardWidgetDefinition = {
  id: DashboardWidgetId;
  category: DashboardWidgetCategory;
  label: string;
  description: string;
  sizes: readonly DashboardWidgetSize[];
  defaultSize: DashboardWidgetSize;
};

export type DashboardWidgetLayout = {
  id: DashboardWidgetId;
  size: DashboardWidgetSize;
};

export type DashboardLayout = {
  version: typeof DASHBOARD_LAYOUT_VERSION;
  widgets: DashboardWidgetLayout[];
};

export const DASHBOARD_WIDGET_DEFINITIONS: readonly DashboardWidgetDefinition[] = [
  {
    id: "portfolio-value",
    category: "summary",
    label: "Wartość portfela",
    description: "Bieżąca wartość w walucie portfela.",
    sizes: ["small", "medium"],
    defaultSize: "small",
  },
  {
    id: "profit-loss",
    category: "summary",
    label: "P/L",
    description: "Łączny wynik portfela.",
    sizes: ["small", "medium"],
    defaultSize: "small",
  },
  {
    id: "return-rate",
    category: "summary",
    label: "Stopa zwrotu",
    description: "Istniejący widok historii stopy zwrotu portfela.",
    sizes: ["large", "full"],
    defaultSize: "large",
  },
  {
    id: "dividends-ytd",
    category: "summary",
    label: "Dywidendy YTD",
    description: "Otrzymane dywidendy w bieżącym roku.",
    sizes: ["small", "medium"],
    defaultSize: "small",
  },
  {
    id: "portfolio-chart",
    category: "charts",
    label: "Wykres portfela",
    description: "Wartość, zwrot i pozostałe perspektywy historii.",
    sizes: ["large", "full"],
    defaultSize: "full",
  },
  {
    id: "portfolio-vs-benchmark",
    category: "charts",
    label: "Portfel vs benchmark",
    description: "Porównanie wyników do wybranego benchmarku.",
    sizes: ["large", "full"],
    defaultSize: "full",
  },
  {
    id: "current-positions",
    category: "portfolio",
    label: "Bieżące pozycje",
    description: "Najważniejsze pozycje z bieżącego widoku portfela.",
    sizes: ["medium", "large", "full"],
    defaultSize: "large",
  },
  {
    id: "biggest-gains",
    category: "portfolio",
    label: "Największe wzrosty",
    description: "Pozycje o najwyższym bieżącym wyniku.",
    sizes: ["medium", "large"],
    defaultSize: "medium",
  },
  {
    id: "biggest-losses",
    category: "portfolio",
    label: "Największe spadki",
    description: "Pozycje o najniższym bieżącym wyniku.",
    sizes: ["medium", "large"],
    defaultSize: "medium",
  },
  {
    id: "portfolio-structure",
    category: "portfolio",
    label: "Struktura portfela",
    description: "Udział klas aktywów w portfelu.",
    sizes: ["medium", "large"],
    defaultSize: "medium",
  },
  {
    id: "recent-operations",
    category: "portfolio",
    label: "Ostatnie operacje",
    description: "Najnowsze zapisy w historii portfela.",
    sizes: ["medium", "large", "full"],
    defaultSize: "medium",
  },
  {
    id: "gpw-events",
    category: "calendar",
    label: "Wydarzenia GPW",
    description: "Najbliższe potwierdzone terminy raportów.",
    sizes: ["medium", "large", "full"],
    defaultSize: "medium",
  },
  {
    id: "upcoming-dividends",
    category: "calendar",
    label: "Nadchodzące dywidendy",
    description: "Potwierdzone przyszłe dywidendy posiadanych spółek GPW.",
    sizes: ["medium", "large", "full"],
    defaultSize: "medium",
  },
] as const;

const definitionsById = new Map(
  DASHBOARD_WIDGET_DEFINITIONS.map((definition) => [definition.id, definition])
);

export const getDashboardWidgetDefinition = (id: string) =>
  definitionsById.get(id as DashboardWidgetId);

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  version: DASHBOARD_LAYOUT_VERSION,
  widgets: [
    { id: "portfolio-value", size: "small" },
    { id: "profit-loss", size: "small" },
    { id: "return-rate", size: "large" },
    { id: "dividends-ytd", size: "small" },
    { id: "portfolio-chart", size: "full" },
    { id: "current-positions", size: "large" },
    { id: "portfolio-structure", size: "medium" },
    { id: "gpw-events", size: "medium" },
  ],
};

const cloneDefaultDashboardLayout = (): DashboardLayout => ({
  version: DASHBOARD_LAYOUT_VERSION,
  widgets: DEFAULT_DASHBOARD_LAYOUT.widgets.map((widget) => ({ ...widget })),
});

const isDashboardWidgetSize = (value: unknown): value is DashboardWidgetSize =>
  typeof value === "string" && DASHBOARD_WIDGET_SIZES.includes(value as DashboardWidgetSize);

/**
 * Layouts deliberately contain only widget IDs and presentation sizes. This
 * normalizer is used by both API boundaries and the client before rendering.
 */
export const normalizeDashboardLayout = (value: unknown): DashboardLayout => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return cloneDefaultDashboardLayout();
  }

  const rawLayout = value as { version?: unknown; widgets?: unknown };
  if (rawLayout.version !== DASHBOARD_LAYOUT_VERSION || !Array.isArray(rawLayout.widgets)) {
    return cloneDefaultDashboardLayout();
  }

  const seen = new Set<DashboardWidgetId>();
  const widgets: DashboardWidgetLayout[] = [];

  for (const rawWidget of rawLayout.widgets.slice(0, DASHBOARD_WIDGET_IDS.length)) {
    if (!rawWidget || typeof rawWidget !== "object" || Array.isArray(rawWidget)) {
      continue;
    }

    const candidate = rawWidget as { id?: unknown; size?: unknown };
    const definition =
      typeof candidate.id === "string" ? getDashboardWidgetDefinition(candidate.id) : undefined;

    if (!definition || seen.has(definition.id)) {
      continue;
    }

    seen.add(definition.id);
    widgets.push({
      id: definition.id,
      size:
        isDashboardWidgetSize(candidate.size) && definition.sizes.includes(candidate.size)
          ? candidate.size
          : definition.defaultSize,
    });
  }

  // An explicit empty array is a valid intentional layout. A non-empty stale
  // payload that contains no known widgets is instead reset to the default.
  if (rawLayout.widgets.length > 0 && widgets.length === 0) {
    return cloneDefaultDashboardLayout();
  }

  return { version: DASHBOARD_LAYOUT_VERSION, widgets };
};

export const dashboardLayoutsEqual = (left: DashboardLayout, right: DashboardLayout) =>
  left.version === right.version &&
  left.widgets.length === right.widgets.length &&
  left.widgets.every(
    (widget, index) =>
      widget.id === right.widgets[index]?.id && widget.size === right.widgets[index]?.size
  );

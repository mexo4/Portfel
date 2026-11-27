import type { WorkspaceRouteKey } from "@/lib/workspace-routes";

/**
 * Pages that hold several functions show one at a time, each on a tab of its own with its own
 * address (`?widok=`). This list drives the tab row, the "Przejdź do" search and the pages.
 */

export type PageView = { id: string; label: string; keywords?: string };

export const PAGE_VIEW_PARAM = "widok";

export const PAGE_VIEWS = {
  performance: [
    { id: "podsumowanie", label: "Podsumowanie", keywords: "wartość wynik xirr cagr" },
    { id: "zrodla", label: "Skąd wynik", keywords: "kaskada źródła zysku waluty prowizje podatki" },
    { id: "okresy", label: "Okresy", keywords: "miesięczne roczne najlepszy najgorszy dzień" },
    { id: "ryzyko", label: "Ryzyko", keywords: "obsunięcie zmienność sharpe beta benchmark" },
  ],
  structure: [
    { id: "sklad", label: "Skład", keywords: "klasy aktywów kraje koncentracja" },
    { id: "w-czasie", label: "W czasie", keywords: "struktura w czasie udział portfeli" },
    { id: "waluty", label: "Waluty", keywords: "ekspozycja walutowa etf" },
  ],
  closed: [
    { id: "podsumowanie", label: "Podsumowanie", keywords: "zamknięte fifo skuteczność" },
    { id: "kalendarz", label: "Kalendarz zamknięć", keywords: "kalendarz dzienny sprzedaży" },
  ],
  reports: [
    { id: "typy", label: "Zysk według typu i konta" },
    { id: "konta", label: "Walory na kontach" },
    { id: "mapa", label: "Mapa cieplna", keywords: "heatmapa" },
    { id: "okresy", label: "Plusy i minusy", keywords: "zmienność stopy zwrotu" },
  ],
  assetCharts: [
    { id: "wykres", label: "Wykres waloru", keywords: "świece dywidendy espi" },
    { id: "okresy", label: "Zwroty w okresach", keywords: "7 dni 30 dni rok zmiana kursu" },
    { id: "porownanie", label: "Porównanie walorów" },
  ],
  dividends: [
    { id: "dochod", label: "Dochód", keywords: "wypłaty miesiąc po miesiącu" },
    { id: "nadchodzace", label: "Nadchodzące", keywords: "kalendarz dywidend" },
    { id: "dodaj", label: "Dodaj dywidendę" },
    { id: "historia", label: "Historia wypłat" },
  ],
  wealth: [
    { id: "pulpit", label: "Pulpit majątku" },
    { id: "lista", label: "Aktywa i pasywa", keywords: "dodaj aktywo kredyt lokata nieruchomość" },
    { id: "w-czasie", label: "W czasie" },
  ],
} as const satisfies Partial<Record<WorkspaceRouteKey, readonly PageView[]>>;

export type ViewedRoute = keyof typeof PAGE_VIEWS;
export type PageViewId<Route extends ViewedRoute> = (typeof PAGE_VIEWS)[Route][number]["id"];

export const getPageViews = (route: WorkspaceRouteKey): readonly PageView[] =>
  (PAGE_VIEWS as Partial<Record<WorkspaceRouteKey, readonly PageView[]>>)[route] ?? [];

/**
 * The view shown when the address names none: the first tab, except that a link prefilled with a
 * holding ("Dywidenda" next to a position) opens the dividend form.
 */
export const getDefaultView = (route: WorkspaceRouteKey, params: { has: (name: string) => boolean }) =>
  route === "dividends" && params.has("walor") ? "dodaj" : getPageViews(route)[0]?.id;

/** The requested view if the page has it, else its default for this address. */
export const resolvePageView = <Route extends ViewedRoute>(route: Route, params: { get: (name: string) => string | null; has: (name: string) => boolean }): PageViewId<Route> => {
  const requested = params.get(PAGE_VIEW_PARAM);
  const found = getPageViews(route).find((view) => view.id === requested)?.id ?? getDefaultView(route, params);
  return found as PageViewId<Route>;
};

/** `href` pointing at one view of a page; the default view needs no parameter. */
export const withPageView = (href: string, route: WorkspaceRouteKey, viewId: string) => {
  const [path, query = ""] = href.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete(PAGE_VIEW_PARAM);
  if (getDefaultView(route, params) !== viewId) params.set(PAGE_VIEW_PARAM, viewId);
  const text = params.toString();
  return text ? `${path}?${text}` : path!;
};

"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { getWorkspaceRoute, type WorkspaceRouteKey } from "@/lib/workspace-routes";
import { ALL_PORTFOLIOS_ID, getWorkspaceReadHref, isAllPortfoliosSelection } from "@/lib/portfolio-selection";
import { PORTFOLIO_ACCOUNT_TYPE_LABELS, normalizePortfolioAccountType } from "@/lib/portfolio-account-rules";
import type { AuthenticatedUser, CurrencyCode, InvestmentPortfolio } from "@/types/portfolio";
import { MEXO_TESTER_MODE } from "@/lib/constants";

export type { WorkspaceRouteKey } from "@/lib/workspace-routes";

type AppWorkspaceShellProps = {
  account: AuthenticatedUser;
  portfolios: InvestmentPortfolio[];
  selectedPortfolioId: string;
  activeBaseCurrency: CurrencyCode;
  isPortfolioMutationPending: boolean;
  isLoggingOut: boolean;
  isAdmin: boolean;
  onPortfolioChange: (portfolioId: string) => void;
  onBaseCurrencyChange: (currency: string) => void;
  onQuickAdd: () => void;
  onLogout: () => void;
  children: ReactNode;
};

type WorkspaceIconName =
  | "dashboard"
  | "portfolios"
  | "wealth"
  | "positions"
  | "operations"
  | "dividends"
  | "import"
  | "performance"
  | "charts"
  | "structure"
  | "instruments"
  | "watchlist"
  | "espi"
  | "events"
  | "settings"
  | "admin"
  | "search"
  | "plus"
  | "more";

const WORKSPACE_ICON_DRAWINGS: Record<WorkspaceIconName, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  portfolios: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M8 6V4h8v2M3 11h18" /></>,
  wealth: <><path d="M4 19V9l8-5 8 5v10" /><path d="M8 19v-6h8v6M2 20h20" /></>,
  positions: <><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="7" cy="7" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="17" cy="17" r="1" /></>,
  operations: <><path d="M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4" /></>,
  dividends: <><circle cx="12" cy="12" r="8" /><path d="M9 9.5c0-1 1.2-1.8 3-1.8s3 .8 3 1.8-1 1.6-3 2-3 1-3 2 1.2 1.8 3 1.8 3-.8 3-1.8M12 6v12" /></>,
  import: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 18v3h16v-3" /></>,
  performance: <><path d="M4 18V9M10 18V5M16 18v-7M22 18V3" /></>,
  charts: <><path d="M3 18l5-6 4 3 7-9" /><path d="M16 6h3v3" /></>,
  structure: <><circle cx="12" cy="12" r="3" /><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /></>,
  instruments: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  watchlist: <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" />,
  espi: <><path d="M6 3h9l4 4v14H6z" /><path d="M15 3v5h4M9 12h6M9 16h6" /></>,
  events: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  admin: <><path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6z" /><path d="m9 12 2 2 4-4" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
};

export function WorkspaceIcon({ name }: { name: WorkspaceIconName }) {
  return <svg aria-hidden="true" className="workspace-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{WORKSPACE_ICON_DRAWINGS[name]}</svg>;
}

type NavigationItem = { key: WorkspaceRouteKey; href: string; label: string; icon: WorkspaceIconName; keywords?: string; testerOnly?: boolean };
type NavigationGroup = { id: "portfolio" | "analysis" | "market" | "tools"; label: string; items: NavigationItem[] };

const directNavigation: NavigationItem[] = [
  { key: "dashboard", href: "/dashboard", label: "Pulpit", icon: "dashboard", keywords: "start dashboard centrum" },
];

/** One source of truth for desktop, section tabs, mobile navigation and command search. */
const navigationGroups: NavigationGroup[] = [
  { id: "portfolio", label: "Portfel", items: [
    { key: "portfolios", href: "/portfolios", label: "Portfele", icon: "portfolios", keywords: "rachunki konta" },
    { key: "positions", href: "/portfolio/positions", label: "Pozycje", icon: "positions", keywords: "aktywa bieżące" },
    { key: "operations", href: "/portfolio/operations", label: "Operacje", icon: "operations", keywords: "historia transakcje" },
    { key: "dividends", href: "/portfolio/dividends", label: "Dywidendy i gotówka", icon: "dividends", keywords: "wpłaty wypłaty dochód" },
    { key: "wealth", href: "/wealth", label: "Majątek", icon: "wealth", keywords: "aktywa netto" },
  ] },
  { id: "analysis", label: "Analiza", items: [
    { key: "performance", href: "/analytics/performance", label: "Wyniki", icon: "performance", keywords: "wynik ryzyko stopa zwrotu" },
    { key: "charts", href: "/analytics/charts", label: "Wykresy", icon: "charts", keywords: "historia benchmark" },
    { key: "structure", href: "/analytics/structure", label: "Struktura", icon: "structure", keywords: "alokacja klasy aktywów" },
  ] },
  { id: "market", label: "Rynek", items: [
    { key: "watchlist", href: "/market/watchlist", label: "Obserwowane", icon: "watchlist", keywords: "watchlista spółki" },
    { key: "events", href: "/market/events", label: "Wydarzenia GPW", icon: "events", keywords: "kalendarz raporty dywidendy" },
    { key: "espi", href: "/market/espi", label: "Raporty ESPI", icon: "espi", keywords: "komunikaty emitentów", testerOnly: true },
    { key: "instruments", href: "/market/instruments", label: "Instrumenty", icon: "instruments", keywords: "wyszukaj akcje etf" },
  ] },
  { id: "tools", label: "Narzędzia", items: [
    { key: "import", href: "/portfolio/import", label: "Import", icon: "import", keywords: "broker plik historia" },
  ] },
];

const routeMeta: Record<WorkspaceRouteKey, { eyebrow: string; title: string; breadcrumb: string; description: string }> = {
  dashboard: { eyebrow: "Przestrzeń inwestora", title: "Pulpit", breadcrumb: "Pulpit", description: "Najważniejsze dane wybranego portfela w jednym miejscu." },
  positions: { eyebrow: "Portfel", title: "Bieżące pozycje", breadcrumb: "Portfel / Pozycje", description: "Aktualna struktura, wycena i wynik otwartych pozycji." },
  operations: { eyebrow: "Portfel", title: "Operacje", breadcrumb: "Portfel / Operacje", description: "Chronologiczny zapis transakcji i korekt portfela." },
  dividends: { eyebrow: "Portfel", title: "Dywidendy i gotówka", breadcrumb: "Portfel / Dywidendy i gotówka", description: "Przepływy gotówkowe, wypłaty i historia dochodu." },
  import: { eyebrow: "Narzędzia", title: "Import operacji", breadcrumb: "Narzędzia / Import", description: "Dodaj historię rachunku z obsługiwanego pliku brokera." },
  performance: { eyebrow: "Analiza", title: "Wyniki portfela", breadcrumb: "Analiza / Wyniki", description: "Wynik, ryzyko i jakość zwrotu w wybranym okresie." },
  charts: { eyebrow: "Analiza", title: "Wykresy", breadcrumb: "Analiza / Wykresy", description: "Historia wartości, wyniku i porównanie z benchmarkiem." },
  structure: { eyebrow: "Analiza", title: "Struktura portfela", breadcrumb: "Analiza / Struktura", description: "Rozkład aktywów, rynków i koncentracji portfela." },
  instruments: { eyebrow: "Rynek", title: "Znajdź instrument", breadcrumb: "Rynek / Instrumenty", description: "Wyszukaj instrument i przejdź do istniejącego procesu dodawania." },
  watchlist: { eyebrow: "Rynek", title: "Obserwowane", breadcrumb: "Rynek / Obserwowane", description: "Spółki śledzone niezależnie od aktualnych pozycji." },
  espi: { eyebrow: "Rynek", title: "Raporty ESPI", breadcrumb: "Rynek / Raporty ESPI", description: "Oficjalne komunikaty emitentów GPW." },
  events: { eyebrow: "Rynek", title: "Wydarzenia GPW", breadcrumb: "Rynek / Wydarzenia GPW", description: "Nadchodzące raporty i wydarzenia śledzonych spółek." },
  portfolios: { eyebrow: "Portfel", title: "Portfele", breadcrumb: "Portfel / Portfele", description: "Zarządzaj realnymi portfelami i typami rachunków." },
  wealth: { eyebrow: "Portfel", title: "Majątek", breadcrumb: "Portfel / Majątek", description: "Łączny obraz aktywów ujętych w Mexo." },
  settings: { eyebrow: "Ustawienia", title: "Konto i preferencje", breadcrumb: "Ustawienia", description: "Ustawienia konta i preferencje aplikacji." },
};

const normalizeSearchText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pl-PL").trim();
const isGroupActive = (route: WorkspaceRouteKey, group: NavigationGroup) => group.items.some((item) => item.key === route);

function NavigationLink({ item, active, compact = false }: { item: NavigationItem; active: boolean; compact?: boolean }) {
  return <Link href={item.href} className={active ? "workspace-nav-link is-active" : "workspace-nav-link"} aria-current={active ? "page" : undefined} title={compact ? item.label : undefined}><span className="workspace-nav-glyph"><WorkspaceIcon name={item.icon} /></span><span>{item.label}</span></Link>;
}

export default function AppWorkspaceShell({ account, portfolios, selectedPortfolioId, activeBaseCurrency, isPortfolioMutationPending, isLoggingOut, isAdmin, onPortfolioChange, onBaseCurrencyChange, onQuickAdd, onLogout, children }: AppWorkspaceShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const route = getWorkspaceRoute(pathname);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("mexo.workspace.sidebar-collapsed") === "true");
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isQuickActionsOpen, setIsQuickActionsOpen] = useState(false);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const moreDialogRef = useRef<HTMLElement | null>(null);
  const quickAddDialogRef = useRef<HTMLElement | null>(null);
  const quickActionsDialogRef = useRef<HTMLElement | null>(null);
  const commandDialogRef = useRef<HTMLElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const quickAddTriggerRef = useRef<HTMLButtonElement | null>(null);
  const quickActionsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const commandTriggerRef = useRef<HTMLButtonElement | null>(null);
  const meta = routeMeta[route];
  const hasAllPortfoliosSelected = isAllPortfoliosSelection(selectedPortfolioId);
  const selectedPortfolio = portfolios.find((portfolio) => portfolio.id === selectedPortfolioId);
  const selectedAccountTypeLabel = hasAllPortfoliosSelected ? "Widok łączny" : selectedPortfolio ? PORTFOLIO_ACCOUNT_TYPE_LABELS[normalizePortfolioAccountType(selectedPortfolio.accountType)] : "Portfel";
  const visibleNavigationGroups = navigationGroups.map((group) => ({ ...group, items: group.items.filter((item) => !item.testerOnly || MEXO_TESTER_MODE) }));
  const currentNavigationGroup = visibleNavigationGroups.find((group) => isGroupActive(route, group));
  const showSectionTabs = currentNavigationGroup && currentNavigationGroup.id !== "tools";

  // The virtual aggregate is URL state, not a persisted portfolio. Preserve it on read routes.
  const getWorkspaceHref = (href: string) => getWorkspaceReadHref(href, selectedPortfolioId, activeBaseCurrency);
  const withWorkspaceContext = (item: NavigationItem): NavigationItem => ({ ...item, href: getWorkspaceHref(item.href) });
  const getPortfolioOptionLabel = (portfolio: InvestmentPortfolio) => `${portfolio.name} · ${PORTFOLIO_ACCOUNT_TYPE_LABELS[normalizePortfolioAccountType(portfolio.accountType)]}`;

  const pageCommands = [...directNavigation, ...visibleNavigationGroups.flatMap((group) => group.items), { key: "settings" as const, href: "/settings", label: "Ustawienia", icon: "settings" as const, keywords: "konto preferencje" }].map((item) => ({
    id: `page:${item.key}`,
    label: item.label,
    description: routeMeta[item.key]?.breadcrumb ?? "Nawigacja",
    icon: item.icon,
    href: getWorkspaceHref(item.href),
    searchText: `${item.label} ${item.keywords ?? ""} ${routeMeta[item.key]?.breadcrumb ?? ""}`,
    action: undefined as "quick-add" | undefined,
  }));
  const commandEntries = [...pageCommands, {
    id: "action:quick-add", label: "Dodaj transakcję", description: hasAllPortfoliosSelected ? "Najpierw wybierz realny portfel" : "Kup, sprzedaj lub dodaj zapis ręcznie", icon: "plus" as const, href: undefined, searchText: "dodaj transakcję kup sprzedaj operacja", action: "quick-add" as const,
  }];
  const normalizedCommandQuery = normalizeSearchText(commandQuery);
  const commandResults = commandEntries.filter((entry) => !normalizedCommandQuery || normalizeSearchText(`${entry.label} ${entry.searchText}`).includes(normalizedCommandQuery)).slice(0, 9);

  const closeAllOverlays = () => { setIsMoreOpen(false); setIsQuickAddOpen(false); setIsQuickActionsOpen(false); setIsCommandOpen(false); };
  const openCommand = () => { setCommandQuery(""); setActiveCommandIndex(0); setIsMoreOpen(false); setIsQuickAddOpen(false); setIsQuickActionsOpen(false); setIsCommandOpen(true); };
  const openQuickActions = (mobile: boolean) => { setIsMoreOpen(false); setIsCommandOpen(false); if (mobile) setIsQuickAddOpen(true); else setIsQuickActionsOpen(true); };
  const runCommand = (entry: (typeof commandEntries)[number]) => { closeAllOverlays(); if (entry.action === "quick-add") onQuickAdd(); else if (entry.href) router.push(entry.href); };

  useEffect(() => { window.localStorage.setItem("mexo.workspace.sidebar-collapsed", String(isSidebarCollapsed)); }, [isSidebarCollapsed]);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") { event.preventDefault(); openCommand(); }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });
  useEffect(() => {
    const activeOverlay = isCommandOpen
      ? { dialog: commandDialogRef.current, trigger: commandTriggerRef.current, initial: commandInputRef.current }
      : isQuickActionsOpen
        ? { dialog: quickActionsDialogRef.current, trigger: quickActionsTriggerRef.current, initial: null }
        : isQuickAddOpen
          ? { dialog: quickAddDialogRef.current, trigger: quickAddTriggerRef.current, initial: null }
          : isMoreOpen
            ? { dialog: moreDialogRef.current, trigger: moreTriggerRef.current, initial: null }
            : null;
    if (!activeOverlay?.dialog) return;
    const { dialog, trigger, initial } = activeOverlay;
    const focusableSelector = "a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((item) => !item.hasAttribute("hidden"));
    const frame = window.requestAnimationFrame(() => (initial ?? getFocusable()[0] ?? dialog).focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeAllOverlays(); return; }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("keydown", handleKeyDown); window.requestAnimationFrame(() => trigger?.focus()); };
  }, [isCommandOpen, isMoreOpen, isQuickActionsOpen, isQuickAddOpen]);

  const handleCommandKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!commandResults.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveCommandIndex((current) => (current + 1) % commandResults.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActiveCommandIndex((current) => (current - 1 + commandResults.length) % commandResults.length); }
    else if (event.key === "Enter") { event.preventDefault(); const entry = commandResults[activeCommandIndex] ?? commandResults[0]; if (entry) runCommand(entry); }
  };

  return <div className={isSidebarCollapsed ? "workspace-shell is-sidebar-collapsed" : "workspace-shell"}>
    <aside className="workspace-sidebar" aria-label="Główna nawigacja">
      <div className="workspace-brand-row"><Link href={getWorkspaceHref("/dashboard")} className="workspace-brand" aria-label="Mexo — pulpit"><Image src="/mexo-mark-transparent.png" className="workspace-brand-mark" alt="" width={34} height={34} priority /><span className="workspace-brand-name">Mexo</span></Link><button type="button" className="workspace-sidebar-toggle" onClick={() => setIsSidebarCollapsed((current) => !current)} aria-label={isSidebarCollapsed ? "Rozwiń menu" : "Zwiń menu"} title={isSidebarCollapsed ? "Rozwiń menu" : "Zwiń menu"}><span aria-hidden="true">‹</span></button></div>
      <nav className="workspace-sidebar-nav" aria-label="Sekcje aplikacji">
        {directNavigation.map((item) => <NavigationLink key={item.key} item={withWorkspaceContext(item)} active={route === item.key} compact={isSidebarCollapsed} />)}
        {visibleNavigationGroups.map((group) => <section key={group.id} className="workspace-nav-group" aria-labelledby={`workspace-nav-${group.id}`}><h2 id={`workspace-nav-${group.id}`}>{group.label}</h2><div className="workspace-nav-group-links">{group.items.map((item) => <NavigationLink key={item.key} item={withWorkspaceContext(item)} active={route === item.key} compact={isSidebarCollapsed} />)}</div></section>)}
      </nav>
      <div className="workspace-sidebar-bottom">
        {isAdmin ? <Link href="/admin" className="workspace-nav-link" title={isSidebarCollapsed ? "Panel admina" : undefined}><span className="workspace-nav-glyph"><WorkspaceIcon name="admin" /></span><span>Panel admina</span></Link> : null}
        <NavigationLink item={withWorkspaceContext({ key: "settings", href: "/settings", label: "Ustawienia", icon: "settings" })} active={route === "settings"} compact={isSidebarCollapsed} />
        <div className="workspace-user-card"><span className="workspace-user-avatar" aria-hidden="true">{(account.email[0] ?? "M").toUpperCase()}</span><span className="workspace-user-copy"><strong>{account.email.split("@")[0]}</strong><small>{MEXO_TESTER_MODE ? "Tester" : account.subscriptionPlan === "pro" ? "Mexo Pro" : "Mexo Free"}</small></span></div>
      </div>
    </aside>

    <header className="workspace-mobile-header">
      <Link href={getWorkspaceHref("/dashboard")} className="workspace-mobile-brand" aria-label="Mexo — pulpit"><Image src="/mexo-mark-transparent.png" alt="" width={34} height={34} priority /></Link>
      <label className="workspace-mobile-portfolio"><span className="sr-only">Aktywny portfel</span><select value={selectedPortfolioId} onChange={(event) => onPortfolioChange(event.target.value)} aria-label="Wybierz aktywny portfel" disabled={isPortfolioMutationPending}><option value={ALL_PORTFOLIOS_ID}>Wszystkie portfele</option>{portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{getPortfolioOptionLabel(portfolio)}</option>)}</select><small>{selectedAccountTypeLabel}</small></label>
      <button ref={quickAddTriggerRef} type="button" className="workspace-mobile-quick-action" onClick={() => openQuickActions(true)} aria-label="Otwórz szybkie działania" aria-haspopup="dialog" aria-expanded={isQuickAddOpen}><WorkspaceIcon name="plus" /></button>
    </header>

    <div className="workspace-main-shell">
      <header className="workspace-topbar">
        <button ref={commandTriggerRef} type="button" className="workspace-global-search-trigger" onClick={openCommand} aria-haspopup="dialog" aria-expanded={isCommandOpen}><WorkspaceIcon name="search" /><span>Przejdź do…</span><kbd>Ctrl K</kbd></button>
        <div className="workspace-topbar-actions">
          <label className="workspace-portfolio-select"><span>Aktywny portfel</span><select value={selectedPortfolioId} onChange={(event) => onPortfolioChange(event.target.value)} disabled={isPortfolioMutationPending}><option value={ALL_PORTFOLIOS_ID}>Wszystkie portfele</option>{portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select><small className="workspace-account-badge">{selectedAccountTypeLabel}</small></label>
          <label className="workspace-currency-select"><span>Waluta</span><select value={activeBaseCurrency} onChange={(event) => onBaseCurrencyChange(event.target.value)} disabled={isPortfolioMutationPending}><option value="PLN">PLN</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></label>
          <button ref={quickActionsTriggerRef} type="button" className="workspace-topbar-add" onClick={() => openQuickActions(false)} aria-label="Otwórz szybkie działania" aria-haspopup="dialog" aria-expanded={isQuickActionsOpen}><WorkspaceIcon name="plus" /><span>Szybkie działania</span></button>
          <Link href={getWorkspaceHref("/settings")} className="workspace-profile-link" aria-label="Ustawienia konta">{(account.email[0] ?? "M").toUpperCase()}</Link>
        </div>
      </header>
      <main className="workspace-content" id="workspace-content" tabIndex={-1}>
        <header className="workspace-page-header"><div><span className="workspace-breadcrumb">{meta.breadcrumb}</span><h1>{meta.title}</h1><p>{meta.description}</p></div></header>
        {showSectionTabs ? <nav className="workspace-section-tabs" aria-label={`Sekcja ${currentNavigationGroup.label}`}>{currentNavigationGroup.items.map((item) => <Link key={item.key} href={getWorkspaceHref(item.href)} className={route === item.key ? "is-active" : undefined} aria-current={route === item.key ? "page" : undefined}>{item.label}</Link>)}</nav> : null}
        {children}
      </main>
    </div>

    <nav className="workspace-bottom-nav" aria-label="Nawigacja mobilna">
      <NavigationLink item={withWorkspaceContext(directNavigation[0]!)} active={route === "dashboard"} />
      <NavigationLink item={withWorkspaceContext({ key: "positions", href: "/portfolio/positions", label: "Portfel", icon: "positions" })} active={isGroupActive(route, visibleNavigationGroups[0]!)} />
      <NavigationLink item={withWorkspaceContext({ key: "watchlist", href: "/market/watchlist", label: "Rynek", icon: "watchlist" })} active={isGroupActive(route, visibleNavigationGroups[2]!)} />
      <NavigationLink item={withWorkspaceContext({ key: "performance", href: "/analytics/performance", label: "Analiza", icon: "performance" })} active={isGroupActive(route, visibleNavigationGroups[1]!)} />
      <button ref={moreTriggerRef} type="button" className={isMoreOpen || route === "settings" || route === "import" ? "workspace-mobile-more is-active" : "workspace-mobile-more"} onClick={() => { closeAllOverlays(); setIsMoreOpen(true); }} aria-haspopup="dialog" aria-expanded={isMoreOpen}><WorkspaceIcon name="more" /><small>Więcej</small></button>
    </nav>

    {isCommandOpen ? <div className="workspace-command-backdrop" role="presentation" onMouseDown={closeAllOverlays}><section ref={commandDialogRef} tabIndex={-1} className="workspace-command-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-command-title" onMouseDown={(event) => event.stopPropagation()}><header><span><WorkspaceIcon name="search" /></span><div><p className="eyebrow">Nawigacja Mexo</p><h2 id="workspace-command-title">Dokąd chcesz przejść?</h2></div><button type="button" onClick={closeAllOverlays} aria-label="Zamknij wyszukiwarkę">×</button></header><label className="workspace-command-input"><span className="sr-only">Szukaj strony lub działania</span><WorkspaceIcon name="search" /><input ref={commandInputRef} type="search" value={commandQuery} onChange={(event) => { setCommandQuery(event.target.value); setActiveCommandIndex(0); }} onKeyDown={handleCommandKeyDown} placeholder="Wpisz np. wykresy, dywidendy, import…" autoComplete="off" /></label><div className="workspace-command-results" role="listbox" aria-label="Wyniki wyszukiwania">{commandResults.length ? commandResults.map((entry, index) => <button key={entry.id} type="button" role="option" aria-selected={index === activeCommandIndex} className={index === activeCommandIndex ? "is-active" : undefined} onMouseEnter={() => setActiveCommandIndex(index)} onClick={() => runCommand(entry)}><span><WorkspaceIcon name={entry.icon} /></span><span><strong>{entry.label}</strong><small>{entry.description}</small></span><kbd>↵</kbd></button>) : <div className="workspace-command-empty"><strong>Brak pasujących miejsc</strong><span>Spróbuj krótszej nazwy modułu lub działania.</span></div>}</div><footer><span>↑↓ wybór</span><span>Enter otwiera</span><span>Esc zamyka</span></footer></section></div> : null}

    {isQuickActionsOpen ? <div className="workspace-popover-scrim" role="presentation" onMouseDown={closeAllOverlays}><section ref={quickActionsDialogRef} tabIndex={-1} className="workspace-quick-actions-popover" role="dialog" aria-modal="true" aria-label="Szybkie działania" onMouseDown={(event) => event.stopPropagation()}><p className="eyebrow">Szybkie działania</p><button type="button" onClick={() => { closeAllOverlays(); onQuickAdd(); }}><span><WorkspaceIcon name="operations" /></span><span><strong>Dodaj transakcję</strong><small>{hasAllPortfoliosSelected ? "Wymaga wyboru realnego portfela" : "Kup, sprzedaj lub dodaj zapis"}</small></span></button><Link href={getWorkspaceHref("/portfolio/dividends")} onClick={closeAllOverlays}><span><WorkspaceIcon name="dividends" /></span><span><strong>Gotówka i dywidendy</strong><small>Przejdź do przepływów portfela</small></span></Link><Link href={getWorkspaceHref("/portfolio/import")} onClick={closeAllOverlays}><span><WorkspaceIcon name="import" /></span><span><strong>Importuj operacje</strong><small>Dodaj historię z pliku</small></span></Link></section></div> : null}

    {isQuickAddOpen ? <div className="workspace-sheet-backdrop" role="presentation" onMouseDown={closeAllOverlays}><section ref={quickAddDialogRef} tabIndex={-1} className="workspace-mobile-sheet" role="dialog" aria-modal="true" aria-label="Szybkie działania" onMouseDown={(event) => event.stopPropagation()}><div className="workspace-sheet-handle" aria-hidden="true" /><p className="eyebrow">Szybkie działania</p><h2>Co chcesz zrobić?</h2><button type="button" className="workspace-sheet-action" onClick={() => { closeAllOverlays(); onQuickAdd(); }}>Dodaj transakcję <span aria-hidden="true">→</span></button><Link href={getWorkspaceHref("/portfolio/dividends")} onClick={closeAllOverlays}>Gotówka i dywidendy <span aria-hidden="true">→</span></Link><Link href={getWorkspaceHref("/portfolio/import")} onClick={closeAllOverlays}>Importuj historię <span aria-hidden="true">→</span></Link><button type="button" onClick={closeAllOverlays}>Anuluj</button></section></div> : null}

    {isMoreOpen ? <div className="workspace-sheet-backdrop" role="presentation" onMouseDown={closeAllOverlays}><section ref={moreDialogRef} tabIndex={-1} className="workspace-mobile-sheet workspace-more-sheet" role="dialog" aria-modal="true" aria-label="Więcej sekcji" onMouseDown={(event) => event.stopPropagation()}><div className="workspace-sheet-handle" aria-hidden="true" /><p className="eyebrow">Mexo</p><h2>Więcej</h2><button type="button" className="workspace-more-quick-action" onClick={() => { setIsMoreOpen(false); setIsQuickAddOpen(true); }}><WorkspaceIcon name="plus" />Szybkie działania</button><div className="workspace-sheet-links">{visibleNavigationGroups.map((group) => <section className="workspace-more-section" key={group.id}><h3>{group.label}</h3>{group.items.map((item) => <Link key={item.key} href={getWorkspaceHref(item.href)} onClick={closeAllOverlays}><span><WorkspaceIcon name={item.icon} /></span>{item.label}</Link>)}</section>)}<section className="workspace-more-section"><h3>Konto</h3><Link href={getWorkspaceHref("/settings")} onClick={closeAllOverlays}><span><WorkspaceIcon name="settings" /></span>Ustawienia</Link></section></div><button type="button" className="workspace-logout-link" onClick={onLogout} disabled={isLoggingOut}>{isLoggingOut ? "Wylogowywanie…" : "Wyloguj"}</button></section></div> : null}
  </div>;
}

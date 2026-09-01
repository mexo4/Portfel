"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
};

export function WorkspaceIcon({ name }: { name: WorkspaceIconName }) {
  return <svg aria-hidden="true" className="workspace-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{WORKSPACE_ICON_DRAWINGS[name]}</svg>;
}

type NavigationItem = { key: WorkspaceRouteKey; href: string; label: string; icon: WorkspaceIconName };

const directNavigation: NavigationItem[] = [
  { key: "dashboard", href: "/dashboard", label: "Pulpit", icon: "dashboard" },
  { key: "portfolios", href: "/portfolios", label: "Portfele", icon: "portfolios" },
  { key: "wealth", href: "/wealth", label: "Majątek", icon: "wealth" },
];
const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  { label: "Portfel", items: [
    { key: "positions", href: "/portfolio/positions", label: "Pozycje", icon: "positions" },
    { key: "operations", href: "/portfolio/operations", label: "Operacje", icon: "operations" },
    { key: "dividends", href: "/portfolio/dividends", label: "Dywidendy", icon: "dividends" },
    { key: "import", href: "/portfolio/import", label: "Import", icon: "import" },
  ] },
  { label: "Analiza", items: [
    { key: "performance", href: "/analytics/performance", label: "Wyniki", icon: "performance" },
    { key: "charts", href: "/analytics/charts", label: "Wykresy", icon: "charts" },
    { key: "structure", href: "/analytics/structure", label: "Struktura", icon: "structure" },
  ] },
  { label: "Rynek", items: [
    { key: "instruments", href: "/market/instruments", label: "Instrumenty", icon: "instruments" },
    { key: "watchlist", href: "/market/watchlist", label: "Obserwowane", icon: "watchlist" },
    ...(MEXO_TESTER_MODE ? [{ key: "espi" as const, href: "/market/espi", label: "Raporty ESPI", icon: "espi" as const }] : []),
    { key: "events", href: "/market/events", label: "Wydarzenia", icon: "events" },
  ] },
];

const routeMeta: Record<WorkspaceRouteKey, { eyebrow: string; title: string; breadcrumb: string }> = {
  dashboard: { eyebrow: "Przestrzeń inwestora", title: "Pulpit", breadcrumb: "Pulpit" },
  positions: { eyebrow: "Portfel", title: "Bieżące pozycje", breadcrumb: "Portfel / Pozycje" },
  operations: { eyebrow: "Portfel", title: "Operacje", breadcrumb: "Portfel / Operacje" },
  dividends: { eyebrow: "Portfel", title: "Dywidendy i gotówka", breadcrumb: "Portfel / Dywidendy" },
  import: { eyebrow: "Portfel", title: "Import operacji", breadcrumb: "Portfel / Import" },
  performance: { eyebrow: "Analiza", title: "Wyniki portfela", breadcrumb: "Analiza / Wyniki" },
  charts: { eyebrow: "Analiza", title: "Wykresy", breadcrumb: "Analiza / Wykresy" },
  structure: { eyebrow: "Analiza", title: "Struktura portfela", breadcrumb: "Analiza / Struktura" },
  instruments: { eyebrow: "Rynek", title: "Znajdź instrument", breadcrumb: "Rynek / Instrumenty" },
  watchlist: { eyebrow: "Rynek", title: "Obserwowane", breadcrumb: "Rynek / Obserwowane" },
  espi: { eyebrow: "Rynek", title: "Raporty ESPI", breadcrumb: "Rynek / Raporty ESPI" },
  events: { eyebrow: "Rynek", title: "Wydarzenia", breadcrumb: "Rynek / Wydarzenia" },
  portfolios: { eyebrow: "Zarządzanie", title: "Portfele", breadcrumb: "Portfele" },
  wealth: { eyebrow: "Zarządzanie", title: "Majątek", breadcrumb: "Majątek" },
  settings: { eyebrow: "Ustawienia", title: "Konto i preferencje", breadcrumb: "Ustawienia" },
};

const isGroupActive = (route: WorkspaceRouteKey, group: (typeof navigationGroups)[number]) => group.items.some((item) => item.key === route);

function NavigationLink({ item, active, compact = false }: { item: NavigationItem; active: boolean; compact?: boolean }) {
  return <Link href={item.href} className={active ? "workspace-nav-link is-active" : "workspace-nav-link"} aria-current={active ? "page" : undefined} title={compact ? item.label : undefined}><span className="workspace-nav-glyph"><WorkspaceIcon name={item.icon} /></span><span>{item.label}</span></Link>;
}

export default function AppWorkspaceShell({ account, portfolios, selectedPortfolioId, activeBaseCurrency, isPortfolioMutationPending, isLoggingOut, isAdmin, onPortfolioChange, onBaseCurrencyChange, onQuickAdd, onLogout, children }: AppWorkspaceShellProps) {
  const route = getWorkspaceRoute(usePathname());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
    () => typeof window !== "undefined" && window.localStorage.getItem("mexo.workspace.sidebar-collapsed") === "true"
  );
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const moreDialogRef = useRef<HTMLDivElement | null>(null);
  const quickAddDialogRef = useRef<HTMLElement | null>(null);
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null);
  const quickAddTriggerRef = useRef<HTMLButtonElement | null>(null);
  const meta = routeMeta[route];
  const hasAllPortfoliosSelected = isAllPortfoliosSelection(selectedPortfolioId);
  // The virtual aggregate is URL state, not a persisted portfolio. Preserve
  // it while moving between read routes so navigation cannot silently expose
  // whichever concrete portfolio happened to be active previously.
  const getWorkspaceHref = (href: string) =>
    getWorkspaceReadHref(href, selectedPortfolioId, activeBaseCurrency);
  const withWorkspaceContext = (item: NavigationItem): NavigationItem => ({
    ...item,
    href: getWorkspaceHref(item.href),
  });
  const getPortfolioOptionLabel = (portfolio: InvestmentPortfolio) =>
    `${portfolio.name} · ${PORTFOLIO_ACCOUNT_TYPE_LABELS[normalizePortfolioAccountType(portfolio.accountType)]}`;

  useEffect(() => { window.localStorage.setItem("mexo.workspace.sidebar-collapsed", String(isSidebarCollapsed)); }, [isSidebarCollapsed]);
  useEffect(() => {
    if (!isMoreOpen && !isQuickAddOpen) return;
    const dialog = isQuickAddOpen ? quickAddDialogRef.current : moreDialogRef.current;
    const trigger = isQuickAddOpen ? quickAddTriggerRef.current : moreTriggerRef.current;
    if (!dialog) return;
    const focusableSelector = "a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((item) => !item.hasAttribute("hidden"));
    const frame = window.requestAnimationFrame(() => (getFocusable()[0] ?? dialog).focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsMoreOpen(false);
        setIsQuickAddOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [isMoreOpen, isQuickAddOpen]);

  return <div className={isSidebarCollapsed ? "workspace-shell is-sidebar-collapsed" : "workspace-shell"}>
    <aside className="workspace-sidebar" aria-label="Główna nawigacja">
      <div className="workspace-brand-row"><Link href={getWorkspaceHref("/dashboard")} className="workspace-brand" aria-label="Mexo — pulpit"><Image src="/mexo-mark-transparent.png" className="workspace-brand-mark" alt="" width={34} height={34} priority /><span className="workspace-brand-name">Mexo</span></Link><button type="button" className="workspace-sidebar-toggle" onClick={() => setIsSidebarCollapsed((current) => !current)} aria-label={isSidebarCollapsed ? "Rozwiń menu" : "Zwiń menu"} title={isSidebarCollapsed ? "Rozwiń menu" : "Zwiń menu"}><span aria-hidden="true">‹</span></button></div>
      <nav className="workspace-sidebar-nav" aria-label="Sekcje aplikacji">
        {directNavigation.map((item) => <NavigationLink key={item.key} item={withWorkspaceContext(item)} active={route === item.key} compact={isSidebarCollapsed} />)}
        {navigationGroups.map((group) => <details key={group.label} className="workspace-nav-group" open={isGroupActive(route, group)}><summary>{group.label}</summary><div className="workspace-nav-group-links">{group.items.map((item) => <NavigationLink key={item.key} item={withWorkspaceContext(item)} active={route === item.key} compact={isSidebarCollapsed} />)}</div></details>)}
      </nav>
      <div className="workspace-sidebar-bottom">
        {isAdmin ? <Link href="/admin" className="workspace-nav-link" title={isSidebarCollapsed ? "Panel admina" : undefined}><span className="workspace-nav-glyph"><WorkspaceIcon name="admin" /></span><span>Panel admina</span></Link> : null}
        <NavigationLink item={withWorkspaceContext({ key: "settings", href: "/settings", label: "Ustawienia", icon: "settings" })} active={route === "settings"} compact={isSidebarCollapsed} />
        <div className="workspace-user-card"><span className="workspace-user-avatar" aria-hidden="true">{(account.email[0] ?? "M").toUpperCase()}</span><span className="workspace-user-copy"><strong>{account.email.split("@")[0]}</strong><small>{MEXO_TESTER_MODE ? "Tester" : account.subscriptionPlan === "pro" ? "Mexo Pro" : "Mexo Free"}</small></span></div>
      </div>
    </aside>

    <header className="workspace-mobile-header"><Link href={getWorkspaceHref("/dashboard")} className="workspace-mobile-brand" aria-label="Mexo — pulpit"><Image src="/mexo-mark-transparent.png" alt="" width={34} height={34} priority /></Link><div><small>{meta.eyebrow}</small><strong>{meta.title}</strong></div><select value={selectedPortfolioId} onChange={(event) => onPortfolioChange(event.target.value)} aria-label="Wybierz aktywny portfel" disabled={isPortfolioMutationPending}><option value={ALL_PORTFOLIOS_ID}>Wszystkie</option>{portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{getPortfolioOptionLabel(portfolio)}</option>)}</select></header>
    <div className="workspace-main-shell"><header className="workspace-topbar"><div className="workspace-topbar-copy"><span className="workspace-breadcrumb">{meta.breadcrumb}</span><h1>{meta.title}</h1></div><div className="workspace-topbar-actions"><label className="workspace-portfolio-select"><span>Aktywny portfel</span><select value={selectedPortfolioId} onChange={(event) => onPortfolioChange(event.target.value)} disabled={isPortfolioMutationPending}><option value={ALL_PORTFOLIOS_ID}>Wszystkie portfele</option>{portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{getPortfolioOptionLabel(portfolio)}</option>)}</select></label><label className="workspace-currency-select"><span>Waluta</span><select value={activeBaseCurrency} onChange={(event) => onBaseCurrencyChange(event.target.value)} disabled={isPortfolioMutationPending}><option value="PLN">PLN</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></label><button type="button" className="workspace-topbar-add" onClick={onQuickAdd}>{hasAllPortfoliosSelected ? "Wybierz portfel" : "Dodaj transakcję"}</button><Link href={getWorkspaceHref("/settings")} className="workspace-profile-link" aria-label="Ustawienia konta">{(account.email[0] ?? "M").toUpperCase()}</Link></div></header><main className="workspace-content" id="workspace-content" tabIndex={-1}>{children}</main></div>
    <nav className="workspace-bottom-nav" aria-label="Nawigacja mobilna"><NavigationLink item={withWorkspaceContext(directNavigation[0]!)} active={route === "dashboard"} /><NavigationLink item={withWorkspaceContext({ key: "positions", href: "/portfolio/positions", label: "Portfel", icon: "positions" })} active={isGroupActive(route, navigationGroups[0])} /><button ref={quickAddTriggerRef} type="button" className="workspace-mobile-add" onClick={() => { if (hasAllPortfoliosSelected) { onQuickAdd(); return; } setIsQuickAddOpen(true); }} aria-label={hasAllPortfoliosSelected ? "Wybierz portfel, aby dodać transakcję" : "Dodaj transakcję"} aria-haspopup={hasAllPortfoliosSelected ? undefined : "dialog"} aria-expanded={hasAllPortfoliosSelected ? undefined : isQuickAddOpen}>+</button><NavigationLink item={withWorkspaceContext({ key: "performance", href: "/analytics/performance", label: "Analiza", icon: "performance" })} active={isGroupActive(route, navigationGroups[1])} /><button ref={moreTriggerRef} type="button" className={isMoreOpen ? "workspace-mobile-more is-active" : "workspace-mobile-more"} onClick={() => setIsMoreOpen(true)} aria-haspopup="dialog" aria-expanded={isMoreOpen}><WorkspaceIcon name="more" /><small>Więcej</small></button></nav>
    {isQuickAddOpen ? <div className="workspace-sheet-backdrop" role="presentation" onMouseDown={() => setIsQuickAddOpen(false)}><section ref={quickAddDialogRef} tabIndex={-1} className="workspace-mobile-sheet" role="dialog" aria-modal="true" aria-label="Szybkie dodawanie" onMouseDown={(event) => event.stopPropagation()}><div className="workspace-sheet-handle" aria-hidden="true" /><p className="eyebrow">Szybkie działanie</p><h2>Dodaj do portfela</h2><Link href="/portfolio/positions?add=asset" onClick={() => setIsQuickAddOpen(false)}>Dodaj transakcję ręcznie <span aria-hidden="true">→</span></Link><Link href="/portfolio/import" onClick={() => setIsQuickAddOpen(false)}>Zaimportuj historię od brokera <span aria-hidden="true">→</span></Link><button type="button" onClick={() => setIsQuickAddOpen(false)}>Anuluj</button></section></div> : null}
    {isMoreOpen ? <div className="workspace-sheet-backdrop" role="presentation" onMouseDown={() => setIsMoreOpen(false)}><section ref={moreDialogRef} tabIndex={-1} className="workspace-mobile-sheet workspace-more-sheet" role="dialog" aria-modal="true" aria-label="Więcej sekcji" onMouseDown={(event) => event.stopPropagation()}><div className="workspace-sheet-handle" aria-hidden="true" /><p className="eyebrow">Mexo</p><h2>Więcej</h2><div className="workspace-sheet-links">{[...directNavigation.slice(1), ...navigationGroups.flatMap((group) => group.items).filter((item) => !["positions", "performance"].includes(item.key))].map((item) => <Link key={item.key} href={getWorkspaceHref(item.href)} onClick={() => setIsMoreOpen(false)}><span><WorkspaceIcon name={item.icon} /></span>{item.label}</Link>)}<Link href={getWorkspaceHref("/settings")} onClick={() => setIsMoreOpen(false)}><span><WorkspaceIcon name="settings" /></span>Ustawienia</Link></div><button type="button" className="workspace-logout-link" onClick={onLogout} disabled={isLoggingOut}>{isLoggingOut ? "Wylogowywanie…" : "Wyloguj"}</button></section></div> : null}
  </div>;
}

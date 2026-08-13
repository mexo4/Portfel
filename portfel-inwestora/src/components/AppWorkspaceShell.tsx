"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getWorkspaceRoute, type WorkspaceRouteKey } from "@/lib/workspace-routes";
import { ALL_PORTFOLIOS_ID, getWorkspaceReadHref, isAllPortfoliosSelection } from "@/lib/portfolio-selection";
import type { AuthenticatedUser, CurrencyCode, InvestmentPortfolio } from "@/types/portfolio";

export type { WorkspaceRouteKey } from "@/lib/workspace-routes";

type AppWorkspaceShellProps = {
  account: AuthenticatedUser;
  portfolios: InvestmentPortfolio[];
  activePortfolioId: string;
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

type NavigationItem = { key: WorkspaceRouteKey; href: string; label: string; glyph: string };

const directNavigation: NavigationItem[] = [
  { key: "dashboard", href: "/dashboard", label: "Pulpit", glyph: "◫" },
  { key: "portfolios", href: "/portfolios", label: "Portfele", glyph: "◌" },
  { key: "wealth", href: "/wealth", label: "Majątek", glyph: "◇" },
];
const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  { label: "Portfel", items: [
    { key: "positions", href: "/portfolio/positions", label: "Pozycje", glyph: "≡" },
    { key: "operations", href: "/portfolio/operations", label: "Operacje", glyph: "↕" },
    { key: "dividends", href: "/portfolio/dividends", label: "Dywidendy", glyph: "◌" },
    { key: "import", href: "/portfolio/import", label: "Import", glyph: "⇣" },
  ] },
  { label: "Analiza", items: [
    { key: "performance", href: "/analytics/performance", label: "Wyniki", glyph: "↗" },
    { key: "charts", href: "/analytics/charts", label: "Wykresy", glyph: "⌁" },
    { key: "structure", href: "/analytics/structure", label: "Struktura", glyph: "◒" },
    { key: "benchmarks", href: "/analytics/benchmarks", label: "Benchmarki", glyph: "⊘" },
  ] },
  { label: "Rynek", items: [
    { key: "instruments", href: "/market/instruments", label: "Instrumenty", glyph: "⌕" },
    { key: "events", href: "/market/events", label: "Wydarzenia", glyph: "□" },
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
  benchmarks: { eyebrow: "Analiza", title: "Benchmarki", breadcrumb: "Analiza / Benchmarki" },
  instruments: { eyebrow: "Rynek", title: "Znajdź instrument", breadcrumb: "Rynek / Instrumenty" },
  events: { eyebrow: "Rynek", title: "Wydarzenia", breadcrumb: "Rynek / Wydarzenia" },
  portfolios: { eyebrow: "Zarządzanie", title: "Portfele", breadcrumb: "Portfele" },
  wealth: { eyebrow: "Zarządzanie", title: "Majątek", breadcrumb: "Majątek" },
  settings: { eyebrow: "Ustawienia", title: "Konto i preferencje", breadcrumb: "Ustawienia" },
};

const isGroupActive = (route: WorkspaceRouteKey, group: (typeof navigationGroups)[number]) => group.items.some((item) => item.key === route);

function NavigationLink({ item, active, compact = false }: { item: NavigationItem; active: boolean; compact?: boolean }) {
  return <Link href={item.href} className={active ? "workspace-nav-link is-active" : "workspace-nav-link"} aria-current={active ? "page" : undefined} title={compact ? item.label : undefined}><span className="workspace-nav-glyph" aria-hidden="true">{item.glyph}</span><span>{item.label}</span></Link>;
}

export default function AppWorkspaceShell({ account, portfolios, activePortfolioId, selectedPortfolioId, activeBaseCurrency, isPortfolioMutationPending, isLoggingOut, isAdmin, onPortfolioChange, onBaseCurrencyChange, onQuickAdd, onLogout, children }: AppWorkspaceShellProps) {
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
  const activePortfolio = useMemo(() => portfolios.find((portfolio) => portfolio.id === activePortfolioId) ?? portfolios[0], [activePortfolioId, portfolios]);
  const hasAllPortfoliosSelected = isAllPortfoliosSelection(selectedPortfolioId);
  const selectedPortfolioLabel = hasAllPortfoliosSelected ? "Wszystkie portfele" : activePortfolio?.name ?? "Portfel";
  // The virtual aggregate is URL state, not a persisted portfolio. Preserve
  // it while moving between read routes so navigation cannot silently expose
  // whichever concrete portfolio happened to be active previously.
  const getWorkspaceHref = (href: string) =>
    getWorkspaceReadHref(href, selectedPortfolioId, activeBaseCurrency);
  const withWorkspaceContext = (item: NavigationItem): NavigationItem => ({
    ...item,
    href: getWorkspaceHref(item.href),
  });

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
        {isAdmin ? <Link href="/admin" className="workspace-nav-link" title={isSidebarCollapsed ? "Panel admina" : undefined}><span className="workspace-nav-glyph" aria-hidden="true">◇</span><span>Panel admina</span></Link> : null}
        <NavigationLink item={withWorkspaceContext({ key: "settings", href: "/settings", label: "Ustawienia", glyph: "⚙" })} active={route === "settings"} compact={isSidebarCollapsed} />
        <div className="workspace-user-card"><span className="workspace-user-avatar" aria-hidden="true">{(account.email[0] ?? "M").toUpperCase()}</span><span className="workspace-user-copy"><strong>{account.email.split("@")[0]}</strong><small>{account.subscriptionPlan === "pro" ? "Mexo Pro" : "Mexo Free"}</small></span></div>
      </div>
    </aside>

    <header className="workspace-mobile-header"><Link href={getWorkspaceHref("/dashboard")} className="workspace-mobile-brand" aria-label="Mexo — pulpit"><Image src="/mexo-mark-transparent.png" alt="" width={34} height={34} priority /></Link><div><small>{meta.eyebrow}</small><strong>{meta.title}</strong></div><select value={selectedPortfolioId} onChange={(event) => onPortfolioChange(event.target.value)} aria-label="Wybierz aktywny portfel" disabled={isPortfolioMutationPending}><option value={ALL_PORTFOLIOS_ID}>Wszystkie portfele</option>{portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select></header>
    <div className="workspace-main-shell"><header className="workspace-topbar"><div className="workspace-topbar-copy"><span className="workspace-breadcrumb">{meta.breadcrumb}</span><h1>{meta.title}</h1></div><div className="workspace-topbar-actions"><label className="workspace-portfolio-select"><span>Aktywny portfel</span><select value={selectedPortfolioId} onChange={(event) => onPortfolioChange(event.target.value)} disabled={isPortfolioMutationPending}><option value={ALL_PORTFOLIOS_ID}>Wszystkie portfele</option>{portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select><small>{selectedPortfolioLabel}</small></label><label className="workspace-currency-select"><span>Waluta</span><select value={activeBaseCurrency} onChange={(event) => onBaseCurrencyChange(event.target.value)} disabled={isPortfolioMutationPending}><option value="PLN">PLN</option><option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option></select></label><button type="button" className="workspace-topbar-add" onClick={onQuickAdd}>{hasAllPortfoliosSelected ? "Wybierz portfel" : "Dodaj aktywo"}</button><Link href={getWorkspaceHref("/settings")} className="workspace-profile-link" aria-label="Ustawienia konta">{(account.email[0] ?? "M").toUpperCase()}</Link></div></header><main className="workspace-content" id="workspace-content" tabIndex={-1}>{children}</main></div>
    <nav className="workspace-bottom-nav" aria-label="Nawigacja mobilna"><NavigationLink item={withWorkspaceContext(directNavigation[0]!)} active={route === "dashboard"} /><NavigationLink item={withWorkspaceContext({ key: "positions", href: "/portfolio/positions", label: "Portfel", glyph: "≡" })} active={isGroupActive(route, navigationGroups[0])} /><button ref={quickAddTriggerRef} type="button" className="workspace-mobile-add" onClick={() => { if (hasAllPortfoliosSelected) { onQuickAdd(); return; } setIsQuickAddOpen(true); }} aria-label={hasAllPortfoliosSelected ? "Wybierz portfel, aby dodać aktywo" : "Dodaj aktywo"} aria-haspopup={hasAllPortfoliosSelected ? undefined : "dialog"} aria-expanded={hasAllPortfoliosSelected ? undefined : isQuickAddOpen}>+</button><NavigationLink item={withWorkspaceContext({ key: "performance", href: "/analytics/performance", label: "Analiza", glyph: "↗" })} active={isGroupActive(route, navigationGroups[1])} /><button ref={moreTriggerRef} type="button" className={isMoreOpen ? "workspace-mobile-more is-active" : "workspace-mobile-more"} onClick={() => setIsMoreOpen(true)} aria-haspopup="dialog" aria-expanded={isMoreOpen}><span aria-hidden="true">•••</span><small>Więcej</small></button></nav>
    {isQuickAddOpen ? <div className="workspace-sheet-backdrop" role="presentation" onMouseDown={() => setIsQuickAddOpen(false)}><section ref={quickAddDialogRef} tabIndex={-1} className="workspace-mobile-sheet" role="dialog" aria-modal="true" aria-label="Szybkie dodawanie" onMouseDown={(event) => event.stopPropagation()}><div className="workspace-sheet-handle" aria-hidden="true" /><p className="eyebrow">Szybkie działanie</p><h2>Dodaj do portfela</h2><Link href="/portfolio/positions?add=asset" onClick={() => setIsQuickAddOpen(false)}>Dodaj instrument ręcznie <span aria-hidden="true">→</span></Link><Link href="/portfolio/import" onClick={() => setIsQuickAddOpen(false)}>Zaimportuj historię od brokera <span aria-hidden="true">→</span></Link><button type="button" onClick={() => setIsQuickAddOpen(false)}>Anuluj</button></section></div> : null}
    {isMoreOpen ? <div className="workspace-sheet-backdrop" role="presentation" onMouseDown={() => setIsMoreOpen(false)}><section ref={moreDialogRef} tabIndex={-1} className="workspace-mobile-sheet workspace-more-sheet" role="dialog" aria-modal="true" aria-label="Więcej sekcji" onMouseDown={(event) => event.stopPropagation()}><div className="workspace-sheet-handle" aria-hidden="true" /><p className="eyebrow">Mexo</p><h2>Więcej</h2><div className="workspace-sheet-links">{[...directNavigation.slice(1), ...navigationGroups.flatMap((group) => group.items).filter((item) => !["positions", "performance"].includes(item.key))].map((item) => <Link key={item.key} href={getWorkspaceHref(item.href)} onClick={() => setIsMoreOpen(false)}><span aria-hidden="true">{item.glyph}</span>{item.label}</Link>)}<Link href={getWorkspaceHref("/settings")} onClick={() => setIsMoreOpen(false)}><span aria-hidden="true">⚙</span>Ustawienia</Link></div><button type="button" className="workspace-logout-link" onClick={onLogout} disabled={isLoggingOut}>{isLoggingOut ? "Wylogowywanie…" : "Wyloguj"}</button></section></div> : null}
  </div>;
}

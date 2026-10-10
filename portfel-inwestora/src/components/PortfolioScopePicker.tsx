"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPortfolioScopeLabel, normalizePortfolioScope, type PortfolioScopeSelection } from "@/lib/portfolio-selection";
import { PORTFOLIO_ACCOUNT_TYPE_LABELS, normalizePortfolioAccountType } from "@/lib/portfolio-account-rules";
import type { InvestmentPortfolio } from "@/types/portfolio";

type Props = {
  portfolios: InvestmentPortfolio[];
  selection: PortfolioScopeSelection;
  disabled?: boolean;
  mobile?: boolean;
  onApply: (selection: PortfolioScopeSelection) => void;
};

const focusableSelector = "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";

export default function PortfolioScopePicker({ portfolios, selection, disabled = false, mobile = false, onApply }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [draftAll, setDraftAll] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const allIds = useMemo(() => portfolios.map(({ id }) => id), [portfolios]);
  const displayLabel = getPortfolioScopeLabel(selection, portfolios);
  const selectedCount = selection.mode === "ALL"
    ? portfolios.length
    : selection.mode === "SINGLE"
      ? 1
      : selection.portfolioIds.length;

  const open = () => {
    setDraftAll(selection.mode === "ALL");
    setDraftIds(selection.mode === "ALL" ? allIds : selection.mode === "SINGLE" ? [selection.portfolioId] : [...selection.portfolioIds]);
    setIsOpen(true);
  };

  const close = () => setIsOpen(false);

  useEffect(() => {
    if (!isOpen) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(focusableSelector);
      (first ?? dialogRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
      } else if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.requestAnimationFrame(() => trigger?.focus());
    };
  }, [isOpen]);

  const apply = () => {
    if (!draftAll && draftIds.length === 0) return;
    const next: PortfolioScopeSelection = draftAll
      ? { mode: "ALL" }
      : { mode: "CUSTOM", portfolioIds: draftIds };
    onApply(normalizePortfolioScope(next, allIds));
    close();
  };

  return <div className={mobile ? "portfolio-scope-control is-mobile" : "portfolio-scope-control"}>
    <span className="portfolio-scope-control-label">{mobile ? "Zakres portfeli" : "Analizowany zakres"}</span>
    <button ref={triggerRef} type="button" className="portfolio-scope-trigger" onClick={open} disabled={disabled || portfolios.length === 0} aria-haspopup="dialog" aria-expanded={isOpen}>
      <span className="portfolio-scope-trigger-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="8" cy="7" r="2" /><circle cx="15" cy="12" r="2" /></svg></span>
      <span className="portfolio-scope-trigger-copy"><strong>{displayLabel}</strong>{selectedCount > 1 ? <small>{selectedCount} z {portfolios.length} rachunków · widok łączny</small> : <small>{selectedCount === 1 ? "Jeden portfel" : "Brak portfeli"}</small>}</span>
      <span className="portfolio-scope-trigger-chevron" aria-hidden="true">⌄</span>
    </button>

    {isOpen ? createPortal(<div className={`portfolio-scope-backdrop${mobile ? " is-mobile" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={dialogRef} tabIndex={-1} className="portfolio-scope-dialog" role="dialog" aria-modal="true" aria-labelledby="portfolio-scope-title">
        <header className="portfolio-scope-dialog-head"><span className="portfolio-scope-dialog-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="8" cy="7" r="2" /><circle cx="15" cy="12" r="2" /></svg></span><div><p className="eyebrow">Zakres analizy</p><h2 id="portfolio-scope-title">Wybierz portfele</h2><p>Wspólny widok pozycji, wyników, wykresów i przepływów.</p></div><button type="button" className="portfolio-scope-close" onClick={close} aria-label="Zamknij wybór portfeli">×</button></header>
        <div className="portfolio-scope-list mexo-option-scroll-area">
          <label className={`portfolio-scope-option portfolio-scope-option-all${draftAll ? " is-selected" : ""}`}>
            <input type="radio" name="portfolio-scope" checked={draftAll} onChange={() => setDraftAll(true)} />
            <span className="portfolio-scope-option-check" aria-hidden="true">✓</span>
            <span className="portfolio-scope-option-copy"><strong>Wszystkie portfele</strong><small>Połączony widok wszystkich rzeczywistych rachunków</small></span>
            <span className="portfolio-scope-option-count">{portfolios.length}</span>
          </label>
          <div className="portfolio-scope-list-heading"><span>Wybierz dowolny zestaw</span><button type="button" onClick={() => { setDraftAll(false); setDraftIds([...allIds]); }}>Zaznacz wszystkie</button></div>
          {portfolios.map((portfolio) => {
            const checked = draftAll || draftIds.includes(portfolio.id);
            return <label key={portfolio.id} className={`portfolio-scope-option${checked && !draftAll ? " is-selected" : ""}`}>
              <input type="checkbox" checked={checked} onChange={(event) => {
                setDraftAll(false);
                setDraftIds((current) => event.target.checked ? [...new Set([...current, portfolio.id])] : current.filter((id) => id !== portfolio.id));
              }} />
              <span className="portfolio-scope-option-check" aria-hidden="true">✓</span>
              <span className="portfolio-scope-option-copy"><strong>{portfolio.name}</strong><small>{PORTFOLIO_ACCOUNT_TYPE_LABELS[normalizePortfolioAccountType(portfolio.accountType)]}</small></span>
            </label>;
          })}
        </div>
        <footer className="portfolio-scope-dialog-foot"><span aria-live="polite">{draftAll ? portfolios.length : draftIds.length} {draftAll || draftIds.length > 1 ? "portfeli" : draftIds.length === 1 ? "portfel" : "wybranych"}</span><div><button type="button" className="ghost-button" onClick={close}>Anuluj</button><button type="button" className="primary-button" onClick={apply} disabled={!draftAll && draftIds.length === 0}>Zastosuj</button></div></footer>
      </section>
    </div>, document.body) : null}
  </div>;
}

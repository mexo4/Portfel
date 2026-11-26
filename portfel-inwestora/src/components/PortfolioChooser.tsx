"use client";

import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";

const BUTTON_LIMIT = 6;

/**
 * For an action that needs one portfolio while the combined view is open. Choosing a portfolio
 * switches the scope on the same page, so the user stays on the action they came for.
 */
export default function PortfolioChooser({ label }: { label: string }) {
  const workspace = usePortfolioWorkspace();
  const choose = (portfolioId: string) => workspace.onPortfolioScopeChange({ mode: "SINGLE", portfolioId });

  return (
    <div className="portfolio-chooser" role="group" aria-label={label}>
      <span>{label}</span>
      {workspace.portfolios.length > BUTTON_LIMIT ? (
        <select value="" disabled={workspace.isPortfolioMutationPending} aria-label={label} onChange={(event) => { if (event.target.value) choose(event.target.value); }}>
          <option value="">Wybierz portfel</option>
          {workspace.portfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}
        </select>
      ) : workspace.portfolios.map((portfolio) => (
        <button key={portfolio.id} type="button" className="ghost-button" disabled={workspace.isPortfolioMutationPending} onClick={() => choose(portfolio.id)}>{portfolio.name}</button>
      ))}
    </div>
  );
}

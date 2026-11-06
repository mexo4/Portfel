"use client";

import { useState } from "react";
import CashWorkspace from "@/components/CashWorkspace";
import DividendCashWorkspace from "@/components/DividendCashWorkspace";
import type { CurrencyCode, FxRates, InvestmentPortfolio } from "@/types/portfolio";

type Props = {
  portfolio: InvestmentPortfolio;
  portfolios?: InvestmentPortfolio[];
  activePortfolioId?: string;
  isAllPortfoliosSelected?: boolean;
  isPortfolioMutationPending?: boolean;
  fxRates: FxRates;
  baseCurrency: CurrencyCode;
  totalPortfolioValue?: number;
  isAdmin: boolean;
  onPortfolioChange: (portfolio: InvestmentPortfolio) => void | Promise<void>;
};

export default function PortfolioIncomeWorkspace(props: Props) {
  const [view, setView] = useState<"dividends" | "cash">("dividends");
  const activeView = view;

  if (props.isAllPortfoliosSelected) {
    return (
      <section className="workspace-income">
        <CashWorkspace portfolio={props.portfolio} portfolios={props.portfolios} activePortfolioId={props.activePortfolioId ?? props.portfolio.id} isAllPortfoliosSelected isPortfolioMutationPending={props.isPortfolioMutationPending} fxRates={props.fxRates} baseCurrency={props.baseCurrency} totalPortfolioValue={props.totalPortfolioValue} onPortfolioChange={props.onPortfolioChange} />
      </section>
    );
  }

  return (
    <section className="workspace-income">
      <header className="income-workspace-heading">
        <div><p className="eyebrow">Portfel · {props.portfolio.name}</p><h2 className="section-title">Dywidendy i gotówka</h2><p className="section-copy">Historia i salda pozostają przypisane do tego rachunku.</p></div>
        <span className="income-currency-tag">Waluta prezentacji <strong>{props.baseCurrency}</strong></span>
      </header>
      <nav className="workspace-subnav" aria-label="Dywidendy i gotowka">
        <button type="button" className={activeView === "dividends" ? "is-active" : ""} onClick={() => setView("dividends")}>Dywidendy</button>
        <button type="button" className={activeView === "cash" ? "is-active" : ""} onClick={() => setView("cash")}>Gotowka</button>
      </nav>
      {activeView === "dividends" ? <DividendCashWorkspace {...props} activeView="dividends" /> : <CashWorkspace portfolio={props.portfolio} portfolios={props.portfolios} activePortfolioId={props.activePortfolioId ?? props.portfolio.id} isPortfolioMutationPending={props.isPortfolioMutationPending} fxRates={props.fxRates} baseCurrency={props.baseCurrency} totalPortfolioValue={props.totalPortfolioValue} onPortfolioChange={props.onPortfolioChange} />}
    </section>
  );
}

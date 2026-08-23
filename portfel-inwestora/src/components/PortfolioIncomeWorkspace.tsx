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
        <CashWorkspace portfolio={props.portfolio} portfolios={props.portfolios} activePortfolioId={props.activePortfolioId ?? props.portfolio.id} isAllPortfoliosSelected fxRates={props.fxRates} baseCurrency={props.baseCurrency} totalPortfolioValue={props.totalPortfolioValue} onPortfolioChange={props.onPortfolioChange} />
      </section>
    );
  }

  return (
    <section className="workspace-income">
      <nav className="workspace-subnav" aria-label="Dywidendy i gotowka">
        <button type="button" className={activeView === "dividends" ? "is-active" : ""} onClick={() => setView("dividends")}>Dywidendy</button>
        <button type="button" className={activeView === "cash" ? "is-active" : ""} onClick={() => setView("cash")}>Gotowka</button>
      </nav>
      {activeView === "dividends" ? <DividendCashWorkspace {...props} activeView="dividends" /> : <CashWorkspace portfolio={props.portfolio} portfolios={props.portfolios} activePortfolioId={props.activePortfolioId ?? props.portfolio.id} fxRates={props.fxRates} baseCurrency={props.baseCurrency} totalPortfolioValue={props.totalPortfolioValue} onPortfolioChange={props.onPortfolioChange} />}
    </section>
  );
}

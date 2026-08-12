"use client";

import { useState } from "react";
import DividendCashWorkspace from "@/components/DividendCashWorkspace";
import type { CurrencyCode, FxRates, InvestmentPortfolio } from "@/types/portfolio";

type PortfolioIncomeWorkspaceProps = { portfolio: InvestmentPortfolio; fxRates: FxRates; baseCurrency: CurrencyCode; onPortfolioChange: (portfolio: InvestmentPortfolio) => void };

export default function PortfolioIncomeWorkspace(props: PortfolioIncomeWorkspaceProps) {
  const [view, setView] = useState<"dividends" | "cash">("dividends");
  return <section className="workspace-income"><nav className="workspace-subnav" aria-label="Dywidendy i gotówka"><button type="button" className={view === "dividends" ? "is-active" : ""} onClick={() => setView("dividends")}>Dywidendy</button><button type="button" className={view === "cash" ? "is-active" : ""} onClick={() => setView("cash")}>Gotówka</button></nav><DividendCashWorkspace {...props} activeView={view} /></section>;
}

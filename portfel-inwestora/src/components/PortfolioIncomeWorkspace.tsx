"use client";

import { useState } from "react";
import DividendCashWorkspace from "@/components/DividendCashWorkspace";
import type { CurrencyCode, FxRates, InvestmentPortfolio } from "@/types/portfolio";

type Props = { portfolio: InvestmentPortfolio; fxRates: FxRates; baseCurrency: CurrencyCode; isAdmin: boolean; onPortfolioChange: (portfolio: InvestmentPortfolio) => void };

export default function PortfolioIncomeWorkspace(props: Props) {
  const [view, setView] = useState<"dividends" | "cash">("dividends");
  const activeView = props.isAdmin ? view : "dividends";
  return <section className="workspace-income"><nav className="workspace-subnav" aria-label="Dywidendy i gotówka"><button type="button" className={activeView === "dividends" ? "is-active" : ""} onClick={() => setView("dividends")}>Dywidendy</button>{props.isAdmin ? <button type="button" className={activeView === "cash" ? "is-active" : ""} onClick={() => setView("cash")}>Gotówka</button> : null}</nav><DividendCashWorkspace {...props} activeView={activeView} /></section>;
}

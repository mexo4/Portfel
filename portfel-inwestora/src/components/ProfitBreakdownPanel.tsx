"use client";

import { useMemo } from "react";
import { buildProfitBreakdown, type ProfitSource } from "@/lib/profit-breakdown";
import { formatCurrency } from "@/lib/utils";
import type { FxRates, InvestmentPortfolio } from "@/types/portfolio";

const POSITION_KEYS = new Set(["open-price", "open-fx", "open-fees", "realized-price", "realized-fx", "realized-fees", "bonds", "manual-results"]);
const tone = (value: number) => (value > 0 ? "tone-positive" : value < 0 ? "tone-negative" : undefined);

function SourceRow({ item, scale }: { item: ProfitSource; scale: number }) {
  const width = scale > 0 ? Math.max(2, Math.round((Math.abs(item.amountPln) / scale) * 100)) : 0;
  return (
    <li className="profit-source">
      <div className="profit-source-text">
        <strong>{item.label}</strong>
        <small>{item.description}</small>
      </div>
      <div className="profit-source-value">
        <span className={tone(item.amountPln)}>{formatCurrency(item.amountPln, "PLN")}</span>
        <span className="profit-source-bar" aria-hidden="true"><i className={item.amountPln < 0 ? "is-negative" : undefined} style={{ width: `${width}%` }} /></span>
      </div>
    </li>
  );
}

export default function ProfitBreakdownPanel({
  portfolios,
  fxRates,
  flowsProfitLossPln,
}: {
  portfolios: InvestmentPortfolio[];
  fxRates: FxRates;
  /** Value now minus net external capital, from the portfolio history; null while it loads. */
  flowsProfitLossPln: number | null;
}) {
  const breakdown = useMemo(() => buildProfitBreakdown({ portfolios, fxRates, flowsProfitLossPln }), [portfolios, fxRates, flowsProfitLossPln]);
  const positionSources = breakdown.sources.filter((item) => POSITION_KEYS.has(item.key));
  const accountSources = breakdown.sources.filter((item) => !POSITION_KEYS.has(item.key) && item.key !== "remainder");
  const remainder = breakdown.sources.find((item) => item.key === "remainder");
  const scale = Math.max(0, ...breakdown.sources.map((item) => Math.abs(item.amountPln)));
  const accountSubtotal = accountSources.reduce((total, item) => total + item.amountPln, 0);

  if (breakdown.sources.length === 0) return null;

  return (
    <section className="risk-section" aria-labelledby="profit-breakdown-title">
      <div className="risk-section-heading">
        <div>
          <p className="eyebrow">Źródła wyniku</p>
          <h3 id="profit-breakdown-title">Skąd wynik</h3>
        </div>
        <span>Od początku · w PLN</span>
      </div>
      <div className="profit-breakdown">
        <div className="profit-group">
          <div className="profit-group-head"><span>Pozycje: ceny, kursy walut i prowizje</span><strong className={tone(breakdown.nominalPln)}>{formatCurrency(breakdown.nominalPln, "PLN")}</strong></div>
          <ul>{positionSources.map((item) => <SourceRow key={item.key} item={item} scale={scale} />)}</ul>
        </div>
        {accountSources.length > 0 ? (
          <div className="profit-group">
            <div className="profit-group-head"><span>Dochody i koszty na rachunku</span><strong className={tone(accountSubtotal)}>{formatCurrency(accountSubtotal, "PLN")}</strong></div>
            <ul>{accountSources.map((item) => <SourceRow key={item.key} item={item} scale={scale} />)}</ul>
          </div>
        ) : null}
        {remainder ? (
          <div className="profit-group">
            <div className="profit-group-head"><span>Pozostałe</span><strong className={tone(remainder.amountPln)}>{formatCurrency(remainder.amountPln, "PLN")}</strong></div>
            <ul><SourceRow item={remainder} scale={scale} /></ul>
          </div>
        ) : null}
        <div className="profit-total">
          <span>{breakdown.flowsProfitLossPln === null ? "Razem z wymienionych źródeł" : "Wynik portfela (wartość minus wpłaty netto)"}</span>
          <strong className={tone(breakdown.flowsProfitLossPln ?? breakdown.explainedPln)}>{formatCurrency(breakdown.flowsProfitLossPln ?? breakdown.explainedPln, "PLN")}</strong>
        </div>
      </div>
      <p className="risk-source-note">
        „Wynik nominalny” w podsumowaniu to pierwsza grupa: ceny, kursy i prowizje pozycji. Dywidendy, odsetki, opłaty i podatki trafiają na rachunek gotówkowy, więc liczą się dopiero w wyniku całego portfela. Kwoty w walutach są przeliczone po kursach zapisanych przy operacjach albo, gdy ich brak, po dzisiejszych.
      </p>
    </section>
  );
}

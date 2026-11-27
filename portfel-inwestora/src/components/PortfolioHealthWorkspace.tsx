"use client";

import { useMemo, useState } from "react";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { buildCurrencyExposure } from "@/lib/currency-exposure";
import { getPortfolioInstrumentClass } from "@/lib/geographic-allocation";
import { instrumentKeyOf } from "@/lib/instrument-chart";
import { calculateCashBalances, ensurePortfolioCoreModel } from "@/lib/operation-engine";
import { assessPortfolioHealth, HEALTH_SEVERITY_LABELS, HEALTH_WEIGHTS, type HealthInput } from "@/lib/portfolio-health";
import { convertCurrency } from "@/lib/pricing";

/** Kondycja portfela: what the fixed rules found, each with the rule it follows. */
export default function PortfolioHealthWorkspace() {
  const workspace = usePortfolioWorkspace();
  const base = workspace.activeBaseCurrency;
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const profiles = useMemo(() => workspace.userProfile.etfCurrencyProfiles ?? [], [workspace.userProfile.etfCurrencyProfiles]);

  const health = useMemo(() => {
    const holdings: HealthInput["holdings"] = workspace.groupedAssets.map((group) => ({
      key: instrumentKeyOf(group),
      name: group.name,
      isEtf: getPortfolioInstrumentClass(group) === "etf",
      value: group.hasBaseValuation ? group.marketValueBase : 0,
      isValued: group.hasBaseValuation,
      dailyChange: group.hasDailyChange && typeof group.dailyChangeBase === "number" ? group.dailyChangeBase : null,
      profitLossPercent: group.hasBaseValuation ? group.profitLossPercent : null,
      priceDate: group.kind === "bond" ? null : group.latestPriceDate ?? null,
    }));
    const cash = workspace.selectedPortfolios.flatMap((portfolio) => {
      const core = ensurePortfolioCoreModel(portfolio);
      return calculateCashBalances(core.operations ?? [], core.accounts).map((balance) => ({
        account: `${core.accounts?.find((account) => account.id === balance.accountId)?.name ?? "Konto"} (${portfolio.name})`,
        currency: balance.currency,
        value: convertCurrency(balance.amount, balance.currency, base, workspace.fxRates),
      }));
    });
    const exposure = buildCurrencyExposure({
      holdings: workspace.groupedAssets.map((group) => ({ key: instrumentKeyOf(group), name: group.name, instrumentClass: getPortfolioInstrumentClass(group), currency: group.marketCurrency, value: group.marketValueBase })),
      cash,
      profiles,
    });
    return assessPortfolioHealth({ holdings, cash, currencies: exposure.buckets, baseCurrency: base, today });
  }, [base, profiles, today, workspace.fxRates, workspace.groupedAssets, workspace.selectedPortfolios]);

  if (health.score === null) {
    return <section className="panel"><p className="empty-row">Dodaj pozycje lub gotówkę, aby zobaczyć kondycję portfela.</p></section>;
  }

  return (
    <div className="reports-workspace">
      <section className="panel health-summary">
        <div className="health-score" role="img" aria-label={`Wynik reguł: ${health.score} na 100`}>
          <svg viewBox="0 0 36 36" aria-hidden="true">
            <circle cx="18" cy="18" r="15.9" className="health-score-track" />
            <circle cx="18" cy="18" r="15.9" className="health-score-value" strokeDasharray={`${health.score} 100`} />
          </svg>
          <strong>{health.score}</strong>
          <small>na 100</small>
        </div>
        <div className="health-summary-text">
          <p className="eyebrow">Kondycja portfela</p>
          <h2 className="section-title">{health.findings.length === 0 ? "Żadna reguła nie zgłosiła uwag." : `Reguły zgłosiły uwagi: ${health.findings.length}.`}</h2>
          <p className="section-copy">
            Ważne: {health.counts.important} · Uwagi: {health.counts.attention} · Obserwacje: {health.counts.note}. Od 100 odejmujemy {HEALTH_WEIGHTS.important} punktów za ważną, {HEALTH_WEIGHTS.attention} za uwagę i {HEALTH_WEIGHTS.note} za obserwację.
          </p>
          <p className="field-note">Stałe reguły, bez sztucznej inteligencji. To nie jest ocena opłacalności ani rekomendacja inwestycyjna.</p>
        </div>
      </section>

      {health.findings.length > 0 ? (
        <ul className="health-findings">
          {health.findings.map((finding) => (
            <li key={finding.id} className={`health-card is-${finding.severity}`}>
              <div className="health-card-head"><span>{finding.area}</span><em>{HEALTH_SEVERITY_LABELS[finding.severity]}</em></div>
              <h3>{finding.title}</h3>
              <p>{finding.detail}</p>
              <small>Reguła: {finding.rule}</small>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="panel health-passed">
        <summary>Spełnione reguły ({health.passed.length})</summary>
        <ul>{health.passed.map((rule) => <li key={rule}>{rule}</li>)}</ul>
      </details>
    </div>
  );
}

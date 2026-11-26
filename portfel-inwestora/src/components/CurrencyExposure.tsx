"use client";

import { useMemo, useState } from "react";
import { usePortfolioWorkspace } from "@/components/PortfolioWorkspaceContext";
import { buildCurrencyExposure, ETF_WITHOUT_SPLIT, type ExposureEtf } from "@/lib/currency-exposure";
import { getPortfolioInstrumentClass } from "@/lib/geographic-allocation";
import { instrumentKeyOf } from "@/lib/instrument-chart";
import { calculateCashBalances, ensurePortfolioCoreModel } from "@/lib/operation-engine";
import { convertCurrency } from "@/lib/pricing";
import { formatCurrency } from "@/lib/utils";
import type { EtfCurrencyWeight } from "@/types/portfolio";

/** Ekspozycja walutowa: what the money is really in, with ETFs split into their currencies. */

const WEIGHT_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CHF", "PLN", "CAD", "AUD", "HKD", "CNY", "TWD", "INR", "KRW", "BRL", "SEK", "DKK", "NOK", "SGD", "ZAR", "MXN"];
const percent = new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type DraftWeight = { currency: string; percent: string };

function SplitEditor({ etf, onSave, onRemove, onCancel }: { etf: ExposureEtf; onSave: (weights: EtfCurrencyWeight[]) => void; onRemove?: () => void; onCancel: () => void }) {
  const [rows, setRows] = useState<DraftWeight[]>(() => (etf.weights?.length ? etf.weights.map((weight) => ({ currency: weight.currency, percent: String(weight.percent) })) : [{ currency: "USD", percent: "" }]));
  const parsed = rows.map((row) => ({ currency: row.currency, percent: Number(row.percent.replace(",", ".")) })).filter((row) => Number.isFinite(row.percent) && row.percent > 0);
  const total = parsed.reduce((sum, row) => sum + row.percent, 0);
  const isValid = parsed.length > 0 && total <= 100.5 && parsed.every((row) => row.percent <= 100);
  const update = (index: number, patch: Partial<DraftWeight>) => setRows((current) => current.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  return (
    <div className="currency-split-editor">
      <p className="field-note">Przepisz udziały walut z karty funduszu (factsheet) u jego dostawcy. Jeśli karta pokazuje tylko kraje, przypisz im waluty. Reszta do 100% trafi do „Inne waluty”.</p>
      {rows.map((row, index) => (
        <div className="currency-split-row" key={index}>
          <label className="field"><span>Waluta</span><select value={row.currency} onChange={(event) => update(index, { currency: event.target.value })}>{WEIGHT_CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></label>
          <label className="field"><span>Udział (%)</span><input inputMode="decimal" value={row.percent} onChange={(event) => update(index, { percent: event.target.value })} placeholder="np. 62,5" /></label>
          {rows.length > 1 ? <button type="button" className="ghost-button" onClick={() => setRows((current) => current.filter((_, position) => position !== index))} aria-label={`Usuń walutę ${row.currency}`}>Usuń</button> : null}
        </div>
      ))}
      <p className={total > 100.5 ? "field-note field-note-error" : "field-note"}>Razem: {percent.format(total)}%{total > 100.5 ? " — to więcej niż 100%." : ""}</p>
      <div className="currency-split-actions">
        <button type="button" className="ghost-button" onClick={() => setRows((current) => [...current, { currency: WEIGHT_CURRENCIES.find((currency) => !current.some((row) => row.currency === currency)) ?? "USD", percent: "" }])} disabled={rows.length >= 20}>Dodaj walutę</button>
        <button type="button" className="primary-button" onClick={() => onSave(parsed)} disabled={!isValid}>Zapisz skład</button>
        {onRemove ? <button type="button" className="ghost-button admin-danger-button" onClick={onRemove}>Usuń zapisany skład</button> : null}
        <button type="button" className="ghost-button" onClick={onCancel}>Anuluj</button>
      </div>
    </div>
  );
}

export default function CurrencyExposure() {
  const workspace = usePortfolioWorkspace();
  const base = workspace.activeBaseCurrency;
  const profiles = useMemo(() => workspace.userProfile.etfCurrencyProfiles ?? [], [workspace.userProfile.etfCurrencyProfiles]);
  const [editing, setEditing] = useState<string | null>(null);

  const exposure = useMemo(() => {
    const holdings = workspace.groupedAssets.map((group) => ({
      key: instrumentKeyOf(group),
      name: group.name,
      instrumentClass: getPortfolioInstrumentClass(group),
      currency: group.marketCurrency,
      value: group.marketValueBase,
    }));
    const cash = workspace.selectedPortfolios.flatMap((portfolio) => {
      const core = ensurePortfolioCoreModel(portfolio);
      return calculateCashBalances(core.operations ?? [], core.accounts).map((balance) => ({ currency: balance.currency, value: convertCurrency(balance.amount, balance.currency, base, workspace.fxRates) }));
    });
    return buildCurrencyExposure({ holdings, cash, profiles });
  }, [base, profiles, workspace.fxRates, workspace.groupedAssets, workspace.selectedPortfolios]);

  const save = (key: string, weights: EtfCurrencyWeight[] | null) => {
    const others = profiles.filter((profile) => profile.key !== key);
    workspace.onUpdateEtfCurrencyProfiles(weights ? [...others, { key, weights, updatedAt: new Date().toISOString() }] : others);
    setEditing(null);
  };

  const largest = exposure.buckets.reduce((value, bucket) => Math.max(value, bucket.percent), 0);

  return (
    <section className="panel currency-exposure">
      <div className="risk-section-heading">
        <h2 className="section-title">Ekspozycja walutowa</h2>
        <span>Pozycje i gotówka · {formatCurrency(exposure.total, base)}</span>
      </div>
      {exposure.buckets.length === 0 ? <p className="empty-row">Brak pozycji i gotówki w wybranych portfelach.</p> : (
        <ul className="currency-bars">
          {exposure.buckets.map((bucket) => (
            <li key={bucket.id}>
              <span className="currency-bars-label">{bucket.label}</span>
              <span className="currency-bars-track" aria-hidden="true"><i className={bucket.id === ETF_WITHOUT_SPLIT || bucket.id === "other" ? "is-unknown" : undefined} style={{ width: `${largest > 0 ? (bucket.percent / largest) * 100 : 0}%` }} /></span>
              <strong>{percent.format(bucket.percent)}%</strong>
              <span className="currency-bars-value">{formatCurrency(bucket.value, base)}</span>
            </li>
          ))}
        </ul>
      )}
      {exposure.negativeCash < -0.5 ? <p className="field-note">Ujemne saldo gotówki ({formatCurrency(exposure.negativeCash, base)}) nie jest liczone w udziałach.</p> : null}
      <p className="field-note">Akcje i obligacje liczą się w walucie notowania, gotówka w swojej walucie. Kryptowaluty są osobno. ETF liczy się według waluty tego, co posiada: skład zapisany przez Ciebie albo, gdy indeks z nazwy składa się z jednej waluty, ta waluta.</p>

      {exposure.etfs.length > 0 ? (
        <div className="currency-etfs">
          <h3>Skład walutowy ETF</h3>
          <ul>
            {exposure.etfs.map((etf) => (
              <li key={etf.key}>
                <div className="currency-etf-line">
                  <div>
                    <strong>{etf.name}</strong>
                    <small>{etf.weights ? etf.weights.map((weight) => `${weight.currency} ${percent.format(weight.percent)}%`).join(" · ") : "Brak składu"} — {etf.source}</small>
                  </div>
                  <span className="num">{formatCurrency(etf.value, base)}</span>
                  <button type="button" className="ghost-button" aria-expanded={editing === etf.key} onClick={() => setEditing((current) => (current === etf.key ? null : etf.key))}>{etf.origin === "missing" ? "Podaj skład" : "Zmień skład"}</button>
                </div>
                {editing === etf.key ? <SplitEditor etf={etf} onSave={(weights) => save(etf.key, weights)} onRemove={etf.origin === "saved" ? () => save(etf.key, null) : undefined} onCancel={() => setEditing(null)} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

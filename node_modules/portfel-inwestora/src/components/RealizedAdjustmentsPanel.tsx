"use client";

import { SUPPORTED_CURRENCIES } from "@/lib/constants";
import { formatCurrency, formatDate } from "@/lib/utils";
import type {
  PortfolioRealizedAdjustment,
  RealizedAdjustmentDraft,
} from "@/types/portfolio";

type RealizedAdjustmentsPanelProps = {
  draft: RealizedAdjustmentDraft;
  adjustments: PortfolioRealizedAdjustment[];
  error?: string | null;
  onChange: (draft: RealizedAdjustmentDraft) => void;
  onSubmit: () => void;
  onRemove: (adjustmentId: string) => void;
};

const parseNumericInput = (value: string) => {
  if (!value.trim()) {
    return 0;
  }

  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const getCurrencyOptions = (currency: string) =>
  Array.from(new Set([...SUPPORTED_CURRENCIES, currency].filter(Boolean))).map((item) =>
    item.toUpperCase()
  );

export default function RealizedAdjustmentsPanel({
  draft,
  adjustments,
  error,
  onChange,
  onSubmit,
  onRemove,
}: RealizedAdjustmentsPanelProps) {
  const currencyOptions = getCurrencyOptions(draft.currency);

  return (
    <section className="panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Historia</p>
          <h2 className="section-title">Wynik zrealizowany sprzed aplikacji</h2>
        </div>

        <p className="section-copy">
          Tutaj dopisujesz historyczny zysk albo strate z transakcji, ktorych nie bylo
          jeszcze w aplikacji.
        </p>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_1fr_1fr_1.4fr_auto]">
        <label className="field">
          <span>Kwota</span>
          <input
            type="number"
            step="0.01"
            value={draft.amountInput}
            onChange={(event) =>
              onChange({
                ...draft,
                amountInput: event.target.value,
                amount: parseNumericInput(event.target.value),
              })
            }
            placeholder="Np. 300 albo -150"
          />
        </label>

        <label className="field">
          <span>Waluta</span>
          <select
            value={draft.currency}
            onChange={(event) =>
              onChange({
                ...draft,
                currency: event.target.value,
              })
            }
          >
            {currencyOptions.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Data</span>
          <input
            type="date"
            value={draft.date}
            onChange={(event) =>
              onChange({
                ...draft,
                date: event.target.value,
              })
            }
          />
        </label>

        <label className="field">
          <span>Opis opcjonalny</span>
          <input
            value={draft.note}
            onChange={(event) =>
              onChange({
                ...draft,
                note: event.target.value,
              })
            }
            placeholder="Np. sprzedaz sprzed zalozenia konta"
          />
        </label>

        <button className="primary-button self-end" type="button" onClick={onSubmit}>
          Dodaj wynik
        </button>
      </div>

      {error ? <p className="field-note field-note-error mt-4">{error}</p> : null}

      {adjustments.length === 0 ? (
        <p className="field-note mt-5">Brak dodanego wyniku historycznego.</p>
      ) : (
        <div className="mt-6 grid gap-4">
          {adjustments.map((adjustment) => (
            <article key={adjustment.id} className="lot-card">
              <div className="lot-card-header">
                <div>
                  <p className="table-title">{formatDate(adjustment.date)}</p>
                  <p className="table-note">
                    {adjustment.source === "bond-coupon"
                      ? `Automatyczny kupon obligacji ${adjustment.bondCode ?? ""}`.trim()
                      : "Wynik historyczny"}
                  </p>
                  {adjustment.note ? <p className="table-note">{adjustment.note}</p> : null}
                </div>

                <strong
                  className={adjustment.amount >= 0 ? "tone-positive" : "tone-negative"}
                >
                  {formatCurrency(adjustment.amount, adjustment.currency)}
                </strong>
              </div>

              {adjustment.currency !== "PLN" ? (
                <p className="table-note mt-3">
                  Snapshot do wyniku lacznego: {formatCurrency(adjustment.amountPlnSnapshot)}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                {adjustment.source === "manual" ? (
                  <>
                    <span className="table-note">
                      Usuniecie cofnie ten historyczny wynik z podsumowan i porownania z benchmarkami.
                    </span>

                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => onRemove(adjustment.id)}
                    >
                      Usun
                    </button>
                  </>
                ) : (
                  <span className="table-note">
                    Automatyczny wpis kuponowy z obligacji jest liczony systemowo i nie mozna go usunac recznie.
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

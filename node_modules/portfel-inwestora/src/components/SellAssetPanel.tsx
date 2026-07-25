"use client";

import type { SellAssetDraft } from "@/types/portfolio";

type SellAssetPanelProps = {
  draft: SellAssetDraft;
  error: string | null;
  onChange: (draft: SellAssetDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

const parseNumericInput = (value: string) => {
  if (!value.trim()) {
    return 0;
  }

  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function SellAssetPanel({
  draft,
  error,
  onChange,
  onCancel,
  onSubmit,
}: SellAssetPanelProps) {
  return (
    <section className="panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Sprzedaz aktywa</p>
          <h2 className="section-title">
            {draft.name} ({draft.symbol})
          </h2>
        </div>

        <p className="section-copy">
          Dostepna ilosc: {draft.maxQuantity} {draft.maxQuantity === 1 ? "sztuka" : "szt."}
        </p>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-4">
        <label className="field">
          <span>Ilosc do sprzedazy</span>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={draft.quantityInput}
            onChange={(event) =>
              onChange({
                ...draft,
                quantityInput: event.target.value,
                quantity: parseNumericInput(event.target.value),
              })
            }
          />
        </label>

        <label className="field">
          <span>Cena sprzedazy (1 szt)</span>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={draft.salePriceInput}
            onChange={(event) =>
              onChange({
                ...draft,
                salePriceInput: event.target.value,
                salePrice: parseNumericInput(event.target.value),
              })
            }
          />
        </label>

        <label className="field">
          <span>Data sprzedazy</span>
          <input
            type="date"
            value={draft.saleDate}
            onChange={(event) =>
              onChange({
                ...draft,
                saleDate: event.target.value,
              })
            }
          />
        </label>

        <label className="field">
          <span>Prowizja PLN</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.feePln}
            onChange={(event) =>
              onChange({
                ...draft,
                feePln: Number(event.target.value),
              })
            }
          />
        </label>
      </div>

      {error ? <p className="field-note field-note-error mt-4">{error}</p> : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" className="primary-button" onClick={onSubmit}>
          Zapisz sprzedaz
        </button>
        <button type="button" className="ghost-button" onClick={onCancel}>
          Anuluj
        </button>
      </div>
    </section>
  );
}

"use client";

import {
  KIND_LABELS,
  SEARCH_MODE_OPTIONS,
  SUPPORTED_CURRENCIES,
} from "@/lib/constants";
import { getSearchPlaceholder } from "@/lib/search";
import type {
  AssetDraft,
  AssetSearchMode,
  AssetSearchResult,
} from "@/types/portfolio";

type AddAssetFormProps = {
  searchMode: AssetSearchMode;
  draft: AssetDraft;
  results: AssetSearchResult[];
  lastAddedResult: AssetSearchResult | null;
  isSearching: boolean;
  isQuoteLoading: boolean;
  searchError: string | null;
  quoteError?: string | null;
  onDraftChange: (draft: AssetDraft) => void;
  onSearchModeChange: (mode: AssetSearchMode) => void;
  onQueryChange: (query: string) => void;
  onSymbolChange: (symbol: string) => void;
  onPickResult: (result: AssetSearchResult) => void;
  onReuseLastAddedResult: (result: AssetSearchResult) => void;
  onSubmit: () => void;
};

const parseNumericInput = (value: string) => {
  if (!value.trim()) {
    return 0;
  }

  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

export default function AddAssetForm({
  searchMode,
  draft,
  results,
  lastAddedResult,
  isSearching,
  isQuoteLoading,
  searchError,
  quoteError,
  onDraftChange,
  onSearchModeChange,
  onQueryChange,
  onSymbolChange,
  onPickResult,
  onReuseLastAddedResult,
  onSubmit,
}: AddAssetFormProps) {
  return (
    <section className="panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Dodaj pozycje</p>
          <h2 className="section-title">Najpierw wybierasz co dodajesz, potem wyszukujesz ticker</h2>
        </div>

        <p className="section-copy">
          Wpisujesz nazwe, klikasz wynik z listy i dopiero wtedy ticker wpada do formularza.
        </p>
      </div>

      <div className="mode-grid mt-6">
        {SEARCH_MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={searchMode === option.value ? "mode-card is-active" : "mode-card"}
            onClick={() => onSearchModeChange(option.value)}
          >
            <span className="mode-title">{option.label}</span>
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-6">
        <label className="field xl:col-span-2">
          <span>Wyszukiwarka</span>
          <input
            value={draft.query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={getSearchPlaceholder(searchMode)}
          />
          {isSearching ? <small className="field-note">Szukam wynikow...</small> : null}
          {isQuoteLoading ? <small className="field-note">Pobieram kurs...</small> : null}
          {!isSearching && draft.symbol ? (
            <small className="field-note">Wybrany ticker: {draft.symbol}</small>
          ) : null}
          {searchError ? (
            <small className="field-note field-note-error">{searchError}</small>
          ) : null}
          {quoteError ? (
            <small className="field-note field-note-error">{quoteError}</small>
          ) : null}
        </label>

        <label className="field">
          <span>Ticker / symbol</span>
          <input
            value={draft.symbol}
            onChange={(event) => onSymbolChange(event.target.value)}
            placeholder="AAPL / XTB / BTC / XAU"
          />
        </label>

        <label className="field">
          <span>Ilosc</span>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={draft.quantityInput}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                quantityInput: event.target.value,
                quantity: parseNumericInput(event.target.value),
              })
            }
          />
        </label>

        <label className="field">
          <span>Cena zakupu (1szt) </span>
          <input
            type="number"
            min="0"
            step="0.0001"
            value={draft.purchasePriceInput}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                purchasePriceInput: event.target.value,
                purchasePrice: parseNumericInput(event.target.value),
              })
            }
          />
        </label>

        <label className="field">
          <span>Data zakupu</span>
          <input
            type="date"
            value={draft.purchaseDate}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                purchaseDate: event.target.value,
              })
            }
          />
        </label>
      </div>

      {lastAddedResult ? (
        <div className="mt-4 max-w-xl">
          <p className="eyebrow">Ostatnio dodane</p>
          <button
            type="button"
            className="result-card mt-3 w-full text-left"
            onClick={() => onReuseLastAddedResult(lastAddedResult)}
          >
            <p className="result-title">{lastAddedResult.name}</p>
            <p className="result-meta">
              {lastAddedResult.symbol} - {KIND_LABELS[lastAddedResult.kind]}
            </p>
          </button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="field">
          <span>Waluta zakupu</span>
          <select
            value={draft.purchaseCurrency}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                purchaseCurrency: event.target.value as AssetDraft["purchaseCurrency"],
              })
            }
          >
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Waluta rynku</span>
          <select
            value={draft.marketCurrency}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                marketCurrency: event.target.value as AssetDraft["marketCurrency"],
              })
            }
          >
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Prowizja w PLN</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.feePln}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                feePln: Number(event.target.value),
              })
            }
          />
        </label>

        <button
          className="primary-button self-end"
          type="button"
          onClick={onSubmit}
          disabled={isQuoteLoading}
        >
          {isQuoteLoading ? "Pobieram kurs..." : "Dodaj do portfela"}
        </button>
      </div>

      {results.length > 0 ? (
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {results.map((result) => (
            <button
              key={`${result.symbol}-${result.providerId ?? "none"}`}
              type="button"
              className="result-card text-left"
              onClick={() => onPickResult(result)}
            >
              <p className="result-title">{result.name}</p>
              <p className="result-meta">
                {result.symbol} - {KIND_LABELS[result.kind]}
              </p>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

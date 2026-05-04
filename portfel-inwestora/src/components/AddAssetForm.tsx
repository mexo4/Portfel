"use client";

import {
  SEARCH_MODE_OPTIONS,
  SUPPORTED_CURRENCIES,
} from "@/lib/constants";
import { getMinimumSearchLength, getSearchPlaceholder } from "@/lib/search";
import type {
  AssetDraft,
  AssetSearchMode,
  AssetSearchResult,
} from "@/types/portfolio";

type AddAssetFormProps = {
  showModeSelector?: boolean;
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
  onBuySubmit: () => void;
  onSellSubmit: () => void;
};

const parseNumericInput = (value: string) => {
  if (!value.trim()) {
    return 0;
  }

  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const getCurrencyOptions = (...currencies: string[]) =>
  Array.from(new Set([...SUPPORTED_CURRENCIES, ...currencies.filter(Boolean)])).map(
    (currency) => currency.toUpperCase()
  );

export default function AddAssetForm({
  showModeSelector = true,
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
  onBuySubmit,
  onSellSubmit,
}: AddAssetFormProps) {
  const trimmedQuery = draft.query.trim();
  const minimumSearchLength = getMinimumSearchLength(searchMode);
  const hasActiveSearchQuery = trimmedQuery.length > 0;
  const hasReachedMinimumSearchLength = trimmedQuery.length >= minimumSearchLength;
  const shouldShowSearchPanel =
    hasActiveSearchQuery || results.length > 0 || isSearching;
  const shouldShowLastAdded =
    !hasActiveSearchQuery && !isSearching && !searchError && Boolean(lastAddedResult);
  const currencyOptions = getCurrencyOptions(draft.purchaseCurrency, draft.marketCurrency);
  const priceCurrency = draft.marketCurrency || "PLN";

  return (
    <section className="panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Dodaj pozycje</p>
          <h2 className="section-title">
            Najpierw wybierasz co dodajesz, potem wyszukujesz ticker
          </h2>
        </div>

        <p className="section-copy">
          Wpisujesz nazwe, klikasz wynik z listy i dopiero wtedy ticker wpada do
          formularza.
        </p>
      </div>

      {showModeSelector ? (
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
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-6">
        <div className="search-stack xl:col-span-2">
          <label className="field">
            <span>Wyszukiwarka</span>
            <input
              value={draft.query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={getSearchPlaceholder(searchMode)}
            />
            {isQuoteLoading ? <small className="field-note">Pobieram kurs...</small> : null}
            {!isSearching && draft.symbol ? (
              <small className="field-note">Wybrany ticker: {draft.symbol}</small>
            ) : null}
            {!hasActiveSearchQuery && searchError ? (
              <small className="field-note field-note-error">{searchError}</small>
            ) : null}
            {quoteError ? (
              <small className="field-note field-note-error">{quoteError}</small>
            ) : null}
          </label>
        </div>

        <label className="field">
          <span>Ticker / symbol</span>
          <input
            value={draft.symbol}
            onChange={(event) => onSymbolChange(event.target.value)}
            placeholder="AAPL / XTB / BTC / VWCE"
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
          <span>Cena transakcji (1 szt, {priceCurrency})</span>
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
          <span>Data transakcji</span>
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

      {shouldShowSearchPanel ? (
        <div className="mt-4">
          <div className="search-stack-panel">
            <div className="search-panel-header">
              <p className="search-panel-title">Sugestie</p>
              {results.length > 0 ? (
                <span className="search-panel-count">
                  {results.length}
                </span>
              ) : null}
            </div>

            {hasActiveSearchQuery && isSearching ? (
              <p className="field-note">Szukam wynikow...</p>
            ) : null}

            {hasActiveSearchQuery && searchError ? (
              <p className="field-note field-note-error">{searchError}</p>
            ) : null}

            {!isSearching && hasActiveSearchQuery && !hasReachedMinimumSearchLength ? (
              <p className="field-note">
                Wpisz min. {minimumSearchLength} znaki, aby zobaczyc wyniki.
              </p>
            ) : null}

            {!isSearching &&
            hasReachedMinimumSearchLength &&
            results.length === 0 &&
            !searchError ? (
              <p className="field-note">Brak wynikow</p>
            ) : null}

            {results.length > 0 ? (
              <div className="search-result-list">
                {results.map((result) => (
                  <button
                    key={`${result.symbol}-${result.providerId ?? "none"}`}
                    type="button"
                    className="search-result-card text-left"
                    onClick={() => onPickResult(result)}
                  >
                    <p className="search-result-title">{result.name}</p>
                    <p className="search-result-meta">{result.symbol}</p>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {shouldShowLastAdded && lastAddedResult ? (
        <div className="mt-4 max-w-xl">
          <p className="eyebrow">Ostatnio dodane</p>
          <button
            type="button"
            className="result-card mt-3 w-full text-left"
            onClick={() => onReuseLastAddedResult(lastAddedResult)}
          >
            <p className="result-title">{lastAddedResult.name}</p>
            <p className="result-meta">{lastAddedResult.symbol}</p>
          </button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_1fr_auto_auto]">
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
            {currencyOptions.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Waluta rynku / kursu</span>
          <select
            value={draft.marketCurrency}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                marketCurrency: event.target.value as AssetDraft["marketCurrency"],
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
          className="transaction-button transaction-button-compact transaction-button-buy self-end"
          type="button"
          onClick={onBuySubmit}
          disabled={isQuoteLoading}
        >
          {isQuoteLoading ? "Pobieram kurs..." : "Kup"}
        </button>

        <button
          className="transaction-button transaction-button-compact transaction-button-sell self-end"
          type="button"
          onClick={onSellSubmit}
        >
          Sprzedaj
        </button>
      </div>
    </section>
  );
}

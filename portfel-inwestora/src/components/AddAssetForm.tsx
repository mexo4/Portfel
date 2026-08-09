"use client";

import { useState } from "react";
import {
  SEARCH_MODE_OPTIONS,
  SUPPORTED_CURRENCIES,
} from "@/lib/constants";
import CurrencyPicker from "@/components/CurrencyPicker";
import TruncatedText from "@/components/TruncatedText";
import { getMinimumSearchLength, getSearchPlaceholder } from "@/lib/search";
import type {
  AssetDraft,
  AssetSearchMode,
  AssetSearchResult,
  EtfListing,
  EtfSearchGroup,
  InstrumentSearchResult,
} from "@/types/portfolio";

type AddAssetFormProps = {
  showModeSelector?: boolean;
  searchMode: AssetSearchMode;
  draft: AssetDraft;
  results: AssetSearchResult[];
  etfResultGroups?: EtfSearchGroup[];
  instrumentSearchResults?: InstrumentSearchResult[];
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
  etfResultGroups,
  instrumentSearchResults,
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
  const [selectedEtfListing, setSelectedEtfListing] = useState<EtfListing | null>(null);
  const trimmedQuery = draft.query.trim();
  const trimmedSymbol = draft.symbol.trim();
  const activeSearchText = trimmedQuery || trimmedSymbol;
  const minimumSearchLength = getMinimumSearchLength(searchMode);
  const hasActiveSearchText = activeSearchText.length > 0;
  const hasReachedMinimumSearchLength = activeSearchText.length >= minimumSearchLength;
  const isEtfSearch = searchMode === "etf";
  const groupedEtfResults = isEtfSearch ? etfResultGroups ?? [] : [];
  const nonEtfInstrumentResults = isEtfSearch
    ? (instrumentSearchResults ?? []).filter((result) => !result.isEtf)
    : [];
  const etfListingsCount = groupedEtfResults.reduce(
    (total, group) => total + group.listings.length,
    0
  );
  const hasSearchResults = isEtfSearch
    ? groupedEtfResults.length > 0 || nonEtfInstrumentResults.length > 0
    : results.length > 0;
  const activeSelectedEtfListing =
    isEtfSearch &&
    selectedEtfListing !== null &&
    selectedEtfListing.symbol.trim().toUpperCase() === trimmedSymbol.toUpperCase();
  const shouldShowSearchPanel =
    !activeSelectedEtfListing &&
    (isEtfSearch || hasActiveSearchText || hasSearchResults || isSearching);
  const shouldShowLastAdded =
    !hasActiveSearchText && !isSearching && !searchError && Boolean(lastAddedResult);
  const currencyOptions = getCurrencyOptions(draft.purchaseCurrency, draft.marketCurrency);
  const priceCurrency = draft.marketCurrency || "PLN";

  const getListingLabel = (listing: EtfListing) =>
    [
      listing.symbol,
      listing.exchange ?? listing.exchangeCode ?? "Giełda nieznana",
      listing.instrumentIdentity.currency ?? "Waluta do potwierdzenia",
    ]
      .filter(Boolean)
      .join(" · ");

  const handleEtfListingPick = (listing: EtfListing) => {
    setSelectedEtfListing(listing);
    onPickResult(listing);
  };

  const handleQueryChange = (query: string) => {
    setSelectedEtfListing(null);
    onQueryChange(query);
  };

  const handleSymbolChange = (symbol: string) => {
    setSelectedEtfListing(null);
    onSymbolChange(symbol);
  };

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
              onChange={(event) => handleQueryChange(event.target.value)}
              placeholder={getSearchPlaceholder(searchMode)}
            />
            {isQuoteLoading ? <small className="field-note">Pobieram kurs...</small> : null}
            {isEtfSearch && !hasActiveSearchText && !selectedEtfListing ? (
              <small className="field-note">
                Wpisz ticker, nazwę, FIGI lub ISIN, aby wybrać konkretne notowanie.
              </small>
            ) : null}
            {!isSearching && activeSelectedEtfListing ? (
              <small className="field-note etf-selected-listing">
                Wybrany listing: {getListingLabel(selectedEtfListing)}
              </small>
            ) : !isSearching && draft.symbol ? (
              <small className="field-note">Wybrany ticker: {draft.symbol}</small>
            ) : null}
            {!hasActiveSearchText && searchError ? (
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
            onChange={(event) => handleSymbolChange(event.target.value)}
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
          <div className="search-stack-panel search-stack-panel-prominent">
            <div className="search-panel-header">
              <p className="search-panel-title">Sugestie</p>
              {hasSearchResults ? (
                <span className="search-panel-count">
                  {isEtfSearch ? etfListingsCount + nonEtfInstrumentResults.length : results.length}
                </span>
              ) : null}
            </div>

            {hasActiveSearchText && isSearching ? (
              <p className="field-note">
                {isEtfSearch ? "Wyszukuję instrumenty..." : "Szukam wynikow..."}
              </p>
            ) : null}

            {isEtfSearch && !hasActiveSearchText && !isSearching && !hasSearchResults ? (
              <p className="field-note">Wpisz ticker, nazwe, FIGI lub ISIN, aby znalezc instrument.</p>
            ) : null}

            {hasActiveSearchText && searchError ? (
              <p className="field-note field-note-error">{searchError}</p>
            ) : null}

            {!isSearching && hasActiveSearchText && !hasReachedMinimumSearchLength ? (
              <p className="field-note">
                Wpisz min. {minimumSearchLength} znaki, aby zobaczyc wyniki.
              </p>
            ) : null}

            {!isSearching &&
            hasReachedMinimumSearchLength &&
            !hasSearchResults &&
            !searchError ? (
              <p className="field-note">
                {isEtfSearch ? "Nie znaleziono pasujących instrumentów." : "Brak wynikow"}
              </p>
            ) : null}

            {isEtfSearch && groupedEtfResults.length > 0 ? (
              <div className="etf-search-groups" aria-label="Wyniki ETF">
                {groupedEtfResults.map((group) => (
                  <section className="etf-search-group" key={group.id}>
                    <header className="etf-search-group-header">
                      <TruncatedText
                        as="p"
                        className="etf-search-group-title"
                        text={group.name}
                      />
                      <span className="etf-type-label">ETF</span>
                    </header>

                    <div className="etf-listing-list" role="list">
                      {group.listings.map((listing) => {
                        const listingLabel = getListingLabel(listing);
                        const isSelected =
                          activeSelectedEtfListing &&
                          selectedEtfListing?.listingId === listing.listingId;

                        return (
                          <div key={listing.listingId} role="listitem">
                            <button
                              type="button"
                              className={
                                isSelected
                                  ? "etf-listing-choice is-selected"
                                  : "etf-listing-choice"
                              }
                              onClick={() => handleEtfListingPick(listing)}
                              aria-label={`Wybierz listing: ${listingLabel}`}
                              aria-pressed={isSelected}
                            >
                              <span className="etf-listing-choice-main">{listingLabel}</span>
                              {listing.priceStatus === "unavailable" ? (
                                <span className="etf-listing-price-status">
                                  Brak aktualnego kursu
                                </span>
                              ) : null}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}

            {isEtfSearch && nonEtfInstrumentResults.length > 0 ? (
              <div className="search-result-list search-result-list-prominent mt-3" role="list">
                <p className="field-note">Inne znalezione instrumenty</p>
                {nonEtfInstrumentResults.map((result) => (
                  <div
                    className="search-result-card search-result-card-prominent text-left"
                    key={result.id}
                    role="listitem"
                  >
                    <TruncatedText as="p" className="search-result-title" text={result.name} />
                    <p className="search-result-meta">
                      {[result.symbol, result.exchange, result.currency, result.instrumentType]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <small className="field-note">
                      Ten typ nie moze jeszcze zostac dodany w formularzu ETF.
                    </small>
                  </div>
                ))}
              </div>
            ) : null}

            {!isEtfSearch && results.length > 0 ? (
              <div className="search-result-list search-result-list-prominent">
                {results.map((result) => (
                  <button
                    key={`${result.symbol}-${result.providerId ?? "none"}`}
                    type="button"
                    className="search-result-card search-result-card-prominent text-left"
                    onClick={() => onPickResult(result)}
                  >
                    <TruncatedText as="p" className="search-result-title" text={result.name} />
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
            <TruncatedText as="p" className="result-title" text={lastAddedResult.name} />
            <p className="result-meta">{lastAddedResult.symbol}</p>
          </button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_1fr_auto_auto]">
        <CurrencyPicker
          label="Waluta zakupu / konta"
          value={draft.purchaseCurrency}
          currencies={currencyOptions}
          onChange={(currency) =>
            onDraftChange({
              ...draft,
              purchaseCurrency: currency,
            })
          }
        />

        <CurrencyPicker
          label="Waluta instrumentu / ceny"
          value={draft.marketCurrency}
          currencies={currencyOptions}
            onChange={(currency) =>
              onDraftChange({
                ...draft,
                marketCurrency: currency,
                marketCurrencyConfirmed: true,
                instrumentIdentity:
                  draft.kind === "etf" && draft.instrumentIdentity
                    ? {
                        ...draft.instrumentIdentity,
                        currency,
                      }
                    : draft.instrumentIdentity,
              })
            }
        />

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

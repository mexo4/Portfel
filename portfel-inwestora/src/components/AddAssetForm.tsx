"use client";

import { useState } from "react";
import {
  VISIBLE_SEARCH_MODE_OPTIONS,
  SUPPORTED_CURRENCIES,
} from "@/lib/constants";
import CurrencyPicker from "@/components/CurrencyPicker";
import TruncatedText from "@/components/TruncatedText";
import { getMinimumSearchLength, getSearchPlaceholder } from "@/lib/search";
import { getGpwWatchlistCanonicalKey, isWatchlistEligibleGpwResult } from "@/lib/watchlist";
import type {
  AssetDraft,
  AssetSearchMode,
  AssetSearchResult,
  EtfListing,
  EtfSearchGroup,
} from "@/types/portfolio";

type AddAssetFormProps = {
  showModeSelector?: boolean;
  searchMode: AssetSearchMode;
  draft: AssetDraft;
  results: AssetSearchResult[];
  etfResultGroups?: EtfSearchGroup[];
  lastAddedResult: AssetSearchResult | null;
  isSearching: boolean;
  isQuoteLoading: boolean;
  isBuyPending: boolean;
  searchError: string | null;
  quoteError?: string | null;
  onDraftChange: (draft: AssetDraft) => void;
  onSearchModeChange: (mode: AssetSearchMode) => void;
  onQueryChange: (query: string) => void;
  onSymbolChange: (symbol: string) => void;
  onPickResult: (result: AssetSearchResult) => void;
  watchlistKeys?: Set<string>;
  isWatchlistTogglePending?: boolean;
  watchlistError?: string | null;
  onToggleWatchlist?: (result: AssetSearchResult) => void;
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

const ETF_GROUPS_PRESENTATION_LIMIT = 15;

const formatEtfListingCount = (count: number) => {
  if (count === 1) return "1 listing";
  if (count % 10 >= 2 && count % 10 <= 4 && (count < 10 || count > 20)) {
    return `${count} listingi`;
  }

  return `${count} listingów`;
};

export default function AddAssetForm({
  showModeSelector = true,
  searchMode,
  draft,
  results,
  etfResultGroups,
  lastAddedResult,
  isSearching,
  isQuoteLoading,
  isBuyPending,
  searchError,
  quoteError,
  onDraftChange,
  onSearchModeChange,
  onQueryChange,
  onSymbolChange,
  onPickResult,
  watchlistKeys,
  isWatchlistTogglePending = false,
  watchlistError,
  onToggleWatchlist,
  onReuseLastAddedResult,
  onBuySubmit,
  onSellSubmit,
}: AddAssetFormProps) {
  const [selectedEtfListing, setSelectedEtfListing] = useState<EtfListing | null>(null);
  const [expandedEtfGroupId, setExpandedEtfGroupId] = useState<string | null>(null);
  const trimmedQuery = draft.query.trim();
  const trimmedSymbol = draft.symbol.trim();
  const activeSearchText = trimmedQuery || trimmedSymbol;
  const minimumSearchLength = getMinimumSearchLength(searchMode);
  const hasActiveSearchText = activeSearchText.length > 0;
  const hasReachedMinimumSearchLength = activeSearchText.length >= minimumSearchLength;
  const isEtfSearch = searchMode === "etf";
  const groupedEtfResults = isEtfSearch ? etfResultGroups ?? [] : [];
  const presentedEtfGroups = groupedEtfResults.slice(0, ETF_GROUPS_PRESENTATION_LIMIT);
  const hasSearchResults = isEtfSearch ? groupedEtfResults.length > 0 : results.length > 0;
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
      listing.subtitle ?? "Rynek do potwierdzenia",
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
    setExpandedEtfGroupId(null);
    onQueryChange(query);
  };

  const handleSymbolChange = (symbol: string) => {
    setSelectedEtfListing(null);
    setExpandedEtfGroupId(null);
    onSymbolChange(symbol);
  };

  const handleEtfGroupToggle = (groupId: string) => {
    setExpandedEtfGroupId((currentGroupId) =>
      currentGroupId === groupId ? null : groupId
    );
  };

  return (
    <section className="panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Transakcja</p>
          <h2 className="section-title">Dodaj transakcję do portfela</h2>
        </div>

        <p className="section-copy">
          Rejestrujesz transakcję w Mexo. Mexo nie składa zleceń giełdowych.
        </p>
      </div>

      {showModeSelector ? (
        <div className="mode-grid mt-6">
          {VISIBLE_SEARCH_MODE_OPTIONS.map((option) => (
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
            {watchlistError ? (
              <small className="field-note field-note-error">{watchlistError}</small>
            ) : null}
          </label>

        </div>

        <label className="field">
          <span>Ticker / symbol</span>
          <input
            value={draft.symbol}
            onChange={(event) => handleSymbolChange(event.target.value)}
            placeholder="AAPL / XTB / VWCE"
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
          <div
            className={
              isEtfSearch
                ? "search-stack-panel search-stack-panel-prominent etf-search-stack-panel"
                : "search-stack-panel search-stack-panel-prominent"
            }
          >
            <div className="search-panel-header">
              <p className="search-panel-title">Sugestie</p>
              {hasSearchResults ? (
                <span className="search-panel-count">
                  {isEtfSearch
                    ? presentedEtfGroups.length === groupedEtfResults.length
                      ? `${presentedEtfGroups.length} funduszy`
                      : `${presentedEtfGroups.length} z ${groupedEtfResults.length}`
                    : results.length}
                </span>
              ) : null}
            </div>

            {hasActiveSearchText && isSearching ? (
              <p className="field-note">
                {isEtfSearch ? "Wyszukuję instrumenty ETF..." : "Szukam wynikow..."}
              </p>
            ) : null}

            {isEtfSearch && !hasActiveSearchText && !isSearching && !hasSearchResults ? (
              <p className="field-note">Wpisz ticker, nazwe, FIGI lub ISIN, aby znalezc ETF.</p>
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
                {isEtfSearch ? "Nie znaleziono pasujących ETF-ów." : "Brak wynikow"}
              </p>
            ) : null}

            {isEtfSearch && groupedEtfResults.length > 0 ? (
              <div className="etf-search-groups" aria-label="Wyniki ETF">
                {presentedEtfGroups.map((group) => {
                  const isExpanded = expandedEtfGroupId === group.id;
                  const listingsId = `etf-listings-${group.id}`;

                  return (
                    <section className="etf-search-group" key={group.id}>
                      <button
                        type="button"
                        className={
                          isExpanded
                            ? "etf-search-group-toggle is-expanded"
                            : "etf-search-group-toggle"
                        }
                        onClick={() => handleEtfGroupToggle(group.id)}
                        aria-expanded={isExpanded}
                        aria-controls={listingsId}
                      >
                        <span className="etf-search-group-heading">
                          <span className="etf-search-group-title" title={group.name}>
                            {group.name}
                          </span>
                          <span className="etf-search-group-copy">
                            Fundusz / share class
                          </span>
                        </span>
                        <span className="etf-search-group-meta">
                          <span className="etf-type-label">ETF</span>
                          <span className="etf-listing-count">
                            {formatEtfListingCount(group.listings.length)}
                          </span>
                        </span>
                        <span className="etf-search-group-chevron" aria-hidden="true">
                          {isExpanded ? "−" : "+"}
                        </span>
                      </button>

                      {isExpanded ? (
                        <div className="etf-listing-inset" id={listingsId}>
                          <div className="etf-listing-inset-header">
                            <span>Wybierz konkretne notowanie</span>
                            <span>{formatEtfListingCount(group.listings.length)}</span>
                          </div>
                          <p className="etf-expanded-fund-name">{group.name}</p>
                          <div className="etf-listing-list" role="list">
                            {group.listings.map((listing) => {
                              const listingLabel = getListingLabel(listing);
                              const isSelected =
                                activeSelectedEtfListing &&
                                selectedEtfListing?.listingId === listing.listingId;
                              const isVenueUnconfirmed =
                                listing.subtitle === "Rynek do potwierdzenia" &&
                                Boolean(listing.exchangeCode);

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
                                    <span className="etf-listing-choice-content">
                                      <span className="etf-listing-choice-main">{listingLabel}</span>
                                      {isVenueUnconfirmed ? (
                                        <span className="etf-listing-technical-meta">
                                          Kod OpenFIGI: {listing.exchangeCode}
                                        </span>
                                      ) : null}
                                    </span>
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
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            ) : results.length > 0 ? (
              <div className="search-result-list search-result-list-prominent">
                {results.map((result) => {
                  const isWatchlistEligible = isWatchlistEligibleGpwResult(result);
                  const watchlistKey = isWatchlistEligible
                    ? getGpwWatchlistCanonicalKey(result.symbol)
                    : "";
                  const isWatchlisted = Boolean(watchlistKey && watchlistKeys?.has(watchlistKey));

                  return (
                    <div
                      key={`${result.symbol}-${result.providerId ?? "none"}`}
                      className="search-result-card search-result-card-prominent search-result-card-with-watch"
                    >
                      <button
                        type="button"
                        className="search-result-select text-left"
                        onClick={() => onPickResult(result)}
                      >
                        <TruncatedText as="p" className="search-result-title" text={result.name} />
                        <p className="search-result-meta">{result.symbol}</p>
                      </button>
                      {isWatchlistEligible && onToggleWatchlist ? (
                        <button
                          type="button"
                          className={isWatchlisted ? "watchlist-toggle is-watched" : "watchlist-toggle"}
                          onClick={() => onToggleWatchlist(result)}
                          disabled={isWatchlistTogglePending}
                          aria-pressed={isWatchlisted}
                          aria-label={isWatchlisted ? `Usuń ${result.name} z obserwowanych` : `Dodaj ${result.name} do obserwowanych`}
                          title={isWatchlisted ? "Usuń z obserwowanych" : "Dodaj do obserwowanych"}
                        >
                          <span aria-hidden="true">{isWatchlisted ? "★" : "☆"}</span>
                        </button>
                      ) : null}
                    </div>
                  );
                })}
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
          disabled={isQuoteLoading || isBuyPending}
          aria-busy={isBuyPending}
        >
          {isBuyPending ? "Dodaję…" : isQuoteLoading ? "Pobieram kurs..." : "Kup"}
        </button>

        <button
          className="transaction-button transaction-button-compact transaction-button-sell self-end"
          type="button"
          onClick={onSellSubmit}
        >
          Sprzedaj
        </button>

        {isBuyPending ? (
          <p className="asset-submit-feedback" role="status" aria-live="polite">
            Dodaję pozycję do portfela…
          </p>
        ) : null}
      </div>
    </section>
  );
}

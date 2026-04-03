"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AddAssetForm from "@/components/AddAssetForm";
import AppSectionTabs, { type AppSection } from "@/components/AppSectionTabs";
import AssetTable from "@/components/AssetTable";
import PortfolioCharts from "@/components/PortfolioCharts";
import PortfolioSummary from "@/components/PortfolioSummary";
import {
  AUTO_REFRESH_INTERVAL_MS,
  FALLBACK_FX_RATES,
  SEARCH_DEBOUNCE_MS,
} from "@/lib/constants";
import {
  fetchFxRates,
  fetchQuotePreview,
  logoutUser,
  refreshPortfolioQuotes,
  requestEmailVerification,
  savePortfolioAssets,
  searchAssets,
} from "@/lib/api";
import { getPortfolioSummary } from "@/lib/pricing";
import { getMinimumSearchLength, getModeConfig } from "@/lib/search";
import { createAssetId, createEmptyDraft, normalizeSymbol } from "@/lib/ticker";
import { getTodayDateInputValue, normalizeText, toDateInputValue } from "@/lib/utils";
import type {
  AssetDraft,
  AssetQuote,
  AssetSearchMode,
  AssetSearchResult,
  AuthenticatedUser,
  FxRates,
  PortfolioAsset,
} from "@/types/portfolio";

type PortfolioAppProps = {
  account: AuthenticatedUser;
  initialAssets: PortfolioAsset[];
};

const SAVE_DEBOUNCE_MS = 700;

const createDraftFromMode = (mode: AssetSearchMode): AssetDraft => {
  const config = getModeConfig(mode);
  const baseDraft = createEmptyDraft(config.kind);

  return {
    ...baseDraft,
    kind: config.kind,
    purchaseDate: getTodayDateInputValue(),
    provider: config.provider,
    purchaseCurrency: config.purchaseCurrency,
    marketCurrency: config.marketCurrency,
  };
};

const toErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const isGpwMode = (mode: AssetSearchMode) => mode === "stock-gpw";
const normalizeSymbolForMode = (symbol: string, mode: AssetSearchMode) => {
  const normalized = normalizeSymbol(symbol);
  if (!normalized || !isGpwMode(mode)) return normalized;
  return normalized.endsWith(".WA") ? normalized : `${normalized}.WA`;
};
const shouldRetryQuoteRequest = (mode: AssetSearchMode) => !isGpwMode(mode);

const pickAutoTickerResult = (query: string, items: AssetSearchResult[]) => {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery || normalizedQuery.length < 2) {
    return null;
  }

  const normalizedQuerySymbol = normalizeSymbol(query);
  const exactSymbolMatch = items.find(
    (item) => normalizeSymbol(item.symbol) === normalizedQuerySymbol
  );
  if (exactSymbolMatch) return exactSymbolMatch;

  const exactNameMatch = items.find((item) => normalizeText(item.name) === normalizedQuery);
  if (exactNameMatch) return exactNameMatch;

  const startsWithNameMatch = items.find((item) =>
    normalizeText(item.name).startsWith(normalizedQuery)
  );

  return startsWithNameMatch ?? items[0] ?? null;
};

export default function PortfolioApp({ account, initialAssets }: PortfolioAppProps) {
  const assetsRef = useRef<PortfolioAsset[]>(initialAssets);
  const hasSavedAssetsRef = useRef(false);
  const quoteRefreshSeqRef = useRef(0);
  const quoteRequestSeqRef = useRef(0);
  const isManualSymbolRef = useRef(false);
  const [activeSection, setActiveSection] = useState<AppSection>("portfolio");
  const [assets, setAssets] = useState<PortfolioAsset[]>(initialAssets);
  const [searchMode, setSearchMode] = useState<AssetSearchMode>("stock-global");
  const [draft, setDraft] = useState<AssetDraft>(() => createDraftFromMode("stock-global"));
  const [results, setResults] = useState<AssetSearchResult[]>([]);
  const [filter, setFilter] = useState("");
  const [fxRates, setFxRates] = useState<FxRates>(FALLBACK_FX_RATES);
  const [isSearching, setIsSearching] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationPreviewUrl, setVerificationPreviewUrl] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [fxUpdatedAt, setFxUpdatedAt] = useState<string>();

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    const trimmedQuery = draft.query.trim();
    const minimumSearchLength = getMinimumSearchLength(searchMode);

    if (trimmedQuery.length < minimumSearchLength) {
      setResults([]);
      setSearchError(null);
      return;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);

      try {
        const nextResults = await searchAssets({
          query: trimmedQuery,
          kind: draft.kind,
          mode: searchMode,
        });

        if (!isCancelled) {
          setResults(nextResults);

          if (!isManualSymbolRef.current) {
            const autoResult = pickAutoTickerResult(trimmedQuery, nextResults);

            if (autoResult) {
              setDraft((currentDraft) => {
                if (normalizeText(currentDraft.query) !== normalizeText(trimmedQuery)) {
                  return currentDraft;
                }

                const normalizedCurrentSymbol = normalizeSymbol(currentDraft.symbol);
                const normalizedAutoSymbol = normalizeSymbol(autoResult.symbol);
                const hasSameAutoValues =
                  normalizedCurrentSymbol === normalizedAutoSymbol &&
                  currentDraft.provider === autoResult.provider &&
                  currentDraft.providerId === autoResult.providerId &&
                  currentDraft.marketCurrency === autoResult.marketCurrency;

                if (hasSameAutoValues) {
                  return currentDraft;
                }

                return {
                  ...currentDraft,
                  name: autoResult.name,
                  symbol: autoResult.symbol,
                  marketCurrency: autoResult.marketCurrency,
                  provider: autoResult.provider,
                  providerId: autoResult.providerId,
                  latestPrice: undefined,
                };
              });
            }
          }
        }
      } catch (error) {
        if (isCancelled) return;

        setSearchError(toErrorMessage(error, "Nie udalo sie pobrac wynikow."));
        setResults([]);
      } finally {
        if (!isCancelled) {
          setIsSearching(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [draft.kind, draft.query, searchMode]);

  useEffect(() => {
    if (!hasSavedAssetsRef.current) {
      hasSavedAssetsRef.current = true;
      return;
    }

    let isCancelled = false;

    const timeoutId = window.setTimeout(async () => {
      try {
        await savePortfolioAssets(assets);

        if (!isCancelled) {
          setSyncError(null);
        }
      } catch (error) {
        if (!isCancelled) {
          setSyncError(toErrorMessage(error, "Nie udalo sie zapisac portfela."));
        }
      }
    }, SAVE_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [assets]);

  const syncFxRates = async () => {
    try {
      const response = await fetchFxRates();
      setFxRates(response.rates);
      setFxUpdatedAt(response.fetchedAt);
    } catch {
      setFxRates(FALLBACK_FX_RATES);
    }
  };

  const syncQuotes = async () => {
    if (assetsRef.current.length === 0) return;

    const refreshSeq = ++quoteRefreshSeqRef.current;
    setIsRefreshing(true);

    try {
      const refreshedAssets = await refreshPortfolioQuotes(assetsRef.current);

      setAssets((currentAssets) => {
        const refreshedById = new Map(refreshedAssets.map((asset) => [asset.id, asset]));

        return currentAssets.map((asset) => {
          const refreshed = refreshedById.get(asset.id);
          if (!refreshed) return asset;

          return {
            ...asset,
            symbol: refreshed.symbol ?? asset.symbol,
            name: refreshed.name ?? asset.name,
            latestPrice: refreshed.latestPrice,
            marketCurrency: refreshed.marketCurrency,
            provider: refreshed.provider,
            providerId: refreshed.providerId ?? asset.providerId,
            lastUpdatedAt: refreshed.lastUpdatedAt,
          };
        });
      });

      if (refreshSeq === quoteRefreshSeqRef.current) {
        setLastSyncAt(new Date().toISOString());
        setSyncError(null);
      }
    } catch (error) {
      if (refreshSeq === quoteRefreshSeqRef.current) {
        setSyncError(toErrorMessage(error, "Nie udalo sie odswiezyc cen aktywow."));
      }
    } finally {
      if (refreshSeq === quoteRefreshSeqRef.current) {
        setIsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    void syncFxRates();
  }, []);

  useEffect(() => {
    if (assets.length === 0) return;

    void syncQuotes();

    const intervalId = window.setInterval(() => {
      void syncQuotes();
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [assets.length]);

  const applyQuoteToDraftIfCurrent = (
    targetSymbol: string,
    quote: AssetQuote | null,
    defaultMessage: string
  ) => {
    if (!quote) {
      setQuoteError(defaultMessage);
      return;
    }

    setDraft((currentDraft) => {
      if (normalizeSymbolForMode(currentDraft.symbol, searchMode) !== targetSymbol) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        latestPrice: quote.price,
        marketCurrency: quote.marketCurrency,
        provider: quote.provider,
        providerId: quote.providerId ?? currentDraft.providerId,
      };
    });
    setQuoteError(null);
  };

  const handleSearchModeChange = (mode: AssetSearchMode) => {
    quoteRequestSeqRef.current += 1;
    isManualSymbolRef.current = false;
    setIsQuoteLoading(false);
    setQuoteError(null);
    setSearchMode(mode);
    setDraft(createDraftFromMode(mode));
    setResults([]);
    setSearchError(null);
  };

  const fetchDraftQuoteWithRetry = async (
    request: {
      symbol: string;
      kind: AssetDraft["kind"];
      marketCurrency: AssetDraft["marketCurrency"];
      provider: AssetDraft["provider"];
      providerId?: string;
    },
    options?: {
      allowRetry?: boolean;
    }
  ) => {
    const firstTry = await fetchQuotePreview(request);
    if (firstTry || options?.allowRetry === false) return firstTry;

    await wait(220);
    return fetchQuotePreview(request);
  };

  const handlePickResult = async (result: AssetSearchResult) => {
    const requestSeq = ++quoteRequestSeqRef.current;
    const normalizedResultSymbol = normalizeSymbolForMode(result.symbol, searchMode);

    isManualSymbolRef.current = false;
    setQuoteError(null);
    setDraft((currentDraft) => ({
      ...currentDraft,
      query: result.name,
      name: result.name,
      symbol: normalizedResultSymbol,
      marketCurrency: result.marketCurrency,
      provider: result.provider,
      providerId: result.providerId,
      latestPrice: undefined,
    }));
    setResults([]);
    setIsQuoteLoading(true);

    try {
      const quote = await fetchDraftQuoteWithRetry({
        symbol: normalizedResultSymbol,
        kind: result.kind,
        marketCurrency: result.marketCurrency,
        provider: result.provider,
        providerId: result.providerId,
      }, { allowRetry: shouldRetryQuoteRequest(searchMode) });

      if (requestSeq !== quoteRequestSeqRef.current) return;

      applyQuoteToDraftIfCurrent(
        normalizedResultSymbol,
        quote,
        "Brak kursu dla wybranego aktywa. Wybierz inny wynik."
      );
    } finally {
      if (requestSeq === quoteRequestSeqRef.current) {
        setIsQuoteLoading(false);
      }
    }
  };

  const resolveDraftQuote = async (
    normalizedSymbol: string,
    options?: {
      allowRetry?: boolean;
    }
  ): Promise<AssetQuote | null> => {
    if (draft.latestPrice && draft.latestPrice > 0) {
      return {
        symbol: normalizedSymbol,
        price: draft.latestPrice,
        marketCurrency: draft.marketCurrency,
        provider: draft.provider,
        providerId: draft.providerId,
        fetchedAt: new Date().toISOString(),
      };
    }

    const requestSeq = ++quoteRequestSeqRef.current;
    setIsQuoteLoading(true);
    setQuoteError(null);

    try {
      const quote = await fetchDraftQuoteWithRetry({
        symbol: normalizedSymbol,
        kind: draft.kind,
        marketCurrency: draft.marketCurrency,
        provider: draft.provider,
        providerId: draft.providerId,
      }, options);

      if (requestSeq !== quoteRequestSeqRef.current) {
        return null;
      }

      applyQuoteToDraftIfCurrent(
        normalizedSymbol,
        quote,
        "Brak kursu dla tego tickera. Sprawdz symbol i sprobuj ponownie."
      );

      return quote;
    } finally {
      if (requestSeq === quoteRequestSeqRef.current) {
        setIsQuoteLoading(false);
      }
    }
  };

  const handleAddAsset = async () => {
    const name = draft.name.trim() || draft.query.trim();
    const symbol = normalizeSymbolForMode(draft.symbol, searchMode);
    const purchaseDate = toDateInputValue(draft.purchaseDate);

    setSearchError(null);
    setQuoteError(null);

    if (
      !name ||
      !symbol ||
      !purchaseDate ||
      draft.quantity <= 0 ||
      draft.purchasePrice <= 0
    ) {
      setSearchError("Uzupelnij nazwe, ticker, date zakupu, ilosc i cene zakupu.");
      return;
    }

    if (isQuoteLoading) {
      setQuoteError("Poczekaj na pobranie kursu przed dodaniem pozycji.");
      return;
    }

    if (symbol !== normalizeSymbol(draft.symbol)) {
      setDraft((currentDraft) => ({
        ...currentDraft,
        symbol,
      }));
    }

    const quote = await resolveDraftQuote(symbol, {
      allowRetry: shouldRetryQuoteRequest(searchMode),
    });

    if (!quote) {
      return;
    }

    const nextAsset: PortfolioAsset = {
      id: createAssetId(),
      name,
      symbol,
      kind: draft.kind,
      purchaseDate,
      quantity: draft.quantity,
      purchasePrice: draft.purchasePrice,
      purchaseCurrency: draft.purchaseCurrency,
      feePln: draft.feePln,
      marketCurrency: quote.marketCurrency,
      provider: quote.provider,
      providerId: quote.providerId ?? draft.providerId,
      latestPrice: quote.price,
      lastUpdatedAt: quote.fetchedAt,
      createdAt: new Date().toISOString(),
    };

    setAssets((currentAssets) => [nextAsset, ...currentAssets]);
    setDraft(createDraftFromMode(searchMode));
    setResults([]);
    setSearchError(null);
    setQuoteError(null);
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);

    try {
      await logoutUser();
      window.location.href = "/login";
    } catch (error) {
      setSyncError(toErrorMessage(error, "Nie udalo sie wylogowac."));
      setIsLoggingOut(false);
    }
  };

  const handleVerificationRequest = async () => {
    setIsSendingVerification(true);
    setVerificationMessage(null);
    setVerificationError(null);
    setVerificationPreviewUrl(null);

    try {
      const response = await requestEmailVerification();

      if (response.alreadyVerified) {
        setVerificationMessage("Ten adres email jest juz zweryfikowany.");
        return;
      }

      setVerificationMessage("Link weryfikacyjny jest gotowy.");
      setVerificationPreviewUrl(response.previewUrl);
    } catch (error) {
      setVerificationError(
        toErrorMessage(error, "Nie udalo sie przygotowac linku weryfikacyjnego.")
      );
    } finally {
      setIsSendingVerification(false);
    }
  };

  const summary = useMemo(() => getPortfolioSummary(assets, fxRates), [assets, fxRates]);

  return (
    <main className="page-shell">
      <div className="page-grid">
        <AppSectionTabs activeSection={activeSection} onChange={setActiveSection} />

        <PortfolioSummary
          summary={summary}
          lastSyncAt={lastSyncAt}
          fxUpdatedAt={fxUpdatedAt}
          isRefreshing={isRefreshing}
          isLoggingOut={isLoggingOut}
          isSendingVerification={isSendingVerification}
          canVerifyEmail={!account.emailVerifiedAt}
          syncError={syncError}
          verificationMessage={verificationMessage}
          verificationError={verificationError}
          verificationPreviewUrl={verificationPreviewUrl}
          onRefresh={() => {
            void syncFxRates();
            void syncQuotes();
          }}
          onLogout={() => {
            void handleLogout();
          }}
          onRequestVerification={() => {
            void handleVerificationRequest();
          }}
        />

        {activeSection === "portfolio" ? (
          <>
            <AddAssetForm
              searchMode={searchMode}
              draft={draft}
              results={results}
              isSearching={isSearching}
              isQuoteLoading={isQuoteLoading}
              searchError={searchError}
              quoteError={quoteError}
              onDraftChange={setDraft}
              onSearchModeChange={handleSearchModeChange}
              onQueryChange={(query) => {
                quoteRequestSeqRef.current += 1;
                isManualSymbolRef.current = false;
                setIsQuoteLoading(false);
                setQuoteError(null);
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  query,
                  name: query,
                  symbol: "",
                  providerId: undefined,
                  latestPrice: undefined,
                }));
              }}
              onSymbolChange={(symbol) => {
                quoteRequestSeqRef.current += 1;
                isManualSymbolRef.current = true;
                setIsQuoteLoading(false);
                setQuoteError(null);
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  symbol: symbol.toUpperCase(),
                  providerId: undefined,
                  latestPrice: undefined,
                }));
              }}
              onPickResult={(result) => {
                void handlePickResult(result);
              }}
              onSubmit={() => {
                void handleAddAsset();
              }}
            />

            <AssetTable
              assets={assets}
              fxRates={fxRates}
              filter={filter}
              onFilterChange={setFilter}
              onRemove={(assetId) => {
                setSyncError(null);
                setAssets((currentAssets) =>
                  currentAssets.filter((asset) => asset.id !== assetId)
                );
              }}
            />
          </>
        ) : (
          <PortfolioCharts assets={assets} fxRates={fxRates} />
        )}
      </div>
    </main>
  );
}

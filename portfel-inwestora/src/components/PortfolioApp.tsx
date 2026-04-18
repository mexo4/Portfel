"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AddAssetForm from "@/components/AddAssetForm";
import AppSectionTabs, { type AppSection } from "@/components/AppSectionTabs";
import AssetTable from "@/components/AssetTable";
import PortfolioCharts from "@/components/PortfolioCharts";
import RealizedAdjustmentsPanel from "@/components/RealizedAdjustmentsPanel";
import PortfolioSummary from "@/components/PortfolioSummary";
import SalesHistoryPanel from "@/components/SalesHistoryPanel";
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
  savePortfolioState,
  searchAssets,
} from "@/lib/api";
import {
  applySaleToPortfolio,
  canUndoPortfolioSale,
  createEmptyRealizedAdjustmentDraft,
  createPortfolioRealizedAdjustment,
  getManualOrderKeys,
  getNextGroupOrder,
  getSortedPortfolioRealizedAdjustments,
  getSortedPortfolioSales,
  normalizeStoredPortfolioAssets,
  undoPortfolioSale,
} from "@/lib/portfolio-state";
import {
  getGroupedPortfolioAssets,
  getPortfolioSummary,
} from "@/lib/pricing";
import {
  getMinimumSearchLength,
  getModeConfig,
  pickBestSearchResult,
} from "@/lib/search";
import {
  createAssetId,
  createEmptyDraft,
  getGpwSymbolKey,
  getPortfolioAssetGroupKey,
  normalizeGpwSymbol,
  normalizeSymbol,
} from "@/lib/ticker";
import {
  getTodayDateInputValue,
  normalizeText,
  toCurrencyCode,
  toDateInputValue,
} from "@/lib/utils";
import type {
  AssetDraft,
  AssetQuote,
  AssetSearchMode,
  AssetSearchResult,
  AssetTableSortMode,
  AuthenticatedUser,
  FxRates,
  PortfolioAsset,
  PortfolioRealizedAdjustment,
  PortfolioSale,
  RealizedAdjustmentDraft,
} from "@/types/portfolio";

type PortfolioAppProps = {
  account: AuthenticatedUser;
  initialAssets: PortfolioAsset[];
  initialSales: PortfolioSale[];
  initialRealizedAdjustments: PortfolioRealizedAdjustment[];
};

const SAVE_DEBOUNCE_MS = 700;
const ASSET_SORT_MODE_STORAGE_KEY = "portfolio.assetTableSortMode";

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
  if (!isGpwMode(mode)) {
    return normalizeSymbol(symbol);
  }

  return normalizeGpwSymbol(symbol);
};
const getComparableSymbolForMode = (symbol: string, mode: AssetSearchMode) => {
  if (!isGpwMode(mode)) {
    return normalizeSymbol(symbol);
  }

  return getGpwSymbolKey(symbol);
};
const getResolvedResultSymbolForMode = (
  currentSymbol: string,
  resultSymbol: string,
  mode: AssetSearchMode
) => {
  const normalizedResultSymbol = normalizeSymbolForMode(resultSymbol, mode);

  if (!isGpwMode(mode)) {
    return normalizedResultSymbol;
  }

  const normalizedCurrentSymbol = normalizeSymbolForMode(currentSymbol, mode);

  if (
    normalizedCurrentSymbol &&
    getComparableSymbolForMode(normalizedCurrentSymbol, mode) ===
      getComparableSymbolForMode(normalizedResultSymbol, mode)
  ) {
    return normalizedCurrentSymbol;
  }

  return normalizedResultSymbol;
};
const shouldRetryQuoteRequest = (mode: AssetSearchMode) => !isGpwMode(mode);
const shouldSyncPurchaseCurrencyWithResult = (mode: AssetSearchMode) => mode === "etf";
const doesQuoteProviderRequireProviderId = (kind: AssetDraft["kind"]) => kind === "etf";
const getDraftQuotePreviewRequest = (draft: AssetDraft, mode: AssetSearchMode) => {
  const normalizedSymbol = normalizeSymbolForMode(draft.symbol, mode);
  const trimmedName = draft.name.trim();

  if (!normalizedSymbol || !trimmedName || !draft.provider) {
    return null;
  }

  if (doesQuoteProviderRequireProviderId(draft.kind) && !draft.providerId) {
    return null;
  }

  return {
    symbol: normalizedSymbol,
    kind: draft.kind,
    marketCurrency: draft.marketCurrency,
    provider: draft.provider,
    providerId: draft.providerId,
    priceScale: draft.priceScale,
    requestKey: [
      normalizedSymbol,
      draft.kind,
      draft.marketCurrency,
      draft.provider,
      draft.providerId ?? "",
      draft.priceScale ?? "",
    ].join("|"),
  };
};
const isAssetTableSortMode = (value: string | null): value is AssetTableSortMode =>
  value === "manual" ||
  value === "value-desc" ||
  value === "value-asc" ||
  value === "profit-desc" ||
  value === "loss-asc" ||
  value === "daily-gain-desc" ||
  value === "daily-loss-asc";

const getTrackedCurrencies = (
  assets: PortfolioAsset[],
  draft: AssetDraft,
  realizedAdjustmentDraft: RealizedAdjustmentDraft
) =>
  Array.from(
    new Set(
      [
        "PLN",
        draft.purchaseCurrency,
        draft.marketCurrency,
        realizedAdjustmentDraft.currency,
        ...assets.flatMap((asset) => [asset.purchaseCurrency, asset.marketCurrency]),
      ]
        .map((code) => toCurrencyCode(code))
        .filter(Boolean)
    )
  ).sort();

export default function PortfolioApp({
  account,
  initialAssets,
  initialSales,
  initialRealizedAdjustments,
}: PortfolioAppProps) {
  const assetsRef = useRef<PortfolioAsset[]>(normalizeStoredPortfolioAssets(initialAssets));
  const hasSavedAssetsRef = useRef(false);
  const quoteRefreshSeqRef = useRef(0);
  const quoteRequestSeqRef = useRef(0);
  const lastPreviewRequestKeyRef = useRef("");
  const isManualSymbolRef = useRef(false);
  const [activeSection, setActiveSection] = useState<AppSection>("portfolio");
  const [assets, setAssets] = useState<PortfolioAsset[]>(() =>
    normalizeStoredPortfolioAssets(initialAssets)
  );
  const [sales, setSales] = useState<PortfolioSale[]>(() =>
    getSortedPortfolioSales(initialSales)
  );
  const [searchMode, setSearchMode] = useState<AssetSearchMode>("stock-global");
  const [draft, setDraft] = useState<AssetDraft>(() => createDraftFromMode("stock-global"));
  const [results, setResults] = useState<AssetSearchResult[]>([]);
  const [lastAddedResult, setLastAddedResult] = useState<AssetSearchResult | null>(null);
  const [filter, setFilter] = useState("");
  const [assetSortMode, setAssetSortMode] = useState<AssetTableSortMode>("manual");
  const [hasLoadedSortMode, setHasLoadedSortMode] = useState(false);
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
  const [realizedAdjustments, setRealizedAdjustments] = useState<PortfolioRealizedAdjustment[]>(
    () => getSortedPortfolioRealizedAdjustments(initialRealizedAdjustments)
  );
  const [realizedAdjustmentDraft, setRealizedAdjustmentDraft] =
    useState<RealizedAdjustmentDraft>(() => createEmptyRealizedAdjustmentDraft());
  const [realizedAdjustmentError, setRealizedAdjustmentError] = useState<string | null>(null);
  const trackedCurrencies = useMemo(
    () => getTrackedCurrencies(assets, draft, realizedAdjustmentDraft),
    [assets, draft, realizedAdjustmentDraft]
  );
  const trackedCurrenciesKey = trackedCurrencies.join("|");
  const draftQuotePreviewRequest = useMemo(
    () => getDraftQuotePreviewRequest(draft, searchMode),
    [draft, searchMode]
  );
  const groupedAssets = useMemo(
    () => getGroupedPortfolioAssets(assets, fxRates),
    [assets, fxRates]
  );

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedSortMode = window.localStorage.getItem(ASSET_SORT_MODE_STORAGE_KEY);

    if (isAssetTableSortMode(storedSortMode)) {
      setAssetSortMode(storedSortMode);
    }

    setHasLoadedSortMode(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !hasLoadedSortMode) {
      return;
    }

    window.localStorage.setItem(ASSET_SORT_MODE_STORAGE_KEY, assetSortMode);
  }, [assetSortMode, hasLoadedSortMode]);

  useEffect(() => {
    const trimmedQuery = draft.query.trim();
    const minimumSearchLength = getMinimumSearchLength(searchMode);

    if (trimmedQuery.length < minimumSearchLength) {
      setResults([]);
      setSearchError(null);
      setIsSearching(false);
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
            const autoResult = pickBestSearchResult(trimmedQuery, nextResults, {
              allowFirstItemFallback: true,
              mode: searchMode,
            });

            if (autoResult) {
              setDraft((currentDraft) => {
                if (normalizeText(currentDraft.query) !== normalizeText(trimmedQuery)) {
                  return currentDraft;
                }

                const normalizedCurrentSymbol = normalizeSymbolForMode(
                  currentDraft.symbol,
                  searchMode
                );
                const normalizedAutoSymbol = normalizeSymbolForMode(
                  autoResult.symbol,
                  searchMode
                );
                const hasSameAutoValues =
                  getComparableSymbolForMode(normalizedCurrentSymbol, searchMode) ===
                    getComparableSymbolForMode(normalizedAutoSymbol, searchMode) &&
                  currentDraft.provider === autoResult.provider &&
                  currentDraft.providerId === autoResult.providerId &&
                  currentDraft.marketCurrency === autoResult.marketCurrency &&
                  currentDraft.priceScale === autoResult.priceScale;

                if (hasSameAutoValues) {
                  return currentDraft;
                }

                return {
                  ...currentDraft,
                  name: autoResult.name,
                  symbol: getResolvedResultSymbolForMode(
                    currentDraft.symbol,
                    autoResult.symbol,
                    searchMode
                  ),
                  purchaseCurrency: shouldSyncPurchaseCurrencyWithResult(searchMode)
                    ? autoResult.marketCurrency
                    : currentDraft.purchaseCurrency,
                  marketCurrency: autoResult.marketCurrency,
                  provider: autoResult.provider,
                  providerId: autoResult.providerId,
                  priceScale: autoResult.priceScale,
                  latestPrice: undefined,
                  previousClose: undefined,
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
    const trimmedSymbol = draft.symbol.trim();
    const minimumSearchLength = getMinimumSearchLength(searchMode);

    if (!isManualSymbolRef.current || trimmedSymbol.length < minimumSearchLength) {
      setIsSearching(false);
      return;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);

      try {
        const nextResults = await searchAssets({
          query: trimmedSymbol,
          kind: draft.kind,
          mode: searchMode,
        });

        if (isCancelled) {
          return;
        }

        const autoResult = pickBestSearchResult(trimmedSymbol, nextResults, {
          mode: searchMode,
          preferSymbol: true,
        });

        setDraft((currentDraft) => {
          if (
            !isManualSymbolRef.current ||
            getComparableSymbolForMode(currentDraft.symbol, searchMode) !==
              getComparableSymbolForMode(trimmedSymbol, searchMode)
          ) {
            return currentDraft;
          }

          if (!autoResult) {
            return {
              ...currentDraft,
              query: "",
              name: "",
              providerId: undefined,
              priceScale: undefined,
              latestPrice: undefined,
              previousClose: undefined,
            };
          }

          const hasSameResolvedValues =
            getComparableSymbolForMode(currentDraft.symbol, searchMode) ===
              getComparableSymbolForMode(autoResult.symbol, searchMode) &&
            normalizeText(currentDraft.query) === normalizeText(autoResult.name) &&
            normalizeText(currentDraft.name) === normalizeText(autoResult.name) &&
            currentDraft.provider === autoResult.provider &&
            currentDraft.providerId === autoResult.providerId &&
            currentDraft.marketCurrency === autoResult.marketCurrency &&
            currentDraft.priceScale === autoResult.priceScale;

          if (hasSameResolvedValues) {
            return currentDraft;
          }

          return {
            ...currentDraft,
            symbol: getResolvedResultSymbolForMode(
              currentDraft.symbol,
              autoResult.symbol,
              searchMode
            ),
            query: autoResult.name,
            name: autoResult.name,
            purchaseCurrency: shouldSyncPurchaseCurrencyWithResult(searchMode)
              ? autoResult.marketCurrency
              : currentDraft.purchaseCurrency,
            marketCurrency: autoResult.marketCurrency,
            provider: autoResult.provider,
            providerId: autoResult.providerId,
            priceScale: autoResult.priceScale,
            latestPrice: undefined,
            previousClose: undefined,
          };
        });
      } catch (error) {
        if (!isCancelled) {
          setSearchError(toErrorMessage(error, "Nie udalo sie pobrac wynikow."));
        }
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
  }, [draft.kind, draft.symbol, searchMode]);

  useEffect(() => {
    if (!hasSavedAssetsRef.current) {
      hasSavedAssetsRef.current = true;
      return;
    }

    let isCancelled = false;

    const timeoutId = window.setTimeout(async () => {
      try {
        await savePortfolioState({ assets, sales, realizedAdjustments });

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
  }, [assets, sales, realizedAdjustments]);

  const syncFxRates = async (codes: string[]) => {
    try {
      const response = await fetchFxRates(codes);
      setFxRates({
        ...FALLBACK_FX_RATES,
        ...response.rates,
      });
      setFxUpdatedAt(response.fetchedAt);
    } catch {
      setFxRates((currentRates) => ({
        ...FALLBACK_FX_RATES,
        ...currentRates,
      }));
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

        return normalizeStoredPortfolioAssets(
          currentAssets.map((asset) => {
            const refreshed = refreshedById.get(asset.id);
            if (!refreshed) return asset;

            return {
              ...asset,
              symbol: refreshed.symbol ?? asset.symbol,
              name: refreshed.name ?? asset.name,
              latestPrice: refreshed.latestPrice,
              previousClose: refreshed.previousClose ?? asset.previousClose,
              marketCurrency: refreshed.marketCurrency,
              provider: refreshed.provider,
              providerId: refreshed.providerId ?? asset.providerId,
              priceScale: refreshed.priceScale ?? asset.priceScale,
              lastUpdatedAt: refreshed.lastUpdatedAt,
            };
          })
        );
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
    void syncFxRates(trackedCurrencies);
  }, [trackedCurrencies, trackedCurrenciesKey]);

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
      if (
        getComparableSymbolForMode(currentDraft.symbol, searchMode) !==
        getComparableSymbolForMode(targetSymbol, searchMode)
      ) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        latestPrice: quote.price,
        previousClose: quote.previousClose ?? currentDraft.previousClose,
        marketCurrency: quote.marketCurrency,
        provider: quote.provider,
        providerId: quote.providerId ?? currentDraft.providerId,
        priceScale: quote.priceScale ?? currentDraft.priceScale,
      };
    });
    setQuoteError(null);
  };

  const handleSearchModeChange = (mode: AssetSearchMode) => {
    quoteRequestSeqRef.current += 1;
    lastPreviewRequestKeyRef.current = "";
    isManualSymbolRef.current = false;
    setIsSearching(false);
    setIsQuoteLoading(false);
    setQuoteError(null);
    setSearchMode(mode);
    setDraft(createDraftFromMode(mode));
    setLastAddedResult(null);
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
      priceScale?: number;
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

  useEffect(() => {
    if (!draftQuotePreviewRequest) {
      lastPreviewRequestKeyRef.current = "";
      return;
    }

    if (lastPreviewRequestKeyRef.current === draftQuotePreviewRequest.requestKey) {
      return;
    }

    let isCancelled = false;
    const requestSeq = ++quoteRequestSeqRef.current;

    lastPreviewRequestKeyRef.current = draftQuotePreviewRequest.requestKey;
    setIsQuoteLoading(true);
    setQuoteError(null);

    void (async () => {
      try {
        const quote = await fetchDraftQuoteWithRetry(
          {
            symbol: draftQuotePreviewRequest.symbol,
            kind: draftQuotePreviewRequest.kind,
            marketCurrency: draftQuotePreviewRequest.marketCurrency,
            provider: draftQuotePreviewRequest.provider,
            providerId: draftQuotePreviewRequest.providerId,
            priceScale: draftQuotePreviewRequest.priceScale,
          },
          { allowRetry: shouldRetryQuoteRequest(searchMode) }
        );

        if (isCancelled || requestSeq !== quoteRequestSeqRef.current) {
          return;
        }

        if (!quote) {
          setQuoteError("Brak kursu dla wybranego aktywa. Wybierz inny wynik.");
          return;
        }

        setDraft((currentDraft) => {
          if (
            getComparableSymbolForMode(currentDraft.symbol, searchMode) !==
            getComparableSymbolForMode(draftQuotePreviewRequest.symbol, searchMode)
          ) {
            return currentDraft;
          }

          return {
            ...currentDraft,
            latestPrice: quote.price,
            previousClose: quote.previousClose ?? currentDraft.previousClose,
            marketCurrency: quote.marketCurrency,
            provider: quote.provider,
            providerId: quote.providerId ?? currentDraft.providerId,
            priceScale: quote.priceScale ?? currentDraft.priceScale,
          };
        });
        setQuoteError(null);
      } finally {
        if (!isCancelled && requestSeq === quoteRequestSeqRef.current) {
          setIsQuoteLoading(false);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [
    draft.latestPrice,
    draftQuotePreviewRequest,
    searchMode,
  ]);

  const handlePickResult = async (result: AssetSearchResult) => {
    const normalizedResultSymbol = normalizeSymbolForMode(result.symbol, searchMode);

    quoteRequestSeqRef.current += 1;
    lastPreviewRequestKeyRef.current = "";
    isManualSymbolRef.current = false;
    setIsSearching(false);
    setSearchError(null);
    setQuoteError(null);
    setIsQuoteLoading(false);
    setDraft((currentDraft) => ({
      ...currentDraft,
      query: result.name,
      name: result.name,
      symbol: normalizedResultSymbol,
      purchaseCurrency: shouldSyncPurchaseCurrencyWithResult(searchMode)
        ? result.marketCurrency
        : currentDraft.purchaseCurrency,
      marketCurrency: result.marketCurrency,
      provider: result.provider,
      providerId: result.providerId,
      priceScale: result.priceScale,
      latestPrice: undefined,
      previousClose: undefined,
    }));
    setResults([]);
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
        previousClose: draft.previousClose,
        marketCurrency: draft.marketCurrency,
        provider: draft.provider,
        providerId: draft.providerId,
        priceScale: draft.priceScale,
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
        priceScale: draft.priceScale,
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
      setSearchError("Uzupelnij nazwe, ticker, date transakcji, ilosc i cene.");
      return;
    }

    if (isQuoteLoading) {
      setQuoteError("Poczekaj na pobranie kursu przed dodaniem pozycji.");
      return;
    }

    if (symbol !== normalizeSymbolForMode(draft.symbol, searchMode)) {
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

    const storedSymbol = symbol;
    const storedName = quote.name?.trim() || name;
    const nextAssetGroupKey = getPortfolioAssetGroupKey({
      kind: draft.kind,
      symbol: storedSymbol,
    });
    const existingGroupOrder = assets.find(
      (asset) => getPortfolioAssetGroupKey(asset) === nextAssetGroupKey
    )?.groupOrder;

    const nextAsset: PortfolioAsset = {
      id: createAssetId(),
      name: storedName,
      symbol: storedSymbol,
      kind: draft.kind,
      purchaseDate,
      quantity: draft.quantity,
      purchasePrice: draft.purchasePrice,
      purchaseCurrency: draft.purchaseCurrency,
      feePln: draft.feePln,
      marketCurrency: quote.marketCurrency,
      provider: quote.provider,
      providerId: quote.providerId ?? draft.providerId,
      priceScale: quote.priceScale ?? draft.priceScale,
      latestPrice: quote.price,
      previousClose: quote.previousClose ?? draft.previousClose,
      lastUpdatedAt: quote.fetchedAt,
      groupOrder: existingGroupOrder ?? getNextGroupOrder(assets),
      createdAt: new Date().toISOString(),
    };

    isManualSymbolRef.current = false;
    setAssets((currentAssets) =>
      normalizeStoredPortfolioAssets([nextAsset, ...currentAssets])
    );
    setLastAddedResult({
      symbol: storedSymbol,
      name: storedName,
      kind: draft.kind,
      marketCurrency: quote.marketCurrency,
      provider: quote.provider,
      providerId: quote.providerId ?? draft.providerId,
      priceScale: quote.priceScale ?? draft.priceScale,
      source: "catalog",
    });
    setDraft(createDraftFromMode(searchMode));
    setResults([]);
    setSearchError(null);
    setQuoteError(null);
  };

  const handleSellAsset = async () => {
    const name = draft.name.trim() || draft.query.trim();
    const symbol = normalizeSymbolForMode(draft.symbol, searchMode);
    const saleDate = toDateInputValue(draft.purchaseDate);

    setSearchError(null);
    setQuoteError(null);

    if (!symbol || !saleDate || draft.quantity <= 0 || draft.purchasePrice <= 0) {
      setSearchError("Uzupelnij ticker, date transakcji, ilosc i cene sprzedazy.");
      return;
    }

    const groupKey = getPortfolioAssetGroupKey({
      kind: draft.kind,
      symbol,
    });
    const targetGroup = groupedAssets.find((group) => group.key === groupKey);

    if (!targetGroup) {
      setSearchError("Nie masz otwartej pozycji dla tego aktywa.");
      return;
    }

    try {
      const representativeLot = targetGroup.lots[0];
      const historicalFxCodes = Array.from(
        new Set(
          [
            draft.purchaseCurrency,
            draft.marketCurrency,
            ...targetGroup.lots.map((lot) => lot.purchaseCurrency),
          ]
            .map((code) => toCurrencyCode(code))
            .filter(Boolean)
        )
      );
      let saleFxRates = fxRates;

      try {
        const response = await fetchFxRates(historicalFxCodes, saleDate);
        saleFxRates = {
          ...FALLBACK_FX_RATES,
          ...saleFxRates,
          ...response.rates,
        };
      } catch {
        saleFxRates = {
          ...FALLBACK_FX_RATES,
          ...saleFxRates,
        };
      }

      const result = applySaleToPortfolio({
        assets,
        group: targetGroup,
        draft: {
          groupKey,
          name: name || targetGroup.name,
          symbol,
          kind: draft.kind,
          purchaseCurrency: draft.purchaseCurrency,
          marketCurrency: draft.marketCurrency,
          provider: representativeLot?.provider ?? draft.provider,
          providerId: representativeLot?.providerId ?? draft.providerId,
          priceScale: representativeLot?.priceScale ?? draft.priceScale,
          maxQuantity: targetGroup.quantity,
          quantity: draft.quantity,
          quantityInput: draft.quantityInput,
          salePrice: draft.purchasePrice,
          salePriceInput: draft.purchasePriceInput,
          saleDate,
          feePln: draft.feePln,
        },
        fxRates: saleFxRates,
      });

      isManualSymbolRef.current = false;
      setAssets(result.assets);
      setSales((currentSales) => getSortedPortfolioSales([result.sale, ...currentSales]));
      setDraft(createDraftFromMode(searchMode));
      setResults([]);
      setSearchError(null);
      setQuoteError(null);
      setSyncError(null);
    } catch (error) {
      setSearchError(toErrorMessage(error, "Nie udalo sie zapisac sprzedazy."));
    }
  };

  const handleAddRealizedAdjustment = async () => {
    const amount = realizedAdjustmentDraft.amount;
    const currency = toCurrencyCode(realizedAdjustmentDraft.currency, "PLN");
    const date = toDateInputValue(realizedAdjustmentDraft.date);
    const note = realizedAdjustmentDraft.note.trim();

    setRealizedAdjustmentError(null);
    setSyncError(null);

    if (!date || amount === 0) {
      setRealizedAdjustmentError("Podaj kwote rozna od zera oraz date.");
      return;
    }

    let nextRates = fxRates;
    let amountPlnSnapshot: number;

    if (currency === "PLN") {
      amountPlnSnapshot = amount;
    } else {
      let rate: number | undefined = nextRates[currency];

      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        try {
          const response = await fetchFxRates([currency]);
          nextRates = {
            ...FALLBACK_FX_RATES,
            ...nextRates,
            ...response.rates,
          };
          setFxRates(nextRates);
          setFxUpdatedAt(response.fetchedAt);
          rate = nextRates[currency];
        } catch {
          rate = undefined;
        }
      }

      if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
        setRealizedAdjustmentError("Brakuje kursu FX dla wybranej waluty.");
        return;
      }

      amountPlnSnapshot = amount * rate;
    }

    const nextAdjustment = createPortfolioRealizedAdjustment({
      amount,
      currency,
      amountPlnSnapshot,
      date,
      note,
    });

    setRealizedAdjustments((currentAdjustments) =>
      getSortedPortfolioRealizedAdjustments([nextAdjustment, ...currentAdjustments])
    );
    setRealizedAdjustmentDraft(createEmptyRealizedAdjustmentDraft());
  };

  const handleUndoSale = (saleId: string) => {
    try {
      const result = undoPortfolioSale({
        assets,
        sales,
        saleId,
      });

      setAssets(result.assets);
      setSales(result.sales);
      setSyncError(null);
    } catch (error) {
      setSyncError(toErrorMessage(error, "Nie udalo sie cofnac sprzedazy."));
    }
  };

  const handleReorderAssetGroups = (nextGroupKeys: string[]) => {
    setSyncError(null);
    setAssets((currentAssets) => {
      const orderedGroupKeys = getManualOrderKeys(currentAssets);

      if (
        nextGroupKeys.length !== orderedGroupKeys.length ||
        orderedGroupKeys.every((key, index) => key === nextGroupKeys[index])
      ) {
        return currentAssets;
      }

      const nextGroupOrderByKey = new Map(
        nextGroupKeys.map((key, index) => [key, index] as const)
      );

      return normalizeStoredPortfolioAssets(
        currentAssets.map((asset) => ({
          ...asset,
          groupOrder:
            nextGroupOrderByKey.get(getPortfolioAssetGroupKey(asset)) ?? asset.groupOrder,
        }))
      );
    });
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

  const summary = useMemo(
    () => getPortfolioSummary(assets, sales, realizedAdjustments, fxRates),
    [assets, sales, realizedAdjustments, fxRates]
  );

  return (
    <main className="page-shell">
      <div className="page-grid">
        <AppSectionTabs activeSection={activeSection} onChange={setActiveSection} />

        {activeSection === "portfolio" ? (
          <>
            {syncError ? <p className="field-note field-note-error">{syncError}</p> : null}

            <AddAssetForm
              searchMode={searchMode}
              draft={draft}
              results={results}
              lastAddedResult={lastAddedResult}
              isSearching={isSearching}
              isQuoteLoading={isQuoteLoading}
              searchError={searchError}
              quoteError={quoteError}
              onDraftChange={setDraft}
              onSearchModeChange={handleSearchModeChange}
              onQueryChange={(query) => {
                const trimmedQuery = query.trim();
                const minimumSearchLength = getMinimumSearchLength(searchMode);

                quoteRequestSeqRef.current += 1;
                lastPreviewRequestKeyRef.current = "";
                isManualSymbolRef.current = false;
                setIsSearching(trimmedQuery.length >= minimumSearchLength);
                setIsQuoteLoading(false);
                setResults([]);
                setSearchError(null);
                setQuoteError(null);
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  query,
                  name: query,
                  symbol: "",
                  providerId: undefined,
                  priceScale: undefined,
                  latestPrice: undefined,
                  previousClose: undefined,
                }));
              }}
              onSymbolChange={(symbol) => {
                quoteRequestSeqRef.current += 1;
                lastPreviewRequestKeyRef.current = "";
                isManualSymbolRef.current = true;
                setIsSearching(false);
                setIsQuoteLoading(false);
                setResults([]);
                setSearchError(null);
                setQuoteError(null);
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  symbol: symbol.toUpperCase(),
                  query: "",
                  name: "",
                  providerId: undefined,
                  priceScale: undefined,
                  latestPrice: undefined,
                  previousClose: undefined,
                }));
              }}
              onPickResult={(result) => {
                void handlePickResult(result);
              }}
              onReuseLastAddedResult={(result) => {
                void handlePickResult(result);
              }}
              onBuySubmit={() => {
                void handleAddAsset();
              }}
              onSellSubmit={() => {
                void handleSellAsset();
              }}
            />

            <AssetTable
              assets={assets}
              fxRates={fxRates}
              filter={filter}
              sortMode={assetSortMode}
              onFilterChange={setFilter}
              onSortModeChange={setAssetSortMode}
              onReorderGroups={handleReorderAssetGroups}
              onRemove={(assetId) => {
                setSyncError(null);
                setAssets((currentAssets) =>
                  normalizeStoredPortfolioAssets(
                    currentAssets.filter((asset) => asset.id !== assetId)
                  )
                );
              }}
            />

            <RealizedAdjustmentsPanel
              draft={realizedAdjustmentDraft}
              adjustments={realizedAdjustments}
              error={realizedAdjustmentError}
              onChange={(nextDraft) => {
                setRealizedAdjustmentDraft(nextDraft);
                setRealizedAdjustmentError(null);
              }}
              onSubmit={() => {
                void handleAddRealizedAdjustment();
              }}
            />

            <SalesHistoryPanel
              sales={sales}
              canUndoSale={(saleId) => canUndoPortfolioSale(sales, saleId)}
              onUndoSale={handleUndoSale}
            />
          </>
        ) : (
          <>
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
                void syncFxRates(trackedCurrencies);
                void syncQuotes();
              }}
              onLogout={() => {
                void handleLogout();
              }}
              onRequestVerification={() => {
                void handleVerificationRequest();
              }}
            />

            <PortfolioCharts assets={assets} sales={sales} fxRates={fxRates} />
          </>
        )}
      </div>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AddAssetForm from "@/components/AddAssetForm";
import AssetModeSelector from "@/components/AssetModeSelector";
import AppSectionTabs, { type AppSection } from "@/components/AppSectionTabs";
import AssetTable from "@/components/AssetTable";
import BrokerImportPanel from "@/components/BrokerImportPanel";
import PortfolioCharts from "@/components/PortfolioCharts";
import PortfolioLineCharts from "@/components/PortfolioLineCharts";
import RealizedAdjustmentsPanel from "@/components/RealizedAdjustmentsPanel";
import PortfolioSummary from "@/components/PortfolioSummary";
import SalesHistoryPanel from "@/components/SalesHistoryPanel";
import TreasuryBondForm from "@/components/TreasuryBondForm";
import {
  AUTO_REFRESH_INTERVAL_MS,
  FALLBACK_FX_RATES,
  FREE_PLAN_ASSET_LIMIT,
  SEARCH_DEBOUNCE_MS,
} from "@/lib/constants";
import {
  fetchFxRates,
  fetchQuotePreview,
  fetchTreasuryBondRedemption,
  fetchTreasuryBondSeries,
  fetchTreasuryBondSwap,
  logoutUser,
  refreshPortfolioQuotes,
  requestEmailVerification,
  savePortfolioState,
  searchAssets,
} from "@/lib/api";
import {
  applySaleToPortfolio,
  buildAutomaticBondCouponAdjustments,
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
  round,
  toCurrencyCode,
  toDateInputValue,
} from "@/lib/utils";
import {
  createEmptyTreasuryBondDraft,
  getTreasuryBondDisplayName,
  getTreasuryBondMaturityDate,
  isTreasuryBondPurchaseDateInIssueWindow,
  normalizeTreasuryBondCode,
} from "@/lib/treasury-bonds";
import type {
  AssetEntryMode,
  AssetDraft,
  AssetQuote,
  AssetSearchMode,
  AssetSearchResult,
  AssetTableSortMode,
  AuthenticatedUser,
  BondRedemptionQuote,
  BondSwapQuote,
  FxRates,
  PortfolioAsset,
  PortfolioRealizedAdjustment,
  PortfolioSale,
  RealizedAdjustmentDraft,
  TreasuryBondDraft,
  TreasuryBondQuote,
  TreasuryBondSeries,
} from "@/types/portfolio";
import type { ImportedBrokerOperation } from "@/lib/import-operations";

type PortfolioAppProps = {
  account: AuthenticatedUser;
  isAdmin?: boolean;
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
const formatBondUnitPriceInput = (value: number) => String(round(value, 2));
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

const canUseProFeatures = (account: AuthenticatedUser) =>
  account.subscriptionPlan === "pro" &&
  (account.subscriptionStatus === "active" || account.subscriptionStatus === "trialing");

export default function PortfolioApp({
  account,
  isAdmin = false,
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
  const [entryMode, setEntryMode] = useState<AssetEntryMode>("stock-global");
  const [searchMode, setSearchMode] = useState<AssetSearchMode>("stock-global");
  const [draft, setDraft] = useState<AssetDraft>(() => createDraftFromMode("stock-global"));
  const [bondDraft, setBondDraft] = useState<TreasuryBondDraft>(() =>
    createEmptyTreasuryBondDraft()
  );
  const [bondSeries, setBondSeries] = useState<TreasuryBondSeries | null>(null);
  const [bondQuote, setBondQuote] = useState<TreasuryBondQuote | null>(null);
  const [bondRedemptionPreview, setBondRedemptionPreview] =
    useState<BondRedemptionQuote | null>(null);
  const [bondSwapPreview, setBondSwapPreview] = useState<BondSwapQuote | null>(null);
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
  const [isBondLoading, setIsBondLoading] = useState(false);
  const [isBondRedemptionLoading, setIsBondRedemptionLoading] = useState(false);
  const [isBondSwapLoading, setIsBondSwapLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [bondError, setBondError] = useState<string | null>(null);
  const [bondRedemptionError, setBondRedemptionError] = useState<string | null>(null);
  const [bondSwapError, setBondSwapError] = useState<string | null>(null);
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
  const effectiveRealizedAdjustments = useMemo(
    () =>
      getSortedPortfolioRealizedAdjustments([
        ...realizedAdjustments,
        ...buildAutomaticBondCouponAdjustments(assets, sales),
      ]),
    [assets, realizedAdjustments, sales]
  );
  const hasProFeatures = canUseProFeatures(account);
  const getFreePlanAssetLimitError = (nextAssetCount = assets.length + 1) =>
    !hasProFeatures && nextAssetCount > FREE_PLAN_ASSET_LIMIT
      ? `Plan Free pozwala miec do ${FREE_PLAN_ASSET_LIMIT} pozycji w jednym portfelu. Przejdz na Pro, aby dodawac kolejne.`
      : null;

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
    const normalizedCode = normalizeTreasuryBondCode(bondDraft.code);

    setBondRedemptionPreview(null);
    setBondRedemptionError(null);

    if (!normalizedCode) {
      setBondSeries(null);
      setBondQuote(null);
      setBondError(null);
      setIsBondLoading(false);
      return;
    }

    if (normalizedCode.length < 7) {
      setBondSeries(null);
      setBondQuote(null);
      setBondError(null);
      setIsBondLoading(false);
      return;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setIsBondLoading(true);
      setBondError(null);

      try {
        const response = await fetchTreasuryBondSeries({
          code: normalizedCode,
          purchaseDate: bondDraft.purchaseDate,
        });

        if (isCancelled) {
          return;
        }

        setBondSeries(response.series);
        setBondQuote(response.quote);
        setBondError(null);
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setBondSeries(null);
        setBondQuote(null);
        setBondError(toErrorMessage(error, "Nie udalo sie pobrac danych obligacji."));
      } finally {
        if (!isCancelled) {
          setIsBondLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [bondDraft.code, bondDraft.purchaseDate]);

  useEffect(() => {
    const nextPurchasePrice = round(bondSeries?.salePrice ?? 100, 2);
    const nextPurchasePriceInput = formatBondUnitPriceInput(nextPurchasePrice);

    setBondDraft((currentDraft) => {
      if (
        currentDraft.purchasePrice === nextPurchasePrice &&
        currentDraft.purchasePriceInput === nextPurchasePriceInput
      ) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        purchasePrice: nextPurchasePrice,
        purchasePriceInput: nextPurchasePriceInput,
      };
    });
  }, [bondSeries?.code, bondSeries?.salePrice]);

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
              bondMeta: refreshed.bondMeta ?? asset.bondMeta,
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

  const resetBondInteractionState = () => {
    setBondRedemptionPreview(null);
    setBondSwapPreview(null);
    setBondRedemptionError(null);
    setBondSwapError(null);
  };

  const handleEntryModeChange = (mode: AssetEntryMode) => {
    resetBondInteractionState();
    setEntryMode(mode);

    if (mode === "bond") {
      setBondError(null);
      return;
    }

    handleSearchModeChange(mode);
  };

  const getBondGroup = (code: string) => {
    const normalizedCode = normalizeTreasuryBondCode(code);
    const groupKey = getPortfolioAssetGroupKey({
      kind: "bond",
      symbol: normalizedCode,
    });

    return groupedAssets.find((group) => group.key === groupKey);
  };

  const buildBondRedemptionPreview = async ({
    code,
    quantity,
    requestDate,
  }: {
    code: string;
    quantity: number;
    requestDate: string;
  }) => {
    const targetGroup = getBondGroup(code);

    if (!targetGroup) {
      throw new Error("Nie masz otwartej pozycji dla tej obligacji.");
    }

    if (quantity <= 0) {
      throw new Error("Podaj ilosc obligacji do wykupu.");
    }

    if (quantity > targetGroup.quantity) {
      throw new Error("Nie mozna wykupic wiecej obligacji niz posiadasz.");
    }

    const sortedLots = [...targetGroup.lots].sort(
      (left, right) =>
        new Date(left.purchaseDate || left.createdAt).getTime() -
          new Date(right.purchaseDate || right.createdAt).getTime() ||
        left.createdAt.localeCompare(right.createdAt)
    );
    const lotRequests: Array<{
      lot: PortfolioAsset;
      quantity: number;
    }> = [];
    let remainingQuantity = quantity;

    for (const lot of sortedLots) {
      if (remainingQuantity <= 0) {
        break;
      }

      const allocatedQuantity = Math.min(remainingQuantity, lot.quantity);

      if (allocatedQuantity <= 0) {
        continue;
      }

      lotRequests.push({
        lot,
        quantity: allocatedQuantity,
      });
      remainingQuantity = Math.max(0, round(remainingQuantity - allocatedQuantity, 6));
    }

    if (remainingQuantity > 0) {
      throw new Error("Brakuje wystarczajacej ilosci do wykupu.");
    }

    const redemptions = await Promise.all(
      lotRequests.map(async (request) => {
        const response = await fetchTreasuryBondRedemption({
          code: request.lot.symbol,
          purchaseDate: request.lot.purchaseDate,
          requestDate,
          quantity: request.quantity,
        });

        return response.redemption;
      })
    );

    const grossValueTotal = round(
      redemptions.reduce((total, item) => total + item.grossValueTotal, 0)
    );
    const grossInterestTotal = round(
      redemptions.reduce((total, item) => total + item.grossInterestTotal, 0)
    );
    const feeTotal = round(redemptions.reduce((total, item) => total + item.feeTotal, 0));
    const taxableInterestTotal = round(
      redemptions.reduce((total, item) => total + item.taxableInterestTotal, 0)
    );
    const taxTotal = round(redemptions.reduce((total, item) => total + item.taxTotal, 0));
    const netValueTotal = round(
      redemptions.reduce((total, item) => total + item.netValueTotal, 0)
    );
    const settlementDate = [...redemptions]
      .map((item) => item.settlementDate)
      .sort()
      .at(-1) ?? requestDate;
    const maturityDate = [...redemptions]
      .map((item) => item.maturityDate)
      .sort()
      .at(-1) ?? requestDate;

    return {
      code: normalizeTreasuryBondCode(code),
      quantity: round(quantity, 6),
      requestDate,
      settlementDate,
      maturityDate,
      grossValuePerUnit: round(grossValueTotal / quantity, 6),
      grossValueTotal,
      grossInterestPerUnit: round(grossInterestTotal / quantity, 6),
      grossInterestTotal,
      annualRate: round(
        redemptions.reduce((total, item) => total + item.annualRate * item.quantity, 0) /
          quantity,
        4
      ),
      feePerUnit: round(feeTotal / quantity, 6),
      feeTotal,
      taxableInterestPerUnit: round(taxableInterestTotal / quantity, 6),
      taxableInterestTotal,
      taxPerUnit: round(taxTotal / quantity, 6),
      taxTotal,
      netValuePerUnit: round(netValueTotal / quantity, 6),
      netValueTotal,
      marketCurrency: "PLN",
      transactionKind: "bond-redemption" as const,
    } satisfies BondRedemptionQuote;
  };

  const buildBondSwapPreview = async ({
    code,
    quantity,
    requestDate,
    targetCode,
    targetQuantity,
  }: {
    code: string;
    quantity: number;
    requestDate: string;
    targetCode: string;
    targetQuantity: number;
  }) => {
    const sourceRedemption = await buildBondRedemptionPreview({
      code,
      quantity,
      requestDate,
    });
    const response = await fetchTreasuryBondSwap({
      sourceRedemption,
      targetCode,
      targetQuantity,
    });

    return response.swap;
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

  const buildBondSettlementSale = ({
    baseSale,
    representativeLot,
    preview,
    transactionKind,
    extra,
  }: {
    baseSale: PortfolioSale;
    representativeLot?: PortfolioAsset;
    preview: BondRedemptionQuote;
    transactionKind: "bond-redemption" | "bond-swap";
    extra?: Partial<PortfolioSale>;
  }): PortfolioSale => {
    const grossProfitLossPln = round(
      preview.grossValueTotal - baseSale.realizedInvestedPln
    );

    return {
      ...baseSale,
      transactionKind,
      settlementDate: preview.settlementDate,
      bondMeta: representativeLot?.bondMeta ?? baseSale.bondMeta,
      grossProceedsPln: preview.grossValueTotal,
      grossProfitLossPln,
      grossProceedsValue: preview.grossValueTotal,
      grossProfitLossValue: grossProfitLossPln,
      taxTotalPln: preview.taxTotal,
      redemptionFeeTotalPln: preview.feeTotal,
      ...extra,
    };
  };

  const handleAddBondAsset = async () => {
    const normalizedCode = normalizeTreasuryBondCode(bondDraft.code);
    const purchaseDate = toDateInputValue(bondDraft.purchaseDate);

    resetBondInteractionState();
    setBondError(null);
    setSyncError(null);

    if (!normalizedCode || bondDraft.quantity <= 0 || bondDraft.purchasePrice <= 0) {
      setBondError("Podaj kod obligacji, ilosc, date operacji i cene zakupu.");
      return;
    }

    if (!isTreasuryBondPurchaseDateInIssueWindow(normalizedCode, purchaseDate)) {
      setBondError("Data zakupu musi miescic sie w miesiacu emisji zakodowanym w serii.");
      return;
    }

    const planLimitError = getFreePlanAssetLimitError();

    if (planLimitError) {
      setBondError(planLimitError);
      return;
    }

    try {
      const response =
        bondSeries &&
        bondQuote &&
        bondSeries.code === normalizedCode &&
        bondQuote.maturityDate ===
          getTreasuryBondMaturityDate(purchaseDate, bondSeries.yearsToMaturity)
          ? { series: bondSeries, quote: bondQuote }
          : await fetchTreasuryBondSeries({
              code: normalizedCode,
              purchaseDate,
            });
      const nextAssetGroupKey = getPortfolioAssetGroupKey({
        kind: "bond",
        symbol: normalizedCode,
      });
      const existingGroupOrder = assets.find(
        (asset) => getPortfolioAssetGroupKey(asset) === nextAssetGroupKey
      )?.groupOrder;
      const nextAsset: PortfolioAsset = {
        id: createAssetId(),
        name: getTreasuryBondDisplayName(response.series),
        symbol: normalizedCode,
        kind: "bond",
        purchaseDate,
        quantity: bondDraft.quantity,
        purchasePrice: round(response.series.salePrice, 2),
        purchaseCurrency: "PLN",
        feePln: 0,
        marketCurrency: "PLN",
        provider: "obligacjeskarbowe",
        latestPrice: response.quote.grossValue,
        previousClose: response.quote.previousClose,
        lastUpdatedAt: response.quote.fetchedAt,
        bondMeta: response.series,
        groupOrder: existingGroupOrder ?? getNextGroupOrder(assets),
        createdAt: new Date().toISOString(),
      };

      setAssets((currentAssets) =>
        normalizeStoredPortfolioAssets([nextAsset, ...currentAssets])
      );
      setBondDraft(createEmptyTreasuryBondDraft());
      setBondSeries(null);
      setBondQuote(null);
      setBondError(null);
    } catch (error) {
      setBondError(toErrorMessage(error, "Nie udalo sie dodac obligacji."));
    }
  };

  const handleRedeemBondAsset = async () => {
    const normalizedCode = normalizeTreasuryBondCode(bondDraft.code);
    const requestDate = toDateInputValue(bondDraft.purchaseDate);

    setBondRedemptionError(null);
    setBondSwapError(null);
    setBondError(null);
    setSyncError(null);

    if (!normalizedCode || bondDraft.quantity <= 0) {
      setBondRedemptionError("Podaj kod obligacji, ilosc i date dyspozycji wykupu.");
      return;
    }

    setIsBondRedemptionLoading(true);

    try {
      const preview = await buildBondRedemptionPreview({
        code: normalizedCode,
        quantity: bondDraft.quantity,
        requestDate,
      });
      const targetGroup = getBondGroup(normalizedCode);

      if (!targetGroup) {
        throw new Error("Nie znaleziono pozycji do wykupu.");
      }

      const representativeLot = targetGroup.lots[0];
      const result = applySaleToPortfolio({
        assets,
        group: targetGroup,
        draft: {
          groupKey: targetGroup.key,
          name: targetGroup.name,
          symbol: normalizedCode,
          kind: "bond",
          purchaseCurrency: "PLN",
          marketCurrency: "PLN",
          provider: representativeLot?.provider ?? "obligacjeskarbowe",
          providerId: representativeLot?.providerId,
          priceScale: representativeLot?.priceScale,
          maxQuantity: targetGroup.quantity,
          quantity: bondDraft.quantity,
          quantityInput: bondDraft.quantityInput,
          salePrice: preview.grossValuePerUnit,
          salePriceInput: String(preview.grossValuePerUnit),
          saleDate: requestDate,
          feePln: round(preview.feeTotal + preview.taxTotal, 2),
        },
        fxRates,
      });

      setAssets(result.assets);
      setSales((currentSales) =>
        getSortedPortfolioSales([
          buildBondSettlementSale({
            baseSale: result.sale,
            representativeLot,
            preview,
            transactionKind: "bond-redemption",
          }),
          ...currentSales,
        ])
      );
      setBondRedemptionPreview(preview);
      setBondSwapPreview(null);
    } catch (error) {
      setBondRedemptionError(toErrorMessage(error, "Nie udalo sie zapisac wykupu."));
    } finally {
      setIsBondRedemptionLoading(false);
    }
  };

  const handleSwapBondAsset = async () => {
    const normalizedSourceCode = normalizeTreasuryBondCode(bondDraft.code);
    const normalizedTargetCode = normalizeTreasuryBondCode(bondDraft.swapTargetCode);
    const requestDate = toDateInputValue(bondDraft.purchaseDate);

    setBondSwapError(null);
    setBondRedemptionError(null);
    setBondError(null);
    setSyncError(null);

    if (!normalizedSourceCode || bondDraft.quantity <= 0) {
      setBondSwapError("Podaj kod zrodlowej obligacji, ilosc i date dyspozycji zamiany.");
      return;
    }

    if (!normalizedTargetCode || bondDraft.swapTargetQuantity <= 0) {
      setBondSwapError("Podaj kod docelowej serii oraz ilosc obligacji po zamianie.");
      return;
    }

    setIsBondSwapLoading(true);

    try {
      const preview = await buildBondSwapPreview({
        code: normalizedSourceCode,
        quantity: bondDraft.quantity,
        requestDate,
        targetCode: normalizedTargetCode,
        targetQuantity: bondDraft.swapTargetQuantity,
      });
      const targetGroup = getBondGroup(normalizedSourceCode);

      if (!targetGroup) {
        throw new Error("Nie znaleziono pozycji do zamiany.");
      }

      const representativeLot = targetGroup.lots[0];
      const result = applySaleToPortfolio({
        assets,
        group: targetGroup,
        draft: {
          groupKey: targetGroup.key,
          name: targetGroup.name,
          symbol: normalizedSourceCode,
          kind: "bond",
          purchaseCurrency: "PLN",
          marketCurrency: "PLN",
          provider: representativeLot?.provider ?? "obligacjeskarbowe",
          providerId: representativeLot?.providerId,
          priceScale: representativeLot?.priceScale,
          maxQuantity: targetGroup.quantity,
          quantity: bondDraft.quantity,
          quantityInput: bondDraft.quantityInput,
          salePrice: preview.sourceRedemption.grossValuePerUnit,
          salePriceInput: String(preview.sourceRedemption.grossValuePerUnit),
          saleDate: requestDate,
          feePln: round(
            preview.sourceRedemption.feeTotal + preview.sourceRedemption.taxTotal,
            2
          ),
        },
        fxRates,
      });
      const nextTargetGroupKey = getPortfolioAssetGroupKey({
        kind: "bond",
        symbol: preview.targetSeries.code,
      });
      const existingTargetGroupOrder = result.assets.find(
        (asset) => getPortfolioAssetGroupKey(asset) === nextTargetGroupKey
      )?.groupOrder;
      const swapTargetAssetId = createAssetId();
      const targetAsset: PortfolioAsset = {
        id: swapTargetAssetId,
        name: getTreasuryBondDisplayName(preview.targetSeries),
        symbol: preview.targetSeries.code,
        kind: "bond",
        purchaseDate: preview.settlementDate,
        quantity: preview.targetQuantity,
        purchasePrice: round(preview.swapPricePerUnit, 2),
        purchaseCurrency: "PLN",
        feePln: 0,
        marketCurrency: "PLN",
        provider: "obligacjeskarbowe",
        latestPrice: preview.targetQuote.grossValue,
        previousClose: preview.targetQuote.previousClose,
        lastUpdatedAt: preview.targetQuote.fetchedAt,
        bondMeta: preview.targetSeries,
        groupOrder: existingTargetGroupOrder ?? getNextGroupOrder(result.assets),
        createdAt: new Date().toISOString(),
      };

      setAssets(
        normalizeStoredPortfolioAssets([targetAsset, ...result.assets])
      );
      setSales((currentSales) =>
        getSortedPortfolioSales([
          buildBondSettlementSale({
            baseSale: result.sale,
            representativeLot,
            preview: preview.sourceRedemption,
            transactionKind: "bond-swap",
            extra: {
              swapTargetCode: preview.targetCode,
              swapTargetQuantity: preview.targetQuantity,
              swapPricePerUnit: preview.swapPricePerUnit,
              swapResidualCashPln: preview.residualCashPln,
              swapTargetAssetId,
            },
          }),
          ...currentSales,
        ])
      );
      setBondSwapPreview(preview);
      setBondRedemptionPreview(null);
    } catch (error) {
      setBondSwapError(toErrorMessage(error, "Nie udalo sie zapisac zamiany."));
    } finally {
      setIsBondSwapLoading(false);
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

    const planLimitError = getFreePlanAssetLimitError();

    if (planLimitError) {
      setSearchError(planLimitError);
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

  const handleImportBrokerOperations = async (operations: ImportedBrokerOperation[]) => {
    let nextAssets = normalizeStoredPortfolioAssets(assets);
    let nextSales = getSortedPortfolioSales(sales);
    let importedBuys = 0;
    let importedSells = 0;
    let skippedSells = 0;

    const orderedOperations = [...operations].sort(
      (left, right) =>
        left.date.localeCompare(right.date) || left.rowNumber - right.rowNumber
    );

    for (const operation of orderedOperations) {
      const groupKey = getPortfolioAssetGroupKey({
        kind: operation.kind,
        symbol: operation.symbol,
      });

      if (operation.side === "buy") {
        const planLimitError = getFreePlanAssetLimitError(nextAssets.length + 1);

        if (planLimitError) {
          throw new Error(planLimitError);
        }

        const existingGroupOrder = nextAssets.find(
          (asset) => getPortfolioAssetGroupKey(asset) === groupKey
        )?.groupOrder;
        const nextAsset: PortfolioAsset = {
          id: createAssetId(),
          name: operation.name,
          symbol: operation.symbol,
          kind: operation.kind,
          purchaseDate: operation.date,
          quantity: operation.quantity,
          purchasePrice: operation.price,
          purchaseCurrency: operation.currency,
          feePln: operation.feePln,
          marketCurrency: operation.currency,
          provider: operation.provider,
          providerId: operation.providerId,
          groupOrder: existingGroupOrder ?? getNextGroupOrder(nextAssets),
          createdAt: new Date(`${operation.date}T00:00:00.000Z`).toISOString(),
        };

        nextAssets = normalizeStoredPortfolioAssets([nextAsset, ...nextAssets]);
        importedBuys += 1;
        continue;
      }

      const targetGroup = getGroupedPortfolioAssets(nextAssets, fxRates).find(
        (group) => group.key === groupKey
      );

      if (!targetGroup) {
        skippedSells += 1;
        continue;
      }

      try {
        const representativeLot = targetGroup.lots[0];
        const result = applySaleToPortfolio({
          assets: nextAssets,
          group: targetGroup,
          draft: {
            groupKey,
            name: operation.name || targetGroup.name,
            symbol: operation.symbol,
            kind: operation.kind,
            purchaseCurrency: operation.currency,
            marketCurrency: operation.currency,
            provider: representativeLot?.provider ?? operation.provider,
            providerId: representativeLot?.providerId ?? operation.providerId,
            priceScale: representativeLot?.priceScale,
            maxQuantity: targetGroup.quantity,
            quantity: operation.quantity,
            quantityInput: String(operation.quantity),
            salePrice: operation.price,
            salePriceInput: String(operation.price),
            saleDate: operation.date,
            feePln: operation.feePln,
          },
          fxRates,
        });

        nextAssets = result.assets;
        nextSales = getSortedPortfolioSales([result.sale, ...nextSales]);
        importedSells += 1;
      } catch {
        skippedSells += 1;
      }
    }

    if (importedBuys + importedSells === 0) {
      throw new Error("Nie udalo sie dodac zadnej operacji z pliku.");
    }

    setAssets(nextAssets);
    setSales(nextSales);
    setSyncError(null);

    return {
      importedBuys,
      importedSells,
      skippedSells,
    };
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

  const handleRemoveRealizedAdjustment = (adjustmentId: string) => {
    setSyncError(null);
    setRealizedAdjustments((currentAdjustments) =>
      getSortedPortfolioRealizedAdjustments(
        currentAdjustments.filter(
          (adjustment) =>
            !(adjustment.id === adjustmentId && adjustment.source === "manual")
        )
      )
    );
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
    () => getPortfolioSummary(assets, sales, effectiveRealizedAdjustments, fxRates),
    [assets, effectiveRealizedAdjustments, sales, fxRates]
  );
  const summaryPanel = (
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
      subscriptionPlan={account.subscriptionPlan}
      onRefresh={() => {
        void syncFxRates(trackedCurrencies);
        void syncQuotes();
      }}
      onRequestVerification={() => {
        void handleVerificationRequest();
      }}
    />
  );

  return (
    <main className="page-shell">
      <div className="page-grid">
        <div className="summary-actions">
          {isAdmin ? (
            <a className="ghost-button" href="/admin">
              Panel admina
            </a>
          ) : null}
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              void handleLogout();
            }}
            disabled={isLoggingOut}
          >
            {isLoggingOut ? "Wylogowuje..." : "Wyloguj"}
          </button>
        </div>

        <AppSectionTabs activeSection={activeSection} onChange={setActiveSection} />

        {activeSection === "portfolio" ? (
          <>
            {syncError ? <p className="field-note field-note-error">{syncError}</p> : null}

            <section className="panel panel-compact">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="eyebrow">Tryb dodawania</p>
                  <h2 className="section-title">Wybierz klase aktywa</h2>
                </div>

                <p className="section-copy">
                  Obligacje maja osobny formularz i nie ingeruja w dotychczasowy flow
                  wyszukiwarki dla akcji, ETF-ow i krypto.
                </p>
              </div>

              <div className="mt-6">
                <AssetModeSelector value={entryMode} onChange={handleEntryModeChange} />
              </div>
            </section>

            {entryMode === "bond" ? (
              <TreasuryBondForm
                draft={bondDraft}
                series={bondSeries}
                quote={bondQuote}
                redemptionPreview={bondRedemptionPreview}
                swapPreview={bondSwapPreview}
                isLoadingSeries={isBondLoading}
                isLoadingRedemption={isBondRedemptionLoading}
                isLoadingSwap={isBondSwapLoading}
                error={bondError}
                redemptionError={bondRedemptionError}
                swapError={bondSwapError}
                onChange={(nextDraft) => {
                  setBondDraft(nextDraft);
                  resetBondInteractionState();
                }}
                onCodeChange={(code) => {
                  setBondDraft((currentDraft) => ({
                    ...currentDraft,
                    code: normalizeTreasuryBondCode(code),
                  }));
                  setBondError(null);
                  resetBondInteractionState();
                }}
                onBuySubmit={() => {
                  void handleAddBondAsset();
                }}
                onRedeemSubmit={() => {
                  void handleRedeemBondAsset();
                }}
                onSwapSubmit={() => {
                  void handleSwapBondAsset();
                }}
              />
            ) : (
              <AddAssetForm
                showModeSelector={false}
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
            )}

            <BrokerImportPanel onImport={handleImportBrokerOperations} />

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
              adjustments={effectiveRealizedAdjustments}
              error={realizedAdjustmentError}
              onChange={(nextDraft) => {
                setRealizedAdjustmentDraft(nextDraft);
                setRealizedAdjustmentError(null);
              }}
              onSubmit={() => {
                void handleAddRealizedAdjustment();
              }}
              onRemove={handleRemoveRealizedAdjustment}
            />

            <SalesHistoryPanel
              sales={sales}
              canUndoSale={(saleId) => canUndoPortfolioSale(sales, saleId)}
              onUndoSale={handleUndoSale}
            />
          </>
        ) : activeSection === "charts" ? (
          <>
            {summaryPanel}

            <PortfolioCharts
              assets={assets}
              sales={sales}
              realizedAdjustments={realizedAdjustments}
              fxRates={fxRates}
              combinedProfitLossPln={summary.combinedProfitLossPln}
            />
          </>
        ) : (
          <>
            {summaryPanel}

            <PortfolioLineCharts
              assets={assets}
              sales={sales}
              realizedAdjustments={effectiveRealizedAdjustments}
              fxRates={fxRates}
              combinedProfitLossPln={summary.combinedProfitLossPln}
            />
          </>
        )}
      </div>
    </main>
  );
}

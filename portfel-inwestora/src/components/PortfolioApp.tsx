"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  logoutUser,
  refreshPortfolioQuotes,
  requestEmailVerification,
  savePortfolioAssets,
  searchAssets,
} from "@/lib/api";
import { getPortfolioSummary } from "@/lib/pricing";
import {
  getMinimumSearchLength,
  getModeConfig,
} from "@/lib/search";
import { createAssetId, createEmptyDraft, normalizeSymbol } from "@/lib/ticker";
import type {
  AssetDraft,
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
    provider: config.provider,
    purchaseCurrency: config.purchaseCurrency,
    marketCurrency: config.marketCurrency,
  };
};

const toErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export default function PortfolioApp({ account, initialAssets }: PortfolioAppProps) {
  const assetsRef = useRef<PortfolioAsset[]>(initialAssets);
  const hasSavedAssetsRef = useRef(false);
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verificationPreviewUrl, setVerificationPreviewUrl] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [fxUpdatedAt, setFxUpdatedAt] = useState<string>();

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  const applySearchResultToDraft = useCallback(
    (
      result: AssetSearchResult,
      options?: {
        query?: string;
        clearResults?: boolean;
      }
    ) => {
      const nextQuery = options?.query ?? result.name;

      setDraft((currentDraft) => ({
        ...currentDraft,
        query: nextQuery,
        name: result.name,
        symbol: result.symbol,
        marketCurrency: result.marketCurrency,
        provider: result.provider,
        providerId: result.providerId,
        latestPrice: undefined,
      }));

      if (options?.clearResults) {
        setResults([]);
      }
    },
    []
  );

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
  }, [applySearchResultToDraft, draft.kind, draft.query, searchMode]);

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

    setIsRefreshing(true);

    try {
      const refreshedAssets = await refreshPortfolioQuotes(assetsRef.current);
      setAssets(refreshedAssets);
      setLastSyncAt(new Date().toISOString());
      setSyncError(null);
    } catch (error) {
      setSyncError(toErrorMessage(error, "Nie udalo sie odswiezyc cen aktywow."));
    } finally {
      setIsRefreshing(false);
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

  const handleSearchModeChange = (mode: AssetSearchMode) => {
    setSearchMode(mode);
    setDraft(createDraftFromMode(mode));
    setResults([]);
    setSearchError(null);
  };

  const handlePickResult = (result: AssetSearchResult) => {
    applySearchResultToDraft(result, {
      query: result.name,
      clearResults: true,
    });
  };

  const handleAddAsset = () => {
    const name = draft.name.trim() || draft.query.trim();
    const symbol = normalizeSymbol(draft.symbol);

    if (!name || !symbol || draft.quantity <= 0 || draft.purchasePrice <= 0) {
      setSearchError("Uzupelnij nazwe, ticker, ilosc i cene zakupu.");
      return;
    }

    const nextAsset: PortfolioAsset = {
      id: createAssetId(),
      name,
      symbol,
      kind: draft.kind,
      quantity: draft.quantity,
      purchasePrice: draft.purchasePrice,
      purchaseCurrency: draft.purchaseCurrency,
      feePln: draft.feePln,
      marketCurrency: draft.marketCurrency,
      provider: draft.provider,
      providerId: draft.providerId,
      createdAt: new Date().toISOString(),
    };

    setAssets((currentAssets) => [nextAsset, ...currentAssets]);
    setDraft(createDraftFromMode(searchMode));
    setResults([]);
    setSearchError(null);
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
        <AppSectionTabs
          activeSection={activeSection}
          onChange={setActiveSection}
        />

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
              searchError={searchError}
              onDraftChange={setDraft}
              onSearchModeChange={handleSearchModeChange}
              onQueryChange={(query) => {
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  query,
                  name: query,
                  symbol: "",
                  latestPrice: undefined,
                }));
              }}
              onSymbolChange={(symbol) => {
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  symbol: symbol.toUpperCase(),
                  latestPrice: undefined,
                }));
              }}
              onPickResult={(result) => {
                handlePickResult(result);
              }}
              onSubmit={handleAddAsset}
            />

            <AssetTable
              assets={assets}
              fxRates={fxRates}
              filter={filter}
              onFilterChange={setFilter}
              onRemove={(assetId) =>
                setAssets((currentAssets) =>
                  currentAssets.filter((asset) => asset.id !== assetId)
                )
              }
            />
          </>
        ) : (
          <PortfolioCharts assets={assets} fxRates={fxRates} />
        )}
      </div>
    </main>
  );
}

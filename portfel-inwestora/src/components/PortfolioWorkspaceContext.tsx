"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PortfolioAssetGroup } from "@/lib/pricing";
import type { WatchlistItem } from "@/lib/watchlist";
import type { PortfolioScopeSelection } from "@/lib/portfolio-selection";
import type {
  AuthenticatedUser,
  CurrencyCode,
  FxRates,
  InvestmentPortfolio,
  PortfolioAsset,
  PortfolioRealizedAdjustment,
  PortfolioSale,
  AssetSearchResult,
  PortfolioBenchmarkDefinition,
  PortfolioSummary,
} from "@/types/portfolio";

export type PortfolioWorkspaceValue = {
  account: AuthenticatedUser;
  isAdmin: boolean;
  portfolios: InvestmentPortfolio[];
  /** The real portfolios included by the global read-only scope. */
  selectedPortfolios: InvestmentPortfolio[];
  portfolioSummaries: Array<{ portfolio: InvestmentPortfolio; summary: PortfolioSummary }>;
  selectedPortfolioSummaries: Array<{ portfolio: InvestmentPortfolio; summary: PortfolioSummary }>;
  activePortfolio?: InvestmentPortfolio;
  /** The persisted active portfolio always remains a real record. */
  activePortfolioId: string;
  selectedPortfolioId: string;
  portfolioScope: PortfolioScopeSelection;
  portfolioScopeLabel: string;
  selectedPortfolioIds: string[];
  isPortfolioScopeAggregate: boolean;
  isAllRealPortfoliosSelected: boolean;
  onPortfolioScopeChange: (selection: PortfolioScopeSelection) => void;
  isAllPortfoliosSelected: boolean;
  activeBaseCurrency: CurrencyCode;
  isPortfolioMutationPending: boolean;
  isLoggingOut: boolean;
  onPortfolioChange: (portfolioId: string) => void;
  onBenchmarksChange: (benchmarks: PortfolioBenchmarkDefinition[]) => Promise<void>;
  onBaseCurrencyChange: (currency: string) => void;
  getReadHref: (href: string) => string;
  onQuickAdd: () => void;
  resetAssetEntryForm: () => void;
  onLogout: () => void;
  displayedSyncError: string | null;
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
  effectiveRealizedAdjustments: PortfolioRealizedAdjustment[];
  fxRates: FxRates;
  groupedAssets: PortfolioAssetGroup[];
  watchlistItems: WatchlistItem[];
  isWatchlistLoading: boolean;
  watchlistReadError: boolean;
  onRemoveWatchlistItem: (canonicalKey: string) => Promise<void>;
  onToggleWatchlistItem: (result: AssetSearchResult) => Promise<void>;
  isWatchlistTogglePending: boolean;
  filter: string;
  assetSortMode: "manual" | "value-desc" | "value-asc" | "profit-desc" | "loss-asc" | "profit-percent-desc" | "profit-percent-asc" | "daily-gain-desc" | "daily-loss-asc";
  isRefreshing: boolean;
  isManualPricePending: boolean;
  manualPriceError: string | null;
  onUpdateManualPrice: (group: PortfolioAssetGroup, price: number, currency: CurrencyCode) => Promise<void>;
  onClearManualPrice: (group: PortfolioAssetGroup) => Promise<void>;
  summaryTotalValue: number;
  summaryCombinedProfitLoss: number;
  summaryTotalInvested: number;
  summaryCashValue: number;
  refreshRevision: number;
  activeDividendYtd: number;
  activeDividendMonth: number;
  activeDividendAnnualIncome: number;
  summaryPanel: ReactNode;
  assetEntryWorkspace: ReactNode;
  operationsWorkspace: ReactNode;
  incomeWorkspace: ReactNode;
  importWorkspace: ReactNode;
  settingsWorkspace: ReactNode;
  portfolioManagementWorkspace: ReactNode;
  wealthWorkspace: ReactNode;
  onFilterChange: (value: string) => void;
  onSortModeChange: (value: PortfolioWorkspaceValue["assetSortMode"]) => void;
  onReorderGroups: (keys: string[]) => void;
  onRemoveAsset: (assetId: string) => void;
};

const PortfolioWorkspaceContext = createContext<PortfolioWorkspaceValue | null>(null);

export function PortfolioWorkspaceProvider({ value, children }: { value: PortfolioWorkspaceValue; children: ReactNode }) {
  return <PortfolioWorkspaceContext.Provider value={value}>{children}</PortfolioWorkspaceContext.Provider>;
}

export function usePortfolioWorkspace() {
  const value = useContext(PortfolioWorkspaceContext);
  if (!value) throw new Error("usePortfolioWorkspace must be used inside PortfolioWorkspaceProvider.");
  return value;
}

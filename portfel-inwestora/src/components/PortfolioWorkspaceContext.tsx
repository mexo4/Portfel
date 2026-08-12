"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { PortfolioAssetGroup } from "@/lib/pricing";
import type {
  AuthenticatedUser,
  CurrencyCode,
  FxRates,
  InvestmentPortfolio,
  PortfolioAsset,
  PortfolioRealizedAdjustment,
  PortfolioSale,
} from "@/types/portfolio";

export type PortfolioWorkspaceValue = {
  account: AuthenticatedUser;
  isAdmin: boolean;
  portfolios: InvestmentPortfolio[];
  activePortfolio?: InvestmentPortfolio;
  activePortfolioId: string;
  activeBaseCurrency: CurrencyCode;
  isPortfolioMutationPending: boolean;
  isLoggingOut: boolean;
  onPortfolioChange: (portfolioId: string) => void;
  onBaseCurrencyChange: (currency: string) => void;
  onQuickAdd: () => void;
  onLogout: () => void;
  displayedSyncError: string | null;
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
  effectiveRealizedAdjustments: PortfolioRealizedAdjustment[];
  fxRates: FxRates;
  groupedAssets: PortfolioAssetGroup[];
  filter: string;
  assetSortMode: "manual" | "value-desc" | "value-asc" | "profit-desc" | "loss-asc" | "daily-gain-desc" | "daily-loss-asc";
  isRefreshing: boolean;
  summaryTotalValue: number;
  summaryCombinedProfitLoss: number;
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

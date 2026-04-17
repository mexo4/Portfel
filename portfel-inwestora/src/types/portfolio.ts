export type AssetKind = "stock" | "etf" | "crypto";

export type AssetSearchMode =
  | "stock-global"
  | "stock-gpw"
  | "etf"
  | "crypto";

export type CurrencyCode = string;

export type InvestorExperience = "beginner" | "intermediate" | "advanced";

export type QuoteProvider =
  | "finnhub"
  | "stooq"
  | "eodhd"
  | "coingecko"
  | "catalog";

export type SearchSource = "api" | "catalog" | "fallback";

export type AssetTableSortMode =
  | "manual"
  | "value-desc"
  | "value-asc"
  | "profit-desc"
  | "loss-asc"
  | "daily-gain-desc"
  | "daily-loss-asc";

export type AssetCatalogItem = {
  symbol: string;
  name: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  searchTerms: string[];
  subtitle?: string;
  providerId?: string;
  isin?: string;
  priceScale?: number;
};

export type AssetSearchResult = {
  symbol: string;
  name: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  source: SearchSource;
  providerId?: string;
  subtitle?: string;
  isin?: string;
  priceScale?: number;
};

export type AssetQuote = {
  symbol: string;
  price: number;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  fetchedAt: string;
  providerId?: string;
  name?: string;
  priceScale?: number;
  previousClose?: number;
};

export type PortfolioAsset = {
  id: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  purchaseDate: string;
  quantity: number;
  purchasePrice: number;
  purchaseCurrency: CurrencyCode;
  feePln: number;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
  latestPrice?: number;
  previousClose?: number;
  lastUpdatedAt?: string;
  groupOrder?: number;
  createdAt: string;
};

export type AssetDraft = {
  kind: AssetKind;
  query: string;
  name: string;
  symbol: string;
  purchaseDate: string;
  quantity: number;
  quantityInput: string;
  purchasePrice: number;
  purchasePriceInput: string;
  purchaseCurrency: CurrencyCode;
  feePln: number;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
  latestPrice?: number;
  previousClose?: number;
};

export type PortfolioSaleAllocation = {
  lotId: string;
  quantity: number;
  purchaseDate: string;
  purchasePrice: number;
  purchaseCurrency: CurrencyCode;
  allocatedBuyFeePln: number;
  investedPln: number;
};

export type PortfolioSale = {
  id: string;
  assetKey: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  quantity: number;
  salePrice: number;
  saleDate: string;
  feePln: number;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
  realizedInvestedPln: number;
  realizedProceedsPln: number;
  realizedProfitLossPln: number;
  allocations: PortfolioSaleAllocation[];
  createdAt: string;
};

export type SellAssetDraft = {
  groupKey: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
  maxQuantity: number;
  quantity: number;
  quantityInput: string;
  salePrice: number;
  salePriceInput: string;
  saleDate: string;
  feePln: number;
};

export type PortfolioState = {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
};

export type FxRates = Record<CurrencyCode, number>;

export type PortfolioSummary = {
  totalValuePln: number;
  totalInvestedPln: number;
  totalProfitLossPln: number;
  openProfitLossPln: number;
  realizedProfitLossPln: number;
  combinedProfitLossPln: number;
  positionsCount: number;
  assetsCount: number;
  salesCount: number;
};

export type BenchmarkInvestment = {
  date: string;
  amountPln: number;
};

export type BenchmarkComparison = {
  id: string;
  label: string;
  currentValuePln: number;
  investedPln: number;
  profitLossPln: number;
  returnPercent: number;
};

export type AuthenticatedUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  emailVerifiedAt: string | null;
};

export type UserProfile = {
  displayName: string;
  email: string;
  country: string;
  preferredBroker: string;
  experienceLevel: InvestorExperience;
  monthlyContributionPln: number;
  investmentGoal: string;
  createdAt: string;
  updatedAt: string;
};

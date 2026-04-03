export type AssetKind = "stock" | "etf" | "crypto" | "commodity";

export type AssetSearchMode =
  | "stock-global"
  | "stock-gpw"
  | "etf"
  | "crypto"
  | "commodity";

export type CurrencyCode = "PLN" | "USD" | "EUR";

export type InvestorExperience = "beginner" | "intermediate" | "advanced";

export type QuoteProvider =
  | "finnhub"
  | "stooq"
  | "coingecko"
  | "commoditypriceapi"
  | "catalog";

export type SearchSource = "api" | "catalog" | "fallback";

export type AssetCatalogItem = {
  symbol: string;
  name: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  searchTerms: string[];
  subtitle?: string;
  providerId?: string;
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
};

export type AssetQuote = {
  symbol: string;
  price: number;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  fetchedAt: string;
  providerId?: string;
  name?: string;
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
  latestPrice?: number;
  lastUpdatedAt?: string;
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
  latestPrice?: number;
};

export type FxRates = Record<CurrencyCode, number>;

export type PortfolioSummary = {
  totalValuePln: number;
  totalInvestedPln: number;
  totalProfitLossPln: number;
  positionsCount: number;
  assetsCount: number;
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

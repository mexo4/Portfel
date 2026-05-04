export type AssetKind = "stock" | "etf" | "crypto" | "bond";

export type AssetSearchMode =
  | "stock-global"
  | "stock-gpw"
  | "etf"
  | "crypto";

export type AssetEntryMode = AssetSearchMode | "bond";

export type CurrencyCode = string;

export type InvestorExperience = "beginner" | "intermediate" | "advanced";

export type QuoteProvider =
  | "finnhub"
  | "stooq"
  | "eodhd"
  | "coingecko"
  | "catalog"
  | "obligacjeskarbowe";

export type SearchSource = "api" | "catalog" | "fallback";

export type TreasuryBondType = "EDO" | "COI" | "ROS";

export type TreasuryBondCouponMode = "capitalized" | "paid-out";

export type BondTransactionKind = "sale" | "bond-redemption" | "bond-swap";

export type TreasuryBondSourceLinks = {
  offerPageUrl?: string;
  interestTableUrl?: string;
  letterUrl?: string;
};

export type TreasuryBondRateEntry = {
  yearIndex: number;
  annualRate: number;
  referenceMonth?: string;
  inflationRate?: number;
  source: "official" | "inflation" | "fallback";
};

export type TreasuryBondSeries = {
  code: string;
  type: TreasuryBondType;
  yearsToMaturity: number;
  issueMonth: number;
  issueYear: number;
  redemptionMonth: number;
  redemptionYear: number;
  nominalValue: number;
  salePrice: number;
  swapPrice?: number;
  firstYearRate: number;
  marginRate: number;
  earlyRedemptionFee: number;
  couponMode: TreasuryBondCouponMode;
  interestPaymentDescription: string;
  isFamilyOnly: boolean;
  rateSchedule?: TreasuryBondRateEntry[];
  sourceLinks?: TreasuryBondSourceLinks;
  resolvedAt: string;
};

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
  bondMeta?: TreasuryBondSeries;
};

export type TreasuryBondQuote = AssetQuote & {
  code: string;
  type: TreasuryBondType;
  maturityDate: string;
  grossValue: number;
  grossInterest: number;
  currentPeriodInterest: number;
  annualRate: number;
  couponPaymentDate?: string;
  bondMeta: TreasuryBondSeries;
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
  bondMeta?: TreasuryBondSeries;
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

export type TreasuryBondDraft = {
  code: string;
  quantity: number;
  quantityInput: string;
  purchaseDate: string;
  purchasePrice: number;
  purchasePriceInput: string;
  swapTargetCode: string;
  swapTargetQuantity: number;
  swapTargetQuantityInput: string;
};

export type PortfolioSaleAllocation = {
  lotId: string;
  quantity: number;
  purchaseDate: string;
  purchasePrice: number;
  purchaseCurrency: CurrencyCode;
  allocatedBuyFeePln: number;
  investedPln: number;
  name?: string;
  symbol?: string;
  kind?: AssetKind;
  marketCurrency?: CurrencyCode;
  provider?: QuoteProvider;
  providerId?: string;
  priceScale?: number;
  latestPrice?: number;
  previousClose?: number;
  lastUpdatedAt?: string;
  groupOrder?: number;
  bondMeta?: TreasuryBondSeries;
  createdAt?: string;
};

export type PortfolioSale = {
  id: string;
  assetKey: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  transactionKind: BondTransactionKind;
  quantity: number;
  salePrice: number;
  saleDate: string;
  settlementDate?: string;
  feePln: number;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
  bondMeta?: TreasuryBondSeries;
  realizedInvestedPln: number;
  realizedProceedsPln: number;
  realizedProfitLossPln: number;
  realizedInvestedValue?: number;
  realizedProceedsValue?: number;
  realizedProfitLossValue?: number;
  realizedValueCurrency?: CurrencyCode;
  grossProceedsPln?: number;
  grossProfitLossPln?: number;
  grossProceedsValue?: number;
  grossProfitLossValue?: number;
  taxTotalPln?: number;
  redemptionFeeTotalPln?: number;
  swapTargetCode?: string;
  swapTargetQuantity?: number;
  swapPricePerUnit?: number;
  swapResidualCashPln?: number;
  swapTargetAssetId?: string;
  allocations: PortfolioSaleAllocation[];
  createdAt: string;
};

export type PortfolioRealizedAdjustment = {
  id: string;
  amount: number;
  currency: CurrencyCode;
  amountPlnSnapshot: number;
  date: string;
  source: "manual" | "bond-coupon";
  bondCode?: string;
  note?: string;
  createdAt: string;
};

export type RealizedAdjustmentDraft = {
  amount: number;
  amountInput: string;
  currency: CurrencyCode;
  date: string;
  note: string;
};

export type SellAssetDraft = {
  groupKey: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  purchaseCurrency: CurrencyCode;
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

export type BondRedemptionQuote = {
  code: string;
  quantity: number;
  requestDate: string;
  settlementDate: string;
  maturityDate: string;
  grossValuePerUnit: number;
  grossValueTotal: number;
  grossInterestPerUnit: number;
  grossInterestTotal: number;
  annualRate: number;
  feePerUnit: number;
  feeTotal: number;
  taxableInterestPerUnit: number;
  taxableInterestTotal: number;
  taxPerUnit: number;
  taxTotal: number;
  netValuePerUnit: number;
  netValueTotal: number;
  marketCurrency: CurrencyCode;
  transactionKind: "bond-redemption";
};

export type BondSwapQuote = {
  sourceCode: string;
  targetCode: string;
  sourceQuantity: number;
  targetQuantity: number;
  requestDate: string;
  settlementDate: string;
  sourceRedemption: BondRedemptionQuote;
  targetSeries: TreasuryBondSeries;
  targetQuote: TreasuryBondQuote;
  swapPricePerUnit: number;
  swapPurchaseTotal: number;
  residualCashPln: number;
  marketCurrency: CurrencyCode;
  transactionKind: "bond-swap";
};

export type PortfolioState = {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  realizedAdjustments: PortfolioRealizedAdjustment[];
};

export type FxRates = Record<CurrencyCode, number>;

export type PortfolioSummary = {
  totalValuePln: number;
  totalInvestedPln: number;
  totalProfitLossPln: number;
  openProfitLossPln: number;
  realizedProfitLossPln: number;
  realizedProfitLossByCurrency: Record<CurrencyCode, number>;
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

export type PortfolioHistoryPoint = {
  date: string;
  portfolioValuePln: number;
  netInvestedPln: number;
  profitLossPln: number;
};

export type PortfolioAssetHistorySeriesPoint = {
  date: string;
  valuePln: number;
};

export type PortfolioAssetHistorySeries = {
  groupKey: string;
  label: string;
  symbol: string;
  kind: AssetKind;
  points: PortfolioAssetHistorySeriesPoint[];
};

export type PortfolioBenchmarkHistoryPoint = {
  date: string;
  valuePln: number;
};

export type PortfolioBenchmarkHistorySeries = {
  id: string;
  label: string;
  points: PortfolioBenchmarkHistoryPoint[];
};

export type PortfolioBenchmarkDefinition = {
  id: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
};

export type PortfolioHistoryResponse = {
  points: PortfolioHistoryPoint[];
  warnings: string[];
  assetSeries: PortfolioAssetHistorySeries[];
  benchmarkSeries: PortfolioBenchmarkHistorySeries[];
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

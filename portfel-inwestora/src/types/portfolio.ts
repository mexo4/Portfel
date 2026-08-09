export type AssetKind = "stock" | "etf" | "crypto" | "bond";

export type InstrumentType =
  | "STOCK"
  | "ETF"
  | "BOND"
  | "CRYPTO"
  | "FUND"
  | "TERM_DEPOSIT"
  | "CASH"
  | "OTHER";

export type OperationType =
  | "BUY"
  | "SELL"
  | "DEPOSIT"
  | "WITHDRAW"
  | "TRANSFER"
  | "DIVIDEND"
  | "COUPON"
  | "INTEREST"
  | "FEE"
  | "TAX"
  | "CONVERSION"
  | "SPLIT"
  | "REVERSE_SPLIT"
  | "BONUS"
  | "CUSTOM";

export type AccountKind = "investment" | "cash" | "currency";

export type BrokerCode =
  | "XTB"
  | "IBKR"
  | "DEGIRO"
  | "TRADING212"
  | "REVOLUT"
  | "MBANK"
  | "BOS"
  | "SANTANDER"
  | "BINANCE"
  | "BYBIT"
  | "KRAKEN"
  | "CASH"
  | "CURRENCY"
  | "OTHER";

export type TagTargetType = "portfolio" | "instrument" | "operation";

export type PortfolioSchemaVersion = 2;

export type AssetSearchMode =
  | "stock-global"
  | "stock-gpw"
  | "stock-international"
  | "etf"
  | "crypto";

export type AssetEntryMode = AssetSearchMode | "bond";

export type CurrencyCode = string;

export type InvestorExperience = "beginner" | "intermediate" | "advanced";
export type SubscriptionPlan = "free" | "pro";
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled";

export type QuoteProvider =
  | "finnhub"
  | "stooq"
  | "yahoo"
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
  instrumentIdentity?: InstrumentIdentity;
};

/**
 * Stable identity returned by an instrument-discovery provider.  A ticker is a
 * display value only: it can be reused on another exchange, so an ETF listing
 * keeps its FIGI identifiers and venue alongside it.
 */
export type InstrumentIdentity = {
  figi?: string;
  compositeFigi?: string;
  shareClassFigi?: string;
  ticker: string;
  name: string;
  instrumentType: "ETF";
  exchange?: string;
  exchangeCode?: string;
  mic?: string;
  currency?: CurrencyCode;
  securityType?: string;
  securityType2?: string;
  providerPriceSymbol?: string;
};

export type EtfPriceStatus = "available" | "unavailable" | "unchecked";

export type EtfListing = AssetSearchResult & {
  kind: "etf";
  listingId: string;
  exchange?: string;
  exchangeCode?: string;
  mic?: string;
  securityType?: string;
  providerPriceSymbol?: string;
  priceStatus: EtfPriceStatus;
  instrumentIdentity: InstrumentIdentity;
};

export type EtfSearchGroup = {
  id: string;
  name: string;
  instrumentType: "ETF";
  identity: Pick<
    InstrumentIdentity,
    "compositeFigi" | "shareClassFigi" | "name" | "instrumentType"
  >;
  listings: EtfListing[];
};

export type AssetQuote = {
  symbol: string;
  price: number;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  fetchedAt: string;
  /** Date of the market session that produced this price (YYYY-MM-DD). */
  priceDate?: string;
  /** Provider's market timestamp when it is available. */
  marketTimestamp?: string;
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
  purchasePriceCurrency?: CurrencyCode;
  purchaseFxRateToPln?: number;
  purchaseSettlementFxRateToPln?: number;
  feePln: number;
  marketCurrency: CurrencyCode;
  provider: QuoteProvider;
  providerId?: string;
  priceScale?: number;
  instrumentIdentity?: InstrumentIdentity;
  latestPrice?: number;
  latestPriceDate?: string;
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
  instrumentIdentity?: InstrumentIdentity;
  marketCurrencyConfirmed?: boolean;
  latestPrice?: number;
  latestPriceDate?: string;
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
  purchasePriceCurrency?: CurrencyCode;
  purchaseFxRateToPln?: number;
  allocatedBuyFeePln: number;
  investedPln: number;
  name?: string;
  symbol?: string;
  kind?: AssetKind;
  marketCurrency?: CurrencyCode;
  provider?: QuoteProvider;
  providerId?: string;
  priceScale?: number;
  instrumentIdentity?: InstrumentIdentity;
  latestPrice?: number;
  latestPriceDate?: string;
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
  instrumentIdentity?: InstrumentIdentity;
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

export type InvestmentPortfolio = PortfolioState & {
  id: string;
  name: string;
  schemaVersion?: PortfolioSchemaVersion;
  baseCurrency?: CurrencyCode;
  subPortfolios?: PortfolioSubPortfolio[];
  accounts?: PortfolioAccount[];
  instruments?: PortfolioInstrument[];
  operations?: PortfolioOperation[];
  tags?: PortfolioTag[];
  tagAssignments?: PortfolioTagAssignment[];
  benchmarks?: PortfolioBenchmarkDefinition[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioBook = {
  schemaVersion?: PortfolioSchemaVersion;
  portfolios: InvestmentPortfolio[];
  activePortfolioId: string;
  migratedAt?: string;
};

export type FxRates = Record<CurrencyCode, number>;

export type PortfolioSummary = {
  currency: CurrencyCode;
  totalValue: number;
  marketValue: number;
  cashValue: number;
  totalInvested: number;
  totalProfitLoss: number;
  openProfitLoss: number;
  realizedProfitLoss: number;
  combinedProfitLoss: number;
  totalValuePln: number;
  marketValuePln: number;
  cashValuePln: number;
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
  timeWeightedReturnPercent: number | null;
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
  price: number;
  pricePln: number;
  returnPercent: number | null;
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

export type PortfolioAccount = {
  id: string;
  portfolioId: string;
  parentAccountId?: string;
  name: string;
  kind: AccountKind;
  broker?: BrokerCode;
  currency: CurrencyCode;
  isDefault: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioInstrument = {
  id: string;
  portfolioId: string;
  type: InstrumentType;
  assetKind?: AssetKind;
  symbol: string;
  name: string;
  marketCurrency: CurrencyCode;
  provider?: QuoteProvider;
  providerId?: string;
  isin?: string;
  priceScale?: number;
  instrumentIdentity?: InstrumentIdentity;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioOperation = {
  id: string;
  portfolioId: string;
  accountId: string;
  assetId: string | null;
  operationType: OperationType;
  quantity: number | null;
  price: number | null;
  currency: CurrencyCode;
  exchangeRate: number | null;
  fee: number;
  tax: number;
  amount: number;
  date: string;
  notes: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioDividend = {
  id: string;
  portfolioId: string;
  accountId: string;
  accountName: string;
  instrumentId: string;
  instrumentName: string;
  symbol: string;
  quantity: number;
  dividendPerShare: number;
  grossAmount: number;
  withholdingTax: number;
  domesticTax: number;
  netAmount: number;
  currency: CurrencyCode;
  exchangeRate: number | null;
  grossAmountPln: number;
  netAmountPln: number;
  exDividendDate: string;
  recordDate: string;
  paymentDate: string;
  country: string;
  notes: string;
  operationId: string;
  createdAt: string;
  updatedAt: string;
};

export type DividendReportBucket =
  | "monthly"
  | "quarterly"
  | "yearly"
  | "company"
  | "portfolio"
  | "currency"
  | "country";

export type DividendReportRow = {
  key: string;
  label: string;
  grossAmountPln: number;
  netAmountPln: number;
  taxPln: number;
  paymentsCount: number;
};

export type DividendCalendarBucket =
  | "today"
  | "week"
  | "month"
  | "upcoming"
  | "history";

export type DividendCalendarGroup = {
  bucket: DividendCalendarBucket;
  label: string;
  dividends: PortfolioDividend[];
  grossAmountPln: number;
  netAmountPln: number;
};

export type DividendForecast = {
  monthlyIncomePln: number;
  annualIncomePln: number;
  nextPayment: PortfolioDividend | null;
  message: string | null;
};

export type CashHistoryEntry = {
  id: string;
  operationId: string;
  date: string;
  operationType: OperationType;
  accountId: string;
  accountName: string;
  amount: number;
  currency: CurrencyCode;
  balanceAfter: number;
  notes: string;
};

export type PortfolioTag = {
  id: string;
  portfolioId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

export type PortfolioTagAssignment = {
  id: string;
  portfolioId: string;
  tagId: string;
  targetType: TagTargetType;
  targetId: string;
  createdAt: string;
};

export type PortfolioSubPortfolio = {
  id: string;
  portfolioId: string;
  name: string;
  currency: CurrencyCode;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CashBalance = {
  accountId: string;
  currency: CurrencyCode;
  amount: number;
};

export type AccountValuation = {
  accountId: string;
  accountName: string;
  kind: AccountKind;
  currency: CurrencyCode;
  cashBalances: CashBalance[];
  marketValuePln: number;
  investedPln: number;
  realizedProfitLossPln: number;
  unrealizedProfitLossPln: number;
  totalValuePln: number;
};

export type PortfolioPosition = {
  instrumentId: string;
  key: string;
  symbol: string;
  name: string;
  type: InstrumentType;
  quantity: number;
  averagePrice: number;
  averagePriceCurrency: CurrencyCode;
  costBasisPln: number;
  marketValuePln: number;
  realizedProfitLossPln: number;
  unrealizedProfitLossPln: number;
  returnPercent: number;
};

export type PortfolioEngineSnapshot = {
  portfolioId: string;
  generatedAt: string;
  summary: PortfolioSummary;
  accounts: AccountValuation[];
  positions: PortfolioPosition[];
  cashBalances: CashBalance[];
  operationsCount: number;
  cacheKey: string;
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
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  hasPassword: boolean;
};

export type WealthItemKind = "asset" | "liability";

export type WealthAssetCategory =
  | "house"
  | "apartment"
  | "land"
  | "car"
  | "motorcycle"
  | "gold"
  | "art"
  | "collection"
  | "other";

export type WealthLiabilityCategory =
  | "mortgage"
  | "car-loan"
  | "loan"
  | "other-liability";

export type WealthCategory = WealthAssetCategory | WealthLiabilityCategory;

export type WealthItem = {
  id: string;
  kind: WealthItemKind;
  name: string;
  category: WealthCategory;
  value: number;
  currency: CurrencyCode;
  addedAt: string;
  description: string;
  annualChangePercent: number;
  createdAt: string;
  updatedAt: string;
};

export type UserProfile = {
  displayName: string;
  email: string;
  country: string;
  preferredBroker: string;
  experienceLevel: InvestorExperience;
  monthlyContributionPln: number;
  investmentGoal: string;
  wealthItems: WealthItem[];
  createdAt: string;
  updatedAt: string;
};

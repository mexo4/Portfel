import {
  getAssetInvestedPln,
  getAssetPurchaseValuePln,
  type PortfolioAssetGroup,
  convertToPln,
} from "@/lib/pricing";
import {
  createFallbackTreasuryBondSeries,
  getTreasuryBondCouponPaymentDates,
  normalizeTreasuryBondCode,
} from "@/lib/treasury-bonds";
import { ensurePortfolioCoreModel } from "@/lib/operation-engine";
import { resolveTickerIdentity } from "@/lib/ticker-aliases";
import {
  getDefaultProviderForKind,
  getPortfolioAssetGroupKey,
} from "@/lib/ticker";
import { getTodayDateInputValue, round, toCurrencyCode, toDateInputValue } from "@/lib/utils";
import type {
  AssetKind,
  BenchmarkInvestment,
  BondTransactionKind,
  FxRates,
  InvestmentPortfolio,
  PortfolioBook,
  PortfolioAsset,
  PortfolioRealizedAdjustment,
  PortfolioSale,
  PortfolioSaleAllocation,
  PortfolioState,
  QuoteProvider,
  RealizedAdjustmentDraft,
  SellAssetDraft,
  TreasuryBondRateEntry,
  TreasuryBondSeries,
} from "@/types/portfolio";

const SUPPORTED_ASSET_KINDS = new Set<AssetKind>(["stock", "etf", "crypto", "bond"]);
const SUPPORTED_QUOTE_PROVIDERS = new Set<QuoteProvider>([
  "catalog",
  "coingecko",
  "eodhd",
  "finnhub",
  "obligacjeskarbowe",
  "stooq",
  "yahoo",
]);

const hasFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const convertFromPln = (
  amountPln: number,
  currency: string,
  fxRates: FxRates
) => {
  const normalizedCurrency = toCurrencyCode(currency, "PLN");

  if (normalizedCurrency === "PLN") {
    return round(amountPln, 6);
  }

  const rate = fxRates[normalizedCurrency];

  if (!hasFiniteNumber(rate) || rate <= 0) {
    return null;
  }

  return round(amountPln / rate, 6);
};

const getSafeQuoteProvider = (value: unknown, kind: AssetKind): QuoteProvider =>
  typeof value === "string" && SUPPORTED_QUOTE_PROVIDERS.has(value as QuoteProvider)
    ? (value as QuoteProvider)
    : getDefaultProviderForKind(kind);

const isSupportedAssetKind = (value: unknown): value is AssetKind =>
  typeof value === "string" && SUPPORTED_ASSET_KINDS.has(value as AssetKind);

const isBondTransactionKind = (value: unknown): value is BondTransactionKind =>
  value === "sale" || value === "bond-redemption" || value === "bond-swap";

const normalizePortfolioSymbol = (value: string, kind?: AssetKind) => {
  const normalized = resolveTickerIdentity({
    symbol: value,
    kind,
  }).symbol;

  if (kind === "etf" && normalized.endsWith(".WAR")) {
    return `${normalized.slice(0, -4)}.PL`;
  }

  return normalized;
};

const normalizePortfolioProviderId = (value: unknown, kind?: AssetKind) => {
  if (typeof value !== "string" || !value) {
    return undefined;
  }

  if (kind === "crypto") {
    return value.trim().toLowerCase();
  }

  return normalizePortfolioSymbol(value, kind);
};

const getFallbackProviderId = (
  kind: AssetKind,
  provider: QuoteProvider,
  symbol: string
) => {
  if (kind === "etf" && provider === "eodhd") {
    return symbol;
  }

  if (kind === "stock" && provider === "yahoo") {
    return symbol;
  }

  return undefined;
};

const normalizeTreasuryBondRateEntry = (
  entry: Partial<TreasuryBondRateEntry>
): TreasuryBondRateEntry | null => {
  if (
    !hasFiniteNumber(entry.yearIndex) ||
    entry.yearIndex < 1 ||
    !hasFiniteNumber(entry.annualRate)
  ) {
    return null;
  }

  return {
    yearIndex: entry.yearIndex,
    annualRate: round(entry.annualRate, 6),
    referenceMonth:
      typeof entry.referenceMonth === "string" && entry.referenceMonth
        ? entry.referenceMonth
        : undefined,
    inflationRate: hasFiniteNumber(entry.inflationRate)
      ? round(entry.inflationRate, 6)
      : undefined,
    source:
      entry.source === "official" || entry.source === "inflation"
        ? entry.source
        : "fallback",
  };
};

const normalizeTreasuryBondSeries = (
  series: Partial<TreasuryBondSeries> | undefined
): TreasuryBondSeries | undefined => {
  if (!series || typeof series.code !== "string" || !series.code) {
    return undefined;
  }

  let fallback: TreasuryBondSeries;

  try {
    fallback = createFallbackTreasuryBondSeries(series.code);
  } catch {
    return undefined;
  }

  return {
    ...fallback,
    code: normalizeTreasuryBondCode(series.code),
    nominalValue:
      hasFiniteNumber(series.nominalValue) && series.nominalValue > 0
        ? round(series.nominalValue, 6)
        : fallback.nominalValue,
    salePrice:
      hasFiniteNumber(series.salePrice) && series.salePrice > 0
        ? round(series.salePrice, 6)
        : fallback.salePrice,
    swapPrice:
      hasFiniteNumber(series.swapPrice) && series.swapPrice > 0
        ? round(series.swapPrice, 6)
        : fallback.swapPrice,
    firstYearRate:
      hasFiniteNumber(series.firstYearRate) && series.firstYearRate >= 0
        ? round(series.firstYearRate, 6)
        : fallback.firstYearRate,
    marginRate:
      hasFiniteNumber(series.marginRate) && series.marginRate >= 0
        ? round(series.marginRate, 6)
        : fallback.marginRate,
    earlyRedemptionFee:
      hasFiniteNumber(series.earlyRedemptionFee) && series.earlyRedemptionFee >= 0
        ? round(series.earlyRedemptionFee, 6)
        : fallback.earlyRedemptionFee,
    interestPaymentDescription:
      typeof series.interestPaymentDescription === "string" &&
      series.interestPaymentDescription.trim()
        ? series.interestPaymentDescription.trim()
        : fallback.interestPaymentDescription,
    isFamilyOnly:
      typeof series.isFamilyOnly === "boolean" ? series.isFamilyOnly : fallback.isFamilyOnly,
    sourceLinks:
      series.sourceLinks && typeof series.sourceLinks === "object"
        ? {
            offerPageUrl:
              typeof series.sourceLinks.offerPageUrl === "string"
                ? series.sourceLinks.offerPageUrl
                : fallback.sourceLinks?.offerPageUrl,
            interestTableUrl:
              typeof series.sourceLinks.interestTableUrl === "string"
                ? series.sourceLinks.interestTableUrl
                : fallback.sourceLinks?.interestTableUrl,
            letterUrl:
              typeof series.sourceLinks.letterUrl === "string"
                ? series.sourceLinks.letterUrl
                : fallback.sourceLinks?.letterUrl,
          }
        : fallback.sourceLinks,
    rateSchedule: Array.isArray(series.rateSchedule)
      ? series.rateSchedule
          .map((entry) => normalizeTreasuryBondRateEntry(entry))
          .filter((entry): entry is TreasuryBondRateEntry => Boolean(entry))
      : fallback.rateSchedule,
    resolvedAt:
      typeof series.resolvedAt === "string" && series.resolvedAt
        ? series.resolvedAt
        : fallback.resolvedAt,
  };
};

const getAssetSortTime = (asset: Pick<PortfolioAsset, "purchaseDate" | "createdAt">) =>
  new Date(asset.purchaseDate || asset.createdAt).getTime();
const getPortfolioSaleSortTime = (sale: Pick<PortfolioSale, "saleDate" | "createdAt">) =>
  new Date(sale.saleDate || sale.createdAt).getTime();

const createSaleId = () =>
  `sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createRealizedAdjustmentId = () =>
  `realized-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createPortfolioId = () =>
  `portfolio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const getManualOrderKeys = (assets: PortfolioAsset[]) => {
  const groupedAssets = new Map<
    string,
    {
      order: number;
      index: number;
    }
  >();

  assets.forEach((asset) => {
    const key = getPortfolioAssetGroupKey(asset);
    const assetOrder =
      typeof asset.groupOrder === "number" && Number.isFinite(asset.groupOrder)
        ? asset.groupOrder
        : Number.MAX_SAFE_INTEGER;
    const existingGroup = groupedAssets.get(key);

    if (!existingGroup) {
      groupedAssets.set(key, {
        order: assetOrder,
        index: groupedAssets.size,
      });
      return;
    }

    existingGroup.order = Math.min(existingGroup.order, assetOrder);
  });

  return Array.from(groupedAssets.entries())
    .sort(
      (left, right) =>
        left[1].order - right[1].order || left[1].index - right[1].index
    )
    .map(([key]) => key);
};

export const normalizeStoredPortfolioAssets = (assets: PortfolioAsset[]) => {
  const normalizedAssets = assets
    .filter(
      (asset) =>
        isSupportedAssetKind(asset.kind) &&
        hasFiniteNumber(asset.quantity) &&
        asset.quantity > 0
    )
    .map((asset) => {
      const symbol = normalizePortfolioSymbol(asset.symbol, asset.kind);
      const provider = getSafeQuoteProvider(asset.provider, asset.kind);

      return {
        ...asset,
        symbol,
        provider,
        providerId:
          normalizePortfolioProviderId(asset.providerId, asset.kind) ??
          getFallbackProviderId(asset.kind, provider, symbol),
        quantity: round(asset.quantity, 6),
        feePln: hasFiniteNumber(asset.feePln) ? round(asset.feePln, 6) : 0,
        purchaseDate: toDateInputValue(asset.purchaseDate, getTodayDateInputValue()),
        createdAt:
          typeof asset.createdAt === "string" && asset.createdAt
            ? asset.createdAt
            : new Date().toISOString(),
        groupOrder:
          typeof asset.groupOrder === "number" && Number.isFinite(asset.groupOrder)
            ? asset.groupOrder
            : undefined,
      };
    });
  const orderedKeys = getManualOrderKeys(normalizedAssets);
  const groupOrderByKey = new Map(
    orderedKeys.map((groupKey, index) => [groupKey, index] as const)
  );

  return normalizedAssets.map((asset) => ({
    ...asset,
    groupOrder: groupOrderByKey.get(getPortfolioAssetGroupKey(asset)) ?? 0,
  }));
};

const normalizePortfolioSaleAllocation = (
  allocation: Partial<PortfolioSaleAllocation>,
  fallbackKind?: AssetKind
): PortfolioSaleAllocation | null => {
  if (
    typeof allocation.lotId !== "string" ||
    !allocation.lotId ||
    !hasFiniteNumber(allocation.quantity) ||
    allocation.quantity <= 0
  ) {
    return null;
  }

  const kind = isSupportedAssetKind(allocation.kind) ? allocation.kind : fallbackKind;

  return {
    lotId: allocation.lotId,
    quantity: round(allocation.quantity, 6),
    purchaseDate: toDateInputValue(allocation.purchaseDate, getTodayDateInputValue()),
    purchasePrice: hasFiniteNumber(allocation.purchasePrice)
      ? round(allocation.purchasePrice, 6)
      : 0,
    purchaseCurrency: toCurrencyCode(allocation.purchaseCurrency, "PLN"),
    purchasePriceCurrency:
      typeof allocation.purchasePriceCurrency === "string" && allocation.purchasePriceCurrency
        ? toCurrencyCode(allocation.purchasePriceCurrency)
        : undefined,
    purchaseFxRateToPln:
      hasFiniteNumber(allocation.purchaseFxRateToPln) && allocation.purchaseFxRateToPln > 0
        ? round(allocation.purchaseFxRateToPln, 8)
        : undefined,
    allocatedBuyFeePln: hasFiniteNumber(allocation.allocatedBuyFeePln)
      ? round(allocation.allocatedBuyFeePln, 6)
      : 0,
    investedPln: hasFiniteNumber(allocation.investedPln)
      ? round(allocation.investedPln)
      : 0,
    name: typeof allocation.name === "string" && allocation.name ? allocation.name : undefined,
    symbol:
      typeof allocation.symbol === "string" && allocation.symbol
        ? normalizePortfolioSymbol(allocation.symbol, kind)
        : undefined,
    kind,
    marketCurrency:
      typeof allocation.marketCurrency === "string" && allocation.marketCurrency
        ? toCurrencyCode(allocation.marketCurrency)
        : undefined,
    provider:
      kind && allocation.provider
        ? getSafeQuoteProvider(allocation.provider, kind)
        : undefined,
    providerId:
      typeof allocation.providerId === "string" && allocation.providerId
        ? normalizePortfolioProviderId(allocation.providerId, kind)
        : undefined,
    priceScale:
      hasFiniteNumber(allocation.priceScale) && allocation.priceScale > 0
        ? allocation.priceScale
        : undefined,
    latestPrice:
      hasFiniteNumber(allocation.latestPrice) && allocation.latestPrice > 0
        ? round(allocation.latestPrice, 8)
        : undefined,
    previousClose:
      hasFiniteNumber(allocation.previousClose) && allocation.previousClose > 0
        ? round(allocation.previousClose, 8)
        : undefined,
    lastUpdatedAt:
      typeof allocation.lastUpdatedAt === "string" && allocation.lastUpdatedAt
        ? allocation.lastUpdatedAt
        : undefined,
    groupOrder:
      hasFiniteNumber(allocation.groupOrder) ? allocation.groupOrder : undefined,
    bondMeta: normalizeTreasuryBondSeries(allocation.bondMeta),
    createdAt:
      typeof allocation.createdAt === "string" && allocation.createdAt
        ? allocation.createdAt
        : undefined,
  };
};

const normalizePortfolioSale = (
  sale: Partial<PortfolioSale>
): PortfolioSale | null => {
  if (
    typeof sale.id !== "string" ||
    !sale.id ||
    typeof sale.symbol !== "string" ||
    !sale.symbol ||
    !isSupportedAssetKind(sale.kind) ||
    !hasFiniteNumber(sale.quantity) ||
    sale.quantity <= 0 ||
    !hasFiniteNumber(sale.salePrice) ||
    sale.salePrice <= 0
  ) {
    return null;
  }

  const kind = sale.kind;
  const symbol = normalizePortfolioSymbol(sale.symbol, kind);
  const provider = getSafeQuoteProvider(sale.provider, kind);
  const assetKey = getPortfolioAssetGroupKey({ kind, symbol });

  return {
    id: sale.id,
    assetKey,
    name: typeof sale.name === "string" && sale.name ? sale.name : symbol,
    symbol,
    kind,
    transactionKind: isBondTransactionKind(sale.transactionKind)
      ? sale.transactionKind
      : "sale",
    quantity: round(sale.quantity, 6),
    salePrice: round(sale.salePrice, 6),
    saleDate: toDateInputValue(sale.saleDate, getTodayDateInputValue()),
    settlementDate:
      typeof sale.settlementDate === "string" && sale.settlementDate
        ? toDateInputValue(sale.settlementDate, sale.saleDate ?? getTodayDateInputValue())
        : undefined,
    feePln: hasFiniteNumber(sale.feePln) ? round(sale.feePln, 6) : 0,
    marketCurrency: toCurrencyCode(
      sale.marketCurrency,
      kind === "stock" || kind === "bond" ? "PLN" : "USD"
    ),
    provider,
    providerId:
      normalizePortfolioProviderId(sale.providerId, kind) ??
      getFallbackProviderId(kind, provider, symbol),
    priceScale:
      hasFiniteNumber(sale.priceScale) && sale.priceScale > 0
        ? sale.priceScale
        : undefined,
    bondMeta: normalizeTreasuryBondSeries(sale.bondMeta),
    realizedInvestedPln: hasFiniteNumber(sale.realizedInvestedPln)
      ? round(sale.realizedInvestedPln)
      : 0,
    realizedProceedsPln: hasFiniteNumber(sale.realizedProceedsPln)
      ? round(sale.realizedProceedsPln)
      : 0,
    realizedProfitLossPln: hasFiniteNumber(sale.realizedProfitLossPln)
      ? round(sale.realizedProfitLossPln)
      : 0,
    realizedInvestedValue: hasFiniteNumber(sale.realizedInvestedValue)
      ? round(sale.realizedInvestedValue, 6)
      : undefined,
    realizedProceedsValue: hasFiniteNumber(sale.realizedProceedsValue)
      ? round(sale.realizedProceedsValue, 6)
      : undefined,
    realizedProfitLossValue: hasFiniteNumber(sale.realizedProfitLossValue)
      ? round(sale.realizedProfitLossValue, 6)
      : undefined,
    realizedValueCurrency:
      typeof sale.realizedValueCurrency === "string" && sale.realizedValueCurrency
        ? toCurrencyCode(sale.realizedValueCurrency)
        : undefined,
    grossProceedsPln: hasFiniteNumber(sale.grossProceedsPln)
      ? round(sale.grossProceedsPln)
      : undefined,
    grossProfitLossPln: hasFiniteNumber(sale.grossProfitLossPln)
      ? round(sale.grossProfitLossPln)
      : undefined,
    grossProceedsValue: hasFiniteNumber(sale.grossProceedsValue)
      ? round(sale.grossProceedsValue, 6)
      : undefined,
    grossProfitLossValue: hasFiniteNumber(sale.grossProfitLossValue)
      ? round(sale.grossProfitLossValue, 6)
      : undefined,
    taxTotalPln: hasFiniteNumber(sale.taxTotalPln) ? round(sale.taxTotalPln) : undefined,
    redemptionFeeTotalPln: hasFiniteNumber(sale.redemptionFeeTotalPln)
      ? round(sale.redemptionFeeTotalPln)
      : undefined,
    swapTargetCode:
      typeof sale.swapTargetCode === "string" && sale.swapTargetCode
        ? normalizeTreasuryBondCode(sale.swapTargetCode)
        : undefined,
    swapTargetQuantity: hasFiniteNumber(sale.swapTargetQuantity)
      ? round(sale.swapTargetQuantity, 6)
      : undefined,
    swapPricePerUnit: hasFiniteNumber(sale.swapPricePerUnit)
      ? round(sale.swapPricePerUnit, 6)
      : undefined,
    swapResidualCashPln: hasFiniteNumber(sale.swapResidualCashPln)
      ? round(sale.swapResidualCashPln)
      : undefined,
    swapTargetAssetId:
      typeof sale.swapTargetAssetId === "string" && sale.swapTargetAssetId
        ? sale.swapTargetAssetId
        : undefined,
    allocations: Array.isArray(sale.allocations)
      ? sale.allocations
          .map((allocation) => normalizePortfolioSaleAllocation(allocation, kind))
          .filter((allocation): allocation is PortfolioSaleAllocation => Boolean(allocation))
      : [],
    createdAt:
      typeof sale.createdAt === "string" && sale.createdAt
        ? sale.createdAt
        : new Date().toISOString(),
  };
};

const normalizePortfolioAsset = (
  asset: Partial<PortfolioAsset>
): PortfolioAsset | null => {
  if (
    typeof asset.id !== "string" ||
    !asset.id ||
    typeof asset.symbol !== "string" ||
    !asset.symbol ||
    !isSupportedAssetKind(asset.kind) ||
    !hasFiniteNumber(asset.quantity) ||
    asset.quantity <= 0 ||
    !hasFiniteNumber(asset.purchasePrice) ||
    asset.purchasePrice <= 0
  ) {
    return null;
  }

  const kind = asset.kind;
  const symbol = normalizePortfolioSymbol(asset.symbol, kind);
  const provider = getSafeQuoteProvider(asset.provider, kind);

  return {
    id: asset.id,
    name:
      typeof asset.name === "string" && asset.name ? asset.name : symbol,
    symbol,
    kind,
    purchaseDate: toDateInputValue(asset.purchaseDate, getTodayDateInputValue()),
    quantity: round(asset.quantity, 6),
    purchasePrice: round(asset.purchasePrice, 6),
    purchaseCurrency: toCurrencyCode(
      asset.purchaseCurrency,
      kind === "stock" || kind === "bond" ? "PLN" : "USD"
    ),
    purchasePriceCurrency:
      typeof asset.purchasePriceCurrency === "string" && asset.purchasePriceCurrency
        ? toCurrencyCode(asset.purchasePriceCurrency)
        : undefined,
    purchaseFxRateToPln:
      hasFiniteNumber(asset.purchaseFxRateToPln) && asset.purchaseFxRateToPln > 0
        ? round(asset.purchaseFxRateToPln, 8)
        : undefined,
    feePln: hasFiniteNumber(asset.feePln) ? round(asset.feePln, 6) : 0,
    marketCurrency: toCurrencyCode(
      asset.marketCurrency,
      kind === "stock" || kind === "bond" ? "PLN" : "USD"
    ),
    provider,
    providerId:
      normalizePortfolioProviderId(asset.providerId, kind) ??
      getFallbackProviderId(kind, provider, symbol),
    priceScale:
      hasFiniteNumber(asset.priceScale) && asset.priceScale > 0
        ? asset.priceScale
        : undefined,
    latestPrice:
      hasFiniteNumber(asset.latestPrice) && asset.latestPrice > 0
        ? round(asset.latestPrice, 8)
        : undefined,
    previousClose:
      hasFiniteNumber(asset.previousClose) && asset.previousClose > 0
        ? round(asset.previousClose, 8)
        : undefined,
    lastUpdatedAt:
      typeof asset.lastUpdatedAt === "string" ? asset.lastUpdatedAt : undefined,
    groupOrder:
      hasFiniteNumber(asset.groupOrder) ? asset.groupOrder : undefined,
    bondMeta: normalizeTreasuryBondSeries(asset.bondMeta),
    createdAt:
      typeof asset.createdAt === "string" && asset.createdAt
        ? asset.createdAt
        : new Date().toISOString(),
  };
};

const normalizePortfolioRealizedAdjustment = (
  adjustment: Partial<PortfolioRealizedAdjustment>
): PortfolioRealizedAdjustment | null => {
  if (
    typeof adjustment.id !== "string" ||
    !adjustment.id ||
    !hasFiniteNumber(adjustment.amount) ||
    adjustment.amount === 0 ||
    !hasFiniteNumber(adjustment.amountPlnSnapshot) ||
    adjustment.amountPlnSnapshot === 0
  ) {
    return null;
  }

  return {
    id: adjustment.id,
    amount: round(adjustment.amount, 6),
    currency: toCurrencyCode(adjustment.currency, "PLN"),
    amountPlnSnapshot: round(adjustment.amountPlnSnapshot),
    date: toDateInputValue(adjustment.date, getTodayDateInputValue()),
    source: adjustment.source === "bond-coupon" ? "bond-coupon" : "manual",
    bondCode:
      typeof adjustment.bondCode === "string" && adjustment.bondCode
        ? normalizeTreasuryBondCode(adjustment.bondCode)
        : undefined,
    note:
      typeof adjustment.note === "string" && adjustment.note.trim()
        ? adjustment.note.trim()
        : undefined,
    createdAt:
      typeof adjustment.createdAt === "string" && adjustment.createdAt
        ? adjustment.createdAt
        : new Date().toISOString(),
  };
};

const isPortfolioBookLike = (value: unknown): value is { portfolios?: unknown[] } => {
  if (value === null || typeof value !== "object") {
    return false;
  }

  return (
    "portfolios" in value &&
    Array.isArray((value as { portfolios?: unknown[] }).portfolios)
  );
};

export const normalizePortfolioState = (value: unknown): PortfolioState => {
  if (isPortfolioBookLike(value)) {
    const book = normalizePortfolioBook(value);

    return normalizePortfolioState({
      assets: book.portfolios.flatMap((portfolio) => portfolio.assets),
      sales: book.portfolios.flatMap((portfolio) => portfolio.sales),
      realizedAdjustments: book.portfolios.flatMap(
        (portfolio) => portfolio.realizedAdjustments
      ),
    });
  }

  const rawState: {
    assets?: unknown[];
    sales?: unknown[];
    realizedAdjustments?: unknown[];
  } =
    Array.isArray(value) || !value || typeof value !== "object"
      ? { assets: Array.isArray(value) ? value : [], sales: [], realizedAdjustments: [] }
      : (value as {
          assets?: unknown[];
          sales?: unknown[];
          realizedAdjustments?: unknown[];
        });

  const assets = Array.isArray(rawState.assets)
    ? rawState.assets
        .map((asset) => normalizePortfolioAsset(asset as Partial<PortfolioAsset>))
        .filter((asset): asset is PortfolioAsset => Boolean(asset))
    : [];
  const sales = Array.isArray(rawState.sales)
    ? rawState.sales
        .map((sale) => normalizePortfolioSale(sale as Partial<PortfolioSale>))
        .filter((sale): sale is PortfolioSale => Boolean(sale))
    : [];
  const realizedAdjustments = Array.isArray(rawState.realizedAdjustments)
    ? rawState.realizedAdjustments
        .map((adjustment) =>
          normalizePortfolioRealizedAdjustment(
            adjustment as Partial<PortfolioRealizedAdjustment>
          )
        )
        .filter(
          (adjustment): adjustment is PortfolioRealizedAdjustment => Boolean(adjustment)
        )
    : [];

  return {
    assets: normalizeStoredPortfolioAssets(assets),
    sales: sales.sort(
      (left, right) =>
        new Date(right.saleDate || right.createdAt).getTime() -
          new Date(left.saleDate || left.createdAt).getTime() ||
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    ),
    realizedAdjustments: realizedAdjustments.sort(
      (left, right) =>
        new Date(right.date || right.createdAt).getTime() -
          new Date(left.date || left.createdAt).getTime() ||
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    ),
  };
};

const normalizePortfolioName = (value: unknown, fallback: string) => {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue.slice(0, 64) : fallback;
};

export const createInvestmentPortfolio = (
  name = "Nowy portfel",
  state: PortfolioState = createEmptyPortfolioState()
): InvestmentPortfolio => {
  const now = new Date().toISOString();
  const normalizedState = normalizePortfolioState(state);

  return ensurePortfolioCoreModel({
    id: createPortfolioId(),
    name: normalizePortfolioName(name, "Nowy portfel"),
    assets: normalizedState.assets,
    sales: normalizedState.sales,
    realizedAdjustments: normalizedState.realizedAdjustments,
    schemaVersion: 2,
    baseCurrency: "PLN",
    subPortfolios: [],
    accounts: [],
    instruments: [],
    operations: [],
    tags: [],
    tagAssignments: [],
    benchmarks: [],
    metadata: {},
    createdAt: now,
    updatedAt: now,
  });
};

const normalizeInvestmentPortfolio = (
  value: unknown,
  index: number
): InvestmentPortfolio | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawPortfolio = value as Partial<InvestmentPortfolio>;
  const normalizedState = normalizePortfolioState(rawPortfolio);
  const now = new Date().toISOString();
  const createdAt =
    typeof rawPortfolio.createdAt === "string" && rawPortfolio.createdAt
      ? rawPortfolio.createdAt
      : now;
  const updatedAt =
    typeof rawPortfolio.updatedAt === "string" && rawPortfolio.updatedAt
      ? rawPortfolio.updatedAt
      : createdAt;

  return ensurePortfolioCoreModel({
    id:
      typeof rawPortfolio.id === "string" && rawPortfolio.id
        ? rawPortfolio.id
        : createPortfolioId(),
    name: normalizePortfolioName(rawPortfolio.name, index === 0 ? "Portfel 1" : `Portfel ${index + 1}`),
    assets: normalizedState.assets,
    sales: normalizedState.sales,
    realizedAdjustments: normalizedState.realizedAdjustments,
    schemaVersion: 2,
    baseCurrency:
      typeof rawPortfolio.baseCurrency === "string" && rawPortfolio.baseCurrency
        ? rawPortfolio.baseCurrency
        : "PLN",
    subPortfolios: rawPortfolio.subPortfolios,
    accounts: rawPortfolio.accounts,
    instruments: rawPortfolio.instruments,
    operations: rawPortfolio.operations,
    tags: rawPortfolio.tags,
    tagAssignments: rawPortfolio.tagAssignments,
    benchmarks: rawPortfolio.benchmarks,
    metadata: rawPortfolio.metadata,
    createdAt,
    updatedAt,
  });
};

export const normalizePortfolioBook = (value: unknown): PortfolioBook => {
  if (isPortfolioBookLike(value)) {
    const rawBook = value as {
      portfolios?: unknown[];
      activePortfolioId?: unknown;
      migratedAt?: unknown;
    };
    const portfolios = (rawBook.portfolios ?? [])
      .map((portfolio, index) => normalizeInvestmentPortfolio(portfolio, index))
      .filter((portfolio): portfolio is InvestmentPortfolio => Boolean(portfolio));
    const fallbackPortfolio = portfolios[0] ?? createInvestmentPortfolio("Portfel 1");
    const activePortfolioId =
      typeof rawBook.activePortfolioId === "string" &&
      portfolios.some((portfolio) => portfolio.id === rawBook.activePortfolioId)
        ? rawBook.activePortfolioId
        : fallbackPortfolio.id;

    return {
      schemaVersion: 2,
      portfolios: portfolios.length > 0 ? portfolios : [fallbackPortfolio],
      activePortfolioId,
      migratedAt:
        typeof rawBook.migratedAt === "string" && rawBook.migratedAt
          ? rawBook.migratedAt
          : new Date().toISOString(),
    };
  }

  const legacyState = normalizePortfolioState(value);
  const defaultPortfolio = createInvestmentPortfolio("Portfel 1", legacyState);

  return {
    schemaVersion: 2,
    portfolios: [defaultPortfolio],
    activePortfolioId: defaultPortfolio.id,
    migratedAt: new Date().toISOString(),
  };
};

export const createSellAssetDraft = (group: PortfolioAssetGroup): SellAssetDraft => ({
  groupKey: group.key,
  name: group.name,
  symbol: group.symbol,
  kind: group.kind,
  purchaseCurrency: group.purchaseCurrency,
  marketCurrency: group.marketCurrency,
  provider: group.lots[0]?.provider ?? getDefaultProviderForKind(group.kind),
  providerId: group.lots[0]?.providerId,
  priceScale: group.lots[0]?.priceScale,
  maxQuantity: group.quantity,
  quantity: group.quantity,
  quantityInput: String(group.quantity),
  salePrice: group.latestUnitPrice ?? 0,
  salePriceInput: group.latestUnitPrice ? String(group.latestUnitPrice) : "",
  saleDate: getTodayDateInputValue(),
  feePln: 0,
});

export const getNextGroupOrder = (assets: PortfolioAsset[]) =>
  assets.reduce((highestOrder, asset) => {
    const currentOrder =
      typeof asset.groupOrder === "number" && Number.isFinite(asset.groupOrder)
        ? asset.groupOrder
        : -1;
    return Math.max(highestOrder, currentOrder);
  }, -1) + 1;

export const getSortedPortfolioSales = (sales: PortfolioSale[]) =>
  [...sales].sort(
    (left, right) =>
      getPortfolioSaleSortTime(right) - getPortfolioSaleSortTime(left) ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );

export const getSortedPortfolioRealizedAdjustments = (
  adjustments: PortfolioRealizedAdjustment[]
) =>
  [...adjustments].sort(
    (left, right) =>
      new Date(right.date || right.createdAt).getTime() -
        new Date(left.date || left.createdAt).getTime() ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );

export const createEmptyRealizedAdjustmentDraft = (): RealizedAdjustmentDraft => ({
  amount: 0,
  amountInput: "",
  currency: "PLN",
  date: getTodayDateInputValue(),
  note: "",
});

export const createPortfolioRealizedAdjustment = ({
  amount,
  currency,
  amountPlnSnapshot,
  date,
  note,
}: {
  amount: number;
  currency: string;
  amountPlnSnapshot: number;
  date: string;
  note?: string;
}): PortfolioRealizedAdjustment => ({
  id: createRealizedAdjustmentId(),
  amount: round(amount, 6),
  currency: toCurrencyCode(currency, "PLN"),
  amountPlnSnapshot: round(amountPlnSnapshot),
  date: toDateInputValue(date, getTodayDateInputValue()),
  source: "manual",
  note: note?.trim() ? note.trim() : undefined,
  createdAt: new Date().toISOString(),
});

export const buildPortfolioBenchmarkInvestments = (
  assets: PortfolioAsset[],
  sales: PortfolioSale[],
  fxRates: FxRates
): BenchmarkInvestment[] =>
  [
    ...assets.map((asset) => ({
      date: asset.purchaseDate || toDateInputValue(asset.createdAt),
      amountPln: getAssetInvestedPln(asset, fxRates),
    })),
    ...sales.flatMap((sale) =>
      sale.allocations.map((allocation) => ({
        date: allocation.purchaseDate,
        amountPln: allocation.investedPln,
      }))
    ),
    ...sales.map((sale) => ({
      date: sale.saleDate || toDateInputValue(sale.createdAt),
      amountPln: -round(sale.realizedInvestedPln),
    })),
  ]
    .filter(
      (investment) =>
        Number.isFinite(investment.amountPln) &&
        investment.amountPln !== 0 &&
        Boolean(investment.date)
    )
    .sort((left, right) => left.date.localeCompare(right.date));

const getBondAnnualRateForYear = (bondMeta: TreasuryBondSeries, yearIndex: number) =>
  bondMeta.rateSchedule?.find((entry) => entry.yearIndex === yearIndex)?.annualRate ??
  (yearIndex === 1 ? bondMeta.firstYearRate : bondMeta.marginRate);

export const buildAutomaticBondCouponAdjustments = (
  assets: PortfolioAsset[],
  sales: PortfolioSale[]
) => {
  const bondCouponSegments = [
    ...assets
      .filter((asset) => asset.kind === "bond" && asset.bondMeta?.couponMode === "paid-out")
      .map((asset) => ({
        segmentId: asset.id,
        quantity: asset.quantity,
        purchaseDate: asset.purchaseDate,
        endDate: undefined as string | undefined,
        bondMeta: asset.bondMeta!,
      })),
    ...sales.flatMap((sale) =>
      sale.allocations
        .filter(
          (allocation) =>
            allocation.kind === "bond" &&
            (allocation.bondMeta ?? sale.bondMeta)?.couponMode === "paid-out"
        )
        .map((allocation) => ({
          segmentId: `${sale.id}:${allocation.lotId}`,
          quantity: allocation.quantity,
          purchaseDate: allocation.purchaseDate,
          endDate: sale.settlementDate ?? sale.saleDate,
          bondMeta: allocation.bondMeta ?? sale.bondMeta!,
        }))
    ),
  ];

  return getSortedPortfolioRealizedAdjustments(
    bondCouponSegments.flatMap((segment) => {
      const couponDates = getTreasuryBondCouponPaymentDates(
        segment.purchaseDate,
        segment.bondMeta
      );

      return couponDates
        .filter((paymentDate) => !segment.endDate || paymentDate <= segment.endDate)
        .map((paymentDate, index) => {
          const grossCoupon = round(
            segment.quantity *
              segment.bondMeta.nominalValue *
              (getBondAnnualRateForYear(segment.bondMeta, index + 1) / 100),
            6
          );
          const netCoupon = round(grossCoupon * 0.81, 6);

          return {
            id: `bond-coupon-${segment.segmentId}-${paymentDate}`,
            amount: netCoupon,
            currency: "PLN",
            amountPlnSnapshot: round(netCoupon),
            date: paymentDate,
            source: "bond-coupon" as const,
            bondCode: segment.bondMeta.code,
            note: `Kupon COI ${segment.bondMeta.code}`,
            createdAt: new Date(`${paymentDate}T00:00:00.000Z`).toISOString(),
          } satisfies PortfolioRealizedAdjustment;
        });
    })
  );
};

export const applySaleToPortfolio = ({
  assets,
  group,
  draft,
  fxRates,
}: {
  assets: PortfolioAsset[];
  group: PortfolioAssetGroup;
  draft: SellAssetDraft;
  fxRates: FxRates;
}) => {
  const saleQuantity = round(draft.quantity, 6);
  const salePrice = round(draft.salePrice, 6);
  const saleDate = toDateInputValue(draft.saleDate, getTodayDateInputValue());
  const saleFeePln = hasFiniteNumber(draft.feePln) ? round(draft.feePln, 6) : 0;
  const saleCurrency = toCurrencyCode(draft.marketCurrency, group.marketCurrency);

  if (saleQuantity <= 0) {
    throw new Error("Podaj ilosc do sprzedazy.");
  }

  if (saleQuantity > group.quantity) {
    throw new Error("Nie mozna sprzedac wiecej niz posiadasz.");
  }

  if (salePrice <= 0) {
    throw new Error("Podaj poprawna cene sprzedazy.");
  }

  const sortedLots = [...group.lots].sort((left, right) => {
    const leftTime = getAssetSortTime(left);
    const rightTime = getAssetSortTime(right);

    return leftTime - rightTime || left.createdAt.localeCompare(right.createdAt);
  });
  const nextAssetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const allocations: PortfolioSaleAllocation[] = [];
  let remainingQuantity = saleQuantity;

  for (const lot of sortedLots) {
    if (remainingQuantity <= 0) {
      break;
    }

    if (saleDate < lot.purchaseDate) {
      throw new Error("Data sprzedazy nie moze byc wczesniejsza niz data zakupu.");
    }

    const availableQuantity = round(lot.quantity, 6);
    const allocatedQuantity = round(Math.min(remainingQuantity, availableQuantity), 6);
    const allocatedBuyFeePln = round(lot.feePln * (allocatedQuantity / availableQuantity), 6);
    const investedPln = round(
      getAssetPurchaseValuePln(
        {
          ...lot,
          quantity: allocatedQuantity,
        },
        fxRates
      ) + allocatedBuyFeePln
    );
    const nextQuantity = round(availableQuantity - allocatedQuantity, 6);
    const nextFeePln = round(lot.feePln - allocatedBuyFeePln, 6);

    allocations.push({
      lotId: lot.id,
      quantity: allocatedQuantity,
      purchaseDate: lot.purchaseDate,
      purchasePrice: lot.purchasePrice,
      purchaseCurrency: lot.purchaseCurrency,
      purchasePriceCurrency: lot.purchasePriceCurrency,
      purchaseFxRateToPln: lot.purchaseFxRateToPln,
      allocatedBuyFeePln,
      investedPln,
      name: lot.name,
      symbol: lot.symbol,
      kind: lot.kind,
      marketCurrency: lot.marketCurrency,
      provider: lot.provider,
      providerId: lot.providerId,
      priceScale: lot.priceScale,
      latestPrice: lot.latestPrice,
      previousClose: lot.previousClose,
      lastUpdatedAt: lot.lastUpdatedAt,
      groupOrder: lot.groupOrder,
      bondMeta: lot.bondMeta,
      createdAt: lot.createdAt,
    });

    if (nextQuantity <= 0) {
      nextAssetsById.delete(lot.id);
    } else {
      nextAssetsById.set(lot.id, {
        ...lot,
        quantity: nextQuantity,
        feePln: Math.max(0, nextFeePln),
      });
    }

    remainingQuantity = round(remainingQuantity - allocatedQuantity, 6);
  }

  if (remainingQuantity > 0) {
    throw new Error("Brakuje wystarczajacej ilosci do sprzedazy.");
  }

  const realizedInvestedPln = round(
    allocations.reduce((total, allocation) => total + allocation.investedPln, 0)
  );
  const realizedProceedsPln = round(
    convertToPln(saleQuantity * salePrice, saleCurrency, fxRates) - saleFeePln
  );

  if (realizedProceedsPln < 0) {
    throw new Error("Prowizja nie moze byc wyzsza niz wartosc sprzedazy.");
  }

  const nativeResultCurrency = toCurrencyCode(
    draft.purchaseCurrency,
    allocations[0]?.purchaseCurrency ?? saleCurrency
  );
  let realizedInvestedValue: number | undefined;
  let realizedProceedsValue: number | undefined;
  let realizedProfitLossValue: number | undefined;
  let realizedValueCurrency: string | undefined;

  if (nativeResultCurrency) {
    const convertedInvestedValue = convertFromPln(
      realizedInvestedPln,
      nativeResultCurrency,
      fxRates
    );
    const convertedProceedsValue = convertFromPln(
      realizedProceedsPln,
      nativeResultCurrency,
      fxRates
    );

    if (convertedInvestedValue !== null && convertedProceedsValue !== null) {
      realizedInvestedValue = round(convertedInvestedValue, 6);
      realizedProceedsValue = round(convertedProceedsValue, 6);
      realizedProfitLossValue = round(
        convertedProceedsValue - convertedInvestedValue,
        6
      );
      realizedValueCurrency = nativeResultCurrency;
    }
  }

  const sale: PortfolioSale = {
    id: createSaleId(),
    assetKey: group.key,
    name: group.name,
    symbol: group.symbol,
    kind: group.kind,
    transactionKind: "sale",
    quantity: saleQuantity,
    salePrice,
    saleDate,
    feePln: saleFeePln,
    marketCurrency: saleCurrency,
    provider: draft.provider,
    providerId: draft.providerId,
    priceScale: draft.priceScale,
    bondMeta: group.lots[0]?.bondMeta,
    realizedInvestedPln,
    realizedProceedsPln,
    realizedProfitLossPln: round(realizedProceedsPln - realizedInvestedPln),
    realizedInvestedValue,
    realizedProceedsValue,
    realizedProfitLossValue,
    realizedValueCurrency,
    allocations,
    createdAt: new Date().toISOString(),
  };

  return {
    assets: normalizeStoredPortfolioAssets(Array.from(nextAssetsById.values())),
    sale,
  };
};

export const createEmptyPortfolioState = (): PortfolioState => ({
  assets: [],
  sales: [],
  realizedAdjustments: [],
});

const comparePortfolioSalesAscending = (left: PortfolioSale, right: PortfolioSale) =>
  getPortfolioSaleSortTime(left) - getPortfolioSaleSortTime(right) ||
  left.createdAt.localeCompare(right.createdAt) ||
  left.id.localeCompare(right.id);

export const canUndoPortfolioSale = (sales: PortfolioSale[], saleId: string) => {
  const targetSale = sales.find((sale) => sale.id === saleId);

  if (!targetSale) {
    return false;
  }

  const targetLotIds = new Set(targetSale.allocations.map((allocation) => allocation.lotId));

  const usesSourceLotsAgain = sales.some(
    (sale) =>
      sale.id !== saleId &&
      comparePortfolioSalesAscending(sale, targetSale) > 0 &&
      sale.allocations.some((allocation) => targetLotIds.has(allocation.lotId))
  );

  if (usesSourceLotsAgain) {
    return false;
  }

  if (!targetSale.swapTargetAssetId) {
    return true;
  }

  return !sales.some(
    (sale) =>
      sale.id !== saleId &&
      comparePortfolioSalesAscending(sale, targetSale) > 0 &&
      sale.allocations.some((allocation) => allocation.lotId === targetSale.swapTargetAssetId)
  );
};

const createRestoredAssetFromAllocation = ({
  allocation,
  sale,
  fallbackGroupOrder,
}: {
  allocation: PortfolioSaleAllocation;
  sale: PortfolioSale;
  fallbackGroupOrder?: number;
}): PortfolioAsset => ({
  id: allocation.lotId,
  name: allocation.name ?? sale.name,
  symbol: allocation.symbol ?? sale.symbol,
  kind: allocation.kind ?? sale.kind,
  purchaseDate: allocation.purchaseDate,
  quantity: round(allocation.quantity, 6),
  purchasePrice: round(allocation.purchasePrice, 6),
  purchaseCurrency: allocation.purchaseCurrency,
  purchasePriceCurrency: allocation.purchasePriceCurrency,
  purchaseFxRateToPln: allocation.purchaseFxRateToPln,
  feePln: round(allocation.allocatedBuyFeePln, 6),
  marketCurrency: toCurrencyCode(allocation.marketCurrency, sale.marketCurrency),
  provider:
    allocation.kind && allocation.provider
      ? getSafeQuoteProvider(allocation.provider, allocation.kind)
      : sale.provider,
  providerId: allocation.providerId ?? sale.providerId,
  priceScale: allocation.priceScale ?? sale.priceScale,
  latestPrice: allocation.latestPrice,
  previousClose: allocation.previousClose,
  lastUpdatedAt: allocation.lastUpdatedAt,
  groupOrder: allocation.groupOrder ?? fallbackGroupOrder,
  bondMeta: allocation.bondMeta ?? sale.bondMeta,
  createdAt:
    allocation.createdAt ??
    new Date(`${allocation.purchaseDate}T00:00:00.000Z`).toISOString(),
});

export const undoPortfolioSale = ({
  assets,
  sales,
  saleId,
}: {
  assets: PortfolioAsset[];
  sales: PortfolioSale[];
  saleId: string;
}) => {
  const sale = sales.find((item) => item.id === saleId);

  if (!sale) {
    throw new Error("Nie znaleziono wskazanej sprzedazy.");
  }

  if (!canUndoPortfolioSale(sales, saleId)) {
    throw new Error(
      "Nie mozna cofnac tej sprzedazy, bo nowsza sprzedaz rozliczyla juz te same zakupy."
    );
  }

  const existingGroupOrder = assets.find(
    (asset) => getPortfolioAssetGroupKey(asset) === sale.assetKey
  )?.groupOrder;
  const restoredGroupOrder =
    sale.allocations.find(
      (allocation) =>
        typeof allocation.groupOrder === "number" && Number.isFinite(allocation.groupOrder)
    )?.groupOrder ??
    existingGroupOrder ??
    getNextGroupOrder(assets);
  const nextAssetsById = new Map(assets.map((asset) => [asset.id, asset]));

  for (const allocation of sale.allocations) {
    const existingAsset = nextAssetsById.get(allocation.lotId);

    if (existingAsset) {
      nextAssetsById.set(allocation.lotId, {
        ...existingAsset,
        quantity: round(existingAsset.quantity + allocation.quantity, 6),
        feePln: round(existingAsset.feePln + allocation.allocatedBuyFeePln, 6),
      });
      continue;
    }

    nextAssetsById.set(
      allocation.lotId,
      createRestoredAssetFromAllocation({
        allocation,
        sale,
        fallbackGroupOrder: restoredGroupOrder,
      })
    );
  }

  if (sale.transactionKind === "bond-swap" && sale.swapTargetAssetId) {
    nextAssetsById.delete(sale.swapTargetAssetId);
  }

  return {
    assets: normalizeStoredPortfolioAssets(Array.from(nextAssetsById.values())),
    sales: getSortedPortfolioSales(sales.filter((item) => item.id !== saleId)),
  };
};

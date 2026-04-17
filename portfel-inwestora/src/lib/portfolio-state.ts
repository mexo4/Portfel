import { getAssetInvestedPln, type PortfolioAssetGroup, convertToPln } from "@/lib/pricing";
import {
  getDefaultProviderForKind,
  getPortfolioAssetGroupKey,
  normalizeSymbol,
} from "@/lib/ticker";
import { getTodayDateInputValue, round, toCurrencyCode, toDateInputValue } from "@/lib/utils";
import type {
  AssetKind,
  BenchmarkInvestment,
  FxRates,
  PortfolioAsset,
  PortfolioSale,
  PortfolioSaleAllocation,
  PortfolioState,
  QuoteProvider,
  SellAssetDraft,
} from "@/types/portfolio";

const SUPPORTED_ASSET_KINDS = new Set<AssetKind>(["stock", "etf", "crypto"]);
const SUPPORTED_QUOTE_PROVIDERS = new Set<QuoteProvider>([
  "catalog",
  "coingecko",
  "eodhd",
  "finnhub",
  "stooq",
]);

const hasFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const getSafeQuoteProvider = (value: unknown, kind: AssetKind): QuoteProvider =>
  typeof value === "string" && SUPPORTED_QUOTE_PROVIDERS.has(value as QuoteProvider)
    ? (value as QuoteProvider)
    : getDefaultProviderForKind(kind);

const isSupportedAssetKind = (value: unknown): value is AssetKind =>
  typeof value === "string" && SUPPORTED_ASSET_KINDS.has(value as AssetKind);

const getAssetSortTime = (asset: Pick<PortfolioAsset, "purchaseDate" | "createdAt">) =>
  new Date(asset.purchaseDate || asset.createdAt).getTime();

const createSaleId = () =>
  `sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
    .map((asset) => ({
      ...asset,
      symbol: normalizeSymbol(asset.symbol),
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
    }));
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
  allocation: Partial<PortfolioSaleAllocation>
): PortfolioSaleAllocation | null => {
  if (
    typeof allocation.lotId !== "string" ||
    !allocation.lotId ||
    !hasFiniteNumber(allocation.quantity) ||
    allocation.quantity <= 0
  ) {
    return null;
  }

  return {
    lotId: allocation.lotId,
    quantity: round(allocation.quantity, 6),
    purchaseDate: toDateInputValue(allocation.purchaseDate, getTodayDateInputValue()),
    purchasePrice: hasFiniteNumber(allocation.purchasePrice)
      ? round(allocation.purchasePrice, 6)
      : 0,
    purchaseCurrency: toCurrencyCode(allocation.purchaseCurrency, "PLN"),
    allocatedBuyFeePln: hasFiniteNumber(allocation.allocatedBuyFeePln)
      ? round(allocation.allocatedBuyFeePln, 6)
      : 0,
    investedPln: hasFiniteNumber(allocation.investedPln)
      ? round(allocation.investedPln)
      : 0,
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

  const symbol = normalizeSymbol(sale.symbol);
  const kind = sale.kind;
  const assetKey =
    typeof sale.assetKey === "string" && sale.assetKey
      ? sale.assetKey
      : getPortfolioAssetGroupKey({ kind, symbol });

  return {
    id: sale.id,
    assetKey,
    name: typeof sale.name === "string" && sale.name ? sale.name : symbol,
    symbol,
    kind,
    quantity: round(sale.quantity, 6),
    salePrice: round(sale.salePrice, 6),
    saleDate: toDateInputValue(sale.saleDate, getTodayDateInputValue()),
    feePln: hasFiniteNumber(sale.feePln) ? round(sale.feePln, 6) : 0,
    marketCurrency: toCurrencyCode(sale.marketCurrency, "USD"),
    provider: getSafeQuoteProvider(sale.provider, kind),
    providerId: typeof sale.providerId === "string" ? sale.providerId : undefined,
    priceScale:
      hasFiniteNumber(sale.priceScale) && sale.priceScale > 0
        ? sale.priceScale
        : undefined,
    realizedInvestedPln: hasFiniteNumber(sale.realizedInvestedPln)
      ? round(sale.realizedInvestedPln)
      : 0,
    realizedProceedsPln: hasFiniteNumber(sale.realizedProceedsPln)
      ? round(sale.realizedProceedsPln)
      : 0,
    realizedProfitLossPln: hasFiniteNumber(sale.realizedProfitLossPln)
      ? round(sale.realizedProfitLossPln)
      : 0,
    allocations: Array.isArray(sale.allocations)
      ? sale.allocations
          .map((allocation) => normalizePortfolioSaleAllocation(allocation))
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

  return {
    id: asset.id,
    name:
      typeof asset.name === "string" && asset.name ? asset.name : normalizeSymbol(asset.symbol),
    symbol: normalizeSymbol(asset.symbol),
    kind,
    purchaseDate: toDateInputValue(asset.purchaseDate, getTodayDateInputValue()),
    quantity: round(asset.quantity, 6),
    purchasePrice: round(asset.purchasePrice, 6),
    purchaseCurrency: toCurrencyCode(asset.purchaseCurrency, kind === "stock" ? "PLN" : "USD"),
    feePln: hasFiniteNumber(asset.feePln) ? round(asset.feePln, 6) : 0,
    marketCurrency: toCurrencyCode(asset.marketCurrency, kind === "stock" ? "PLN" : "USD"),
    provider: getSafeQuoteProvider(asset.provider, kind),
    providerId: typeof asset.providerId === "string" ? asset.providerId : undefined,
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
    createdAt:
      typeof asset.createdAt === "string" && asset.createdAt
        ? asset.createdAt
        : new Date().toISOString(),
  };
};

export const normalizePortfolioState = (value: unknown): PortfolioState => {
  const rawState: {
    assets?: unknown[];
    sales?: unknown[];
  } =
    Array.isArray(value) || !value || typeof value !== "object"
      ? { assets: Array.isArray(value) ? value : [], sales: [] }
      : (value as { assets?: unknown[]; sales?: unknown[] });

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

  return {
    assets: normalizeStoredPortfolioAssets(assets),
    sales: sales.sort(
      (left, right) =>
        new Date(right.saleDate || right.createdAt).getTime() -
          new Date(left.saleDate || left.createdAt).getTime() ||
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    ),
  };
};

export const createSellAssetDraft = (group: PortfolioAssetGroup): SellAssetDraft => ({
  groupKey: group.key,
  name: group.name,
  symbol: group.symbol,
  kind: group.kind,
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
      new Date(right.saleDate || right.createdAt).getTime() -
        new Date(left.saleDate || left.createdAt).getTime() ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );

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
      amountPln: -round(sale.realizedProceedsPln),
    })),
  ]
    .filter(
      (investment) =>
        Number.isFinite(investment.amountPln) &&
        investment.amountPln !== 0 &&
        Boolean(investment.date)
    )
    .sort((left, right) => left.date.localeCompare(right.date));

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
      convertToPln(
        allocatedQuantity * lot.purchasePrice,
        lot.purchaseCurrency,
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
      allocatedBuyFeePln,
      investedPln,
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
    convertToPln(saleQuantity * salePrice, group.marketCurrency, fxRates) - saleFeePln
  );

  if (realizedProceedsPln < 0) {
    throw new Error("Prowizja nie moze byc wyzsza niz wartosc sprzedazy.");
  }

  const sale: PortfolioSale = {
    id: createSaleId(),
    assetKey: group.key,
    name: group.name,
    symbol: group.symbol,
    kind: group.kind,
    quantity: saleQuantity,
    salePrice,
    saleDate,
    feePln: saleFeePln,
    marketCurrency: draft.marketCurrency,
    provider: draft.provider,
    providerId: draft.providerId,
    priceScale: draft.priceScale,
    realizedInvestedPln,
    realizedProceedsPln,
    realizedProfitLossPln: round(realizedProceedsPln - realizedInvestedPln),
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
});

import { BASE_CURRENCY, FALLBACK_FX_RATES } from "@/lib/constants";
import { calculateCashBalances, ensurePortfolioCoreModel } from "@/lib/operation-engine";
import { getPortfolioAssetGroupKey } from "@/lib/ticker";
import { round } from "@/lib/utils";
import type {
  AccountValuation,
  CashBalance,
  CurrencyCode,
  FxRates,
  InvestmentPortfolio,
  PortfolioAsset,
  PortfolioEngineSnapshot,
  PortfolioPosition,
  PortfolioRealizedAdjustment,
  PortfolioSale,
  PortfolioSummary,
} from "@/types/portfolio";

export type PortfolioAssetGroup = {
  key: string;
  name: string;
  symbol: string;
  kind: PortfolioAsset["kind"];
  quantity: number;
  purchaseCurrency: CurrencyCode;
  averagePurchasePrice: number;
  averagePurchasePriceCurrency: CurrencyCode;
  marketCurrency: CurrencyCode;
  latestUnitPrice?: number;
  previousClose?: number;
  hasLivePrice: boolean;
  hasDailyChange: boolean;
  dailyChangePercent?: number;
  totalInvestedPln: number;
  totalValuePln: number;
  totalProfitLossPln: number;
  baseCurrency: CurrencyCode;
  totalInvested: number;
  totalValue: number;
  totalProfitLoss: number;
  lastUpdatedAt?: string;
  groupOrder: number;
  lotsCount: number;
  lots: PortfolioAsset[];
};

export type PortfolioEngineCache = {
  get: (key: string) => PortfolioEngineSnapshot | undefined;
  set: (key: string, snapshot: PortfolioEngineSnapshot) => void;
  clear: () => void;
};

const getAssetSortTime = (asset: PortfolioAsset) => {
  const sourceDate = asset.purchaseDate || asset.createdAt;
  return new Date(sourceDate).getTime();
};

export const createPortfolioEngineCache = (): PortfolioEngineCache => {
  const cache = new Map<string, PortfolioEngineSnapshot>();

  return {
    get: (key) => cache.get(key),
    set: (key, snapshot) => {
      cache.set(key, snapshot);
    },
    clear: () => {
      cache.clear();
    },
  };
};

const hasPositiveNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const getRateToPln = (currency: CurrencyCode, fxRates: FxRates) => {
  if (currency === BASE_CURRENCY) {
    return 1;
  }

  const fallbackRates: FxRates = FALLBACK_FX_RATES;
  const rate = fxRates[currency] ?? fallbackRates[currency];

  return hasPositiveNumber(rate) ? rate : 0;
};

export const getCurrencyConversionRate = (
  sourceCurrency: CurrencyCode,
  targetCurrency: CurrencyCode,
  fxRates: FxRates
) => {
  if (sourceCurrency === targetCurrency) {
    return 1;
  }

  const sourceRate = getRateToPln(sourceCurrency, fxRates);
  const targetRate = getRateToPln(targetCurrency, fxRates);

  return sourceRate > 0 && targetRate > 0 ? sourceRate / targetRate : 0;
};

export const convertCurrency = (
  amount: number,
  sourceCurrency: CurrencyCode,
  targetCurrency: CurrencyCode,
  fxRates: FxRates,
  precision = 6
) => round(amount * getCurrencyConversionRate(sourceCurrency, targetCurrency, fxRates), precision);

export const convertToPln = (
  amount: number,
  currency: CurrencyCode,
  fxRates: FxRates
) => convertCurrency(amount, currency, BASE_CURRENCY, fxRates);

export const convertFromPln = (
  amount: number,
  currency: CurrencyCode,
  fxRates: FxRates
) => convertCurrency(amount, BASE_CURRENCY, currency, fxRates);

type PurchasePriceSource = {
  purchaseCurrency: CurrencyCode;
  purchasePriceCurrency?: CurrencyCode;
  marketCurrency?: CurrencyCode;
  purchaseFxRateToPln?: number;
};

export const getAssetPurchasePriceCurrency = (asset: PurchasePriceSource) =>
  asset.purchasePriceCurrency ?? asset.purchaseCurrency ?? asset.marketCurrency ?? BASE_CURRENCY;

export const getAssetPurchaseFxRateToPln = (
  asset: PurchasePriceSource,
  fxRates: FxRates
) => {
  if (hasPositiveNumber(asset.purchaseFxRateToPln)) {
    return asset.purchaseFxRateToPln;
  }

  return getRateToPln(getAssetPurchasePriceCurrency(asset), fxRates);
};

export const getAssetPurchaseValuePln = (
  asset: PurchasePriceSource & {
    purchasePrice: number;
    quantity: number;
  },
  fxRates: FxRates
) => round(asset.purchasePrice * asset.quantity * getAssetPurchaseFxRateToPln(asset, fxRates));

export const getAssetPurchaseUnitValuePln = (
  asset: PurchasePriceSource & {
    purchasePrice: number;
  },
  fxRates: FxRates
) => round(asset.purchasePrice * getAssetPurchaseFxRateToPln(asset, fxRates), 6);

export const hasAssetLivePrice = (asset: PortfolioAsset) =>
  typeof asset.latestPrice === "number" && asset.latestPrice > 0;

export const getAssetLatestUnitPrice = (asset: PortfolioAsset) =>
  hasAssetLivePrice(asset) ? asset.latestPrice : undefined;

export const getAssetPreviousClose = (asset: PortfolioAsset) =>
  typeof asset.previousClose === "number" &&
  Number.isFinite(asset.previousClose) &&
  asset.previousClose > 0
    ? asset.previousClose
    : undefined;

export const getAssetDailyChangePercent = (asset: PortfolioAsset) => {
  const latestUnitPrice = getAssetLatestUnitPrice(asset);
  const previousClose = getAssetPreviousClose(asset);

  if (latestUnitPrice === undefined || previousClose === undefined) {
    return undefined;
  }

  return round(((latestUnitPrice - previousClose) / previousClose) * 100, 2);
};

export const getAssetInvestedPln = (asset: PortfolioAsset, fxRates: FxRates) =>
  round(getAssetPurchaseValuePln(asset, fxRates) + asset.feePln);

export const getAssetMarketValuePln = (asset: PortfolioAsset, fxRates: FxRates) =>
  hasAssetLivePrice(asset)
    ? convertToPln((asset.latestPrice ?? 0) * asset.quantity, asset.marketCurrency, fxRates)
    : 0;

export const getAssetProfitLossPln = (asset: PortfolioAsset, fxRates: FxRates) =>
  hasAssetLivePrice(asset)
    ? round(getAssetMarketValuePln(asset, fxRates) - getAssetInvestedPln(asset, fxRates))
    : 0;

export const getAssetInvestedValue = (
  asset: PortfolioAsset,
  fxRates: FxRates,
  baseCurrency: CurrencyCode = BASE_CURRENCY
) => convertFromPln(getAssetInvestedPln(asset, fxRates), baseCurrency, fxRates);

export const getAssetMarketValue = (
  asset: PortfolioAsset,
  fxRates: FxRates,
  baseCurrency: CurrencyCode = BASE_CURRENCY
) => convertFromPln(getAssetMarketValuePln(asset, fxRates), baseCurrency, fxRates);

export const getAssetProfitLoss = (
  asset: PortfolioAsset,
  fxRates: FxRates,
  baseCurrency: CurrencyCode = BASE_CURRENCY
) => convertFromPln(getAssetProfitLossPln(asset, fxRates), baseCurrency, fxRates);

export const getGroupedPortfolioAssets = (
  assets: PortfolioAsset[],
  fxRates: FxRates,
  baseCurrency: CurrencyCode = BASE_CURRENCY
): PortfolioAssetGroup[] => {
  const groups = new Map<string, PortfolioAsset[]>();

  assets.forEach((asset) => {
    const key = getPortfolioAssetGroupKey(asset);
    const currentGroup = groups.get(key) ?? [];
    currentGroup.push(asset);
    groups.set(key, currentGroup);
  });

  return Array.from(groups.entries()).map(([key, lots]) => {
    const sortedLots = [...lots].sort(
      (left, right) => getAssetSortTime(right) - getAssetSortTime(left)
    );
    const representativeLot = sortedLots.find((lot) => hasAssetLivePrice(lot)) ?? sortedLots[0];
    const hasLivePrice = sortedLots.some(hasAssetLivePrice);
    const quantity = round(
      sortedLots.reduce((total, lot) => total + lot.quantity, 0),
      6
    );
    const weightedLatestUnitPrice = hasLivePrice
      ? round(
          sortedLots.reduce((total, lot) => {
            const latestUnitPrice = getAssetLatestUnitPrice(lot);
            return total + (latestUnitPrice ?? 0) * lot.quantity;
          }, 0) / Math.max(quantity, 1),
          8
        )
      : undefined;
    const previousCloseLots = sortedLots.filter(
      (lot) => getAssetPreviousClose(lot) !== undefined
    );
    const previousClose =
      previousCloseLots.length > 0
        ? round(
            previousCloseLots.reduce((total, lot) => {
              const lotPreviousClose = getAssetPreviousClose(lot) ?? 0;
              return total + lotPreviousClose * lot.quantity;
            }, 0) /
              Math.max(
                previousCloseLots.reduce((total, lot) => total + lot.quantity, 0),
                1
              ),
            8
          )
        : undefined;
    const dailyChangePercent =
      weightedLatestUnitPrice !== undefined && previousClose !== undefined && previousClose > 0
        ? round(((weightedLatestUnitPrice - previousClose) / previousClose) * 100, 2)
        : undefined;
    const purchaseCurrencies = new Set(sortedLots.map(getAssetPurchasePriceCurrency));
    const averagePurchasePriceCurrency =
      purchaseCurrencies.size === 1
        ? getAssetPurchasePriceCurrency(sortedLots[0])
        : BASE_CURRENCY;
    const purchaseValue = sortedLots.reduce(
      (total, lot) => total + lot.purchasePrice * lot.quantity,
      0
    );
    const purchaseValuePln = sortedLots.reduce(
      (total, lot) => total + getAssetPurchaseValuePln(lot, fxRates),
      0
    );
    const totalInvestedPln = round(
      sortedLots.reduce((total, lot) => total + getAssetInvestedPln(lot, fxRates), 0)
    );
    const totalValuePln = round(
      sortedLots.reduce((total, lot) => total + getAssetMarketValuePln(lot, fxRates), 0)
    );
    const groupOrderCandidates = sortedLots
      .map((lot) => lot.groupOrder)
      .filter((value): value is number => Number.isFinite(value))
      .sort((left, right) => left - right);
    const lastUpdatedAt = sortedLots
      .map((lot) => lot.lastUpdatedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];

    const totalProfitLossPln = round(
      sortedLots.reduce((total, lot) => total + getAssetProfitLossPln(lot, fxRates), 0)
    );

    return {
      key,
      name: representativeLot.name,
      symbol: representativeLot.symbol,
      kind: representativeLot.kind,
      quantity,
      purchaseCurrency: representativeLot.purchaseCurrency,
      averagePurchasePrice: round(
        quantity === 0
          ? 0
          : averagePurchasePriceCurrency === BASE_CURRENCY
            ? purchaseValuePln / quantity
            : purchaseValue / quantity
      ),
      averagePurchasePriceCurrency,
      marketCurrency: representativeLot.marketCurrency,
      latestUnitPrice: weightedLatestUnitPrice,
      previousClose,
      hasLivePrice,
      hasDailyChange: dailyChangePercent !== undefined,
      dailyChangePercent,
      totalInvestedPln,
      totalValuePln,
      totalProfitLossPln,
      baseCurrency,
      totalInvested: convertFromPln(totalInvestedPln, baseCurrency, fxRates),
      totalValue: convertFromPln(totalValuePln, baseCurrency, fxRates),
      totalProfitLoss: convertFromPln(totalProfitLossPln, baseCurrency, fxRates),
      lastUpdatedAt,
      groupOrder: groupOrderCandidates[0] ?? Number.MAX_SAFE_INTEGER,
      lotsCount: sortedLots.length,
      lots: sortedLots,
    } satisfies PortfolioAssetGroup;
  });
};

export const getPortfolioSummary = (
  assets: PortfolioAsset[],
  sales: PortfolioSale[],
  realizedAdjustments: PortfolioRealizedAdjustment[],
  fxRates: FxRates,
  baseCurrency: CurrencyCode = BASE_CURRENCY,
  cashBalances: CashBalance[] = []
): PortfolioSummary => {
  const openTotals = assets.reduce(
    (acc, asset) => {
      acc.totalValuePln += getAssetMarketValuePln(asset, fxRates);
      acc.totalInvestedPln += getAssetInvestedPln(asset, fxRates);
      acc.totalProfitLossPln += getAssetProfitLossPln(asset, fxRates);
      return acc;
    },
    {
      totalValuePln: 0,
      totalInvestedPln: 0,
      totalProfitLossPln: 0,
    }
  );
  const realizedProfitLossByCurrency = sales.reduce<Record<CurrencyCode, number>>(
    (totals, sale) => {
      const isBondSettlement =
        sale.transactionKind === "bond-redemption" || sale.transactionKind === "bond-swap";
      const currency = sale.realizedValueCurrency ?? BASE_CURRENCY;
      const value = isBondSettlement
        ? sale.grossProfitLossValue ??
          sale.grossProfitLossPln ??
          sale.realizedProfitLossValue ??
          sale.realizedProfitLossPln
        : sale.realizedProfitLossValue ?? sale.realizedProfitLossPln;

      totals[currency] = round((totals[currency] ?? 0) + value, currency === BASE_CURRENCY ? 2 : 6);
      return totals;
    },
    {}
  );
  const realizedProfitLossByCurrencyWithAdjustments = realizedAdjustments.reduce<
    Record<CurrencyCode, number>
  >((totals, adjustment) => {
    totals[adjustment.currency] = round(
      (totals[adjustment.currency] ?? 0) + adjustment.amount,
      adjustment.currency === BASE_CURRENCY ? 2 : 6
    );
    return totals;
  }, realizedProfitLossByCurrency);
  const realizedProfitLossBasePln = round(
    sales.reduce((total, sale) => {
      const isBondSettlement =
        sale.transactionKind === "bond-redemption" || sale.transactionKind === "bond-swap";
      return (
        total +
        (isBondSettlement
          ? sale.grossProfitLossPln ?? sale.realizedProfitLossPln
          : sale.realizedProfitLossPln)
      );
    }, 0) +
      realizedAdjustments.reduce((total, adjustment) => total + adjustment.amountPlnSnapshot, 0)
  );
  const realizedProfitLossPln = realizedProfitLossBasePln;
  const openProfitLossPln = round(openTotals.totalProfitLossPln);
  const combinedProfitLossPln = round(openProfitLossPln + realizedProfitLossBasePln);
  const marketValuePln = round(openTotals.totalValuePln);
  const cashValuePln = getCashValuePln(cashBalances, fxRates);
  const totalInvestedPln = round(openTotals.totalInvestedPln);
  const portfolioValuePln = round(marketValuePln + cashValuePln);

  return {
    currency: baseCurrency,
    totalValue: convertFromPln(portfolioValuePln, baseCurrency, fxRates),
    marketValue: convertFromPln(marketValuePln, baseCurrency, fxRates),
    cashValue: convertFromPln(cashValuePln, baseCurrency, fxRates),
    totalInvested: convertFromPln(totalInvestedPln, baseCurrency, fxRates),
    totalProfitLoss: convertFromPln(openProfitLossPln, baseCurrency, fxRates),
    openProfitLoss: convertFromPln(openProfitLossPln, baseCurrency, fxRates),
    realizedProfitLoss: convertFromPln(realizedProfitLossPln, baseCurrency, fxRates),
    combinedProfitLoss: convertFromPln(combinedProfitLossPln, baseCurrency, fxRates),
    totalValuePln: portfolioValuePln,
    marketValuePln,
    cashValuePln,
    totalInvestedPln,
    totalProfitLossPln: openProfitLossPln,
    openProfitLossPln,
    realizedProfitLossPln,
    realizedProfitLossByCurrency: realizedProfitLossByCurrencyWithAdjustments,
    combinedProfitLossPln,
    positionsCount: assets.length,
    assetsCount: new Set(assets.map((asset) => getPortfolioAssetGroupKey(asset))).size,
    salesCount: sales.length,
  };
};

const getCashValuePln = (balances: CashBalance[], fxRates: FxRates) =>
  round(
    balances.reduce(
      (total, balance) => total + convertToPln(balance.amount, balance.currency, fxRates),
      0
    )
  );

const buildAccountValuations = (
  portfolio: InvestmentPortfolio,
  cashBalances: CashBalance[],
  fxRates: FxRates
): AccountValuation[] => {
  const accounts = portfolio.accounts ?? [];
  const defaultInvestmentAccount = accounts.find((account) => account.kind === "investment");
  const groupedBalances = new Map<string, CashBalance[]>();

  cashBalances.forEach((balance) => {
    const currentBalances = groupedBalances.get(balance.accountId) ?? [];
    currentBalances.push(balance);
    groupedBalances.set(balance.accountId, currentBalances);
  });

  return accounts.map((account) => {
    const accountBalances = groupedBalances.get(account.id) ?? [];
    const isDefaultInvestmentAccount = account.id === defaultInvestmentAccount?.id;
    const accountAssets = isDefaultInvestmentAccount ? portfolio.assets : [];
    const accountSales = isDefaultInvestmentAccount ? portfolio.sales : [];
    const accountAdjustments = isDefaultInvestmentAccount ? portfolio.realizedAdjustments : [];
    const summary = getPortfolioSummary(accountAssets, accountSales, accountAdjustments, fxRates);
    const cashValuePln = getCashValuePln(accountBalances, fxRates);

    return {
      accountId: account.id,
      accountName: account.name,
      kind: account.kind,
      currency: account.currency,
      cashBalances: accountBalances,
      marketValuePln: summary.marketValuePln,
      investedPln: summary.totalInvestedPln,
      realizedProfitLossPln: summary.realizedProfitLossPln,
      unrealizedProfitLossPln: summary.openProfitLossPln,
      totalValuePln: round(summary.totalValuePln + cashValuePln),
    } satisfies AccountValuation;
  });
};

const buildPositions = (
  portfolio: InvestmentPortfolio,
  groups: PortfolioAssetGroup[]
): PortfolioPosition[] => {
  const realizedByKey = portfolio.sales.reduce<Record<string, number>>((totals, sale) => {
    totals[sale.assetKey] = round((totals[sale.assetKey] ?? 0) + sale.realizedProfitLossPln);
    return totals;
  }, {});

  return groups.map((group) => {
    const instrument = portfolio.instruments?.find(
      (item) => item.id === `${portfolio.id}:instrument:${group.key}`
    );
    const realizedProfitLossPln = realizedByKey[group.key] ?? 0;
    const returnPercent =
      group.totalInvestedPln > 0
        ? round((group.totalProfitLossPln / group.totalInvestedPln) * 100, 2)
        : 0;

    return {
      instrumentId: instrument?.id ?? `${portfolio.id}:instrument:${group.key}`,
      key: group.key,
      symbol: group.symbol,
      name: group.name,
      type: instrument?.type ?? "OTHER",
      quantity: group.quantity,
      averagePrice: group.averagePurchasePrice,
      averagePriceCurrency: group.averagePurchasePriceCurrency,
      costBasisPln: group.totalInvestedPln,
      marketValuePln: group.totalValuePln,
      realizedProfitLossPln,
      unrealizedProfitLossPln: group.totalProfitLossPln,
      returnPercent,
    } satisfies PortfolioPosition;
  });
};

const getPortfolioEngineCacheKey = (
  portfolio: InvestmentPortfolio,
  fxRates: FxRates
) =>
  [
    portfolio.id,
    portfolio.updatedAt,
    portfolio.assets.length,
    portfolio.sales.length,
    portfolio.realizedAdjustments.length,
    portfolio.operations?.length ?? 0,
    Object.entries(fxRates)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, rate]) => `${currency}:${rate}`)
      .join(","),
  ].join("|");

export const calculatePortfolioSnapshot = ({
  portfolio,
  fxRates,
  cache,
}: {
  portfolio: InvestmentPortfolio;
  fxRates: FxRates;
  cache?: PortfolioEngineCache;
}): PortfolioEngineSnapshot => {
  const corePortfolio = ensurePortfolioCoreModel(portfolio);
  const cacheKey = getPortfolioEngineCacheKey(corePortfolio, fxRates);
  const cachedSnapshot = cache?.get(cacheKey);

  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  const baseCurrency = corePortfolio.baseCurrency ?? BASE_CURRENCY;
  const groups = getGroupedPortfolioAssets(corePortfolio.assets, fxRates, baseCurrency);
  const cashBalances = calculateCashBalances(
    corePortfolio.operations ?? [],
    corePortfolio.accounts ?? []
  );
  const summary = getPortfolioSummary(
    corePortfolio.assets,
    corePortfolio.sales,
    corePortfolio.realizedAdjustments,
    fxRates,
    baseCurrency
  );
  const snapshot = {
    portfolioId: corePortfolio.id,
    generatedAt: new Date().toISOString(),
    summary,
    accounts: buildAccountValuations(corePortfolio, cashBalances, fxRates),
    positions: buildPositions(corePortfolio, groups),
    cashBalances,
    operationsCount: corePortfolio.operations?.length ?? 0,
    cacheKey,
  } satisfies PortfolioEngineSnapshot;

  cache?.set(cacheKey, snapshot);
  return snapshot;
};

export const getBaseCurrency = () => BASE_CURRENCY;

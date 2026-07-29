import { BASE_CURRENCY } from "@/lib/constants";
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

export const convertToPln = (
  amount: number,
  currency: CurrencyCode,
  fxRates: FxRates
) => round(amount * (fxRates[currency] ?? 1));

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
  round(
    convertToPln(asset.purchasePrice * asset.quantity, asset.purchaseCurrency, fxRates) +
      asset.feePln
  );

export const getAssetMarketValuePln = (asset: PortfolioAsset, fxRates: FxRates) =>
  hasAssetLivePrice(asset)
    ? convertToPln((asset.latestPrice ?? 0) * asset.quantity, asset.marketCurrency, fxRates)
    : 0;

export const getAssetProfitLossPln = (asset: PortfolioAsset, fxRates: FxRates) =>
  hasAssetLivePrice(asset)
    ? round(getAssetMarketValuePln(asset, fxRates) - getAssetInvestedPln(asset, fxRates))
    : 0;

export const getGroupedPortfolioAssets = (
  assets: PortfolioAsset[],
  fxRates: FxRates
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
    const purchaseCurrencies = new Set(sortedLots.map((lot) => lot.purchaseCurrency));
    const averagePurchasePriceCurrency =
      purchaseCurrencies.size === 1 ? sortedLots[0].purchaseCurrency : BASE_CURRENCY;
    const purchaseValue = sortedLots.reduce(
      (total, lot) => total + lot.purchasePrice * lot.quantity,
      0
    );
    const purchaseValuePln = sortedLots.reduce(
      (total, lot) =>
        total + convertToPln(lot.purchasePrice * lot.quantity, lot.purchaseCurrency, fxRates),
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
      totalProfitLossPln: round(
        sortedLots.reduce((total, lot) => total + getAssetProfitLossPln(lot, fxRates), 0)
      ),
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
  fxRates: FxRates
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
  const realizedProfitLossPln = round(realizedProfitLossByCurrencyWithAdjustments.PLN ?? 0);
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
  const openProfitLossPln = round(openTotals.totalProfitLossPln);
  const combinedProfitLossPln = round(openProfitLossPln + realizedProfitLossBasePln);

  return {
    totalValuePln: round(openTotals.totalValuePln),
    totalInvestedPln: round(openTotals.totalInvestedPln),
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
      marketValuePln: summary.totalValuePln,
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

  const groups = getGroupedPortfolioAssets(corePortfolio.assets, fxRates);
  const summary = getPortfolioSummary(
    corePortfolio.assets,
    corePortfolio.sales,
    corePortfolio.realizedAdjustments,
    fxRates
  );
  const cashBalances = calculateCashBalances(corePortfolio.operations ?? []);
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

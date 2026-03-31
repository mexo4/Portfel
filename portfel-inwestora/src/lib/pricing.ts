import { BASE_CURRENCY } from "@/lib/constants";
import { round } from "@/lib/utils";
import type {
  AssetKind,
  CurrencyCode,
  FxRates,
  PortfolioAsset,
  PortfolioSummary,
} from "@/types/portfolio";

export type PortfolioAssetGroup = {
  key: string;
  name: string;
  symbol: string;
  kind: AssetKind;
  quantity: number;
  purchaseCurrency: CurrencyCode;
  averagePurchasePrice: number;
  averagePurchasePriceCurrency: CurrencyCode;
  marketCurrency: CurrencyCode;
  latestUnitPrice?: number;
  hasLivePrice: boolean;
  totalInvestedPln: number;
  totalValuePln: number;
  totalProfitLossPln: number;
  lastUpdatedAt?: string;
  lotsCount: number;
  lots: PortfolioAsset[];
};

const getAssetSortTime = (asset: PortfolioAsset) => {
  const sourceDate = asset.purchaseDate || asset.createdAt;
  return new Date(sourceDate).getTime();
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
    const key = `${asset.kind}:${asset.symbol}`;
    const currentGroup = groups.get(key) ?? [];
    currentGroup.push(asset);
    groups.set(key, currentGroup);
  });

  return Array.from(groups.entries())
    .map(([key, lots]) => {
      const sortedLots = [...lots].sort(
        (left, right) => getAssetSortTime(right) - getAssetSortTime(left)
      );
      const representativeLot =
        sortedLots.find((lot) => hasAssetLivePrice(lot)) ?? sortedLots[0];
      const hasLivePrice = sortedLots.some(hasAssetLivePrice);
      const quantity = round(
        sortedLots.reduce((total, lot) => total + lot.quantity, 0),
        6
      );
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
        latestUnitPrice: getAssetLatestUnitPrice(representativeLot),
        hasLivePrice,
        totalInvestedPln,
        totalValuePln,
        totalProfitLossPln: round(
          sortedLots.reduce((total, lot) => total + getAssetProfitLossPln(lot, fxRates), 0)
        ),
        lastUpdatedAt,
        lotsCount: sortedLots.length,
        lots: sortedLots,
      } satisfies PortfolioAssetGroup;
    });
};

export const getPortfolioSummary = (
  assets: PortfolioAsset[],
  fxRates: FxRates
): PortfolioSummary => {
  const totals = assets.reduce(
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

  return {
    totalValuePln: round(totals.totalValuePln),
    totalInvestedPln: round(totals.totalInvestedPln),
    totalProfitLossPln: round(totals.totalProfitLossPln),
    positionsCount: assets.length,
    assetsCount: new Set(assets.map((asset) => asset.symbol)).size,
  };
};

export const getBaseCurrency = () => BASE_CURRENCY;

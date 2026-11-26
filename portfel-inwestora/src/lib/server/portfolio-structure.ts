import { getAssetClassGroup } from "@/lib/geographic-allocation";
import { buildPortfolioStructure, type StructureScope } from "@/lib/portfolio-structure";
import { buildAutomaticBondCouponAdjustments, normalizePortfolioState } from "@/lib/portfolio-state";
import { ensurePortfolioCoreModel } from "@/lib/operation-engine";
import type { PortfolioAssetGroup } from "@/lib/pricing";
import { buildPortfolioHistory } from "@/lib/server/portfolio-history";
import { getPortfolioAssetGroupKey } from "@/lib/ticker";
import type { CurrencyCode, InvestmentPortfolio, PortfolioAsset, PortfolioSale } from "@/types/portfolio";

/**
 * The asset class of each instrument of a portfolio, judged the same way as on the Pozycje list,
 * also for holdings sold in full, which are known only from their sales.
 */
export const buildClassLookup = (assets: PortfolioAsset[], sales: PortfolioSale[]) => {
  const lots = new Map<string, PortfolioAsset[]>();
  const add = (key: string, lot: PortfolioAsset) => lots.set(key, [...(lots.get(key) ?? []), lot]);
  for (const asset of assets) add(getPortfolioAssetGroupKey(asset), asset);
  for (const sale of sales) {
    for (const allocation of sale.allocations ?? []) {
      const kind = allocation.kind ?? sale.kind;
      const symbol = allocation.symbol ?? sale.symbol;
      add(getPortfolioAssetGroupKey({ kind, symbol }), {
        kind,
        symbol,
        name: allocation.name ?? sale.name,
        instrumentType: allocation.instrumentType ?? sale.instrumentType,
        instrumentIdentity: allocation.instrumentIdentity ?? sale.instrumentIdentity,
        marketCurrency: sale.marketCurrency,
        provider: sale.provider,
        providerId: sale.providerId,
      } as PortfolioAsset);
    }
  }
  return (key: string, fallback: { kind: PortfolioAsset["kind"]; label: string }) => {
    const group = lots.get(key);
    return getAssetClassGroup({
      kind: group?.[0]?.kind ?? fallback.kind,
      instrumentType: group?.[0]?.instrumentType,
      name: group?.[0]?.name ?? fallback.label,
      lots: group ?? [],
    } as unknown as PortfolioAssetGroup);
  };
};

export const buildStructureForPortfolios = async (portfolios: InvestmentPortfolio[], currency: CurrencyCode) => {
  const scopes = await Promise.all(
    portfolios.map(async (portfolio): Promise<StructureScope> => {
      const core = ensurePortfolioCoreModel(portfolio);
      const state = normalizePortfolioState({ assets: core.assets, sales: core.sales, realizedAdjustments: core.realizedAdjustments });
      const adjustments = new Map(
        [...state.realizedAdjustments, ...buildAutomaticBondCouponAdjustments(state.assets, state.sales, core.accountType)]
          .map((adjustment) => [adjustment.id, adjustment] as const)
      );
      const history = await buildPortfolioHistory({
        assets: state.assets,
        sales: state.sales,
        realizedAdjustments: [...adjustments.values()],
        operations: core.operations ?? [],
        accounts: core.accounts ?? [],
        presentationCurrency: currency,
        benchmarks: [],
        includeAssetSeries: true,
      });
      const classOf = buildClassLookup(state.assets, state.sales);
      return { id: core.id, name: core.name, history, classify: (series) => classOf(series.groupKey, series) };
    })
  );
  return buildPortfolioStructure(scopes, currency);
};

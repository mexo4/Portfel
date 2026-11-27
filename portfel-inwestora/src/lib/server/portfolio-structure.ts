import { getAssetClassGroup } from "@/lib/geographic-allocation";
import { getVenueLookupSymbol, type VenueId } from "@/lib/listing-venue";
import { buildPortfolioStructure, type StructureScope } from "@/lib/portfolio-structure";
import { buildAutomaticBondCouponAdjustments, normalizePortfolioState } from "@/lib/portfolio-state";
import { ensurePortfolioCoreModel } from "@/lib/operation-engine";
import type { PortfolioAssetGroup } from "@/lib/pricing";
import { resolveListingVenues } from "@/lib/server/listing-venues";
import { buildPortfolioHistory } from "@/lib/server/portfolio-history";
import { getPortfolioAssetGroupKey } from "@/lib/ticker";
import type { CurrencyCode, InvestmentPortfolio, PortfolioAsset, PortfolioSale } from "@/types/portfolio";

/** Open lots by instrument, with the lots sold, which are known only from their sales. */
const lotsByInstrument = (assets: PortfolioAsset[], sales: PortfolioSale[]) => {
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
  return lots;
};

/** The tickers of stocks whose exchange has to be looked up. */
export const listVenueLookupSymbols = (assets: PortfolioAsset[], sales: PortfolioSale[]) =>
  [...lotsByInstrument(assets, sales).values()].flatMap((lots) =>
    lots[0]?.kind === "stock" ? getVenueLookupSymbol({ lots }) ?? [] : []
  );

/**
 * The asset class of each instrument of a portfolio, judged the same way as on the Pozycje list,
 * also for holdings sold in full.
 */
export const buildClassLookup = (assets: PortfolioAsset[], sales: PortfolioSale[], venues: Readonly<Record<string, VenueId>> = {}) => {
  const lots = lotsByInstrument(assets, sales);
  return (key: string, fallback: { kind: PortfolioAsset["kind"]; label: string }) => {
    const group = lots.get(key) ?? [];
    const lookupSymbol = getVenueLookupSymbol({ lots: group });
    return getAssetClassGroup({
      kind: group[0]?.kind ?? fallback.kind,
      instrumentType: group[0]?.instrumentType,
      name: group[0]?.name ?? fallback.label,
      lots: group,
      listingVenue: lookupSymbol ? venues[lookupSymbol] : undefined,
    } as unknown as PortfolioAssetGroup);
  };
};

export const buildStructureForPortfolios = async (portfolios: InvestmentPortfolio[], currency: CurrencyCode) => {
  const states = portfolios.map((portfolio) => {
    const core = ensurePortfolioCoreModel(portfolio);
    return { core, state: normalizePortfolioState({ assets: core.assets, sales: core.sales, realizedAdjustments: core.realizedAdjustments }) };
  });
  const venues = await resolveListingVenues(states.flatMap(({ state }) => listVenueLookupSymbols(state.assets, state.sales)));
  const scopes = await Promise.all(
    states.map(async ({ core, state }): Promise<StructureScope> => {
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
      const classOf = buildClassLookup(state.assets, state.sales, venues);
      return { id: core.id, name: core.name, history, classify: (series) => classOf(series.groupKey, series) };
    })
  );
  return buildPortfolioStructure(scopes, currency);
};

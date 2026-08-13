import type { PortfolioAssetGroup } from "@/lib/pricing";
import { LOCAL_STOCK_CATALOG } from "@/lib/constants";
import { getGpwTickerCore, isGpwSymbol, normalizeSymbol } from "@/lib/ticker";

export const UNKNOWN_COUNTRY_LABEL = "Inne / Brak danych";

export type GeographicAllocationItem = {
  country: string;
  totalValue: number;
};

export type AssetClassAllocationItem = {
  id: string;
  label: string;
  totalValue: number;
};

const getCanonicalCatalogSymbol = (symbol: string) =>
  isGpwSymbol(symbol) ? getGpwTickerCore(symbol) : normalizeSymbol(symbol);

const getCatalogIssuerCountry = (group: PortfolioAssetGroup) => {
  const matchingCountries = Array.from(
    new Set(
      group.lots.flatMap((asset) => {
        if (typeof asset.symbol !== "string" || !asset.symbol.trim()) return [];
        const assetSymbol = getCanonicalCatalogSymbol(asset.symbol);
        return LOCAL_STOCK_CATALOG
          .filter(
            (catalog) =>
              catalog.kind === "stock" &&
              catalog.provider === asset.provider &&
              getCanonicalCatalogSymbol(catalog.symbol) === assetSymbol &&
              Boolean(catalog.issuerCountry)
          )
          .map((catalog) => catalog.issuerCountry!);
      })
    )
  );

  return matchingCountries.length === 1 ? matchingCountries[0] : undefined;
};

export const getConfirmedIssuerCountry = (group: PortfolioAssetGroup) => {
  // Country exposure is intentionally issuer metadata, not exchange metadata.
  // A listing suffix or quote currency is not sufficient evidence of a country.
  const countries = Array.from(
    new Set(
      group.lots
        .map((asset) => asset.issuerCountry?.trim())
        .filter((country): country is string => Boolean(country))
    )
  );

  if (countries.length === 1) return countries[0]!;
  if (countries.length > 1) return UNKNOWN_COUNTRY_LABEL;

  // Legacy positions predate issuerCountry. An exact known catalog instrument
  // remains trusted metadata; this does not infer a country from its suffix.
  return getCatalogIssuerCountry(group) ?? UNKNOWN_COUNTRY_LABEL;
};

const getStockAssetClassLabel = (country: string) => {
  if (country === "Polska") return "Akcje GPW";
  if (country === "USA") return "Akcje USA";
  return `Akcje: ${country}`;
};

/**
 * The asset-class card can split stocks only when issuer-country metadata is
 * confirmed. It never derives a country from a ticker suffix or an exchange.
 * ETFs intentionally remain a separate class because no look-through
 * allocation exists yet.
 */
export const getAssetClassAllocation = (groups: PortfolioAssetGroup[]) => {
  const allocation = new Map<string, AssetClassAllocationItem>();

  for (const group of groups) {
    const country = group.kind === "stock" ? getConfirmedIssuerCountry(group) : null;
    const id = country ? `stock:${country}` : group.kind;
    const label = country
      ? getStockAssetClassLabel(country)
      : group.kind === "etf"
        ? "ETF"
        : group.kind === "crypto"
          ? "Krypto"
          : group.kind === "bond"
            ? "Obligacje"
            : "Inne";
    const current = allocation.get(id);

    allocation.set(id, {
      id,
      label,
      totalValue: (current?.totalValue ?? 0) + group.totalValue,
    });
  }

  return Array.from(allocation.values())
    .filter((item) => item.totalValue > 0)
    .sort(
      (left, right) =>
        right.totalValue - left.totalValue || left.label.localeCompare(right.label, "pl")
    );
};

/**
 * Broad ETFs are deliberately excluded until we have verified look-through
 * holdings. Crypto and bonds are also outside issuer-country exposure.
 */
export const getGeographicAllocation = (groups: PortfolioAssetGroup[]) => {
  const allocation = new Map<string, number>();

  for (const group of groups) {
    if (group.kind !== "stock") continue;

    const country = getConfirmedIssuerCountry(group);
    allocation.set(country, (allocation.get(country) ?? 0) + group.totalValue);
  }

  return Array.from(allocation, ([country, totalValue]) => ({ country, totalValue }))
    .filter((item) => item.totalValue > 0)
    .sort((left, right) => right.totalValue - left.totalValue || left.country.localeCompare(right.country, "pl"));
};

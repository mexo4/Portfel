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

const COUNTRY_ALIASES: Record<string, string> = {
  pl: "Polska",
  poland: "Polska",
  polska: "Polska",
  us: "USA",
  usa: "USA",
  "united states": "USA",
  "united states of america": "USA",
};

const normalizeIssuerCountry = (value: string) =>
  COUNTRY_ALIASES[value.trim().toLocaleLowerCase("en-US")] ?? value.trim();

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
        .map(normalizeIssuerCountry)
    )
  );

  if (countries.length === 1) return countries[0]!;
  if (countries.length > 1) return UNKNOWN_COUNTRY_LABEL;

  // Legacy positions predate issuerCountry. An exact known catalog instrument
  // remains trusted metadata; this does not infer a country from its suffix.
  const catalogCountry = getCatalogIssuerCountry(group);
  if (catalogCountry) return normalizeIssuerCountry(catalogCountry);

  // For legacy holdings, a verified GPW listing is enough to use Poland only
  // when no issuer metadata says otherwise. Explicit issuer country above
  // always wins, so a foreign company listed on GPW remains foreign.
  const isConfirmedGpwListing = group.lots.some(
    (asset) =>
      isGpwSymbol(asset.symbol ?? "") ||
      isGpwSymbol(asset.providerId ?? "") ||
      (asset.provider === "stooq" && asset.marketCurrency === "PLN")
  );
  return isConfirmedGpwListing ? "Polska" : UNKNOWN_COUNTRY_LABEL;
};

export const getStockMarketClass = (group: PortfolioAssetGroup) => {
  // GPW is listing identity, so it takes precedence over issuer metadata.
  // The stored Stooq + PLN pair is likewise a market-aware legacy identity
  // in Mexo; neither condition uses a bare ticker or a company name.
  const isGpwListing = group.lots.some(
    (asset) =>
      isGpwSymbol(asset.symbol ?? "") ||
      isGpwSymbol(asset.providerId ?? "") ||
      (asset.provider === "stooq" && asset.marketCurrency === "PLN")
  );

  if (isGpwListing) {
    return { id: "stock:gpw", label: "Akcje GPW" };
  }

  return getConfirmedIssuerCountry(group) === "USA"
    ? { id: "stock:usa", label: "Akcje ameryka\u0144skie" }
    : { id: "stock:international", label: "Akcje mi\u0119dzynarodowe" };
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
    const stockClass = group.kind === "stock" ? getStockMarketClass(group) : null;
    const id = stockClass?.id ?? group.kind;
    const label = stockClass
      ? stockClass.label
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

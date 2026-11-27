import type { PortfolioAssetGroup } from "@/lib/pricing";
import { LOCAL_STOCK_CATALOG } from "@/lib/constants";
import { getGpwTickerCore, isGpwSymbol, normalizeSymbol } from "@/lib/ticker";
import { classifyInstrument, type InstrumentClass } from "@/lib/instrument-classification";
import { VENUE_LABELS, getStoredListingVenue } from "@/lib/listing-venue";

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

export const getPortfolioInstrumentClass = (
  group: Pick<PortfolioAssetGroup, "kind" | "instrumentType" | "lots" | "name">
): InstrumentClass => {
  const groupClassification = classifyInstrument({
    kind: group.kind,
    instrumentType: group.instrumentType,
    name: group.name,
  });
  const classifications = group.lots.map((lot) => {
    const lotHasClassificationMetadata = Boolean(
      lot.kind || lot.instrumentType || lot.instrumentIdentity || lot.name
    );
    return lotHasClassificationMetadata ? classifyInstrument({
      kind: lot.kind,
      instrumentType: lot.instrumentType,
      instrumentIdentity: lot.instrumentIdentity,
      isin: lot.isin,
      name: lot.name,
    }) : groupClassification;
  });
  const verifiedClasses = new Set(classifications.filter((value) => value !== "unverified"));

  // A trusted provider/catalog type can repair older lots in the same legacy
  // symbol group. Conflicting verified types remain explicitly unresolved.
  if (verifiedClasses.size > 1) return "unverified";
  if (verifiedClasses.size === 1) return Array.from(verifiedClasses)[0]!;
  return classifications[0] ?? groupClassification;
};

const COUNTRY_ALIASES: Record<string, string> = {
  pl: "Polska",
  pol: "Polska",
  poland: "Polska",
  polska: "Polska",
  us: "USA",
  usa: "USA",
  "u.s.": "USA",
  "u.s.a.": "USA",
  "united states (us)": "USA",
  "stany zjednoczone": "USA",
  "united states": "USA",
  "united states of america": "USA",
};

const normalizeIssuerCountry = (value: string) => {
  const trimmed = value.trim();
  const normalized = trimmed.toLocaleLowerCase("en-US");

  if (["unknown", "n/a", "na", "none", "-", "brak danych"].includes(normalized)) {
    return UNKNOWN_COUNTRY_LABEL;
  }

  const alias = COUNTRY_ALIASES[normalized];
  if (alias) return alias;

  // GLEIF returns ISO 3166-1 alpha-2 codes for the registered legal entity.
  // Render those as localized issuer countries instead of exposing raw codes.
  if (/^[A-Z]{2}$/i.test(trimmed) && typeof Intl.DisplayNames === "function") {
    const localized = new Intl.DisplayNames(["pl"], { type: "region" }).of(trimmed.toUpperCase());
    if (localized && localized.toUpperCase() !== trimmed.toUpperCase()) return localized;
  }

  return trimmed;
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
  // Only values with provenance are trusted. Legacy records did not preserve
  // provenance, and EODHD Search's Country field was incorrectly persisted as
  // issuer country. Do not mistake an exchange-country for a cross-listed
  // company's issuer country.
  const countries = Array.from(
    new Set(
      group.lots
        .filter((asset) =>
          asset.issuerCountrySource === "catalog" ||
          asset.issuerCountrySource === "issuer-profile" ||
          asset.issuerCountrySource === "broker-confirmed" ||
          asset.issuerCountrySource === "gleif-isin"
        )
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
  // Stocks are grouped by where they are listed, never by the issuer's country: a Japanese
  // company bought on the NYSE is an NYSE share. Verified issuer country remains
  // available to the geographic analysis.
  const venue = getStoredListingVenue(group) ?? group.listingVenue;
  return venue
    ? { id: `stock:${venue}`, label: `Akcje ${VENUE_LABELS[venue]}` }
    : { id: "stock:foreign", label: "Akcje zagraniczne" };
};

/** The asset-class bucket of one holding (Akcje NYSE, ETF-y polskie, Krypto, Obligacje…). */
export const getAssetClassGroup = (group: PortfolioAssetGroup) => {
  const instrumentClass = getPortfolioInstrumentClass(group);
  if (instrumentClass === "stock") return getStockMarketClass(group);
  // "Polish" means listed on the GPW.
  if (instrumentClass === "etf") {
    return getStoredListingVenue(group) === "gpw"
      ? { id: "etf:pl", label: "ETF-y polskie" }
      : { id: "etf:foreign", label: "ETF-y zagraniczne" };
  }
  const label = instrumentClass === "crypto"
      ? "Krypto"
      : instrumentClass === "bond"
        ? "Obligacje"
        : instrumentClass === "cfd"
          ? "CFD"
          : instrumentClass === "etc"
            ? "ETC"
            : instrumentClass === "etn"
              ? "ETN"
              : instrumentClass === "fund"
                ? "Fundusze"
                : "Niezweryfikowany typ";
  return { id: instrumentClass as string, label };
};

/**
 * Ordinary stocks are grouped by the exchange they are listed on; those whose
 * exchange is not known stay together as foreign. Issuer-country metadata
 * remains available separately through getGeographicAllocation.
 * ETFs are split only into Polish and foreign listings because no
 * look-through allocation exists yet.
 */
export const getAssetClassAllocation = (groups: PortfolioAssetGroup[]) => {
  const allocation = new Map<string, AssetClassAllocationItem>();

  for (const group of groups) {
    const { id, label } = getAssetClassGroup(group);
    const current = allocation.get(id);

    allocation.set(id, {
      id,
      label,
      totalValue: (current?.totalValue ?? 0) + group.totalValue,
    });
  }

  return Array.from(allocation.values())
    .filter((item) => item.totalValue !== 0)
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
    if (getPortfolioInstrumentClass(group) !== "stock") continue;

    const country = getConfirmedIssuerCountry(group);
    allocation.set(country, (allocation.get(country) ?? 0) + group.totalValue);
  }

  return Array.from(allocation, ([country, totalValue]) => ({ country, totalValue }))
    .filter((item) => item.totalValue > 0)
    .sort((left, right) => right.totalValue - left.totalValue || left.country.localeCompare(right.country, "pl"));
};

import { getPortfolioInstrumentId } from "@/lib/operation-engine";
import type {
  InvestmentPortfolio,
  IssuerCountrySource,
  PortfolioAsset,
  PortfolioBook,
  PortfolioInstrument,
} from "@/types/portfolio";

export type IssuerCountryResolution = {
  country: string;
  source: "gleif-isin";
  lei: string;
  isin: string;
};

export type IssuerCountryInstrumentIdentity = {
  symbol: string;
  name: string;
  provider?: string;
  providerId?: string;
  isin?: string;
  marketCurrency?: string;
  exchange?: string;
};

const TRUSTED_ISSUER_COUNTRY_SOURCES = new Set<IssuerCountrySource>([
  "catalog",
  "issuer-profile",
  "broker-confirmed",
  "gleif-isin",
]);

export const normalizeIssuerIsin = (value: unknown) => {
  const isin = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin) ? isin : undefined;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const isTrustedCountry = (country: unknown, source: unknown): country is string =>
  typeof country === "string" &&
  Boolean(country.trim()) &&
  typeof source === "string" &&
  TRUSTED_ISSUER_COUNTRY_SOURCES.has(source as IssuerCountrySource);

/**
 * Parse only a unique, issued GLEIF legal entity returned for an exact ISIN
 * filter. Names and listing venue fields are intentionally never used to infer
 * issuer country.
 */
export const parseGleifIssuerCountry = (
  payload: unknown,
  requestedIsin: string
): IssuerCountryResolution | null => {
  const normalizedIsin = normalizeIssuerIsin(requestedIsin);
  const root = asRecord(payload);
  const data = root?.data;

  if (!normalizedIsin || !Array.isArray(data)) return null;

  const candidates = new Map<string, IssuerCountryResolution>();

  for (const rawRecord of data) {
    const record = asRecord(rawRecord);
    const attributes = asRecord(record?.attributes);
    const lei = typeof attributes?.lei === "string" ? attributes.lei.trim().toUpperCase() : "";
    const entity = asRecord(attributes?.entity);
    const legalAddress = asRecord(entity?.legalAddress);
    const registration = asRecord(attributes?.registration);
    const country = typeof legalAddress?.country === "string"
      ? legalAddress.country.trim().toUpperCase()
      : "";

    if (
      !/^[A-Z0-9]{20}$/.test(lei) ||
      registration?.status !== "ISSUED" ||
      !/^[A-Z]{2}$/.test(country)
    ) {
      continue;
    }

    candidates.set(lei, { country, source: "gleif-isin", lei, isin: normalizedIsin });
  }

  return candidates.size === 1 ? Array.from(candidates.values())[0]! : null;
};

const getLinkedInstrument = (
  portfolio: InvestmentPortfolio,
  asset: PortfolioAsset,
  instrumentsById: Map<string, PortfolioInstrument>
) => instrumentsById.get(getPortfolioInstrumentId(portfolio.id, asset));

const getConsistentAssetIsin = (asset: PortfolioAsset, instrument?: PortfolioInstrument) => {
  const assetIsin = normalizeIssuerIsin(asset.isin);
  const instrumentIsin = normalizeIssuerIsin(instrument?.isin);
  if (assetIsin && instrumentIsin && assetIsin !== instrumentIsin) return undefined;
  return assetIsin ?? instrumentIsin;
};

const hasConflictingAssetIsins = (asset: PortfolioAsset, instrument?: PortfolioInstrument) => {
  const assetIsin = normalizeIssuerIsin(asset.isin);
  const instrumentIsin = normalizeIssuerIsin(instrument?.isin);
  return Boolean(assetIsin && instrumentIsin && assetIsin !== instrumentIsin);
};

const getIssuerIdentity = (
  asset: PortfolioAsset,
  instrument?: PortfolioInstrument
): IssuerCountryInstrumentIdentity => ({
  symbol: asset.symbol,
  name: asset.name || instrument?.name || asset.symbol,
  provider: asset.provider ?? instrument?.provider,
  providerId: asset.providerId ?? instrument?.providerId,
  isin: getConsistentAssetIsin(asset, instrument),
  marketCurrency: asset.marketCurrency ?? instrument?.marketCurrency,
  exchange: asset.instrumentIdentity?.exchange,
});

const getIssuerIdentityKey = (identity: IssuerCountryInstrumentIdentity) => {
  const isin = normalizeIssuerIsin(identity.isin);
  if (isin) return `isin:${isin}`;

  return [
    identity.symbol.trim().toUpperCase(),
    identity.providerId?.trim().toUpperCase() ?? "",
    identity.exchange?.trim().toUpperCase() ?? "",
    identity.name.trim().toLocaleLowerCase("en-US"),
  ].join("|");
};

const getInstrumentIssuerCountry = (instrument?: PortfolioInstrument) => {
  if (
    !instrument ||
    instrument.type === "CFD" ||
    (instrument.assetKind !== undefined && instrument.assetKind !== "stock")
  ) return undefined;
  const metadata = asRecord(instrument.metadata);
  const country = metadata?.issuerCountry;
  const source = metadata?.issuerCountrySource;

  return isTrustedCountry(country, source)
    ? { country: country.trim(), source: source as IssuerCountrySource }
    : undefined;
};

const isOrdinaryStockAsset = (asset: PortfolioAsset) =>
  asset.kind === "stock" &&
  (asset.instrumentType === undefined || asset.instrumentType === "STOCK");

const copyLinkedIssuerMetadata = (portfolio: InvestmentPortfolio): InvestmentPortfolio => {
  const instrumentsById = new Map((portfolio.instruments ?? []).map((instrument) => [instrument.id, instrument]));
  let assetsChanged = false;
  const assets = portfolio.assets.map((asset) => {
    if (!isOrdinaryStockAsset(asset) || isTrustedCountry(asset.issuerCountry, asset.issuerCountrySource)) {
      return asset;
    }

    const instrument = getLinkedInstrument(portfolio, asset, instrumentsById);
    const isin = getConsistentAssetIsin(asset, instrument);
    if (!isin && (normalizeIssuerIsin(asset.isin) || normalizeIssuerIsin(instrument?.isin))) return asset;
    const issuer = getInstrumentIssuerCountry(instrument);
    if (!issuer) return asset;

    assetsChanged = true;
    return {
      ...asset,
      isin: asset.isin ?? isin,
      issuerCountry: issuer.country,
      issuerCountrySource: issuer.source,
    };
  });

  return assetsChanged ? { ...portfolio, assets } : portfolio;
};

const mapWithConcurrency = async <T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
) => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), values.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= values.length) return;
        results[index] = await mapper(values[index]!);
      }
    })
  );

  return results;
};

/**
 * Adds confirmed issuer metadata to the request's read model only. It links
 * old legacy lots to their per-portfolio instrument by deterministic ID, then
 * resolves missing countries strictly by ISIN. No financial or ledger fields
 * are recalculated or written here.
 */
export const enrichPortfolioBookIssuerCountries = async (
  book: PortfolioBook,
  resolveByIsin: (isin: string) => Promise<IssuerCountryResolution | null>,
  resolveByIdentity?: (
    identity: IssuerCountryInstrumentIdentity
  ) => Promise<IssuerCountryResolution | null>
): Promise<PortfolioBook> => {
  const portfolios = book.portfolios.map(copyLinkedIssuerMetadata);
  const preparedBook = { ...book, portfolios };
  const unresolvedIdentities = new Map<
    string,
    { isin?: string; identity: IssuerCountryInstrumentIdentity }
  >();

  for (const portfolio of portfolios) {
    const instrumentsById = new Map((portfolio.instruments ?? []).map((instrument) => [instrument.id, instrument]));
    for (const asset of portfolio.assets) {
      if (!isOrdinaryStockAsset(asset) || isTrustedCountry(asset.issuerCountry, asset.issuerCountrySource)) continue;
      const instrument = getLinkedInstrument(portfolio, asset, instrumentsById);
      if (hasConflictingAssetIsins(asset, instrument)) continue;
      const identity = getIssuerIdentity(asset, instrument);
      const isin = normalizeIssuerIsin(identity.isin);
      if (!isin && !resolveByIdentity) continue;
      unresolvedIdentities.set(getIssuerIdentityKey(identity), { isin, identity });
    }
  }

  if (unresolvedIdentities.size === 0) return preparedBook;

  const resolutions = new Map<string, IssuerCountryResolution>();
  await mapWithConcurrency(Array.from(unresolvedIdentities.entries()), 4, async ([key, target]) => {
    try {
      const resolution = target.isin
        ? await resolveByIsin(target.isin)
        : await resolveByIdentity?.(target.identity);
      const resolvedIsin = normalizeIssuerIsin(resolution?.isin) ?? target.isin;
      if (
        resolution?.source === "gleif-isin" &&
        /^[A-Z]{2}$/.test(resolution.country) &&
        /^[A-Z0-9]{20}$/.test(resolution.lei) &&
        resolvedIsin
      ) resolutions.set(key, { ...resolution, isin: resolvedIsin });
    } catch {
      // A single issuer lookup failure must not make existing portfolio data unavailable.
    }
  });

  if (resolutions.size === 0) return preparedBook;

  return {
    ...preparedBook,
    portfolios: portfolios.map((portfolio) => {
      const instrumentsById = new Map((portfolio.instruments ?? []).map((instrument) => [instrument.id, instrument]));
      const resolutionByInstrumentId = new Map<string, IssuerCountryResolution>();
      let assetsChanged = false;

      const assets = portfolio.assets.map((asset) => {
        if (!isOrdinaryStockAsset(asset) || isTrustedCountry(asset.issuerCountry, asset.issuerCountrySource)) {
          return asset;
        }

        const instrument = getLinkedInstrument(portfolio, asset, instrumentsById);
        if (hasConflictingAssetIsins(asset, instrument)) return asset;
        const identity = getIssuerIdentity(asset, instrument);
        const resolution = resolutions.get(getIssuerIdentityKey(identity));
        if (!resolution) return asset;

        assetsChanged = true;
        if (instrument) resolutionByInstrumentId.set(instrument.id, resolution);
        return {
          ...asset,
          isin: normalizeIssuerIsin(asset.isin) ?? resolution.isin,
          issuerCountry: resolution.country,
          issuerCountrySource: resolution.source,
        };
      });

      const instruments = (portfolio.instruments ?? []).map((instrument) => {
        const resolution = resolutionByInstrumentId.get(instrument.id);
        if (!resolution || getInstrumentIssuerCountry(instrument)) return instrument;
        return {
          ...instrument,
          metadata: {
            ...instrument.metadata,
            issuerCountry: resolution.country,
            issuerCountrySource: resolution.source,
          },
        };
      });

      return assetsChanged
        ? { ...portfolio, assets, instruments }
        : portfolio;
    }),
  };
};

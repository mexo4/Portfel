import { getGpwTickerCore, isGpwSymbol, normalizeSymbol } from "@/lib/ticker";
import type { PortfolioAsset } from "@/types/portfolio";

/**
 * The exchange a holding is listed on. It is read from what is known about the listing, never from
 * the company's name or country: the saved exchange code, then the suffix of the symbol, and for a
 * US ticker, which says only "US", the answer of the price provider.
 */

export const VENUE_LABELS = {
  gpw: "GPW",
  nyse: "NYSE",
  nasdaq: "NASDAQ",
  "nyse-american": "NYSE American",
  "nyse-arca": "NYSE Arca",
  cboe: "Cboe",
  otc: "OTC",
  lse: "LSE",
  xetra: "Xetra",
  frankfurt: "Frankfurt",
  "euronext-paris": "Euronext Paryż",
  "euronext-amsterdam": "Euronext Amsterdam",
  "euronext-brussels": "Euronext Bruksela",
  "euronext-lisbon": "Euronext Lizbona",
  milan: "Mediolan",
  madrid: "Madryt",
  six: "SIX",
  toronto: "Toronto",
  tokyo: "Tokio",
  hongkong: "Hongkong",
  stockholm: "Sztokholm",
  copenhagen: "Kopenhaga",
  helsinki: "Helsinki",
  oslo: "Oslo",
  vienna: "Wiedeń",
  prague: "Praga",
  sydney: "Sydney",
} as const;

export type VenueId = keyof typeof VENUE_LABELS;

export const isVenueId = (value: unknown): value is VenueId =>
  typeof value === "string" && Object.hasOwn(VENUE_LABELS, value);

const byCodes = (entries: Array<[VenueId, string]>) =>
  new Map<string, VenueId>(entries.flatMap(([venue, codes]) => codes.split(" ").map((code) => [code, venue] as const)));

/** Exchange codes of Yahoo, market identifier codes and the plain names, without spaces. */
const EXCHANGE_CODES = byCodes([
  ["gpw", "GPW WSE WAR XWAR WARSAW"],
  ["nyse", "NYSE NYQ NYS XNYS NEWYORKSTOCKEXCHANGE"],
  ["nasdaq", "NASDAQ NMS NGM NCM NAS XNAS XNGS XNMS XNCM NASDAQGS NASDAQGM NASDAQCM"],
  ["nyse-american", "ASE XASE NYSEAMERICAN NYSEMKT AMEX"],
  ["nyse-arca", "PCX ARCX NYSEARCA"],
  ["cboe", "BTS BATS CBOE CBOEBZX"],
  ["otc", "PNK OQB OQX OEM OTC OTCMKTS"],
  ["lse", "LSE IOB XLON LONDON LONDONSTOCKEXCHANGE"],
  ["xetra", "XETRA XETR GER"],
  ["frankfurt", "FRA XFRA FRANKFURT"],
  ["euronext-paris", "PAR XPAR EURONEXTPARIS"],
  ["euronext-amsterdam", "AMS XAMS EURONEXTAMSTERDAM"],
  ["euronext-brussels", "BRU XBRU EURONEXTBRUSSELS"],
  ["euronext-lisbon", "LIS XLIS EURONEXTLISBON"],
  ["milan", "MIL XMIL MTAA BORSAITALIANA"],
  ["madrid", "MCE XMAD MADRID"],
  ["six", "EBS XSWX SIX SIXSWISSEXCHANGE"],
  ["toronto", "TOR XTSE TORONTO TORONTOSTOCKEXCHANGE"],
  ["tokyo", "JPX XTKS XJPX TOKYOSTOCKEXCHANGE"],
  ["hongkong", "HKG XHKG HKEX HONGKONGEXCHANGESANDCLEARING"],
  ["stockholm", "STO XSTO"],
  ["copenhagen", "CPH XCSE"],
  ["helsinki", "HEL XHEL"],
  ["oslo", "OSL XOSL"],
  ["vienna", "VIE XWBO"],
  ["prague", "PRA XPRA"],
  ["sydney", "ASX XASX"],
]);

/** Bloomberg codes, which OpenFIGI uses; they are trusted only next to a FIGI. */
const FIGI_EXCHANGE_CODES = byCodes([
  ["gpw", "PW"],
  ["nyse", "UN"],
  ["nasdaq", "UW UQ UR"],
  ["nyse-american", "UA"],
  ["nyse-arca", "UP"],
  ["lse", "LN"],
  ["xetra", "GY"],
  ["frankfurt", "GF"],
  ["euronext-paris", "FP"],
  ["euronext-amsterdam", "NA"],
  ["milan", "IM"],
  ["madrid", "SM"],
  ["six", "SW SE"],
  ["toronto", "CT"],
  ["tokyo", "JT"],
  ["hongkong", "HK"],
  ["stockholm", "SS"],
  ["copenhagen", "DC"],
  ["helsinki", "FH"],
  ["oslo", "NO"],
  ["vienna", "AV"],
]);

/** Symbol suffixes of brokers (AAPL.US), of Yahoo and of EODHD. ".US" names no single exchange. */
const SYMBOL_SUFFIXES = byCodes([
  ["lse", "UK L LSE"],
  ["xetra", "DE XETRA"],
  ["frankfurt", "F"],
  ["euronext-paris", "FR PA"],
  ["euronext-amsterdam", "NL AS"],
  ["euronext-brussels", "BR"],
  ["euronext-lisbon", "PT LS"],
  ["milan", "IT MI"],
  ["madrid", "ES MC"],
  ["six", "CH SW"],
  ["toronto", "TO"],
  ["tokyo", "T"],
  ["hongkong", "HK"],
  ["stockholm", "SE ST"],
  ["copenhagen", "DK CO"],
  ["helsinki", "FI HE"],
  ["oslo", "NO OL"],
  ["vienna", "VI"],
  ["prague", "CZ PR"],
  ["sydney", "AX"],
]);

export const venueFromExchangeCode = (value: string | undefined, hasFigi = false): VenueId | null => {
  const code = (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) return null;
  return (hasFigi ? FIGI_EXCHANGE_CODES.get(code) : undefined) ?? EXCHANGE_CODES.get(code) ?? null;
};

export const venueFromSymbol = (value: string | undefined): VenueId | null => {
  const symbol = normalizeSymbol(value ?? "");
  if (isGpwSymbol(symbol)) return "gpw";
  const dot = symbol.lastIndexOf(".");
  return dot > 0 ? SYMBOL_SUFFIXES.get(symbol.slice(dot + 1)) ?? null : null;
};

type ListedGroup = { lots: PortfolioAsset[] };

/** The one value all lots agree on; null when none of them says or two of them disagree. */
const agreed = (values: Array<VenueId | null>) => {
  const known = new Set(values.filter((value): value is VenueId => value !== null));
  return known.size === 1 ? [...known][0]! : null;
};

/** GPW is part of a listing's identity in Mexo, so it is decided before anything else. */
export const isGpwListing = (group: ListedGroup) =>
  group.lots.some(
    (lot) =>
      isGpwSymbol(lot.symbol ?? "") ||
      isGpwSymbol(lot.providerId ?? "") ||
      (lot.provider === "stooq" && lot.marketCurrency === "PLN")
  );

/** The exchange named by the saved data of a holding, without asking a provider. */
export const getStoredListingVenue = (group: ListedGroup): VenueId | null => {
  if (isGpwListing(group)) return "gpw";
  const fromIdentity = agreed(
    group.lots.map((lot) => {
      const identity = lot.instrumentIdentity;
      const hasFigi = Boolean(identity?.figi);
      return (
        venueFromExchangeCode(identity?.mic) ??
        venueFromExchangeCode(identity?.exchangeCode, hasFigi) ??
        venueFromExchangeCode(identity?.exchange, hasFigi)
      );
    })
  );
  if (fromIdentity) return fromIdentity;
  return agreed(
    group.lots.flatMap((lot) => [
      venueFromSymbol(lot.symbol),
      venueFromSymbol(lot.providerId),
      venueFromSymbol(lot.instrumentIdentity?.providerPriceSymbol),
    ])
  );
};

const US_TICKER = /^[A-Z]{1,6}([.-][A-Z]{1,2})?$/;

/**
 * The ticker to ask the price provider about, for a holding quoted in dollars whose saved data
 * names no exchange. Null when there is nothing to ask.
 */
export const getVenueLookupSymbol = (group: ListedGroup & { symbol?: string }): string | null => {
  if (getStoredListingVenue(group)) return null;
  const candidates = new Set<string>();
  for (const lot of group.lots) {
    if ((lot.marketCurrency ?? "").toUpperCase() !== "USD") return null;
    const symbol = normalizeSymbol(lot.symbol || getGpwTickerCore(group.symbol ?? "")).replace(/\.US$/, "");
    if (!US_TICKER.test(symbol)) return null;
    // Yahoo writes share classes with a dash: BRK.B is BRK-B there.
    candidates.add(symbol.replace(".", "-"));
  }
  return candidates.size === 1 ? [...candidates][0]! : null;
};

/** Adds the looked-up exchange to the groups that need it; the others are returned as they are. */
export const attachListingVenues = <T extends ListedGroup & { symbol: string; kind: PortfolioAsset["kind"]; listingVenue?: VenueId }>(
  groups: T[],
  known: Readonly<Record<string, VenueId>>
): T[] => {
  let changed = false;
  const next = groups.map((group) => {
    const symbol = group.kind === "stock" ? getVenueLookupSymbol(group) : null;
    const listingVenue = symbol ? known[symbol] : undefined;
    if (!listingVenue) return group;
    changed = true;
    return { ...group, listingVenue };
  });
  return changed ? next : groups;
};

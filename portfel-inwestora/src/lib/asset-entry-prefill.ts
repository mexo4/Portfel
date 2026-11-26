import { isGpwSymbol } from "@/lib/ticker";
import type { AssetDraft, AssetEntryMode, PortfolioAsset } from "@/types/portfolio";

/**
 * Starts the add-transaction form from a holding the user already has: the row actions in
 * Pozycje ("Kup", "Sprzedaj") open the form with that instrument, so a purchase joins the same
 * position and a sale finds it.
 */

export type AssetEntrySide = "buy" | "sell";

export const getAssetEntryHref = (lotId: string, side: AssetEntrySide, targetPortfolioId?: string) => {
  const params = new URLSearchParams({ add: "asset", walor: lotId, strona: side === "sell" ? "sprzedaj" : "kup" });
  if (targetPortfolioId) params.set("cel", targetPortfolioId);
  return `/portfolio/positions?${params.toString()}`;
};

export const getDividendEntryHref = (lotId: string, targetPortfolioId?: string) => {
  const params = new URLSearchParams({ walor: lotId });
  if (targetPortfolioId) params.set("cel", targetPortfolioId);
  return `/portfolio/dividends?${params.toString()}`;
};

/** The newest purchase carries the freshest provider data about the instrument. */
export const getLatestLot = (lots: readonly PortfolioAsset[]) =>
  [...lots].sort((left, right) => right.purchaseDate.localeCompare(left.purchaseDate) || right.createdAt.localeCompare(left.createdAt))[0];

export const getAssetEntryMode = (asset: Pick<PortfolioAsset, "kind" | "symbol" | "marketCurrency" | "provider">): AssetEntryMode => {
  if (asset.kind === "bond" || asset.kind === "crypto" || asset.kind === "etf") return asset.kind;
  if (asset.provider === "stooq" || (asset.marketCurrency === "PLN" && isGpwSymbol(asset.symbol))) return "stock-gpw";
  return asset.marketCurrency === "USD" ? "stock-global" : "stock-international";
};

/** Instrument fields of a held lot; quantity, price and date stay as in an empty form. */
export const getHeldInstrumentDraftFields = (asset: PortfolioAsset): Partial<AssetDraft> => ({
  kind: asset.kind,
  query: asset.name,
  name: asset.name,
  symbol: asset.symbol,
  provider: asset.provider,
  providerId: asset.providerId,
  priceScale: asset.priceScale,
  marketCurrency: asset.marketCurrency,
  purchaseCurrency: asset.purchaseCurrency,
  isin: asset.isin,
  issuerCountry: asset.issuerCountry,
  issuerCountrySource: asset.issuerCountrySource,
  instrumentIdentity: asset.instrumentIdentity,
  marketCurrencyConfirmed: asset.instrumentIdentity?.currency ? true : undefined,
  instrumentType: asset.instrumentType === "CFD" ? "CFD" : undefined,
  positionDirection: asset.positionDirection === "SHORT" ? "SHORT" : "LONG",
  contractMultiplier: asset.instrumentType === "CFD" ? asset.contractMultiplier : undefined,
  contractMultiplierInput: asset.instrumentType === "CFD" && asset.contractMultiplier ? String(asset.contractMultiplier) : "",
});

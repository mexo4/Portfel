import { NextResponse } from "next/server";
import { getCurrentAccountData } from "@/lib/server/auth";
import {
  clearManualPortfolioQuoteSnapshots,
  getPortfolioQuoteSnapshots,
  saveManualPortfolioQuoteSnapshots,
  type AutomaticQuoteFallback,
  type PortfolioQuoteSnapshotInput,
} from "@/lib/server/portfolio-quote-snapshots";
import { getPortfolioAssetGroupKey } from "@/lib/ticker";
import type { CurrencyCode, PortfolioAsset } from "@/types/portfolio";

export const runtime = "nodejs";

const isEligibleAsset = (asset: PortfolioAsset) =>
  asset.instrumentType === "OTHER" || asset.kind === "crypto";

const parseAssetIds = (value: unknown) =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128))).slice(0, 500)
    : [];

const isSupportedCurrencyCode = (value: unknown): value is CurrencyCode => {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) return false;
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency: value }).format(1);
    return true;
  } catch {
    return false;
  }
};

const getWarsawDate = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

const getRequestedGroup = (
  accountData: NonNullable<Awaited<ReturnType<typeof getCurrentAccountData>>>,
  portfolioId: unknown,
  assetIds: string[]
) => {
  if (typeof portfolioId !== "string" || !portfolioId || assetIds.length === 0) {
    throw new Error("Wybierz pozycję z konkretnego portfela.");
  }
  const portfolio = accountData.portfolios.find((candidate) => candidate.id === portfolioId);
  if (!portfolio) throw new Error("Nie znaleziono wybranego portfela.");

  const assets = portfolio.assets.filter((asset) => assetIds.includes(asset.id));
  if (assets.length !== assetIds.length || assets.some((asset) => !isEligibleAsset(asset))) {
    throw new Error("Ręczna wycena jest dostępna tylko dla aktywów importowanych lub kryptowalut w wybranym portfelu.");
  }
  const groupKey = getPortfolioAssetGroupKey(assets[0]);
  const groupLots = portfolio.assets.filter((asset) => getPortfolioAssetGroupKey(asset) === groupKey);
  if (
    assets.some((asset) => getPortfolioAssetGroupKey(asset) !== groupKey) ||
    groupLots.some((asset) => !assetIds.includes(asset.id))
  ) {
    throw new Error("Wybierz wszystkie zakupy tej samej pozycji.");
  }

  return { portfolio, assets };
};

const automaticFallbackFromAsset = (asset: PortfolioAsset): AutomaticQuoteFallback | undefined => {
  if (asset.priceSource === "MANUAL") return undefined;
  return {
    latestPrice: typeof asset.latestPrice === "number" && Number.isFinite(asset.latestPrice) && asset.latestPrice > 0 ? asset.latestPrice : undefined,
    latestPriceDate: asset.latestPriceDate,
    latestPriceMarketTimestamp: asset.latestPriceMarketTimestamp,
    latestPriceFetchedAt: asset.latestPriceFetchedAt,
    previousClose: asset.previousClose,
    lastUpdatedAt: asset.lastUpdatedAt,
    marketCurrency: asset.marketCurrency,
    provider: asset.provider,
    providerId: asset.providerId,
    priceScale: asset.priceScale,
  };
};

export async function PUT(request: Request) {
  const accountData = await getCurrentAccountData();
  if (!accountData) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  try {
    const body = (await request.json()) as {
      portfolioId?: unknown;
      assetIds?: unknown;
      price?: unknown;
      currency?: unknown;
    };
    const assetIds = parseAssetIds(body.assetIds);
    const price = body.price;
    const currency = body.currency;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || price > 1_000_000_000_000) {
      throw new Error("Podaj prawidłową cenę większą od zera.");
    }
    if (!isSupportedCurrencyCode(currency)) throw new Error("Wybierz prawidłową walutę ceny.");

    const { portfolio, assets } = getRequestedGroup(accountData, body.portfolioId, assetIds);
    const existingSnapshots = await getPortfolioQuoteSnapshots([portfolio.id]);
    const enteredAt = new Date();
    const fetchedAt = enteredAt.toISOString();
    const latestPriceDate = getWarsawDate(enteredAt);
    const snapshots: PortfolioQuoteSnapshotInput[] = assets.map((asset) => {
      const existing = existingSnapshots.get(`${portfolio.id}:${asset.id}`);
      const automaticFallback = existing?.priceSource === "MANUAL"
        ? existing.automaticFallback
        : automaticFallbackFromAsset(asset);
      return {
        portfolioId: portfolio.id,
        assetId: asset.id,
        latestPrice: price,
        latestPriceDate,
        latestPriceFetchedAt: fetchedAt,
        lastUpdatedAt: fetchedAt,
        marketCurrency: currency,
        provider: asset.provider,
        providerId: asset.providerId,
        priceScale: asset.priceScale,
        priceSource: "MANUAL",
        automaticFallback,
      };
    });
    const result = await saveManualPortfolioQuoteSnapshots(accountData.user.id, snapshots);
    return NextResponse.json({ saved: result.saved, updatedAt: fetchedAt, priceDate: latestPriceDate });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się zapisać ręcznej ceny.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const accountData = await getCurrentAccountData();
  if (!accountData) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });

  try {
    const body = (await request.json()) as { portfolioId?: unknown; assetIds?: unknown };
    const assetIds = parseAssetIds(body.assetIds);
    const { portfolio } = getRequestedGroup(accountData, body.portfolioId, assetIds);
    const result = await clearManualPortfolioQuoteSnapshots(accountData.user.id, portfolio.id, assetIds);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udało się usunąć ręcznej ceny.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

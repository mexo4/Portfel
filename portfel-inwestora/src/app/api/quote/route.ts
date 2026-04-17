import { NextResponse } from "next/server";
import { fetchAssetQuoteServer } from "@/lib/server/market-data";
import { toCurrencyCode } from "@/lib/utils";
import type { AssetKind, QuoteProvider } from "@/types/portfolio";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.trim();
  const kind = (searchParams.get("kind") as AssetKind | null) ?? "stock";
  const marketCurrency = toCurrencyCode(searchParams.get("marketCurrency") ?? "USD");
  const provider = (searchParams.get("provider") as QuoteProvider | null) ?? "catalog";
  const providerId = searchParams.get("providerId")?.trim() ?? undefined;
  const priceScaleValue = searchParams.get("priceScale")?.trim();
  const priceScale = priceScaleValue ? Number(priceScaleValue) : undefined;

  if (!symbol) {
    return NextResponse.json({ error: "Brak symbolu." }, { status: 400 });
  }

  try {
    const quote = await fetchAssetQuoteServer({
      symbol,
      kind,
      marketCurrency,
      provider,
      providerId,
      priceScale:
        typeof priceScale === "number" && Number.isFinite(priceScale) && priceScale > 0
          ? priceScale
          : undefined,
    });

    if (!quote) {
      return NextResponse.json(
        { error: "Brak aktualnej ceny dla tego aktywa." },
        { status: 404 }
      );
    }

    return NextResponse.json({ quote });
  } catch (error) {
    console.error("GET /api/quote failed", error);
    return NextResponse.json(
      { error: "Nie udalo sie pobrac aktualnej ceny." },
      { status: 500 }
    );
  }
}

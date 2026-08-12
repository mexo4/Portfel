import { NextResponse } from "next/server";
import { fetchAssetQuoteServer } from "@/lib/server/market-data";
import { fetchTreasuryBondQuoteServer } from "@/lib/server/treasury-bonds";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { toCurrencyCode } from "@/lib/utils";
import type { AssetKind, QuoteProvider } from "@/types/portfolio";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getCurrentAuthenticatedUser())) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.trim();
  const kind = (searchParams.get("kind") as AssetKind | null) ?? "stock";
  const marketCurrency = toCurrencyCode(searchParams.get("marketCurrency") ?? "USD");
  const provider = (searchParams.get("provider") as QuoteProvider | null) ?? "catalog";
  const providerId = searchParams.get("providerId")?.trim() ?? undefined;
  const purchaseDate = searchParams.get("purchaseDate")?.trim() ?? undefined;
  const priceScaleValue = searchParams.get("priceScale")?.trim();
  const priceScale = priceScaleValue ? Number(priceScaleValue) : undefined;

  if (!symbol) {
    return NextResponse.json({ error: "Brak symbolu." }, { status: 400 });
  }

  const bondPurchaseDate = kind === "bond" ? purchaseDate : undefined;

  if (kind === "bond" && !bondPurchaseDate) {
    return NextResponse.json(
      { error: "Brak daty zakupu dla obligacji." },
      { status: 400 }
    );
  }

  try {
    let quote;

    if (kind === "bond") {
      quote = await fetchTreasuryBondQuoteServer({
        code: symbol,
        purchaseDate: bondPurchaseDate!,
      });
    } else {
      quote = await fetchAssetQuoteServer({
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
    }

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

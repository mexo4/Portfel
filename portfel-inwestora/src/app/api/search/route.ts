import { NextResponse } from "next/server";
import {
  buildTickerFallbackResults,
  getMinimumSearchLength,
  mergeSearchResults,
} from "@/lib/search";
import { searchMarketAssets } from "@/lib/server/market-data";
import type { AssetKind, AssetSearchMode } from "@/types/portfolio";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const kind = (searchParams.get("kind") as AssetKind | null) ?? "stock";
  const mode = (searchParams.get("mode") as AssetSearchMode | null) ?? undefined;
  const minimumSearchLength = getMinimumSearchLength(mode ?? "stock-global");

  if (query.length < minimumSearchLength) {
    return NextResponse.json({ results: [] });
  }

  try {
    const remoteResults = await searchMarketAssets(query, kind, mode);
    const fallbackResults = buildTickerFallbackResults(query, kind, mode);

    return NextResponse.json({
      results: mergeSearchResults([...remoteResults, ...fallbackResults]),
    });
  } catch (error) {
    console.error("GET /api/search failed", error);
    return NextResponse.json(
      {
        error: "Nie udalo sie pobrac wynikow wyszukiwania.",
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import {
  buildTickerFallbackResults,
  getMinimumSearchLength,
  mergeSearchResults,
  searchCatalogAssets,
} from "@/lib/search";
import type { AssetKind, AssetSearchMode, AssetSearchResult } from "@/types/portfolio";

const shouldReturnQuickResults = (
  quickResults: AssetSearchResult[],
  kind: AssetKind,
  mode?: AssetSearchMode
) => {
  if (quickResults.length === 0) {
    return false;
  }

  if (quickResults.some((result) => result.source === "catalog")) {
    return true;
  }

  return kind !== "etf" && mode !== "etf";
};

const getRemoteSearchTimeoutMs = (mode?: AssetSearchMode) => {
  if (mode === "stock-international") return 3_200;
  if (mode === "stock-global") return 2_800;
  return 4_000;
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, fallback: T) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim() ?? "";
  const kind = (searchParams.get("kind") as AssetKind | null) ?? "stock";
  const mode = (searchParams.get("mode") as AssetSearchMode | null) ?? undefined;
  const minimumSearchLength = getMinimumSearchLength(mode ?? "stock-global");

  if (query.length < minimumSearchLength) {
    return NextResponse.json({ results: [] });
  }

  const catalogResults = searchCatalogAssets(query, kind, mode);
  const fallbackResults = buildTickerFallbackResults(query, kind, mode);
  const quickResults = mergeSearchResults([...catalogResults, ...fallbackResults]);
  let remoteResults: AssetSearchResult[] = [];

  if (shouldReturnQuickResults(quickResults, kind, mode)) {
    return NextResponse.json({ results: quickResults });
  }

  try {
    const { searchMarketAssets } = await import("@/lib/server/market-data");
    remoteResults = await withTimeout(
      searchMarketAssets(query, kind, mode),
      getRemoteSearchTimeoutMs(mode),
      []
    );
  } catch (error) {
    console.error("GET /api/search remote lookup failed", error);
  }

  try {
    return NextResponse.json({
      results: mergeSearchResults([...quickResults, ...remoteResults]),
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

import { NextResponse } from "next/server";
import { FALLBACK_FX_RATES } from "@/lib/constants";
import { fetchFxRatesServer } from "@/lib/server/market-data";

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const codes = (requestUrl.searchParams.get("codes") ?? "")
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    const date = requestUrl.searchParams.get("date")?.trim() || undefined;
    const rates = await fetchFxRatesServer(codes, date);
    return NextResponse.json({
      rates,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("GET /api/fx failed", error);
    return NextResponse.json(
      {
        rates: FALLBACK_FX_RATES,
        fetchedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  }
}

import { NextResponse } from "next/server";
import { FALLBACK_FX_RATES } from "@/lib/constants";
import { fetchFxRatesServer } from "@/lib/server/market-data";

export async function GET() {
  try {
    const rates = await fetchFxRatesServer();
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

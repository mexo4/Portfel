import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { fetchFxRatesServer } from "@/lib/server/market-data";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getCurrentAuthenticatedUser())) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

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
        error: "Nie udalo sie pobrac kursow walut.",
      },
      { status: 502 }
    );
  }
}

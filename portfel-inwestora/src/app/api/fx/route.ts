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
    const historicalOnly = requestUrl.searchParams.get("historicalOnly") === "1";
    if (historicalOnly && (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
      return NextResponse.json({ error: "Historyczny kurs FX wymaga prawidlowej daty." }, { status: 400 });
    }
    const rates = await fetchFxRatesServer(codes, date, { historicalOnly });
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

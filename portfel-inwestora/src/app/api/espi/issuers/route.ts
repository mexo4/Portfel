import { NextResponse } from "next/server";
import { canAccessFeature } from "@/lib/entitlements";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { searchEspiIssuers } from "@/lib/server/espi";

export const runtime = "nodejs";

/** Company suggestions for the ESPI search. They come from stored reports only. */
export async function GET(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  if (!canAccessFeature(user, "espi")) {
    return NextResponse.json({ error: "Brak dostępu do modułu ESPI." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  try {
    const items = await searchEspiIssuers({
      text: params.get("query") ?? "",
      market: params.get("market") === "NEWCONNECT" ? "NEWCONNECT" : "GPW",
    });
    return NextResponse.json({ items });
  } catch (error) {
    console.error("GET /api/espi/issuers failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Nie udało się wyszukać spółek." }, { status: 500 });
  }
}

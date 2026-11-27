import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { MAX_VENUE_SYMBOLS, resolveListingVenues } from "@/lib/server/listing-venues";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

/**
 * The exchanges of US tickers the signed-in user holds. The tickers travel in the body, so they
 * do not end up in access logs.
 */
export async function POST(request: Request) {
  if (!(await getCurrentAuthenticatedUser())) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401, headers: NO_STORE });
  }

  let body: { symbols?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowe zapytanie." }, { status: 400, headers: NO_STORE });
  }

  const symbols = Array.isArray(body.symbols) ? body.symbols.filter((item): item is string => typeof item === "string") : [];
  if (symbols.length === 0 || symbols.length > MAX_VENUE_SYMBOLS) {
    return NextResponse.json({ error: `Podaj od 1 do ${MAX_VENUE_SYMBOLS} symboli.` }, { status: 400, headers: NO_STORE });
  }

  return NextResponse.json({ venues: await resolveListingVenues(symbols) }, { headers: NO_STORE });
}

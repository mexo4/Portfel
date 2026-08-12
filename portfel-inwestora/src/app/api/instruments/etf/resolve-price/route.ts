import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import {
  resolveEtfListingPriceSource,
  sanitiseEtfListing,
} from "@/lib/server/openfigi";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await getCurrentAuthenticatedUser())) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { listing?: unknown };
    const listing = sanitiseEtfListing(body.listing);

    if (!listing) {
      return NextResponse.json({ error: "Nieprawidlowy listing ETF." }, { status: 400 });
    }

    const resolved = await resolveEtfListingPriceSource(listing);
    return NextResponse.json({ listing: resolved });
  } catch {
    return NextResponse.json(
      {
        error:
          "Nie udalo sie sprawdzic dostepnosci aktualnego kursu. ETF nadal mozna dodac z cena transakcji.",
      },
      { status: 502 }
    );
  }
}

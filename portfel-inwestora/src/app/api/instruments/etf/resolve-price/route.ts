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
      return NextResponse.json({ error: "Nieprawidłowy listing ETF." }, { status: 400 });
    }

    const resolved = await resolveEtfListingPriceSource(listing);
    return NextResponse.json({ listing: resolved });
  } catch {
    return NextResponse.json(
      {
        error:
          "Nie udało się sprawdzić dostępności aktualnego kursu. ETF nadal można dodać z ceną transakcji.",
      },
      { status: 502 }
    );
  }
}

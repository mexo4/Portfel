import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import {
  addUserWatchlistItem,
  getUserWatchlist,
  removeUserWatchlistItem,
} from "@/lib/server/watchlist";
import { getGpwWatchlistCanonicalKey } from "@/lib/watchlist";
import type { WatchlistItemInput } from "@/lib/watchlist";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  return NextResponse.json({ items: await getUserWatchlist(user.id) });
}

export async function POST(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as { item?: WatchlistItemInput };
    if (!payload.item) {
      return NextResponse.json({ error: "Brakuje instrumentu do obserwowania." }, { status: 400 });
    }

    return NextResponse.json({ item: await addUserWatchlistItem(user.id, payload.item) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Nie udało się dodać do obserwowanych." },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const canonicalKey = searchParams.get("key")?.trim() ?? "";
  const ticker = canonicalKey.slice("gpw:ticker:".length);
  if (
    !canonicalKey ||
    !/^[A-Z0-9]{1,8}$/.test(ticker) ||
    canonicalKey !== getGpwWatchlistCanonicalKey(ticker)
  ) {
    return NextResponse.json({ error: "Nieprawidłowa spółka obserwowana." }, { status: 400 });
  }

  await removeUserWatchlistItem(user.id, canonicalKey);
  return NextResponse.json({ removed: true });
}

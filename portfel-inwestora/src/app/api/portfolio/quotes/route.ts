import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { savePortfolioQuoteSnapshots } from "@/lib/server/portfolio-quote-snapshots";

export const runtime = "nodejs";

/** Persists derived last-known-good quotes without rewriting portfolio_json. */
export async function POST(request: Request) {
  const user = await getCurrentAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as { snapshots?: unknown };
    const result = await savePortfolioQuoteSnapshots(
      user.id,
      Array.isArray(payload.snapshots) ? payload.snapshots : []
    );
    return NextResponse.json({ saved: result.saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udalo sie zapisac aktualnych kursow.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

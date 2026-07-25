import { NextResponse } from "next/server";
import { resolveTreasuryBondSeries, fetchTreasuryBondQuoteServer } from "@/lib/server/treasury-bonds";
import { toDateInputValue } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim() ?? "";
  const purchaseDate = toDateInputValue(searchParams.get("purchaseDate") ?? undefined);

  if (!code) {
    return NextResponse.json({ error: "Brak kodu obligacji." }, { status: 400 });
  }

  try {
    const [series, quote] = await Promise.all([
      resolveTreasuryBondSeries(code),
      fetchTreasuryBondQuoteServer({
        code,
        purchaseDate,
      }),
    ]);

    return NextResponse.json({
      series,
      quote,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie pobrac danych obligacji.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

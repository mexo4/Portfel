import { NextResponse } from "next/server";
import { fetchTreasuryBondRedemptionQuoteServer } from "@/lib/server/treasury-bonds";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { toDateInputValue } from "@/lib/utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!(await getCurrentAuthenticatedUser())) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim() ?? "";
  const purchaseDate = toDateInputValue(searchParams.get("purchaseDate") ?? undefined);
  const requestDate = toDateInputValue(searchParams.get("requestDate") ?? undefined);
  const quantityValue = searchParams.get("quantity")?.trim();
  const quantity = quantityValue ? Number(quantityValue) : 0;

  if (!code) {
    return NextResponse.json({ error: "Brak kodu obligacji." }, { status: 400 });
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json({ error: "Podaj poprawna ilosc do wykupu." }, { status: 400 });
  }

  try {
    const redemption = await fetchTreasuryBondRedemptionQuoteServer({
      code,
      purchaseDate,
      requestDate,
      quantity,
    });

    return NextResponse.json({ redemption });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie pobrac wyceny wykupu.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { fetchTreasuryBondSwapQuoteServer } from "@/lib/server/treasury-bonds";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import type { BondRedemptionQuote } from "@/types/portfolio";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await getCurrentAuthenticatedUser())) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        sourceRedemption?: BondRedemptionQuote;
        targetCode?: string;
        targetQuantity?: number;
      }
    | null;
  const sourceRedemption = body?.sourceRedemption;
  const targetCode = body?.targetCode?.trim() ?? "";
  const targetQuantity = Number(body?.targetQuantity ?? 0);

  if (!sourceRedemption) {
    return NextResponse.json(
      { error: "Brak podgladu wykupu dla zrodlowej serii." },
      { status: 400 }
    );
  }

  if (!targetCode) {
    return NextResponse.json({ error: "Brak kodu docelowej obligacji." }, { status: 400 });
  }

  if (!Number.isFinite(targetQuantity) || targetQuantity <= 0) {
    return NextResponse.json(
      { error: "Podaj poprawna ilosc obligacji po zamianie." },
      { status: 400 }
    );
  }

  try {
    const swap = await fetchTreasuryBondSwapQuoteServer({
      sourceRedemption,
      targetCode,
      targetQuantity,
    });

    return NextResponse.json({ swap });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie pobrac podgladu zamiany.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

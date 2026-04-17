import { NextResponse } from "next/server";
import {
  getCurrentAccountData,
  updateCurrentUserPortfolio,
} from "@/lib/server/auth";
import type { PortfolioState } from "@/types/portfolio";

export const runtime = "nodejs";

export async function GET() {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  return NextResponse.json({ assets: accountData.assets, sales: accountData.sales });
}

export async function PUT(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as {
      assets?: PortfolioState["assets"];
      sales?: PortfolioState["sales"];
    };

    const updatedPortfolio = await updateCurrentUserPortfolio(accountData.user.id, {
      assets: Array.isArray(payload.assets) ? payload.assets : [],
      sales: Array.isArray(payload.sales) ? payload.sales : [],
    });

    return NextResponse.json(updatedPortfolio);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udalo sie zapisac portfela.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import {
  getCurrentAccountData,
  updateCurrentUserPortfolio,
} from "@/lib/server/auth";
import type { PortfolioAsset } from "@/types/portfolio";

export const runtime = "nodejs";

export async function GET() {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  return NextResponse.json({ assets: accountData.assets });
}

export async function PUT(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as {
      assets?: PortfolioAsset[];
    };

    const assets = Array.isArray(payload.assets) ? payload.assets : [];
    const updatedAssets = await updateCurrentUserPortfolio(accountData.user.id, assets);

    return NextResponse.json({ assets: updatedAssets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udalo sie zapisac portfela.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

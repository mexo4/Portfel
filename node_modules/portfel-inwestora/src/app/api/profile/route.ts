import { NextResponse } from "next/server";
import {
  getCurrentAccountData,
  updateCurrentUserProfile,
} from "@/lib/server/auth";
import type { UserProfile } from "@/types/portfolio";

export const runtime = "nodejs";

export async function GET() {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  return NextResponse.json({
    user: accountData.user,
    profile: accountData.profile,
  });
}

export async function PUT(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const payload = (await request.json()) as {
      profile?: UserProfile;
    };

    const updated = await updateCurrentUserProfile(
      accountData.user.id,
      payload.profile ?? accountData.profile
    );

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nie udalo sie zapisac profilu.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

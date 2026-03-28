import { NextResponse } from "next/server";
import {
  getCurrentAccountData,
  requestEmailVerificationForUser,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const baseUrl = request.headers.get("origin") ?? new URL(request.url).origin;
    const result = await requestEmailVerificationForUser(accountData.user.id, baseUrl);

    return NextResponse.json({
      success: true,
      alreadyVerified: result.alreadyVerified,
      previewUrl: process.env.NODE_ENV === "production" ? null : result.previewUrl,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie wyslac linku weryfikacyjnego.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

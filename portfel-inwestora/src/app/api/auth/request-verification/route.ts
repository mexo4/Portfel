import { NextResponse } from "next/server";
import {
  getCurrentAccountData,
  sendEmailVerificationForUser,
} from "@/lib/server/auth";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";
import { getPublicOrigin } from "@/lib/server/public-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const accountData = await getCurrentAccountData();

  if (!accountData) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const limited = await applyAuthRateLimit(request, "verification", accountData.user.id);
    if (limited) return limited;
    const result = await sendEmailVerificationForUser(accountData.user.id, getPublicOrigin(request));

    return NextResponse.json({
      success: true,
      alreadyVerified: result.alreadyVerified,
      sent: result.sent,
      previewUrl: process.env.NODE_ENV === "production" ? null : result.previewUrl,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie wyslac linku weryfikacyjnego.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

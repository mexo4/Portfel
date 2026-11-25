import { NextResponse } from "next/server";
import {
  getCurrentAuthenticatedUser,
  sendEmailVerificationForUser,
} from "@/lib/server/auth";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";
import { getPublicOrigin } from "@/lib/server/public-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  try {
    const limited = await applyAuthRateLimit(request, "verification", user.id);
    if (limited) return limited;
    const result = await sendEmailVerificationForUser(user.id, getPublicOrigin(request));

    return NextResponse.json({
      success: true,
      alreadyVerified: result.alreadyVerified,
      sent: result.sent,
      previewUrl: process.env.NODE_ENV === "production" ? null : result.previewUrl,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udało się wysłać linku weryfikacyjnego.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

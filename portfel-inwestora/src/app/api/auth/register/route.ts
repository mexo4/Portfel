import { NextResponse } from "next/server";
import {
  registerAccount,
  sendEmailVerificationForUser,
} from "@/lib/server/auth";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";
import { getPublicOrigin } from "@/lib/server/public-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      displayName?: string;
      email?: string;
      password?: string;
    };

    const limited = await applyAuthRateLimit(request, "register", payload.email ?? "");
    if (limited) return limited;

    const user = await registerAccount({
      displayName: payload.displayName ?? "",
      email: payload.email ?? "",
      password: payload.password ?? "",
    });

    const verification = await sendEmailVerificationForUser(user.id, getPublicOrigin(request));

    return NextResponse.json({
      user,
      requiresVerification: true,
      verificationSent: verification.sent,
      previewUrl: process.env.NODE_ENV === "production" ? null : verification.previewUrl,
    });
  } catch {
    return NextResponse.json(
      { error: "Nie udało się założyć konta. Sprawdź dane albo użyj logowania, jeśli konto już istnieje." },
      { status: 400 }
    );
  }
}

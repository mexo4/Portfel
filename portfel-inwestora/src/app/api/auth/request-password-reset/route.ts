import { NextResponse } from "next/server";
import { requestPasswordResetForEmail } from "@/lib/server/auth";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";
import { getPublicOrigin } from "@/lib/server/public-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      email?: string;
    };

    const limited = await applyAuthRateLimit(request, "passwordReset", payload.email ?? "");
    if (limited) return limited;

    const result = await requestPasswordResetForEmail(payload.email ?? "", getPublicOrigin(request));

    return NextResponse.json({
      success: true,
      previewUrl: process.env.NODE_ENV === "production" ? null : result.previewUrl,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udało się przygotować resetu hasła.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

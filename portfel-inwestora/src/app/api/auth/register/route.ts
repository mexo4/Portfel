import { NextResponse } from "next/server";
import {
  registerAccount,
  sendEmailVerificationForUser,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      displayName?: string;
      email?: string;
      password?: string;
    };

    const user = await registerAccount({
      displayName: payload.displayName ?? "",
      email: payload.email ?? "",
      password: payload.password ?? "",
    });

    const baseUrl = request.headers.get("origin") ?? new URL(request.url).origin;
    const verification = await sendEmailVerificationForUser(user.id, baseUrl);

    return NextResponse.json({
      user,
      requiresVerification: true,
      verificationSent: verification.sent,
      previewUrl: process.env.NODE_ENV === "production" ? null : verification.previewUrl,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Nie udalo sie zalozyc konta.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

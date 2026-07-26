import { NextResponse } from "next/server";
import {
  appendSessionCookie,
  createSessionForUser,
  EmailVerificationRequiredError,
  loginAccount,
  sendEmailVerificationForUser,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      email?: string;
      password?: string;
    };

    const user = await loginAccount({
      email: payload.email ?? "",
      password: payload.password ?? "",
    });

    const session = await createSessionForUser(user.id);
    const response = NextResponse.json({ user });
    appendSessionCookie(response, session.token, session.expiresAt);

    return response;
  } catch (error) {
    if (error instanceof EmailVerificationRequiredError) {
      const baseUrl = request.headers.get("origin") ?? new URL(request.url).origin;
      const verification = await sendEmailVerificationForUser(error.userId, baseUrl);

      return NextResponse.json(
        {
          error: error.message,
          requiresVerification: true,
          verificationSent: verification.sent,
          previewUrl: process.env.NODE_ENV === "production" ? null : verification.previewUrl,
        },
        { status: 403 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Nie udalo sie zalogowac.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

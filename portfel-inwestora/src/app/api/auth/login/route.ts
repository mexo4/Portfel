import { NextResponse } from "next/server";
import {
  appendSessionCookie,
  createSessionForUser,
  EmailVerificationRequiredError,
  loginAccount,
  sendEmailVerificationForUser,
} from "@/lib/server/auth";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      email?: string;
      password?: string;
    };

    const limited = await applyAuthRateLimit(request, "login", payload.email ?? "");
    if (limited) return limited;

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
      const limited = await applyAuthRateLimit(request, "verification", error.userId);
      if (limited) return limited;
      const baseUrl = request.headers.get("origin") ?? new URL(request.url).origin;
      await sendEmailVerificationForUser(error.userId, baseUrl);

      return NextResponse.json(
        {
          // Keep the public response indistinguishable from an invalid
          // credential pair. The verification message is still sent, but the
          // API does not confirm that this address owns an account.
          error: "Niepoprawny email lub hasło.",
        },
        { status: 401 }
      );
    }

    return NextResponse.json({ error: "Niepoprawny email lub hasło." }, { status: 401 });
  }
}

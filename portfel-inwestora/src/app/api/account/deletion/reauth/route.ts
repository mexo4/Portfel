import { NextResponse } from "next/server";
import { ACCOUNT_DELETION_CHALLENGE_COOKIE, getAccountDeletionCookieOptions, isSameOriginMutation } from "@/lib/server/account-deletion-http";
import { issueAccountDeletionChallenge, verifyAccountPasswordForStepUp } from "@/lib/server/account-privacy";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  const limited = await applyAuthRateLimit(request, "accountDeletion", user.id);
  if (limited) return limited;
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Nieprawidłowe żądanie." }, { status: 403 });
  if (!user.hasPassword) return NextResponse.json({ error: "To konto wymaga ponownego uwierzytelnienia przez Google." }, { status: 409 });

  let password = "";
  try {
    const payload = await request.json() as { password?: unknown };
    password = typeof payload.password === "string" ? payload.password : "";
  } catch {
    return NextResponse.json({ error: "Podaj aktualne hasło." }, { status: 400 });
  }
  if (!(await verifyAccountPasswordForStepUp(user.id, password))) {
    return NextResponse.json({ error: "Nie udało się potwierdzić tożsamości." }, { status: 403 });
  }

  try {
    const challenge = await issueAccountDeletionChallenge(user.id);
    const response = NextResponse.json({ success: true, expiresAt: challenge.expiresAt.toISOString() });
    response.cookies.set(ACCOUNT_DELETION_CHALLENGE_COOKIE, challenge.token, getAccountDeletionCookieOptions());
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return NextResponse.json({ error: "Nie udało się przygotować bezpiecznego potwierdzenia." }, { status: 503 });
  }
}

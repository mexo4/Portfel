import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCOUNT_DELETION_CHALLENGE_COOKIE, getExpiredAccountDeletionCookieOptions, isSameOriginMutation } from "@/lib/server/account-deletion-http";
import { AccountDeletionError, deleteAccountAfterReauthentication } from "@/lib/server/account-privacy";
import { clearSessionCookie, getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  const limited = await applyAuthRateLimit(request, "accountDeletion", user.id);
  if (limited) return limited;
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Nieprawidłowe żądanie." }, { status: 403 });
  const cookieStore = await cookies();
  const challenge = cookieStore.get(ACCOUNT_DELETION_CHALLENGE_COOKIE)?.value;
  if (!challenge) return NextResponse.json({ error: "Najpierw ponownie potwierdź swoją tożsamość." }, { status: 403 });

  try {
    await deleteAccountAfterReauthentication(user.id, challenge);
    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);
    response.cookies.set(ACCOUNT_DELETION_CHALLENGE_COOKIE, "", getExpiredAccountDeletionCookieOptions());
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      const status = error.code === "challenge_invalid" ? 403 : error.code === "admin_transfer_required" ? 409 : 401;
      return NextResponse.json({ error: error.message }, { status, headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ error: "Nie udało się bezpiecznie usunąć konta. Spróbuj ponownie później." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

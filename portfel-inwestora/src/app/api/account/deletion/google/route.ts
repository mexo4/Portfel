import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";
import { createGoogleOAuthPending, getGoogleAuthorizationUrl, getGoogleOAuthCookieOptions, GOOGLE_OAUTH_STATE_COOKIE_NAME } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (user.hasPassword) return NextResponse.redirect(new URL("/settings", request.url));
  const limited = await applyAuthRateLimit(request, "accountDeletion", user.id);
  if (limited) return limited;
  try {
    const { pending, cookieValue } = createGoogleOAuthPending({ purpose: "account-deletion", userId: user.id });
    const response = NextResponse.redirect(getGoogleAuthorizationUrl(pending));
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE_NAME, cookieValue, getGoogleOAuthCookieOptions());
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return NextResponse.redirect(new URL("/settings?privacyDeletionError=oauth-unavailable", request.url));
  }
}

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  appendSessionCookie,
  createSessionForUser,
  resolveGoogleOAuthAccount,
} from "@/lib/server/auth";
import {
  exchangeGoogleOAuthCode,
  getExpiredGoogleOAuthCookieOptions,
  getOAuthApplicationUrl,
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
  isGoogleOAuthStateValid,
  readGoogleOAuthPending,
} from "@/lib/server/oauth";

export const runtime = "nodejs";

const redirectToLogin = (parameter: "oauthError" | "oauthNotice", message: string) => {
  const url = getOAuthApplicationUrl("/login");
  url.searchParams.set(parameter, message);
  const response = NextResponse.redirect(url);
  response.cookies.set(
    GOOGLE_OAUTH_STATE_COOKIE_NAME,
    "",
    getExpiredGoogleOAuthCookieOptions()
  );
  return response;
};

export async function GET(request: Request) {
  const callbackUrl = new URL(request.url);
  const providerError = callbackUrl.searchParams.get("error");
  const receivedState = callbackUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const pending = readGoogleOAuthPending(
    cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE_NAME)?.value
  );

  if (providerError) {
    if (!pending || !isGoogleOAuthStateValid(pending, receivedState)) {
      return redirectToLogin("oauthError", "Sesja logowania wygasla. Rozpocznij logowanie ponownie.");
    }

    return redirectToLogin(
      providerError === "access_denied" ? "oauthNotice" : "oauthError",
      providerError === "access_denied"
        ? "Logowanie przez Google zostalo anulowane."
        : "Nie udalo sie zalogowac przez Google. Sprobuj ponownie."
    );
  }

  const code = callbackUrl.searchParams.get("code");

  if (!code || !pending || !isGoogleOAuthStateValid(pending, receivedState)) {
    return redirectToLogin("oauthError", "Sesja logowania wygasla. Rozpocznij logowanie ponownie.");
  }

  try {
    const identity = await exchangeGoogleOAuthCode({ code, pending });
    const user = await resolveGoogleOAuthAccount(identity);
    const session = await createSessionForUser(user.id);
    const response = NextResponse.redirect(getOAuthApplicationUrl("/dashboard"));

    appendSessionCookie(response, session.token, session.expiresAt);
    response.cookies.set(
      GOOGLE_OAUTH_STATE_COOKIE_NAME,
      "",
      getExpiredGoogleOAuthCookieOptions()
    );

    return response;
  } catch {
    return redirectToLogin("oauthError", "Nie udalo sie zalogowac przez Google. Sprobuj ponownie.");
  }
}

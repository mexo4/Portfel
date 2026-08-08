import { NextResponse } from "next/server";
import {
  createGoogleOAuthPending,
  getGoogleAuthorizationUrl,
  getGoogleOAuthCookieOptions,
  getOAuthApplicationUrl,
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
  GoogleOAuthConfigurationError,
} from "@/lib/server/oauth";

export const runtime = "nodejs";

const redirectToLogin = (message: string) => {
  const url = getOAuthApplicationUrl("/login");
  url.searchParams.set("oauthError", message);
  return NextResponse.redirect(url);
};

export async function GET() {
  try {
    const { pending, cookieValue } = createGoogleOAuthPending();
    const response = NextResponse.redirect(getGoogleAuthorizationUrl(pending));

    response.cookies.set(
      GOOGLE_OAUTH_STATE_COOKIE_NAME,
      cookieValue,
      getGoogleOAuthCookieOptions()
    );

    return response;
  } catch (error) {
    if (error instanceof GoogleOAuthConfigurationError) {
      return redirectToLogin(error.message);
    }

    return redirectToLogin("Nie udalo sie rozpoczac logowania przez Google. Sprobuj ponownie.");
  }
}

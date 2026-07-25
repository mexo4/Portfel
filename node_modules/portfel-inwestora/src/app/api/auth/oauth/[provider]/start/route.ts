import { NextResponse } from "next/server";
import {
  createOAuthState,
  getOAuthAuthorizationUrl,
  isOAuthProvider,
  OAUTH_STATE_COOKIE_NAME,
} from "@/lib/server/oauth";

export const runtime = "nodejs";

type OAuthStartContext = {
  params: Promise<{
    provider: string;
  }>;
};

const redirectWithError = (requestUrl: string, message: string) => {
  const url = new URL("/login", new URL(requestUrl).origin);
  url.searchParams.set("oauthError", message);
  return NextResponse.redirect(url);
};

export async function GET(request: Request, context: OAuthStartContext) {
  const { provider } = await context.params;

  if (!isOAuthProvider(provider)) {
    return redirectWithError(request.url, "Nieznany dostawca logowania.");
  }

  try {
    const state = createOAuthState();
    const authorizationUrl = getOAuthAuthorizationUrl({
      provider,
      requestUrl: request.url,
      state,
    });
    const response = NextResponse.redirect(authorizationUrl);

    response.cookies.set(OAUTH_STATE_COOKIE_NAME, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 10,
    });

    return response;
  } catch (error) {
    return redirectWithError(
      request.url,
      error instanceof Error ? error.message : "Nie udalo sie rozpoczac logowania."
    );
  }
}

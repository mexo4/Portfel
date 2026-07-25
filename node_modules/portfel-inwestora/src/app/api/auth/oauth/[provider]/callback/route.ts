import { NextResponse } from "next/server";
import {
  appendSessionCookie,
  createSessionForUser,
  upsertOAuthAccount,
} from "@/lib/server/auth";
import {
  exchangeOAuthCode,
  isOAuthProvider,
  OAUTH_STATE_COOKIE_NAME,
} from "@/lib/server/oauth";

export const runtime = "nodejs";

type OAuthCallbackContext = {
  params: Promise<{
    provider: string;
  }>;
};

const buildRedirect = (requestUrl: string, pathname: string, error?: string) => {
  const url = new URL(pathname, new URL(requestUrl).origin);

  if (error) {
    url.searchParams.set("oauthError", error);
  }

  return url;
};

const finishOAuthLogin = async ({
  request,
  context,
  code,
  state,
}: {
  request: Request;
  context: OAuthCallbackContext;
  code: string;
  state: string;
}) => {
  const { provider } = await context.params;

  if (!isOAuthProvider(provider)) {
    return NextResponse.redirect(buildRedirect(request.url, "/login", "Nieznany dostawca logowania."));
  }

  const expectedState = request.headers
    .get("cookie")
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${OAUTH_STATE_COOKIE_NAME}=`))
    ?.split("=")[1];

  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(
      buildRedirect(request.url, "/login", "Sesja logowania wygasla. Sprobuj ponownie.")
    );
  }

  try {
    const identity = await exchangeOAuthCode({
      provider,
      requestUrl: request.url,
      code,
    });
    const user = await upsertOAuthAccount(identity);
    const session = createSessionForUser(user.id);
    const response = NextResponse.redirect(buildRedirect(request.url, "/app"));

    appendSessionCookie(response, session.token, session.expiresAt);
    response.cookies.set(OAUTH_STATE_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: new Date(0),
    });

    return response;
  } catch (error) {
    const response = NextResponse.redirect(
      buildRedirect(
        request.url,
        "/login",
        error instanceof Error ? error.message : "Nie udalo sie zalogowac przez dostawce."
      )
    );
    response.cookies.set(OAUTH_STATE_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: new Date(0),
    });
    return response;
  }
};

export async function GET(request: Request, context: OAuthCallbackContext) {
  const url = new URL(request.url);
  return finishOAuthLogin({
    request,
    context,
    code: url.searchParams.get("code") ?? "",
    state: url.searchParams.get("state") ?? "",
  });
}

export async function POST(request: Request, context: OAuthCallbackContext) {
  const formData = await request.formData();
  return finishOAuthLogin({
    request,
    context,
    code: String(formData.get("code") ?? ""),
    state: String(formData.get("state") ?? ""),
  });
}

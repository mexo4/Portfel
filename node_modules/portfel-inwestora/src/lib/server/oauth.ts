import { randomBytes } from "node:crypto";

export type OAuthProvider = "google" | "apple";

type OAuthConfig = {
  authorizationUrl: string;
  tokenUrl: string;
  clientId?: string;
  clientSecret?: string;
  scope: string;
};

export type OAuthIdentity = {
  email: string;
  displayName: string | null;
};

export const OAUTH_STATE_COOKIE_NAME = "portfel_oauth_state";

export const isOAuthProvider = (provider: string): provider is OAuthProvider =>
  provider === "google" || provider === "apple";

const getOAuthConfig = (provider: OAuthProvider): OAuthConfig => {
  if (provider === "google") {
    return {
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      scope: "openid email profile",
    };
  }

  return {
    authorizationUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    clientId: process.env.APPLE_CLIENT_ID,
    clientSecret: process.env.APPLE_CLIENT_SECRET,
    scope: "openid email name",
  };
};

export const getOAuthRedirectUri = (requestUrl: string, provider: OAuthProvider) => {
  const requestOrigin = new URL(requestUrl).origin;
  const baseUrl = process.env.OAUTH_REDIRECT_BASE_URL ?? requestOrigin;
  return `${baseUrl}/api/auth/oauth/${provider}/callback`;
};

export const createOAuthState = () => randomBytes(24).toString("hex");

export const getOAuthAuthorizationUrl = ({
  provider,
  requestUrl,
  state,
}: {
  provider: OAuthProvider;
  requestUrl: string;
  state: string;
}) => {
  const config = getOAuthConfig(provider);

  if (!config.clientId || !config.clientSecret) {
    throw new Error(`Brakuje konfiguracji logowania ${provider}.`);
  }

  const authorizationUrl = new URL(config.authorizationUrl);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", getOAuthRedirectUri(requestUrl, provider));
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", config.scope);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("response_mode", provider === "apple" ? "form_post" : "query");

  return authorizationUrl;
};

const decodeJwtPayload = (token: string) => {
  const [, payload] = token.split(".");

  if (!payload) {
    throw new Error("Dostawca logowania zwrocil niepoprawny token.");
  }

  const normalizedPayload = payload.replace(/-/g, "+").replace(/_/g, "/");
  const paddedPayload = normalizedPayload.padEnd(
    normalizedPayload.length + ((4 - (normalizedPayload.length % 4)) % 4),
    "="
  );

  return JSON.parse(Buffer.from(paddedPayload, "base64").toString("utf8")) as Record<
    string,
    unknown
  >;
};

const getIdentityFromToken = (provider: OAuthProvider, idToken: string): OAuthIdentity => {
  const payload = decodeJwtPayload(idToken);
  const email = typeof payload.email === "string" ? payload.email : "";
  const emailVerified = payload.email_verified;

  if (!email) {
    throw new Error("Dostawca logowania nie udostepnil adresu email.");
  }

  if (provider === "google" && emailVerified === false) {
    throw new Error("Konto Google nie ma potwierdzonego adresu email.");
  }

  const displayName =
    typeof payload.name === "string"
      ? payload.name
      : [payload.given_name, payload.family_name]
          .filter((part): part is string => typeof part === "string")
          .join(" ") || null;

  return {
    email,
    displayName,
  };
};

export const exchangeOAuthCode = async ({
  provider,
  requestUrl,
  code,
}: {
  provider: OAuthProvider;
  requestUrl: string;
  code: string;
}) => {
  const config = getOAuthConfig(provider);

  if (!config.clientId || !config.clientSecret) {
    throw new Error(`Brakuje konfiguracji logowania ${provider}.`);
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: getOAuthRedirectUri(requestUrl, provider),
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = (await response.json().catch(() => null)) as { id_token?: string } | null;

  if (!response.ok || !payload?.id_token) {
    throw new Error(`Nie udalo sie zalogowac przez ${provider}.`);
  }

  return getIdentityFromToken(provider, payload.id_token);
};

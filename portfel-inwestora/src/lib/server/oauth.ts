import {
  createHash,
  createHmac,
  createPublicKey,
  createVerify,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const OAUTH_MAX_AGE_SECONDS = 10 * 60;

export const GOOGLE_OAUTH_STATE_COOKIE_NAME = "mexo_google_oauth";

type GoogleJwk = {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  use?: string;
  alg?: string;
};

type GoogleTokenClaims = {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  iat?: unknown;
  nonce?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
  given_name?: unknown;
  family_name?: unknown;
};

type GoogleTokenHeader = {
  alg?: unknown;
  kid?: unknown;
};

export type GoogleOAuthPending = {
  state: string;
  codeVerifier: string;
  nonce: string;
  issuedAt: number;
};

export type GoogleIdentity = {
  providerAccountId: string;
  email: string;
  displayName: string | null;
  emailVerified: true;
};

export class GoogleOAuthConfigurationError extends Error {
  constructor() {
    super("Logowanie przez Google nie jest jeszcze skonfigurowane.");
    this.name = "GoogleOAuthConfigurationError";
  }
}

export class GoogleOAuthError extends Error {
  constructor() {
    super("Nie udalo sie zalogowac przez Google. Sprobuj ponownie.");
    this.name = "GoogleOAuthError";
  }
}

let jwksCache: { keys: GoogleJwk[]; expiresAt: number } | null = null;

export const getGoogleOAuthConfigurationPresence = () => ({
  googleClientIdPresent: Boolean(process.env.GOOGLE_CLIENT_ID?.trim()),
  googleClientSecretPresent: Boolean(process.env.GOOGLE_CLIENT_SECRET?.trim()),
});

const getGoogleConfig = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new GoogleOAuthConfigurationError();
  }

  return { clientId, clientSecret };
};

const getApplicationBaseUrl = () =>
  process.env.NODE_ENV === "production" ? "https://mexo.com.pl" : "http://localhost:3000";

export const getGoogleOAuthRedirectUri = () =>
  `${getApplicationBaseUrl()}/api/auth/oauth/google/callback`;

const randomUrlSafeValue = () => randomBytes(48).toString("base64url");

const createPendingCookieSignature = (payload: string) => {
  const { clientSecret } = getGoogleConfig();

  return createHmac("sha256", clientSecret)
    .update(`mexo:google-oauth:${payload}`)
    .digest("base64url");
};

const encodePending = (pending: GoogleOAuthPending) => {
  const payload = Buffer.from(JSON.stringify(pending)).toString("base64url");
  const signature = createPendingCookieSignature(payload);

  return `${payload}.${signature}`;
};

export const createGoogleOAuthPending = () => {
  const pending: GoogleOAuthPending = {
    state: randomUrlSafeValue(),
    codeVerifier: randomUrlSafeValue(),
    nonce: randomUrlSafeValue(),
    issuedAt: Date.now(),
  };

  return {
    pending,
    cookieValue: encodePending(pending),
  };
};

export const readGoogleOAuthPending = (cookieValue: string | undefined): GoogleOAuthPending | null => {
  if (!cookieValue) {
    return null;
  }

  try {
    const [payload, receivedSignature, ...unexpectedParts] = cookieValue.split(".");

    if (!payload || !receivedSignature || unexpectedParts.length > 0) {
      return null;
    }

    const expectedSignature = createPendingCookieSignature(payload);

    if (!hasSameValue(expectedSignature, receivedSignature)) {
      return null;
    }

    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<
      GoogleOAuthPending
    >;

    const issuedAt = parsed.issuedAt;
    const now = Date.now();
    const isExpired =
      typeof issuedAt !== "number" ||
      issuedAt > now + 60_000 ||
      now - issuedAt > OAUTH_MAX_AGE_SECONDS * 1_000;

    if (
      typeof parsed.state !== "string" ||
      typeof parsed.codeVerifier !== "string" ||
      typeof parsed.nonce !== "string" ||
      isExpired ||
      !parsed.state ||
      !parsed.codeVerifier ||
      !parsed.nonce ||
      parsed.state.length < 32 ||
      parsed.codeVerifier.length < 43 ||
      parsed.nonce.length < 32
    ) {
      return null;
    }

    return {
      state: parsed.state,
      codeVerifier: parsed.codeVerifier,
      nonce: parsed.nonce,
      issuedAt,
    };
  } catch {
    return null;
  }
};

const hasSameValue = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const isGoogleOAuthStateValid = (
  pending: GoogleOAuthPending | null,
  receivedState: string | null
) => Boolean(pending && receivedState && hasSameValue(pending.state, receivedState));

export const getGoogleAuthorizationUrl = (pending: GoogleOAuthPending) => {
  const { clientId } = getGoogleConfig();
  const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_URL);
  const codeChallenge = createHash("sha256").update(pending.codeVerifier).digest("base64url");

  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", getGoogleOAuthRedirectUri());
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", pending.state);
  authorizationUrl.searchParams.set("nonce", pending.nonce);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  authorizationUrl.searchParams.set("prompt", "select_account");

  return authorizationUrl;
};

const decodeJsonSegment = <T>(segment: string) => {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
  } catch {
    throw new GoogleOAuthError();
  }
};

const getGoogleJwks = async () => {
  if (jwksCache && jwksCache.expiresAt > Date.now()) {
    return jwksCache.keys;
  }

  let response: Response;

  try {
    response = await fetch(GOOGLE_JWKS_URL, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new GoogleOAuthError();
  }

  const payload = (await response.json().catch(() => null)) as { keys?: GoogleJwk[] } | null;

  if (!response.ok || !payload?.keys?.length) {
    throw new GoogleOAuthError();
  }

  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAgeSeconds = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 3_600);
  jwksCache = {
    keys: payload.keys,
    expiresAt: Date.now() + Math.max(60, Math.min(maxAgeSeconds, 86_400)) * 1_000,
  };

  return jwksCache.keys;
};

const verifyGoogleIdToken = async ({
  idToken,
  nonce,
  clientId,
}: {
  idToken: string;
  nonce: string;
  clientId: string;
}): Promise<GoogleIdentity> => {
  const parts = idToken.split(".");

  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new GoogleOAuthError();
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = decodeJsonSegment<GoogleTokenHeader>(headerPart);

  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new GoogleOAuthError();
  }

  const jwks = await getGoogleJwks();
  const key = jwks.find(
    (candidate) =>
      candidate.kid === header.kid &&
      candidate.kty === "RSA" &&
      candidate.use === "sig" &&
      candidate.alg === "RS256"
  );

  if (!key) {
    // A rotated Google signing key can appear before the cache expires.
    jwksCache = null;
    const refreshedKeys = await getGoogleJwks();
    const refreshedKey = refreshedKeys.find(
      (candidate) =>
        candidate.kid === header.kid &&
        candidate.kty === "RSA" &&
        candidate.use === "sig" &&
        candidate.alg === "RS256"
    );

    if (!refreshedKey) {
      throw new GoogleOAuthError();
    }

    return verifyGoogleIdTokenWithKey({
      headerPart,
      payloadPart,
      signaturePart,
      key: refreshedKey,
      nonce,
      clientId,
    });
  }

  return verifyGoogleIdTokenWithKey({
    headerPart,
    payloadPart,
    signaturePart,
    key,
    nonce,
    clientId,
  });
};

const verifyGoogleIdTokenWithKey = ({
  headerPart,
  payloadPart,
  signaturePart,
  key,
  nonce,
  clientId,
}: {
  headerPart: string;
  payloadPart: string;
  signaturePart: string;
  key: GoogleJwk;
  nonce: string;
  clientId: string;
}): GoogleIdentity => {
  let signatureIsValid = false;

  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerPart}.${payloadPart}`);
    verifier.end();
    signatureIsValid = verifier.verify(
      createPublicKey({ key, format: "jwk" }),
      Buffer.from(signaturePart, "base64url")
    );
  } catch {
    throw new GoogleOAuthError();
  }

  if (!signatureIsValid) {
    throw new GoogleOAuthError();
  }

  const claims = decodeJsonSegment<GoogleTokenClaims>(payloadPart);
  const audience = claims.aud;
  const hasExpectedAudience =
    audience === clientId || (Array.isArray(audience) && audience.includes(clientId));
  const issuedAt = typeof claims.iat === "number" ? claims.iat : null;
  const expiresAt = typeof claims.exp === "number" ? claims.exp : null;
  const nowSeconds = Math.floor(Date.now() / 1_000);

  if (
    typeof claims.iss !== "string" ||
    !GOOGLE_ISSUERS.has(claims.iss) ||
    !hasExpectedAudience ||
    (Array.isArray(audience) && claims.azp !== clientId) ||
    (typeof claims.azp === "string" && claims.azp !== clientId) ||
    !expiresAt ||
    expiresAt <= nowSeconds - 60 ||
    (issuedAt !== null && issuedAt > nowSeconds + 300) ||
    typeof claims.nonce !== "string" ||
    !hasSameValue(claims.nonce, nonce) ||
    typeof claims.sub !== "string" ||
    !claims.sub ||
    typeof claims.email !== "string" ||
    !claims.email ||
    claims.email_verified !== true
  ) {
    throw new GoogleOAuthError();
  }

  const displayName =
    typeof claims.name === "string"
      ? claims.name
      : [claims.given_name, claims.family_name]
          .filter((part): part is string => typeof part === "string")
          .join(" ") || null;

  return {
    providerAccountId: claims.sub,
    email: claims.email,
    displayName,
    emailVerified: true,
  };
};

export const exchangeGoogleOAuthCode = async ({
  code,
  pending,
}: {
  code: string;
  pending: GoogleOAuthPending;
}) => {
  const { clientId, clientSecret } = getGoogleConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    code_verifier: pending.codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: getGoogleOAuthRedirectUri(),
  });

  let response: Response;

  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GoogleOAuthError();
  }

  const payload = (await response.json().catch(() => null)) as { id_token?: unknown } | null;

  if (!response.ok || !payload || typeof payload.id_token !== "string") {
    throw new GoogleOAuthError();
  }

  return verifyGoogleIdToken({
    idToken: payload.id_token,
    nonce: pending.nonce,
    clientId,
  });
};

export const getGoogleOAuthCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth/oauth/google",
  maxAge: OAUTH_MAX_AGE_SECONDS,
});

export const getExpiredGoogleOAuthCookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/api/auth/oauth/google",
  expires: new Date(0),
});

export const getOAuthApplicationUrl = (pathname: string) => new URL(pathname, getApplicationBaseUrl());

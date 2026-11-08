import assert from "node:assert/strict";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  createGoogleOAuthPending,
  exchangeGoogleOAuthCode,
  getGoogleAuthorizationUrl,
  getGoogleOAuthConfigurationPresence,
  getGoogleOAuthRedirectUri,
  GoogleOAuthConfigurationError,
  isRecentGoogleAuthentication,
  isGoogleOAuthStateValid,
  GoogleOAuthError,
  readGoogleOAuthPending,
} from "../src/lib/server/oauth.ts";

const originalClientId = process.env.GOOGLE_CLIENT_ID;
const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const originalNodeEnv = process.env.NODE_ENV;

const restoreEnvironment = () => {
  if (originalClientId === undefined) {
    delete process.env.GOOGLE_CLIENT_ID;
  } else {
    process.env.GOOGLE_CLIENT_ID = originalClientId;
  }

  if (originalClientSecret === undefined) {
    delete process.env.GOOGLE_CLIENT_SECRET;
  } else {
    process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
  }

  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
};

test.after(restoreEnvironment);

test("fails safely when Google OAuth is not configured", () => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;

  assert.deepEqual(getGoogleOAuthConfigurationPresence(), {
    googleClientIdPresent: false,
    googleClientSecretPresent: false,
  });
  assert.throws(() => createGoogleOAuthPending(), GoogleOAuthConfigurationError);
});

test("creates a signed OAuth context and the standard Google OIDC request", () => {
  process.env.NODE_ENV = "development";
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";

  assert.deepEqual(getGoogleOAuthConfigurationPresence(), {
    googleClientIdPresent: true,
    googleClientSecretPresent: true,
  });

  const { pending, cookieValue } = createGoogleOAuthPending();
  const authorizationUrl = getGoogleAuthorizationUrl(pending);

  assert.deepEqual(readGoogleOAuthPending(cookieValue), pending);
  assert.equal(authorizationUrl.origin, "https://accounts.google.com");
  assert.equal(authorizationUrl.pathname, "/o/oauth2/v2/auth");
  assert.equal(authorizationUrl.searchParams.get("client_id"), "google-client-id");
  assert.equal(
    authorizationUrl.searchParams.get("redirect_uri"),
    "http://localhost:3000/api/auth/oauth/google/callback"
  );
  assert.equal(authorizationUrl.searchParams.get("scope"), "openid email profile");
  assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));
  assert.equal(authorizationUrl.searchParams.get("state"), pending.state);
  assert.equal(authorizationUrl.searchParams.get("nonce"), pending.nonce);
  assert.equal(authorizationUrl.searchParams.has("claims"), false);
  assert.ok(isGoogleOAuthStateValid(pending, pending.state));
  assert.equal(isGoogleOAuthStateValid(pending, "other-state"), false);
});

test("Google deletion step-up requests and requires a fresh auth_time claim", () => {
  process.env.NODE_ENV = "development";
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  const { pending } = createGoogleOAuthPending({ purpose: "account-deletion", userId: "user-1" });
  const authorizationUrl = getGoogleAuthorizationUrl(pending);
  assert.deepEqual(JSON.parse(authorizationUrl.searchParams.get("claims")), {
    id_token: { auth_time: { essential: true } },
  });

  const now = Math.floor(Date.now() / 1000);
  const initiatedAt = now * 1000;
  assert.equal(isRecentGoogleAuthentication(now, initiatedAt, now), true);
  assert.equal(isRecentGoogleAuthentication(now - 301, initiatedAt, now), false);
  assert.equal(isRecentGoogleAuthentication(now - 600, initiatedAt, now), false);
  assert.equal(isRecentGoogleAuthentication(undefined, initiatedAt, now), false);
  assert.equal(isRecentGoogleAuthentication("recent", initiatedAt, now), false);
  assert.equal(isRecentGoogleAuthentication(now + 60, initiatedAt, now), false);
});

test("verified Google ID tokens accept fresh deletion auth_time and reject stale or absent claims", async () => {
  process.env.NODE_ENV = "development";
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "privacy-step-up-fixture", use: "sig", alg: "RS256" };
  const now = Math.floor(Date.now() / 1000);
  const { pending } = createGoogleOAuthPending({ purpose: "account-deletion", userId: "user-step-up" });
  const originalFetch = globalThis.fetch;
  let tokenClaims = {};
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("oauth2/v3/certs")) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { "cache-control": "max-age=300" } });
    }
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: jwk.kid })).toString("base64url");
    const claims = Buffer.from(JSON.stringify({
      iss: "https://accounts.google.com", aud: "google-client-id", exp: now + 300,
      iat: now, nonce: pending.nonce, sub: "google-subject", email: "owner@example.invalid",
      email_verified: true, ...tokenClaims,
    })).toString("base64url");
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    signer.end();
    const idToken = `${header}.${claims}.${signer.sign(privateKey).toString("base64url")}`;
    return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
  };

  try {
    tokenClaims = { auth_time: now };
    const freshIdentity = await exchangeGoogleOAuthCode({ code: "test-code", pending });
    assert.equal(freshIdentity.providerAccountId, "google-subject");
    tokenClaims = { auth_time: now - 301 };
    await assert.rejects(exchangeGoogleOAuthCode({ code: "test-code", pending }), GoogleOAuthError);
    tokenClaims = {};
    await assert.rejects(exchangeGoogleOAuthCode({ code: "test-code", pending }), GoogleOAuthError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects a changed or expired OAuth context", () => {
  process.env.NODE_ENV = "development";
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";

  const { cookieValue } = createGoogleOAuthPending();
  const [payload, signature] = cookieValue.split(".");
  const changedPayload = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}`;

  assert.equal(readGoogleOAuthPending(`${changedPayload}.${signature}`), null);

  const expiredPayload = Buffer.from(
    JSON.stringify({
      state: "a".repeat(64),
      codeVerifier: "b".repeat(64),
      nonce: "c".repeat(64),
      issuedAt: Date.now() - 11 * 60 * 1_000,
    })
  ).toString("base64url");
  const expiredSignature = createHmac("sha256", "google-client-secret")
    .update(`mexo:google-oauth:${expiredPayload}`)
    .digest("base64url");

  assert.equal(readGoogleOAuthPending(`${expiredPayload}.${expiredSignature}`), null);
});

test("uses the exact production callback URL", () => {
  process.env.NODE_ENV = "production";

  assert.equal(
    getGoogleOAuthRedirectUri(),
    "https://mexo.com.pl/api/auth/oauth/google/callback"
  );
});

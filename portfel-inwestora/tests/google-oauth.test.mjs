import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createGoogleOAuthPending,
  getGoogleAuthorizationUrl,
  getGoogleOAuthRedirectUri,
  GoogleOAuthConfigurationError,
  isGoogleOAuthStateValid,
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

  assert.throws(() => createGoogleOAuthPending(), GoogleOAuthConfigurationError);
});

test("creates a signed OAuth context and the standard Google OIDC request", () => {
  process.env.NODE_ENV = "development";
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";

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
  assert.ok(isGoogleOAuthStateValid(pending, pending.state));
  assert.equal(isGoogleOAuthStateValid(pending, "other-state"), false);
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

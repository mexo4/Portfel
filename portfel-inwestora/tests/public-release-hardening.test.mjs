import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PLAN_DEFINITIONS, canAccessFeature, canAddAsset, canCreatePortfolio, resolveEffectiveEntitlements, isSubscriptionPlan } from "../src/lib/entitlements.ts";
import { classifyFxRateQuality, getVerifiedHistoricalFxRate, MAX_HISTORICAL_FX_CARRY_DAYS, shouldTrustHistoricalFxRate } from "../src/lib/fx-quality.ts";
import { createRateLimitBucketHash, AUTH_RATE_LIMIT_POLICIES, resolveTrustedClientAddress } from "../src/lib/server/auth-rate-limit.ts";
import { hasAdminRole } from "../src/lib/server/access.ts";
import { getSecurityHeaders } from "../src/lib/security-headers.ts";

const user = (overrides = {}) => ({
  subscriptionPlan: "free",
  subscriptionStatus: "active",
  subscriptionExpiresAt: null,
  role: "user",
  testerAccess: false,
  espiAccess: false,
  ...overrides,
});

test("five distinct plans have configured prices and undecided product entitlements remain pending", () => {
  assert.deepEqual(Object.keys(PLAN_DEFINITIONS), ["free", "basic", "standard", "pro", "expert"]);
  assert.deepEqual(Object.values(PLAN_DEFINITIONS).map((plan) => plan.pricePln), [0, 3.99, 6.99, 11.99, 14.99]);
  assert.equal(PLAN_DEFINITIONS.free.limits.portfolios.value, 1);
  assert.equal(PLAN_DEFINITIONS.free.limits.assetsPerPortfolio.value, 99);
  for (const id of ["basic", "standard", "expert"]) {
    assert.equal(PLAN_DEFINITIONS[id].limits.portfolios.status, "pending");
    assert.equal(PLAN_DEFINITIONS[id].features.advancedAnalytics, "pending");
    assert.equal(PLAN_DEFINITIONS[id].selfServicePurchase, false);
  }
  for (const id of ["basic", "standard", "pro", "expert"]) {
    assert.equal(PLAN_DEFINITIONS[id].features.benchmarks, "pending");
  }
  assert.equal(isSubscriptionPlan("expert"), true);
  assert.equal(isSubscriptionPlan("enterprise"), false);
});

test("expiry falls back to Free without changing the assigned plan or deleting data", () => {
  const resolved = resolveEffectiveEntitlements(user({
    subscriptionPlan: "standard", subscriptionStatus: "active", subscriptionExpiresAt: "2026-10-01T00:00:00.000Z",
  }), Date.parse("2026-11-08T00:00:00.000Z"));
  assert.equal(resolved.assignedPlan, "standard");
  assert.equal(resolved.effectivePlan, "free");
  assert.equal(resolved.isExpired, true);
  assert.equal(resolved.limits.portfolios, 1);
  assert.equal(canCreatePortfolio(user(), 1), false);
  assert.equal(canAddAsset(user(), 99), false);
});

test("legacy Pro access survives old records without activation/expiry timestamps", () => {
  const resolved = resolveEffectiveEntitlements(user({ subscriptionPlan: "pro", subscriptionStatus: "active" }));
  assert.equal(resolved.effectivePlan, "pro");
  assert.equal(resolved.limits.portfolios, null);
  assert.equal(resolved.limits.assetsPerPortfolio, null);
  assert.equal(canAccessFeature(user({ subscriptionPlan: "pro", subscriptionStatus: "active" }), "benchmarks"), false);
});

test("role, Tester, ESPI entitlement, and paid plan are separate controls", () => {
  assert.equal(hasAdminRole(user({ role: "admin" })), true);
  assert.equal(hasAdminRole(user({ subscriptionPlan: "expert" })), false);
  assert.equal(hasAdminRole(user({ testerAccess: true })), false);
  assert.equal(canAccessFeature(user({ role: "admin" }), "advancedAnalytics"), false);
  assert.equal(canAccessFeature(user({ subscriptionPlan: "expert", subscriptionStatus: "active", subscriptionExpiresAt: "2027-01-01T00:00:00.000Z" }), "advancedAnalytics"), false);
  assert.equal(canAccessFeature(user({ espiAccess: true }), "espi"), true);
  assert.equal(canAccessFeature(user({ testerAccess: true }), "espi"), false);
  assert.equal(canAccessFeature(user(), "espi"), false);
  assert.equal(canCreatePortfolio(user({ testerAccess: true }), 20), true);
});

test("auth limiter uses trusted proxy identity, HMAC buckets, and multi-instance SQL-backed policies", async () => {
  assert.equal(AUTH_RATE_LIMIT_POLICIES.register.limit, 5);
  assert.equal(AUTH_RATE_LIMIT_POLICIES.login.limit, 10);
  assert.equal(AUTH_RATE_LIMIT_POLICIES.login.identityLimit, 30);
  const headers = new Headers({ "x-real-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.22" });
  assert.equal(resolveTrustedClientAddress(headers, true), "203.0.113.10");
  assert.equal(resolveTrustedClientAddress(new Headers({ "x-forwarded-for": "198.51.100.22" }), true), null);
  assert.equal(resolveTrustedClientAddress(new Headers(), false), "127.0.0.1");
  const a = createRateLimitBucketHash("secret", "login", "203.0.113.10");
  assert.equal(a, createRateLimitBucketHash("secret", "login", "203.0.113.10"));
  assert.notEqual(a, createRateLimitBucketHash("other-secret", "login", "203.0.113.10"));
  const [limiter, db, routes] = await Promise.all([
    readFile(new URL("../src/lib/server/auth-rate-limit.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/server/db.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/auth/login/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(limiter, /ON CONFLICT \(bucket_hash, window_started_at\)/);
  assert.match(limiter, /createRateLimitBucketHash\(secret, `\$\{scope\}:identity`, identityPart\)/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS auth_rate_limit_buckets/);
  assert.match(routes, /applyAuthRateLimit\(request, "login"/);
  assert.match(routes, /Niepoprawny email lub hasło/);
  assert.doesNotMatch(routes, /requiresVerification: true|verificationSent:/);
});

test("production headers add Report-Only CSP and safe hardening without HSTS subdomain preload", () => {
  const production = new Map(getSecurityHeaders(true).map(({ key, value }) => [key.toLowerCase(), value]));
  const development = new Map(getSecurityHeaders(false).map(({ key, value }) => [key.toLowerCase(), value]));
  assert.ok(production.has("content-security-policy-report-only"));
  assert.equal(production.get("x-content-type-options"), "nosniff");
  assert.equal(production.get("x-frame-options"), "DENY");
  assert.equal(production.get("strict-transport-security"), "max-age=31536000");
  assert.equal(development.has("strict-transport-security"), false);
  assert.doesNotMatch(production.get("strict-transport-security"), /includeSubDomains|preload/i);
});

test("FX statuses distinguish same-day, carried, stale, fallback, and unavailable values", () => {
  assert.equal(MAX_HISTORICAL_FX_CARRY_DAYS, 7);
  assert.equal(classifyFxRateQuality({ rate: 4.1, asOf: "2026-11-08", targetDate: "2026-11-08", source: "eodhd" }), "confirmed");
  assert.equal(classifyFxRateQuality({ rate: 4.1, asOf: "2026-11-06", targetDate: "2026-11-08", source: "nbp" }), "historically-carried");
  assert.equal(classifyFxRateQuality({ rate: 4.1, asOf: "2026-10-20", targetDate: "2026-11-08", source: "nbp" }), "stale");
  assert.equal(classifyFxRateQuality({ rate: 4.1, asOf: "2026-11-09", targetDate: "2026-11-08", source: "nbp" }), "stale");
  assert.equal(classifyFxRateQuality({ rate: 4.1, source: "fallback" }), "fallback");
  assert.equal(classifyFxRateQuality({ source: "fallback" }), "unavailable");
  assert.equal(classifyFxRateQuality({ targetDate: "2026-11-08" }), "unavailable");
  assert.equal(shouldTrustHistoricalFxRate(4.1, "2026-11-01", "2026-11-08"), true);
  assert.equal(shouldTrustHistoricalFxRate(4.1, "2026-10-31", "2026-11-08"), false);
  assert.equal(shouldTrustHistoricalFxRate(4.1, "2026-11-09", "2026-11-08"), false);
});

test("manual historical operations accept only verified dated FX, never current or static fallback rates", () => {
  const rate = 4.12;
  assert.equal(getVerifiedHistoricalFxRate("PLN", { rates: { PLN: 1 } }), 1);
  assert.equal(getVerifiedHistoricalFxRate("USD", {
    rates: { USD: rate }, quality: { USD: { status: "confirmed", source: "nbp" } },
  }), rate);
  assert.equal(getVerifiedHistoricalFxRate("EUR", {
    rates: { EUR: rate }, quality: { EUR: { status: "historically-carried", source: "nbp" } },
  }), rate);
  for (const status of ["stale", "fallback", "unavailable"]) {
    assert.equal(getVerifiedHistoricalFxRate("GBP", {
      rates: { GBP: rate }, quality: { GBP: { status, source: status === "fallback" ? "fallback" : "nbp" } },
    }), undefined);
  }
  assert.equal(getVerifiedHistoricalFxRate("USD", { rates: { USD: rate } }), undefined);
});

test("manual asset entry and sales request historical-only FX before persisting snapshots", async () => {
  const source = await readFile(new URL("../src/components/PortfolioApp.tsx", import.meta.url), "utf8");
  assert.match(source, /fetchFxRates\(normalizedCodes, date, true\)/);
  assert.match(source, /getVerifiedHistoricalFxRate\(purchasePriceCurrency, purchaseFxRates\)/);
  assert.match(source, /getVerifiedHistoricalFxRate\(purchaseCurrency, purchaseFxRates\)/);
  assert.match(source, /fetchFxRates\(historicalFxCodes, saleDate, true\)/);
  assert.match(source, /missingHistoricalFx/);
});

test("paid plans cannot be self-activated and migrations are idempotent DDL only", async () => {
  const [route, auth, db] = await Promise.all([
    readFile(new URL("../src/app/api/subscription/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/server/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/server/db.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /Samodzielny zakup planów płatnych nie jest jeszcze dostępny/);
  assert.match(auth, /if \(plan !== "free"\) throw new Error/);
  assert.match(auth, /30 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(db, /ADD COLUMN IF NOT EXISTS subscription_expires_at/);
  assert.match(db, /ADD COLUMN IF NOT EXISTS user_role/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// getCurrentAccountData parses the whole portfolio, merges quote snapshots and
// enriches issuer countries on every call. Endpoints that never look at the
// portfolio were paying for that (about 550 ms against about 90 ms for the
// routes that only validate the session), so they must keep using the light
// reads. There is no database in this suite, hence the source pins.

test("profile and subscription read the user without loading the portfolio", () => {
  const profile = read("src/app/api/profile/route.ts");
  const subscription = read("src/app/api/subscription/route.ts");

  assert.match(profile, /getCurrentAccountIdentity/);
  assert.doesNotMatch(profile, /getCurrentAccountData/);
  assert.match(subscription, /getCurrentAuthenticatedUser/);
  assert.doesNotMatch(subscription, /getCurrentAccountData/);
});

test("password change and e-mail verification only need the authenticated user", () => {
  for (const route of ["change-password", "request-verification"]) {
    const source = read(`src/app/api/auth/${route}/route.ts`);

    assert.match(source, /getCurrentAuthenticatedUser/, route);
    assert.doesNotMatch(source, /getCurrentAccountData/, route);
  }
});

test("the identity read never asks for the portfolio column", () => {
  const auth = read("src/lib/server/auth.ts");
  const identity = auth.match(/export const getCurrentAccountIdentity = async \(\) => \{[\s\S]*?\n\};/);

  assert.ok(identity, "getCurrentAccountIdentity exists");
  assert.match(identity[0], /getCurrentSessionUser\(\)/);
  assert.doesNotMatch(identity[0], /getCurrentSessionUser\(true\)/);
  assert.doesNotMatch(identity[0], /parsePortfolioBook|enrichPortfolioBookIssuerCountries/);
});

test("dashboard layout authorises a scope from portfolio ids only", () => {
  const route = read("src/app/api/dashboard-layout/route.ts");

  assert.match(route, /enrichIssuerCountries:\s*false/);
  assert.equal(
    (route.match(/getCurrentAccountData\(ONLY_PORTFOLIO_IDS\)/g) ?? []).length,
    2,
    "both GET and PUT use the cheap variant"
  );
});

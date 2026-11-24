import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getPublicOrigin } from "../src/lib/server/public-origin.ts";

const originalOrigin = process.env.MEXO_PUBLIC_ORIGIN;
const originalNodeEnv = process.env.NODE_ENV;

const restoreEnvironment = () => {
  if (originalOrigin === undefined) delete process.env.MEXO_PUBLIC_ORIGIN;
  else process.env.MEXO_PUBLIC_ORIGIN = originalOrigin;

  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
};

const forged = (origin) =>
  new Request("http://127.0.0.1:3000/api/auth/request-password-reset", {
    method: "POST",
    headers: origin ? { origin } : {},
  });

test("a forged Origin header never decides the link domain in production", () => {
  delete process.env.MEXO_PUBLIC_ORIGIN;
  process.env.NODE_ENV = "production";

  try {
    assert.equal(getPublicOrigin(forged("https://evil.example")), "https://mexo.com.pl");
    assert.equal(getPublicOrigin(forged(null)), "https://mexo.com.pl");
  } finally {
    restoreEnvironment();
  }
});

test("MEXO_PUBLIC_ORIGIN wins and is normalised to an origin", () => {
  process.env.NODE_ENV = "production";
  process.env.MEXO_PUBLIC_ORIGIN = "https://staging.mexo.example/some/path?x=1";

  try {
    assert.equal(getPublicOrigin(forged("https://evil.example")), "https://staging.mexo.example");
  } finally {
    restoreEnvironment();
  }
});

test("an unusable MEXO_PUBLIC_ORIGIN falls back to the production domain, not to the request", () => {
  process.env.NODE_ENV = "production";
  process.env.MEXO_PUBLIC_ORIGIN = "not a url";

  try {
    assert.equal(getPublicOrigin(forged("https://evil.example")), "https://mexo.com.pl");
  } finally {
    restoreEnvironment();
  }
});

test("outside production the request origin keeps local development working, still ignoring Origin", () => {
  delete process.env.MEXO_PUBLIC_ORIGIN;
  process.env.NODE_ENV = "development";

  try {
    assert.equal(getPublicOrigin(forged("https://evil.example")), "http://127.0.0.1:3000");
  } finally {
    restoreEnvironment();
  }
});

test("none of the e-mail link routes reads the Origin header any more", () => {
  for (const route of [
    "login",
    "register",
    "request-password-reset",
    "request-verification",
  ]) {
    const source = readFileSync(
      new URL(`../src/app/api/auth/${route}/route.ts`, import.meta.url),
      "utf8"
    );

    assert.doesNotMatch(source, /headers\.get\(["']origin["']\)/i, `${route} still trusts Origin`);
    assert.match(source, /getPublicOrigin\(request\)/, `${route} must use getPublicOrigin`);
  }
});

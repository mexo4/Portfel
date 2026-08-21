import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const portfolioAppSource = fs.readFileSync(
  new URL("../src/components/PortfolioApp.tsx", import.meta.url),
  "utf8"
);
const addAssetFormSource = fs.readFileSync(
  new URL("../src/components/AddAssetForm.tsx", import.meta.url),
  "utf8"
);
const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

test("the common PLN add path does not wait for an unnecessary historical FX request", () => {
  assert.match(
    portfolioAppSource,
    /if \(normalizedCodes\.every\(\(code\) => code === "PLN"\)\) \{[\s\S]*?PLN: 1/
  );
  assert.match(
    portfolioAppSource,
    /const \[quote, prefetchedFxRates\] = await Promise\.all\(\[/
  );
});

test("asset submission has a synchronous single-flight guard and immediate accessible feedback", () => {
  const guardIndex = portfolioAppSource.indexOf("if (assetAddInFlightRef.current)");
  const claimIndex = portfolioAppSource.indexOf("assetAddInFlightRef.current = true", guardIndex);
  const releaseIndex = portfolioAppSource.indexOf("assetAddInFlightRef.current = false", claimIndex);

  assert.ok(guardIndex >= 0);
  assert.ok(claimIndex > guardIndex);
  assert.ok(releaseIndex > claimIndex);
  assert.match(addAssetFormSource, /disabled=\{isQuoteLoading \|\| isBuyPending\}/);
  assert.match(addAssetFormSource, /aria-busy=\{isBuyPending\}/);
  assert.match(addAssetFormSource, /Dodaję pozycję do portfela…/);
});

test("local scripts use the system trust store, bind to IPv4 and retain stable webpack", () => {
  assert.equal(
    packageJson.scripts.dev,
    "node --use-system-ca ./node_modules/next/dist/bin/next dev --webpack --hostname 127.0.0.1"
  );
  assert.equal(
    packageJson.scripts.start,
    "node --use-system-ca ./node_modules/next/dist/bin/next start --hostname 127.0.0.1"
  );
});

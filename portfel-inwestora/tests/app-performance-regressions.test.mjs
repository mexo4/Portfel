import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getUserProfilePersistenceFingerprint } from "../src/lib/profile.ts";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("profile persistence fingerprint ignores timestamp-only changes but tracks edits", () => {
  const profile = {
    displayName: "Tester",
    email: "tester@example.test",
    country: "Polska",
    preferredBroker: "XTB",
    experienceLevel: "beginner",
    monthlyContributionPln: 500,
    investmentGoal: "Oszczędzanie",
    wealthItems: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  assert.equal(
    getUserProfilePersistenceFingerprint(profile),
    getUserProfilePersistenceFingerprint({ ...profile, updatedAt: "2026-02-01T00:00:00.000Z" })
  );
  assert.notEqual(
    getUserProfilePersistenceFingerprint(profile),
    getUserProfilePersistenceFingerprint({ ...profile, country: "Niemcy" })
  );
});

test("always-mounted workspace navigation opts out of eager route prefetch", async () => {
  const shell = await readSource("src/components/AppWorkspaceShell.tsx");
  assert.match(shell, /function NavigationLink[\s\S]*?prefetch=\{false\}/);
  assert.match(shell, /workspace-section-tabs[\s\S]*?prefetch=\{false\}/);
});

test("dashboard widget and ESPI links do not eagerly prefetch unseen destinations", async () => {
  const dashboard = await readSource("src/components/ConfigurableDashboard.tsx");
  assert.match(dashboard, /<Link href=\{href\} prefetch=\{false\}>Zobacz<\/Link>/);
  assert.match(dashboard, /getReadHref\(`\/market\/espi\/\$\{report\.id\}`\)\} prefetch=\{false\}/);
});

test("a price update does not restart the quote refresh (no back-to-back full quote passes)", async () => {
  const app = await readSource("src/components/PortfolioApp.tsx");
  const syncQuotes = app.match(/const syncQuotes = useCallback\(async \([\s\S]*?\n  \}, \[([^\]]*)\]\);/);

  assert.ok(syncQuotes, "syncQuotes useCallback not found");
  // `selectedPortfolioIds` is a new array after every `portfolios` change, i.e.
  // after every applied quote. As a dependency it re-created `syncQuotes`,
  // re-ran the refresh effect and started another full pass of provider calls
  // right after each pass that changed a price.
  assert.doesNotMatch(syncQuotes[1], /selectedPortfolioIds/);
  assert.match(syncQuotes[0], /new Set\(selectedPortfolioIdsRef\.current\)/);
  assert.doesNotMatch(syncQuotes[0], /new Set\(selectedPortfolioIds\)/);

  // A changed selection must still refresh, through its string key.
  assert.match(app, /\}, \[activePortfolioId, assets\.length, operationScopeKey, syncQuotes\]\);/);
});

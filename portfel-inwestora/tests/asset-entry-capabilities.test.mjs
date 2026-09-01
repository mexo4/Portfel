import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CRYPTO_UI_ENABLED,
  VISIBLE_ASSET_ENTRY_MODE_OPTIONS,
  VISIBLE_SEARCH_MODE_OPTIONS,
  isAssetEntryModeEnabled,
} from "../src/lib/constants.ts";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("temporary crypto capability hides new entry options without removing the underlying type", () => {
  assert.equal(CRYPTO_UI_ENABLED, false);
  assert.equal(isAssetEntryModeEnabled("crypto"), false);
  assert.equal(VISIBLE_SEARCH_MODE_OPTIONS.some((option) => option.kind === "crypto"), false);
  assert.equal(VISIBLE_ASSET_ENTRY_MODE_OPTIONS.some((option) => option.value === "crypto"), false);
});

test("crypto import rows and crypto-only exchanges are gated in UI while historical holdings stay outside this filter", async () => {
  const importPanel = await readSource("src/components/BrokerImportPanel.tsx");
  const platformPicker = await readSource("src/components/ImportPlatformPicker.tsx");
  const portfolioApp = await readSource("src/components/PortfolioApp.tsx");
  const lineCharts = await readSource("src/components/PortfolioLineCharts.tsx");

  assert.match(importPanel, /operation\.kind !== "crypto"/);
  assert.match(platformPicker, /CRYPTO_IMPORT_PLATFORM_IDS/);
  assert.match(platformPicker, /section\.id !== "crypto"/);
  assert.match(portfolioApp, /draft\.kind === "crypto"/);
  assert.match(portfolioApp, /operations\.some\(\(operation\) => operation\.kind === "crypto"\)/);
  assert.match(lineCharts, /VISIBLE_SEARCH_MODE_OPTIONS/);
  assert.match(lineCharts, /!benchmarkSearchKind/);
  assert.match(lineCharts, /VISIBLE_SEARCH_MODE_OPTIONS\.map\(\(option\) =>/);
  assert.doesNotMatch(lineCharts, /\bSEARCH_MODE_OPTIONS\b/);
});

test("current-position primary values reuse the natural proportional figures from dividend summaries", async () => {
  const styles = await readSource("src/app/globals.css");
  const selector = styles.match(
    /\.portfolio-positions-table \.portfolio-number,[\s\S]*?\.workspace-position-card \.portfolio-number \{([\s\S]*?)\n\}/
  );

  assert.ok(selector);
  assert.match(selector[1], /font-family:\s*inherit/);
  assert.match(selector[1], /font-variant-numeric:\s*normal/);
  assert.match(selector[1], /letter-spacing: normal/);
  assert.match(selector[1], /word-spacing: normal/);
});

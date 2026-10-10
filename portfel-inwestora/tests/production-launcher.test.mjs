import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveBuildRuntimeOverrides } from "../scripts/start-production.mjs";

test("production launcher selects the exact managed release path and revision", () => {
  const appDir = mkdtempSync(path.join(os.tmpdir(), "mexo-launcher-"));
  const revision = "a".repeat(40);
  const target = `.mexo-releases/${revision}-20261010T120000Z-42`;
  const releaseDir = path.join(appDir, target);
  mkdirSync(releaseDir, { recursive: true });
  writeFileSync(path.join(releaseDir, "BUILD_ID"), "build-id");

  try {
    assert.deepEqual(resolveBuildRuntimeOverrides(appDir, target), {
      MEXO_BUILD_DIST_DIR: target,
      MEXO_BUILD_REVISION: revision,
    });
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test("production launcher leaves a legacy physical .next build on the default distDir", () => {
  const appDir = mkdtempSync(path.join(os.tmpdir(), "mexo-launcher-"));
  mkdirSync(path.join(appDir, ".next"));
  writeFileSync(path.join(appDir, ".next", "BUILD_ID"), "legacy-build");

  try {
    assert.deepEqual(resolveBuildRuntimeOverrides(appDir, null), {});
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

test("production launcher refuses an unmanaged or path-traversing build target", () => {
  const appDir = mkdtempSync(path.join(os.tmpdir(), "mexo-launcher-"));
  try {
    assert.throws(() => resolveBuildRuntimeOverrides(appDir, "../outside"), /outside a managed Mexo release/);
    assert.throws(() => resolveBuildRuntimeOverrides(appDir, ".mexo-releases/../outside"), /outside a managed Mexo release/);
  } finally {
    rmSync(appDir, { recursive: true, force: true });
  }
});

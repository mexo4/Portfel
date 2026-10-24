import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCalendarSyncRuntime } from "../scripts/run-gpw-calendar-sync-release.mjs";

const revision = "a".repeat(40);
const suffix = "20261024T120000Z-42";
const releaseTarget = `.mexo-releases/${revision}-${suffix}/source/portfel-inwestora/.next`;

async function makeRelease(t, target = releaseTarget) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mexo-gpw-sync-launcher-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const releaseApp = path.resolve(root, target, "..");
  await mkdir(path.join(releaseApp, "scripts"), { recursive: true });
  await mkdir(path.join(root, target), { recursive: true });
  await writeFile(path.join(root, target, "BUILD_ID"), "test-build\n");
  await writeFile(path.join(releaseApp, "scripts", "run-gpw-calendar-sync.mjs"), "");
  await writeFile(path.join(releaseApp, "scripts", "register-alias-loader.mjs"), "");
  return root;
}

test("calendar sync resolves the active isolated release and its own scripts", async (t) => {
  const root = await makeRelease(t);
  const runtime = resolveCalendarSyncRuntime(root, releaseTarget, true);

  assert.equal(runtime.cwd, path.resolve(root, releaseTarget, ".."));
  assert.equal(runtime.entrypoint, path.join(runtime.cwd, "scripts", "run-gpw-calendar-sync.mjs"));
  assert.equal(runtime.aliasLoader, path.join(runtime.cwd, "scripts", "register-alias-loader.mjs"));
  assert.equal(runtime.env.MEXO_BUILD_REVISION, revision);
  assert.equal(runtime.env.MEXO_BUILD_DIST_DIR, ".next");
});

test("calendar sync fails closed unless the active build is a managed symlink", async () => {
  assert.throws(() => resolveCalendarSyncRuntime("/app", releaseTarget, false), /must point to a managed production release/);
  assert.throws(() => resolveCalendarSyncRuntime("/app", null, true), /must point to a managed production release/);
  assert.throws(() => resolveCalendarSyncRuntime("/app", ".next", true), /outside a managed Mexo release/);
});

test("calendar sync rejects a legacy release that uses the stable checkout runtime", async (t) => {
  const root = await makeRelease(t, `.mexo-releases/${revision}-${suffix}`);
  assert.throws(
    () => resolveCalendarSyncRuntime(root, `.mexo-releases/${revision}-${suffix}`, true),
    /does not contain isolated runtime dependencies/,
  );
});

test("calendar sync rejects an incomplete release instead of falling back to test tooling", async (t) => {
  const root = await makeRelease(t);
  const loader = path.resolve(root, releaseTarget, "..", "scripts", "register-alias-loader.mjs");
  const { rm: removeFile } = await import("node:fs/promises");
  await removeFile(loader);

  assert.throws(
    () => resolveCalendarSyncRuntime(root, releaseTarget, true),
    /missing the production sync entrypoint or alias loader/,
  );
});

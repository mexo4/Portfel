// Runs the shell blocks of the production deploy workflow against a throwaway
// release tree, because they delete directories on the server.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflow = readFileSync(join(repoRoot, ".github", "workflows", "deploy-production.yml"), "utf8")
  .replaceAll("\r\n", "\n");

function block(name) {
  const start = workflow.indexOf(`# BEGIN ${name}\n`);
  const end = workflow.indexOf(`# END ${name}\n`);
  assert.ok(start >= 0 && end > start, `workflow marks the "${name}" block`);
  return workflow.slice(start, end).replace(/^ {10}/gm, "");
}

// Git Bash only creates real-looking symlinks when told to.
const bashEnv = { ...process.env, MSYS: "winsymlinks:sys" };

function bash(cwd, script, env = {}) {
  return spawnSync("bash", ["-s"], {
    cwd,
    input: script,
    encoding: "utf8",
    env: { ...bashEnv, ...env },
  });
}

const probeDirectory = mkdtempSync(join(tmpdir(), "mexo-deploy-probe-"));
const probe = bash(
  probeDirectory,
  "mkdir target && ln -s target link && test -L link && find . -maxdepth 1 -printf '%p\\n' >/dev/null",
);
rmSync(probeDirectory, { recursive: true, force: true });
const skip = probe.status === 0 ? false : "needs bash with symlinks and GNU find";

const releaseName = (letter, index) =>
  `${letter.repeat(40)}-20261101T00000${index}Z-${1000 + index}`;

function createRelease(releases, name, { built = true, modules = true, age }) {
  const directory = join(releases, name);
  const source = join(directory, "source");
  const app = join(source, "portfel-inwestora");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(source, "package-lock.json"), "{}");
  if (modules) {
    mkdirSync(join(source, "node_modules", "next"), { recursive: true });
    writeFileSync(join(source, "node_modules", "next", "index.js"), "");
  }
  mkdirSync(join(app, ".next", "cache", "webpack"), { recursive: true });
  writeFileSync(join(app, ".next", "cache", "webpack", "0.pack"), "x");
  mkdirSync(join(app, ".next", "cache", "images"), { recursive: true });
  if (built) writeFileSync(join(app, ".next", "BUILD_ID"), "id");
  // `age` counts days back, so a smaller number is a newer release.
  const time = new Date(Date.UTC(2026, 10, 20) - age * 86_400_000);
  utimesSync(directory, time, time);
  return {
    directory,
    has: (...parts) => existsSync(join(source, ...parts)),
    exists: () => existsSync(directory),
  };
}

function createTree(t) {
  const root = mkdtempSync(join(tmpdir(), "mexo-deploy-cleanup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const releases = join(root, "app", ".mexo-releases");
  mkdirSync(releases, { recursive: true });
  return { root, releases };
}

function runCleanup(root, { activeRelease, freeKb = [9_000_000] }) {
  const link = activeRelease
    ? `ln -s ".mexo-releases/${activeRelease}/source/portfel-inwestora/.next" "$APP/.next"`
    : 'mkdir -p "$APP/.next"';
  writeFileSync(join(root, "free-space"), `${freeKb.join("\n")}\n`);
  return bash(
    root,
    [
      "set -Eeuo pipefail",
      'APP="$PWD/app"',
      'RELEASES="$APP/.mexo-releases"',
      'FREE_SPACE_FILE="$PWD/free-space"',
      'NPM_LOG="$PWD/npm.log"',
      // Each call reports the next value, so a test can model npm freeing space.
      'df() { local value; value="$(head -n 1 "$FREE_SPACE_FILE")"; if [ -f "$NPM_LOG" ]; then value="$(tail -n 1 "$FREE_SPACE_FILE")"; fi; printf \'header\\nfs 0 0 %s 0 /\\n\' "$value"; }',
      'npm() { echo "$*" >> "$NPM_LOG"; }',
      link,
      block("release cleanup"),
      "echo CLEANUP-FINISHED",
    ].join("\n"),
  );
}

test("release cleanup keeps what production needs and removes the rest", { skip }, (t) => {
  const { root, releases } = createTree(t);
  const activeName = releaseName("a", 1);
  // The active release is deliberately not the newest one on disk.
  const active = createRelease(releases, activeName, { age: 3 });
  const rolledBack = createRelease(releases, releaseName("b", 2), { age: 1 });
  const older = [5, 6, 7].map((age) => createRelease(releases, releaseName("c", age), { age }));
  const expired = [8, 9].map((age) => createRelease(releases, releaseName("d", age), { age }));
  const unfinished = createRelease(releases, releaseName("e", 3), { built: false, age: 0 });
  const legacy = join(releases, "legacy-build");
  mkdirSync(legacy);
  writeFileSync(join(legacy, "BUILD_ID"), "id");
  const handMade = createRelease(releases, "kept-by-hand", { built: false, age: 30 });

  const result = runCleanup(root, { activeRelease: activeName });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /CLEANUP-FINISHED/);

  assert.ok(active.has("node_modules", "next", "index.js"), "active dependencies stay");
  assert.ok(active.has("portfel-inwestora", ".next", "cache", "webpack", "0.pack"), "active release is untouched");

  assert.ok(rolledBack.has("node_modules"), "rollback build keeps its dependencies");
  assert.ok(rolledBack.has("portfel-inwestora", ".next", "BUILD_ID"));
  assert.ok(!rolledBack.has("portfel-inwestora", ".next", "cache", "webpack"));

  for (const release of older) {
    assert.ok(release.has("portfel-inwestora", ".next", "BUILD_ID"), "recent builds stay");
    assert.ok(release.has("portfel-inwestora", ".next", "cache", "images"));
    assert.ok(!release.has("portfel-inwestora", ".next", "cache", "webpack"));
    assert.ok(!release.has("node_modules"));
  }
  for (const release of expired) assert.ok(!release.exists(), "builds beyond the limit go");
  assert.ok(!unfinished.exists(), "an attempt without a build goes");
  assert.ok(existsSync(join(legacy, "BUILD_ID")), "unknown layouts are left alone");
  assert.ok(handMade.exists(), "directories not named like a release are left alone");
  assert.ok(!existsSync(join(root, "npm.log")), "npm cache stays while there is room");
});

test("release cleanup deletes nothing without a managed active build", { skip }, (t) => {
  const { root, releases } = createTree(t);
  const unfinished = createRelease(releases, releaseName("e", 3), { built: false, age: 0 });
  const built = createRelease(releases, releaseName("c", 4), { age: 9 });

  const result = runCleanup(root, { activeRelease: null });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(unfinished.exists());
  assert.ok(built.has("node_modules"));
});

test("low disk space clears the npm cache and then decides", { skip }, async (t) => {
  await t.test("continues when clearing the cache is enough", (t) => {
    const { root, releases } = createTree(t);
    createRelease(releases, releaseName("a", 1), { age: 1 });
    const result = runCleanup(root, { activeRelease: releaseName("a", 1), freeKb: [100, 9_000_000] });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(readFileSync(join(root, "npm.log"), "utf8"), /^cache clean --force/);
  });

  await t.test("stops with the numbers when it is still not enough", (t) => {
    const { root, releases } = createTree(t);
    const active = createRelease(releases, releaseName("a", 1), { age: 1 });
    const result = runCleanup(root, { activeRelease: releaseName("a", 1), freeKb: [102_400, 204_800] });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /only 200 MB is free after cleanup and a release needs 1536 MB/);
    assert.doesNotMatch(result.stdout, /CLEANUP-FINISHED/);
    assert.ok(active.has("node_modules"));
  });
});

test("a staged release that did not finish building is removed", { skip }, async (t) => {
  const run = (t, ending) => {
    const { root, releases } = createTree(t);
    const name = releaseName("f", 5);
    const result = bash(
      root,
      [
        "set -Eeuo pipefail",
        'REPO="$PWD"',
        'APP="$PWD/app"',
        `RELEASE_TARGET=".mexo-releases/${name}"`,
        block("unfinished release guard"),
        'mkdir -p "$APP/$RELEASE_TARGET/source/node_modules"',
        ending,
      ].join("\n"),
    );
    return { result, exists: existsSync(join(releases, name)) };
  };

  await t.test("after a failed command, keeping the failure status", (t) => {
    const { result, exists } = run(t, "bash -c 'exit 7'");
    assert.equal(result.status, 7, result.stderr);
    assert.equal(exists, false);
  });

  await t.test("but a finished build stays", (t) => {
    const { result, exists } = run(t, "STAGED_BUILD_READY=1");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(exists, true);
  });
});

test("the deploy builds the commit its run was started for", { skip }, async (t) => {
  const repo = mkdtempSync(join(tmpdir(), "mexo-deploy-revision-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet");
  git("config", "user.name", "Mexo deploy revision test");
  git("config", "user.email", "mexo-deploy-revision@example.invalid");
  const commit = (message) => {
    git("commit", "--quiet", "--allow-empty", "-m", message);
    return git("rev-parse", "HEAD");
  };
  const live = commit("live");
  const first = commit("first merge");
  const second = commit("second merge");
  git("update-ref", "refs/remotes/origin/najlepsza-wersja", second);
  const unrelated = commit("not on the production branch");

  const choose = (previous, requested) =>
    bash(
      repo,
      [
        "set -Eeuo pipefail",
        'BRANCH="najlepsza-wersja"',
        `PREVIOUS_REVISION="${previous}"`,
        block("requested revision"),
        'echo "BUILD=$BUILD_REVISION"',
      ].join("\n"),
      { REQUESTED_REVISION: requested },
    );

  await t.test("even when a later merge is already on the branch", () => {
    const result = choose(live, first);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`BUILD=${first}`));
  });
  await t.test("also when it is the one already live", () => {
    assert.equal(choose(first, first).status, 0);
  });
  await t.test("but not an older commit than the live one", () => {
    const result = choose(second, first);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /already runs a newer commit/);
  });
  await t.test("and not a commit outside the production branch", () => {
    const result = choose(live, unrelated);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /is not part of najlepsza-wersja/);
  });
  await t.test("and not a missing value", () => {
    assert.notEqual(choose(live, "").status, 0);
  });
});

test("the workflow passes the run commit to the server and uses it throughout", () => {
  assert.match(workflow, /"REQUESTED_REVISION=\$GITHUB_SHA bash -se" <<'REMOTE'/);
  assert.match(workflow, /git reset --hard "\$BUILD_REVISION"/);
  assert.doesNotMatch(workflow, /reset --hard "origin\//);
  assert.match(workflow, /rm -rf -- "\$RELEASE_APP\/\.next\/cache\/webpack"\n\s+STAGED_BUILD_READY=1/);
});

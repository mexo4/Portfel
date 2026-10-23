import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workflowPath = join(repoRoot, ".github", "workflows", "deploy-production.yml");
const workflow = readFileSync(workflowPath, "utf8");
const guardMatch = workflow.match(
  /node - "\$PREVIOUS_REVISION" "\$BUILD_REVISION" <<'NODE'\r?\n([\s\S]*?)\r?\n\s+NODE/m,
);
assert.ok(guardMatch, "production workflow contains the expected manifest guard heredoc");
const guardScript = guardMatch[1].replace(/^ {10}/gm, "");

const baseManifest = {
  name: "portfel-inwestora",
  version: "0.1.0",
  private: true,
  scripts: {
    start: "node --use-system-ca ./scripts/start-production.mjs",
    build: "next build",
    dev: "next dev",
    test: "node --test",
    "audit:gpw-dividends": "node audit-old.mjs",
  },
  dependencies: { next: "16.4.0" },
  devDependencies: { eslint: "9.0.0" },
  optionalDependencies: { "@tailwindcss/oxide-linux-arm64-gnu": "4.2.1" },
  peerDependencies: {},
  engines: { node: "24.x" },
  packageManager: "npm@10",
  type: "module",
};

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function runGuardCase(t, mutate = () => {}, mutateRoot = () => {}) {
  const repo = join(tmpdir(), `mexo-deploy-guard-${process.pid}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(repo, "portfel-inwestora"), { recursive: true });
  t.after(() => rmSync(repo, { recursive: true, force: true }));

  git(repo, "init", "--quiet");
  git(repo, "config", "user.name", "Mexo deploy guard test");
  git(repo, "config", "user.email", "mexo-deploy-guard@example.invalid");

  const oldManifest = structuredClone(baseManifest);
  const newManifest = structuredClone(baseManifest);
  const oldRoot = { name: "mexo-root", private: true };
  const newRoot = structuredClone(oldRoot);
  const oldLock = { name: "mexo-root", lockfileVersion: 3, packages: {} };
  const newLock = structuredClone(oldLock);
  mutate({ oldManifest, newManifest });
  mutateRoot({ oldRoot, newRoot, oldLock, newLock });

  const writeJson = (path, value) => writeFileSync(join(repo, path), `${JSON.stringify(value, null, 2)}\n`);
  writeJson("package.json", oldRoot);
  writeJson("package-lock.json", oldLock);
  writeJson("portfel-inwestora/package.json", oldManifest);
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "previous release");
  const previous = git(repo, "rev-parse", "HEAD");

  writeJson("package.json", newRoot);
  writeJson("package-lock.json", newLock);
  writeJson("portfel-inwestora/package.json", newManifest);
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "candidate release");
  const candidate = git(repo, "rev-parse", "HEAD");

  const appGuard = spawnSync(process.execPath, ["-", previous, candidate], {
    cwd: repo,
    input: guardScript,
    encoding: "utf8",
  });
  const rootDiff = spawnSync("git", ["diff", "--quiet", previous, candidate, "--", "package.json", "package-lock.json"], {
    cwd: repo,
    encoding: "utf8",
  });

  return {
    appAccepted: appGuard.status === 0,
    rootChanged: rootDiff.status === 1,
    output: `${appGuard.stdout}\n${appGuard.stderr}`,
  };
}

test("Oracle deployment guard permits isolated dependency releases but pins runtime package behavior", async (t) => {
  await t.test("change only to audit:gpw-dividends is allowed", (t) => {
    const result = runGuardCase(t, ({ newManifest }) => {
      newManifest.scripts["audit:gpw-dividends"] = "node audit-new.mjs";
    });
    assert.equal(result.appAccepted, true, result.output);
    assert.equal(result.rootChanged, false);
  });

  await t.test("production dependency changes are allowed in isolated release trees", (t) => {
    const result = runGuardCase(t, ({ newManifest }) => {
      newManifest.dependencies.next = "16.5.0";
    });
    assert.equal(result.appAccepted, true, result.output);
  });

  await t.test("dev dependency changes are allowed in isolated build trees", (t) => {
    const result = runGuardCase(t, ({ newManifest }) => {
      newManifest.devDependencies.eslint = "10.0.0";
    });
    assert.equal(result.appAccepted, true, result.output);
  });

  await t.test("root lockfile changes are allowed because npm ci runs in the isolated release", (t) => {
    const result = runGuardCase(t, () => {}, ({ newLock }) => {
      newLock.packages["node_modules/next"] = { version: "16.5.0" };
    });
    assert.equal(result.rootChanged, true);
    assert.equal(result.appAccepted, true);
  });

  await t.test("root workspace configuration changes remain blocked", (t) => {
    const result = runGuardCase(t, () => {}, ({ newRoot }) => {
      newRoot.engines = { node: "24.x" };
    });
    assert.equal(result.rootChanged, true);
    assert.equal(result.appAccepted, false);
  });

  await t.test("application install lifecycle changes remain blocked", (t) => {
    const result = runGuardCase(t, ({ newManifest }) => {
      newManifest.scripts.postinstall = "node install-hook.mjs";
    });
    assert.equal(result.appAccepted, false);
  });

  await t.test("production start command changes are blocked", (t) => {
    const result = runGuardCase(t, ({ newManifest }) => {
      newManifest.scripts.start = "node server.mjs";
    });
    assert.equal(result.appAccepted, false);
  });

  await t.test("build script changes are blocked", (t) => {
    const result = runGuardCase(t, ({ newManifest }) => {
      newManifest.scripts.build = "next build --experimental";
    });
    assert.equal(result.appAccepted, false);
  });

  await t.test("unapproved npm script additions are blocked", (t) => {
    const result = runGuardCase(t, ({ newManifest }) => {
      newManifest.scripts["deploy:unreviewed"] = "node deploy.mjs";
    });
    assert.equal(result.appAccepted, false);
  });

  await t.test("workflow stages locked dependencies in the release source tree", () => {
    assert.match(workflow, /git -C "\$REPO" archive "\$BUILD_REVISION" \| tar -x -C "\$RELEASE_SOURCE"/);
    assert.match(workflow, /cd "\$RELEASE_SOURCE"\s+npm ci --no-audit --no-fund/);
    assert.doesNotMatch(workflow, /npm ci.*REPO\/node_modules/);
    assert.match(workflow, /ACTIVE_NEXT_TARGET="\$RELEASE_TARGET\/source\/portfel-inwestora\/\.next"/);
  });
});

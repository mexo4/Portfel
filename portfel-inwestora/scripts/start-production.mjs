import { spawn } from "node:child_process";
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Resolve runtime settings from the active .next symlink. Next.js embeds its
 * distDir at build time, so a managed release must be started with that exact
 * relative path even though the active build is exposed through .next.
 */
export function resolveBuildRuntimeOverrides(appDir, currentNextTarget) {
  if (currentNextTarget === null) return {};

  const normalizedTarget = currentNextTarget.replaceAll("\\", "/");
  const match = /^\.mexo-releases\/([a-f0-9]{40})-[A-Za-z0-9._-]+$/.exec(normalizedTarget);
  if (!match) {
    throw new Error("Refusing to start: .next points outside a managed Mexo release.");
  }

  const appRoot = realpathSync(appDir);
  const releasePath = path.resolve(appRoot, normalizedTarget);
  if (!releasePath.startsWith(`${appRoot}${path.sep}`)) {
    throw new Error("Refusing to start: managed release path escapes the application directory.");
  }

  lstatSync(releasePath);
  lstatSync(path.join(releasePath, "BUILD_ID"));
  if (!realpathSync(releasePath).startsWith(`${appRoot}${path.sep}`)) {
    throw new Error("Refusing to start: managed release resolves outside the application directory.");
  }
  return {
    MEXO_BUILD_DIST_DIR: normalizedTarget,
    MEXO_BUILD_REVISION: match[1],
  };
}

function getRuntimeOverrides() {
  const activeBuild = path.join(appDirectory, ".next");
  const metadata = lstatSync(activeBuild);
  return resolveBuildRuntimeOverrides(
    appDirectory,
    metadata.isSymbolicLink() ? readlinkSync(activeBuild) : null
  );
}

function start() {
  const env = { ...process.env };
  delete env.MEXO_BUILD_DIST_DIR;
  delete env.MEXO_BUILD_REVISION;
  Object.assign(env, getRuntimeOverrides());

  const nextCli = path.resolve(appDirectory, "../node_modules/next/dist/bin/next");
  const child = spawn(process.execPath, ["--use-system-ca", nextCli, "start", "--hostname", "127.0.0.1"], {
    cwd: appDirectory,
    env,
    stdio: "inherit",
  });

  let stopping = false;
  const forwardSignal = (signal) => {
    if (stopping) return;
    stopping = true;
    child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));
  child.once("error", (error) => {
    console.error("Failed to start the Mexo Next.js production server:", error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    start();
  } catch (error) {
    console.error("Failed to resolve the active Mexo release:", error.message);
    process.exitCode = 1;
  }
}

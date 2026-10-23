import { spawn } from "node:child_process";
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const managedReleasePattern = /^\.mexo-releases\/([a-f0-9]{40})-([0-9]{8}T[0-9]{6}Z-[0-9]+)$/;
const isolatedReleasePattern = /^\.mexo-releases\/([a-f0-9]{40})-([0-9]{8}T[0-9]{6}Z-[0-9]+)\/source\/portfel-inwestora\/\.next$/;

function resolveManagedBuild(appDir, target) {
  const normalizedTarget = target?.replaceAll("\\", "/");
  const isolated = normalizedTarget ? isolatedReleasePattern.exec(normalizedTarget) : null;
  const legacy = normalizedTarget ? managedReleasePattern.exec(normalizedTarget) : null;
  if (!isolated && !legacy) {
    throw new Error("Refusing to start: .next points outside a managed Mexo release.");
  }

  const appRoot = realpathSync(appDir);
  const buildPath = path.resolve(appRoot, normalizedTarget);
  if (!buildPath.startsWith(`${appRoot}${path.sep}`)) {
    throw new Error("Refusing to start: managed release path escapes the application directory.");
  }
  lstatSync(buildPath);
  lstatSync(path.join(buildPath, "BUILD_ID"));
  if (!realpathSync(buildPath).startsWith(`${appRoot}${path.sep}`)) {
    throw new Error("Refusing to start: managed release resolves outside the application directory.");
  }
  return { buildPath, isolated, revision: (isolated ?? legacy)[1] };
}

/**
 * Resolve runtime settings from the active .next symlink. Next.js embeds its
 * distDir at build time, so a managed release must be started with that exact
 * relative path even though the active build is exposed through .next.
 */
export function resolveBuildRuntimeOverrides(appDir, currentNextTarget) {
  if (currentNextTarget === null) return {};
  const { isolated, revision } = resolveManagedBuild(appDir, currentNextTarget);
  return {
    MEXO_BUILD_DIST_DIR: isolated ? ".next" : currentNextTarget.replaceAll("\\", "/"),
    MEXO_BUILD_REVISION: revision,
  };
}

export function resolveRuntimeAppDirectory(appDir, currentNextTarget) {
  if (currentNextTarget === null) return path.resolve(appDir);
  const { buildPath, isolated } = resolveManagedBuild(appDir, currentNextTarget);
  return isolated ? path.dirname(buildPath) : path.resolve(appDir);
}

function start() {
  const env = { ...process.env };
  delete env.MEXO_BUILD_DIST_DIR;
  delete env.MEXO_BUILD_REVISION;
  const activeBuild = path.join(appDirectory, ".next");
  const metadata = lstatSync(activeBuild);
  const currentNextTarget = metadata.isSymbolicLink() ? readlinkSync(activeBuild) : null;
  const runtimeAppDirectory = resolveRuntimeAppDirectory(appDirectory, currentNextTarget);
  Object.assign(env, resolveBuildRuntimeOverrides(appDirectory, currentNextTarget));

  const nextCli = path.resolve(runtimeAppDirectory, "../node_modules/next/dist/bin/next");
  const child = spawn(process.execPath, ["--use-system-ca", nextCli, "start", "--hostname", "127.0.0.1"], {
    cwd: runtimeAppDirectory,
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

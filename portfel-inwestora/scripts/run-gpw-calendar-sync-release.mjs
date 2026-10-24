import { spawn } from "node:child_process";
import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBuildRuntimeOverrides, resolveRuntimeAppDirectory } from "./start-production.mjs";

const appDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveCalendarSyncRuntime(appDir, currentNextTarget, isSymbolicLink) {
  if (!isSymbolicLink || !currentNextTarget) {
    throw new Error("Refusing calendar sync: active .next must point to a managed production release.");
  }

  const runtimeAppDirectory = resolveRuntimeAppDirectory(appDir, currentNextTarget);
  if (path.resolve(runtimeAppDirectory) === path.resolve(appDir)) {
    throw new Error("Refusing calendar sync: active release does not contain isolated runtime dependencies.");
  }

  const appRoot = realpathSync(appDir);
  const runtimeRoot = realpathSync(runtimeAppDirectory);
  if (!runtimeRoot.startsWith(`${appRoot}${path.sep}`)) {
    throw new Error("Refusing calendar sync: active release resolves outside the application directory.");
  }

  const entrypoint = path.join(runtimeRoot, "scripts", "run-gpw-calendar-sync.mjs");
  const aliasLoader = path.join(runtimeRoot, "scripts", "register-alias-loader.mjs");
  if (!existsSync(entrypoint) || !existsSync(aliasLoader)) {
    throw new Error("Refusing calendar sync: active release is missing the production sync entrypoint or alias loader.");
  }

  return {
    cwd: runtimeRoot,
    entrypoint,
    aliasLoader,
    env: resolveBuildRuntimeOverrides(appRoot, currentNextTarget),
  };
}

function run() {
  const activeBuild = path.join(appDirectory, ".next");
  const metadata = lstatSync(activeBuild);
  const runtime = resolveCalendarSyncRuntime(
    appDirectory,
    metadata.isSymbolicLink() ? readlinkSync(activeBuild) : null,
    metadata.isSymbolicLink(),
  );
  const child = spawn(process.execPath, [
    "--experimental-strip-types",
    "--import",
    runtime.aliasLoader,
    runtime.entrypoint,
    "--run",
  ], {
    cwd: runtime.cwd,
    env: { ...process.env, ...runtime.env },
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
    console.error("Failed to start the Mexo GPW calendar sync release:", error.message);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error("Failed to resolve the active Mexo calendar sync release:", error.message);
    process.exitCode = 1;
  }
}

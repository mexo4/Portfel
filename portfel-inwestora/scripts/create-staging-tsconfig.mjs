import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFilePattern = /^\.mexo-tsconfig-[A-Za-z0-9._-]+\.json$/;
const releaseTargetPattern = /^\.mexo-releases\/[a-f0-9]{40}-[0-9]{8}T[0-9]{6}Z-[0-9]+$/;

export function createStagingTsconfig(configFile, releaseTarget) {
  if (!configFilePattern.test(configFile ?? "")) {
    throw new Error("Staging TypeScript config must use the generated .mexo-tsconfig-*.json name.");
  }
  if (!releaseTargetPattern.test(releaseTarget ?? "")) {
    throw new Error("Staging release target is not a managed Mexo release path.");
  }

  const configPath = path.resolve(appRoot, configFile);
  if (path.dirname(configPath) !== appRoot) {
    throw new Error("Staging TypeScript config must be written inside the application directory.");
  }

  const config = {
    extends: "./tsconfig.json",
    include: [
      "next-env.d.ts",
      "*.ts",
      "*.tsx",
      "*.mts",
      "src/**/*.ts",
      "src/**/*.tsx",
      "src/**/*.mts",
      `${releaseTarget}/types/**/*.ts`,
    ],
    // The active .next is a symlink to the previous release during staging.
    // Explicitly omit it and only include route types generated in this build.
    exclude: ["node_modules", "scripts", ".next"],
  };

  return { configPath, contents: `${JSON.stringify(config, null, 2)}\n` };
}

async function main() {
  const [configFile, releaseTarget, ...extraArgs] = process.argv.slice(2);
  if (!configFile || !releaseTarget || extraArgs.length) {
    throw new Error("Usage: create-staging-tsconfig.mjs <config-file> <release-target>");
  }

  const { configPath, contents } = createStagingTsconfig(configFile, releaseTarget);
  let createdByThisRun = false;
  try {
    const handle = await open(configPath, "wx", 0o600);
    createdByThisRun = true;
    try {
      await handle.writeFile(contents, "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (createdByThisRun) {
      await unlink(configPath).catch(() => {});
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Unable to create isolated staging tsconfig: ${error.message}`);
    process.exitCode = 1;
  });
}

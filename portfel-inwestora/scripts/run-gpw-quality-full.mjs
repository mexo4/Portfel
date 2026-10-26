import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const common = ["--experimental-strip-types", "--import", "./tests/register-alias-loader.mjs"];
const commands = [
  ["fixtures", "scripts/run-gpw-quality-audit.mjs"],
  ["sources", "scripts/run-gpw-quality-sources.mjs"],
  ["projections", "scripts/run-gpw-quality-projections.mjs"],
  ["postgres-e2e", "scripts/run-gpw-quality-e2e.mjs", "--run-postgres", "--require-postgres"],
  ["quality-gate", "scripts/run-gpw-quality-gate.mjs"],
];
const results = [];
for (const [name, script, ...args] of commands) {
  const result = spawnSync(process.execPath, [...common, script, ...args,
    ...(name === "sources" ? process.argv.slice(2) : [])], {
    cwd: appRoot, encoding: "utf8", timeout: name === "sources" ? 15 * 60_000 : 5 * 60_000,
    env: process.env,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  results.push({ name, status: result.status ?? "FAILED", timeout: result.error?.code === "ETIMEDOUT" });
}
process.stdout.write(`${JSON.stringify({ name: "gpw:audit:full", results }, null, 2)}\n`);
if (results.some((result) => result.status !== 0)) process.exitCode = 1;

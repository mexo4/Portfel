import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { getAuditOutputDirectory, printArtifactSummary, renderGenericMarkdown, writeGpwQualityArtifacts } from "./gpw-quality-io.mjs";

const appRoot = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const requirePostgres = process.argv.includes("--require-postgres");
const runPostgres = process.argv.includes("--run-postgres") || requirePostgres;
const focusedTests = [
  "tests/corporate-events.test.mjs",
  "tests/gpw-calendar-brief-regression.test.mjs",
  "tests/gpw-completeness.test.mjs",
  "tests/gpw-comprehensive-regression.test.mjs",
  "tests/gpw-direct-correction-regression.test.mjs",
  "tests/gpw-final-calendar-parser.test.mjs",
  "tests/gpw-ical-filters.test.mjs",
  "tests/gpw-ical.test.mjs",
  "tests/gpw-metamorphic.test.mjs",
  "tests/gpw-mutation-sensitivity.test.mjs",
  "tests/gpw-parser-policy.test.mjs",
  "tests/gpw-pap-discovery.test.mjs",
  "tests/gpw-quality-audit.test.mjs",
  "tests/gpw-quality-gate.test.mjs",
  "tests/gpw-source-audit.test.mjs",
  "tests/gpw-meeting-registration-context.test.mjs",
  "tests/gpw-new-source-regressions.test.mjs",
  "tests/gpw-report-calendar.test.mjs",
  "tests/gpw-report-date-role.test.mjs",
  "tests/report-schedule-publication.test.mjs",
  "tests/gpw-reprojection-action-plan.test.mjs",
  "tests/gpw-sync-health.test.mjs",
  "tests/gpw-calendar-sync-launcher.test.mjs",
  "tests/gpw-calendar-upgrade.test.mjs",
  "tests/general-meeting-backend.test.mjs",
  "tests/general-meeting-parser.test.mjs",
  "tests/public-gpw-calendar.test.mjs",
];
const nodeArgs = ["--experimental-strip-types", "--import", "./tests/register-alias-loader.mjs", "--test", ...focusedTests];
const unit = spawnSync(process.execPath, nodeArgs, { cwd: appRoot, encoding: "utf8", timeout: 180_000 });
const pgUrl = process.env.MEXO_GPW_TEST_DATABASE_URL;
let nativePostgres = {
  configured: Boolean(pgUrl),
  testFile: "tests/gpw-postgres-integration.test.mjs",
  status: runPostgres ? "POSTGRES_NOT_AVAILABLE" : "NOT_REQUESTED",
  reason: pgUrl
    ? "An isolated URL is configured. PostgreSQL runs only in the explicit required profile."
    : "No MEXO_GPW_TEST_DATABASE_URL was supplied. The test never falls back to an application or production database.",
};
if (runPostgres && pgUrl) {
  const postgres = spawnSync(process.execPath, ["--experimental-strip-types", "--import", "./tests/register-alias-loader.mjs", "--test", nativePostgres.testFile], {
    cwd: appRoot,
    encoding: "utf8",
    timeout: 180_000,
    env: process.env,
  });
  nativePostgres = {
    ...nativePostgres,
    status: postgres.status === 0 ? "POSTGRES_E2E_PASS" : "POSTGRES_E2E_FAIL",
    reason: postgres.status === 0 ? "The isolated native PostgreSQL contract suite passed." : "The isolated native PostgreSQL contract suite failed.",
    exitCode: postgres.status,
    timedOut: postgres.error?.code === "ETIMEDOUT",
    stdout: postgres.stdout,
    stderr: postgres.stderr,
  };
}
const report = {
  schemaVersion: 1,
  scope: {
    focusedTests,
    isolatedPostgres: nativePostgres,
    limitations: [
      "The deterministic E2E suite covers parser, API/ICS contracts and fixture-level projection behaviour without live external network requests.",
      "The default profile is UNIT_ONLY. The required PostgreSQL profile fails if the isolated loopback mexo_gpw_test database is unavailable.",
    ],
  },
  unit: {
    exitCode: unit.status,
    timedOut: unit.error?.code === "ETIMEDOUT",
    stdout: unit.stdout,
    stderr: unit.stderr,
  },
  nativePostgres,
  status: unit.status !== 0 ? "UNIT_FAIL"
    : !runPostgres ? "UNIT_ONLY"
      : nativePostgres.status,
};
const artifacts = await writeGpwQualityArtifacts({
  outputDir: getAuditOutputDirectory(),
  basename: "e2e",
  report,
  markdown: renderGenericMarkdown("GPW source-to-contract E2E report", [
    { heading: "Deterministic suite", body: `- Status: **${unit.status === 0 ? "PASS" : "FAIL"}**\n- Tests: ${focusedTests.length}\n- Exit code: ${String(unit.status)}` },
    { heading: "Native PostgreSQL", body: `- Status: **${nativePostgres.status}**\n- ${nativePostgres.reason}` },
    { heading: "Limitations", body: report.scope.limitations.map((limit) => `- ${limit}`).join("\n") },
  ]),
});

printArtifactSummary({
  name: "gpw:e2e",
  status: report.status,
  artifacts,
  summary: { unitExitCode: unit.status, nativePostgres: nativePostgres.status },
});
if (report.status !== "UNIT_ONLY" && report.status !== "POSTGRES_E2E_PASS") process.exitCode = 1;

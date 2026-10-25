import assert from "node:assert/strict";
import test from "node:test";

import { scanGpwParserPolicy, scanGpwParserPolicySources } from "../scripts/gpw-parser-policy.mjs";

test("GPW parser policy detects ticker-keyed parser decisions", () => {
  const report = scanGpwParserPolicySources({
    files: [{
      file: "src/lib/corporate-events.ts",
      source: "const classify = (ticker) => { if (ticker === 'ABC') return 'QUARTERLY_REPORT'; return 'UNKNOWN'; };",
    }],
  });
  assert.equal(report.status, "FAIL");
  assert.equal(report.findings[0]?.code, "TICKER_SPECIFIC_PARSER_DECISION");
});

test("GPW parser policy detects identity sets, keyed overrides, and fixed-date branches", () => {
  const report = scanGpwParserPolicySources({
    files: [{
      file: "src/lib/corporate-events.ts",
      source: [
        "const one = new Set(['ABC']).has(instrumentTicker);",
        "const two = issuerOverrides[ticker];",
        "if (eventDate === '2026-11-20') return 'QUARTERLY_REPORT';",
      ].join("\n"),
    }],
  });
  assert.equal(report.status, "FAIL");
  assert.equal(report.findings.filter((entry) => entry.code === "TICKER_SPECIFIC_PARSER_DECISION").length, 2);
  assert.equal(report.findings.filter((entry) => entry.code === "DATE_SPECIFIC_PARSER_DECISION").length, 1);
});

test("GPW parser policy makes documented source-seed metadata visible without accepting parser branching", async () => {
  const report = await scanGpwParserPolicy();
  assert.equal(report.status, "PASS");
  assert.ok(report.documentedExceptions.length > 0);
  assert.ok(report.documentedExceptions.every((entry) => entry.exception === "GPW_ISSUER_SOURCE_REGISTRY"));
});

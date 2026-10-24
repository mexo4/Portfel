import assert from "node:assert/strict";
import test from "node:test";
import { getGpwSyncHealth } from "../src/lib/gpw-sync-health.ts";

test("GPW synchronization never reports success while a batch backlog remains", () => {
  assert.equal(getGpwSyncHealth({}), "COMPLETE");
  assert.equal(getGpwSyncHealth({ errors: 0, pending: 0 }), "COMPLETE");
  assert.equal(getGpwSyncHealth({ errors: 0, pending: 1 }), "INCOMPLETE");
  assert.equal(getGpwSyncHealth({ errors: 0, pending: 120 }), "INCOMPLETE");
  assert.equal(getGpwSyncHealth({ errors: 1, pending: 0 }), "FAILED");
  assert.equal(getGpwSyncHealth({ errors: 2, pending: 9 }), "FAILED");
});

test("GPW synchronization outcome is stable for broad bounded count ranges", () => {
  for (let errors = 0; errors <= 20; errors += 1) {
    for (let pending = 0; pending <= 50; pending += 1) {
      const expected = errors > 0 ? "FAILED" : pending > 0 ? "INCOMPLETE" : "COMPLETE";
      assert.equal(getGpwSyncHealth({ errors, pending }), expected);
    }
  }
});

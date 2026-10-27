import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createGpwAuditCheckpoint, readAttachmentWithBoundedRetry } from "../scripts/gpw-audit-checkpoint.mjs";

test("attachment retry is bounded and limited to transient failures", async () => {
  let attempts = 0;
  const waits = [];
  const transient = await readAttachmentWithBoundedRetry("https://www.gpw.pl/report.pdf", async () =>
    ++attempts === 1 ? { status: "UNREADABLE", reason: "HTTP_429", httpStatus: 429 }
      : { status: "READ", read: { text: "valid", pagesRead: 1, totalPages: 1, truncated: false } },
  { wait: async (milliseconds) => waits.push(milliseconds) });
  assert.equal(transient.attempts, 2);
  assert.deepEqual(waits, [2_000]);

  attempts = 0;
  const blocked = await readAttachmentWithBoundedRetry("https://espiebi.pap.pl/challenge.pdf", async () => {
    attempts += 1;
    return { status: "UNREADABLE", reason: "ACCESS_CHALLENGE" };
  });
  assert.equal(blocked.attempts, 1);
  assert.equal(attempts, 1);
  await assert.rejects(readAttachmentWithBoundedRetry("https://www.gpw.pl/report.pdf", async () =>
    ({ status: "UNREADABLE", reason: "TIMEOUT" }), { maxAttempts: 4 }));
});

test("resume reparses cached official HTML and respects unresolved attachment cooldown", async (t) => {
  const outputDir = await mkdtemp(path.join(tmpdir(), "mexo-gpw-checkpoint-"));
  t.after(async () => rm(outputDir, { recursive: true, force: true }));
  const now = Date.parse("2026-10-26T12:00:00Z");
  const url = "https://www.gpw.pl/komunikat?geru_id=123";
  const attachmentUrl = "https://espiebi.pap.pl/espi/pl/reports/view/attachment/123.pdf";
  const first = await createGpwAuditCheckpoint({ outputDir, now: () => now });
  await first.fetchDocument(url, async () => ({ status: "SUCCESS", document: "<html>public report</html>" }));
  await first.readAttachment(attachmentUrl, async () => ({ status: "UNREADABLE", reason: "ACCESS_CHALLENGE" }));

  let networkCalls = 0;
  const resumed = await createGpwAuditCheckpoint({ outputDir, resume: true, now: () => now + 60_000 });
  const detail = await resumed.fetchDocument(url, async () => {
    networkCalls += 1;
    return { status: "SUCCESS", document: "changed" };
  });
  const failure = await resumed.readAttachment(attachmentUrl, async () => {
    networkCalls += 1;
    return { status: "READ", read: { text: "unexpected", pagesRead: 1, totalPages: 1, truncated: false } };
  });
  assert.equal(detail.document, "<html>public report</html>");
  assert.deepEqual(failure, { status: "UNREADABLE", reason: "ACCESS_CHALLENGE" });
  assert.equal(networkCalls, 0);
  assert.equal(resumed.counters.cachedDetailsReused, 1);
  assert.equal(resumed.counters.attachmentFailuresReused, 1);

  const stale = await createGpwAuditCheckpoint({ outputDir, resume: true,
    now: () => now + 25 * 60 * 60 * 1_000 });
  const refreshedDetail = await stale.fetchDocument(url, async () => {
    networkCalls += 1;
    return { status: "SUCCESS", document: "changed official report" };
  });
  assert.equal(refreshedDetail.document, "changed official report");
  assert.equal(stale.counters.cachedDetailsReused, 0);
  const rechecked = await stale.readAttachment(attachmentUrl, async () => {
    networkCalls += 1;
    return { status: "READ", read: { text: "recovered", pagesRead: 1, totalPages: 1, truncated: false } };
  });
  assert.equal(rechecked.status, "READ");
  assert.equal(stale.counters.attachmentFailuresReused, 0);
  assert.equal(networkCalls, 2);

  const fresh = await createGpwAuditCheckpoint({ outputDir, resume: false, now: () => now + 60_000 });
  await fresh.readAttachment(attachmentUrl, async () => {
    networkCalls += 1;
    return { status: "READ", read: { text: "recovered", pagesRead: 1, totalPages: 1, truncated: false } };
  });
  assert.equal(networkCalls, 3);
});

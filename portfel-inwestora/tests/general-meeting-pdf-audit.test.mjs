import assert from "node:assert/strict";
import test from "node:test";
import { inspectOfficialMeetingPdf } from "../src/lib/server/general-meeting-pdf.ts";

const attachmentUrl = "https://espiebi.pap.pl/espi/pl/reports/view/attachment/report.pdf,20261025";

test("official PDF inspector identifies a 200 HTML access challenge without following it", async () => {
  let options;
  const result = await inspectOfficialMeetingPdf(attachmentUrl, async (_url, init) => {
    options = init;
    return new Response('<html><iframe src="/_Incapsula_Resource?incident_id=123">Request unsuccessful</iframe></html>',
      { status: 200, headers: { "content-type": "text/html" } });
  });

  assert.deepEqual(result, { status: "UNREADABLE", reason: "ACCESS_CHALLENGE" });
  assert.equal(options.redirect, "manual");
  assert.equal(options.headers.Accept, "application/pdf");
});

test("official PDF inspector distinguishes non-PDF, HTTP, size and untrusted URL failures", async () => {
  const nonPdf = await inspectOfficialMeetingPdf(attachmentUrl, async () =>
    new Response("ordinary HTML", { status: 200, headers: { "content-type": "text/html" } }));
  assert.deepEqual(nonPdf, { status: "UNREADABLE", reason: "NON_PDF" });

  const httpError = await inspectOfficialMeetingPdf(attachmentUrl, async () => new Response("", { status: 403 }));
  assert.deepEqual(httpError, { status: "UNREADABLE", reason: "HTTP_ERROR", httpStatus: 403 });

  const tooLarge = await inspectOfficialMeetingPdf(attachmentUrl, async () =>
    new Response("", { status: 200, headers: { "content-length": "2000001" } }));
  assert.deepEqual(tooLarge, { status: "UNREADABLE", reason: "SIZE_LIMIT" });

  let fetched = false;
  const untrusted = await inspectOfficialMeetingPdf("https://example.test/attachment.pdf", async () => {
    fetched = true;
    return new Response("", { status: 200 });
  });
  assert.deepEqual(untrusted, { status: "UNREADABLE", reason: "UNTRUSTED_URL" });
  assert.equal(fetched, false);
});

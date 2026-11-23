import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";

// Nothing here may reach a real database or API.
for (const name of ["DATABASE_URL", "POSTGRES_CA_CERT_PATH", "POSTGRES_CA_CERT_BASE64"]) {
  delete process.env[name];
}

const { createProviderCooldown } = await import("../src/lib/server/provider-cooldown.ts");
const { safeFetchText } = await import("../src/lib/server/portfolio-history.ts");

test("a provider is skipped for the cooldown after it was unreachable, then asked again", () => {
  let now = 1_000;
  const cooldown = createProviderCooldown({ cooldownMs: 600_000, now: () => now });

  assert.equal(cooldown.isCoolingDown(), false);

  cooldown.markUnavailable();
  assert.equal(cooldown.isCoolingDown(), true);

  now += 599_999;
  assert.equal(cooldown.isCoolingDown(), true);

  now += 2;
  assert.equal(cooldown.isCoolingDown(), false);
});

test("a second failure extends the cooldown and reset clears it", () => {
  let now = 0;
  const cooldown = createProviderCooldown({ cooldownMs: 100, now: () => now });

  cooldown.markUnavailable();
  now = 90;
  cooldown.markUnavailable();
  now = 150;
  assert.equal(cooldown.isCoolingDown(), true, "measured from the latest failure");

  cooldown.reset();
  assert.equal(cooldown.isCoolingDown(), false);
});

const listen = (handler) =>
  new Promise((resolve) => {
    const connections = new Set();
    const server = createServer(handler);
    server.on("connection", (socket) => {
      connections.add(socket);
      socket.on("close", () => connections.delete(socket));
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}/`,
        requests: () => requestCount,
        close: () => {
          connections.forEach((socket) => socket.destroy());
          server.close();
        },
      });
    });
    let requestCount = 0;
    server.on("request", () => {
      requestCount += 1;
    });
  });

test("a host that hangs is given up on at the deadline, once, and reported as unreachable", async () => {
  // Never answers: the request stays open.
  const hanging = await listen(() => undefined);
  let unreachable = 0;

  try {
    const startedAt = performance.now();
    const text = await safeFetchText(hanging.url, 300, () => {
      unreachable += 1;
    });
    const elapsedMs = performance.now() - startedAt;

    assert.equal(text, null);
    assert.equal(unreachable, 1);
    // One attempt, not the same request again over a second client: that
    // retry doubled the wait (and it was the 20 s of the ~31 s on production).
    assert.ok(elapsedMs < 1_000, `gave up after ${Math.round(elapsedMs)} ms`);
    assert.equal(hanging.requests(), 1);
  } finally {
    hanging.close();
  }
});

test("an answer, even an empty or a refusal, is not an unreachable host", async () => {
  const notFound = await listen((_request, response) => {
    response.statusCode = 404;
    response.end("Brak danych");
  });
  const csv = await listen((_request, response) => {
    response.statusCode = 200;
    response.end("Data,Otwarcie,Najwyzszy,Najnizszy,Zamkniecie\n2026-11-23,1,2,0.5,1.5\n");
  });
  let unreachable = 0;
  const onUnreachable = () => {
    unreachable += 1;
  };

  try {
    assert.equal(await safeFetchText(notFound.url, 1_000, onUnreachable), null);
    assert.match(String(await safeFetchText(csv.url, 1_000, onUnreachable)), /2026-11-23,1,2,0.5,1.5/);
    assert.equal(unreachable, 0);
  } finally {
    notFound.close();
    csv.close();
  }
});

const readSource = async (relativePath) =>
  (await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("Stooq history is a short, fail-fast second source behind a cooldown", async () => {
  const source = await readSource("src/lib/server/portfolio-history.ts");

  assert.match(source, /const STOOQ_HISTORY_TIMEOUT_MS = 4_000;/);
  assert.match(source, /createProviderCooldown\(\{ cooldownMs: 10 \* 60 \* 1_000 \}\)/);
  assert.match(
    source,
    /const fetchStooqCsv = async \(url: string\) => \{\n  if \(stooqHistoryCooldown\.isCoolingDown\(\)\) return null;\n\n  return safeFetchText\(url, STOOQ_HISTORY_TIMEOUT_MS, \(\) => stooqHistoryCooldown\.markUnavailable\(\)\);/
  );
  // The only Stooq history request goes through the guarded call, not the 20 s default.
  assert.equal(source.split("await fetchStooqCsv(").length - 1, 1);
  assert.equal(source.split("await safeFetchText(").length - 1, 0);
});

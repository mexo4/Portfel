import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const { CHUNK_RELOAD_GUARD_MS, CHUNK_RELOAD_KEY, CHUNK_RETRY_INLINE_SCRIPT, isChunkLoadError, reloadOnceForChunkError } = await import(
  "../src/lib/chunk-load-error.ts"
);

// Seen on production: a page chunk that Cloudflare could not fetch from the origin (525) left the
// English "This page couldn't load" screen, although the chunk loaded a moment later.

const memoryStorage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};

const chunkError = () => Object.assign(new Error("Loading chunk 6907 failed.\n(error: /_next/static/chunks/app/pricing/page.js)"), { name: "ChunkLoadError" });

test("a chunk load error is recognised by its name or its message, nothing else is", () => {
  assert.equal(isChunkLoadError(chunkError()), true);
  assert.equal(isChunkLoadError(new Error("Loading CSS chunk 12 failed.")), true);
  assert.equal(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /x.js")), true);
  assert.equal(isChunkLoadError(new Error("Cannot read properties of undefined")), false);
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError("Loading chunk 1 failed"), false);
});

test("a failed chunk reloads the page once, and not again within the guard", () => {
  const storage = memoryStorage();
  let now = 1_000_000;
  let reloads = 0;
  const environment = { storage, reload: () => (reloads += 1), now: () => now };

  assert.equal(reloadOnceForChunkError(chunkError(), environment), true);
  assert.equal(reloads, 1);
  assert.equal(storage.getItem(CHUNK_RELOAD_KEY), String(now));

  now += CHUNK_RELOAD_GUARD_MS - 1;
  assert.equal(reloadOnceForChunkError(chunkError(), environment), false, "no reload loop");
  assert.equal(reloads, 1);

  now += 2;
  assert.equal(reloadOnceForChunkError(chunkError(), environment), true, "a later failure may reload again");
  assert.equal(reloads, 2);
});

test("other errors never reload, and without storage there is no reload either", () => {
  let reloads = 0;
  const reload = () => (reloads += 1);

  assert.equal(reloadOnceForChunkError(new Error("boom"), { storage: memoryStorage(), reload, now: Date.now }), false);
  const brokenStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => {} };
  assert.equal(reloadOnceForChunkError(chunkError(), { storage: brokenStorage, reload, now: Date.now }), false);
  assert.equal(reloads, 0);
});

test("the root error screen uses the helper and speaks Polish", () => {
  const source = readFileSync(new URL("../src/app/global-error.tsx", import.meta.url), "utf8");

  assert.match(source, /^"use client";/);
  assert.match(source, /reloadOnceForChunkError\(error, \{/);
  assert.match(source, /<html lang="pl">/);
  assert.match(source, /Nie udało się wczytać strony/);
});

// Checked in a local production build: when the page's own script tag gets a 525, Next.js throws
// nothing and the page stays visible but never hydrates, so the root error screen never shows.
test("the head script reloads once for a failed Next.js script or stylesheet, never for others", () => {
  let listener = null;
  let reloads = 0;
  const storage = memoryStorage();
  const window = {
    sessionStorage: storage,
    location: { reload: () => (reloads += 1) },
    addEventListener: (type, handler, capture) => {
      assert.equal(type, "error");
      assert.equal(capture, true, "resource errors only reach a capturing listener");
      listener = handler;
    },
  };
  vm.runInNewContext(CHUNK_RETRY_INLINE_SCRIPT, { window, Date, Number, String });
  assert.equal(typeof listener, "function");

  listener({ target: { tagName: "IMG", src: "https://mexo.com.pl/_next/static/media/a.png" } });
  listener({ target: { tagName: "SCRIPT", src: "https://www.googletagmanager.com/gtag.js" } });
  listener({ target: window });
  assert.equal(reloads, 0);

  listener({ target: { tagName: "SCRIPT", src: "https://mexo.com.pl/_next/static/chunks/app/pricing/page-1.js" } });
  assert.equal(reloads, 1);
  assert.ok(storage.getItem(CHUNK_RELOAD_KEY));

  listener({ target: { tagName: "LINK", href: "https://mexo.com.pl/_next/static/css/app.css" } });
  assert.equal(reloads, 1, "the guard stops a second reload");
});

test("the root layout puts the script in the head", () => {
  const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");

  assert.match(layout, /<head>[\s\S]*<script dangerouslySetInnerHTML=\{\{ __html: CHUNK_RETRY_INLINE_SCRIPT \}\} \/>[\s\S]*<\/head>/);
});

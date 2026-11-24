import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import manifest from "../src/app/manifest.ts";

const fromApp = (path) => new URL(`../${path}`, import.meta.url);

test("the web app manifest points at icons that exist and have the declared size", () => {
  const result = manifest();

  assert.equal(result.lang, "pl");
  assert.equal(result.display, "standalone");
  assert.ok(result.icons && result.icons.length >= 2);

  for (const icon of result.icons) {
    const file = fromApp(`public${icon.src}`);
    assert.ok(existsSync(file), `${icon.src} is referenced by the manifest but missing`);

    // PNG header: width and height are big-endian uint32 at bytes 16 and 20.
    const header = readFileSync(file).subarray(0, 24);
    assert.equal(header.subarray(1, 4).toString("ascii"), "PNG");
    const declared = Number(icon.sizes.split("x")[0]);
    assert.equal(header.readUInt32BE(16), declared, `${icon.src} width`);
    assert.equal(header.readUInt32BE(20), declared, `${icon.src} height`);
  }
});

test("an iPhone home-screen icon is provided through the app directory convention", () => {
  const file = fromApp("src/app/apple-icon.png");

  assert.ok(existsSync(file));
  assert.ok(statSync(file).size < 100 * 1024, "keep the icon small");
});

test("the 404 page is Polish, not indexed, and leads back to the landing page", () => {
  const source = readFileSync(fromApp("src/app/not-found.tsx"), "utf8");

  assert.match(source, /Nie znaleziono strony/);
  assert.match(source, /index:\s*false/);
  assert.match(source, /href="\/"/);
  assert.doesNotMatch(source, /could not be found/i);
});

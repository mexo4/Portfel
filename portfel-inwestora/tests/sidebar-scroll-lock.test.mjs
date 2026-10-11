import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { acquireBodyScrollLock } from "../src/lib/client/body-scroll-lock.ts";

const readSource = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

function makeDocument({ innerWidth = 1200, clientWidth = 1185, bodyPaddingRight = "4px" } = {}) {
  const body = { style: { overflow: "auto", paddingRight: "" } };
  const documentElement = { clientWidth, style: { overflow: "auto" } };
  const documentRef = {
    body,
    documentElement,
    defaultView: {
      innerWidth,
      getComputedStyle: () => ({ paddingRight: bodyPaddingRight }),
    },
  };
  return { documentRef, body, documentElement };
}

test("workspace navigation remains scrollable while its visible scrollbar is hidden cross-browser", async () => {
  const styles = await readSource("src/app/globals.css");
  const navRule = styles.match(/\.workspace-sidebar-nav\s*\{\s*display:\s*flex([\s\S]*?)\n\}/);

  assert.ok(navRule);
  assert.match(navRule[1], /overflow-y:\s*auto/);
  assert.match(navRule[1], /scrollbar-width:\s*none/);
  assert.match(navRule[1], /-ms-overflow-style:\s*none/);
  assert.match(styles, /\.workspace-sidebar-nav::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
});

test("body scroll lock reserves scrollbar space and restores existing inline styles", () => {
  const { documentRef, body, documentElement } = makeDocument();
  body.style.overflow = "scroll";
  body.style.paddingRight = "2px";
  documentElement.style.overflow = "visible";

  const release = acquireBodyScrollLock(documentRef);

  assert.equal(body.style.overflow, "hidden");
  assert.equal(documentElement.style.overflow, "hidden");
  assert.equal(body.style.paddingRight, "19px");

  release();
  assert.equal(body.style.overflow, "scroll");
  assert.equal(body.style.paddingRight, "2px");
  assert.equal(documentElement.style.overflow, "visible");
});

test("nested modal locks keep page scrolling disabled until the final overlay closes", () => {
  const { documentRef, body, documentElement } = makeDocument();
  const releaseFirst = acquireBodyScrollLock(documentRef);
  const releaseSecond = acquireBodyScrollLock(documentRef);

  releaseFirst();
  assert.equal(body.style.overflow, "hidden");
  assert.equal(documentElement.style.overflow, "hidden");

  releaseSecond();
  assert.equal(body.style.overflow, "auto");
  assert.equal(documentElement.style.overflow, "auto");
});

test("all modal scroll-lock call sites use the shared reference-counted lock", async () => {
  const paths = [
    "src/components/PortfolioAccountManagement.tsx",
    "src/components/CurrencyPicker.tsx",
    "src/components/ImportPlatformPicker.tsx",
    "src/components/ManualAssetPriceDialog.tsx",
    "src/components/PortfolioScopePicker.tsx",
    "src/components/PortfolioLineCharts.tsx",
    "src/components/ConfigurableDashboard.tsx",
  ];
  const sources = await Promise.all(paths.map(readSource));

  for (const source of sources) {
    assert.match(source, /acquireBodyScrollLock\(document\)/);
    assert.doesNotMatch(source, /document\.body\.style\.overflow\s*=\s*["']hidden/);
  }
});

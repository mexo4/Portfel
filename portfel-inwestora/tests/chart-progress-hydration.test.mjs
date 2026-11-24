import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/components/PortfolioLineCharts.tsx", import.meta.url), "utf8");

// /analytics/charts logged "Hydration failed because the server rendered HTML
// didn't match the client" (React error #418) on every visit: the history
// progress overlay is a portal, pending from the very first render, and its
// guard `typeof document !== "undefined"` is false on the server but true while
// the client hydrates. React cannot hydrate a portal, so the whole tree was
// thrown away and rendered again. The overlay now waits until after mount.

test("the history progress overlay is gated by a mounted flag, not by typeof document", () => {
  const overlay = source.match(/\{isHistoryPending && ([^\n]+)\n\s*\? createPortal\(\s*<div className="portfolio-history-progress"/);

  assert.ok(overlay, "the progress overlay portal is still rendered under isHistoryPending");
  assert.equal(overlay[1].trim(), "isMounted");
});

test("the mounted flag is false on the server and during hydration", () => {
  assert.match(source, /const getServerMountedSnapshot = \(\) => false;/);
  assert.match(source, /const getMountedSnapshot = \(\) => true;/);
  assert.match(
    source,
    /const isMounted = useSyncExternalStore\(\s*subscribeToMount,\s*getMountedSnapshot,\s*getServerMountedSnapshot\s*\);/
  );
});

test("no portal in this component is rendered from a first-render condition via typeof document", () => {
  // The two remaining portals depend on user-driven state (the chart modal), so they
  // are false at hydration; the one that is pending from the start must not use it.
  const guards = [...source.matchAll(/\{([^\n]*typeof document !== "undefined")/g)].map((match) => match[1]);

  assert.ok(guards.every((guard) => !/isHistoryPending/.test(guard)), guards.join(" | "));
});

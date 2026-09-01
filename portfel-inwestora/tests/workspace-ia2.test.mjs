import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("workspace uses one live-route hierarchy across sidebar, tabs and command search", async () => {
  const shell = await readSource("src/components/AppWorkspaceShell.tsx");

  assert.match(shell, /id: "portfolio", label: "Portfel"/);
  assert.match(shell, /label: "Dywidendy i gotówka"/);
  assert.match(shell, /id: "analysis", label: "Analiza"/);
  assert.match(shell, /id: "market", label: "Rynek"/);
  assert.match(shell, /label: "Obserwowane"/);
  assert.match(shell, /id: "tools", label: "Narzędzia"/);
  assert.match(shell, /className="workspace-section-tabs"/);
  assert.match(shell, /className="workspace-nav-group"/);
  assert.doesNotMatch(shell, /<details[^>]*workspace-nav-group/);
});

test("command search and quick actions only target existing workspace flows", async () => {
  const shell = await readSource("src/components/AppWorkspaceShell.tsx");

  assert.match(shell, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(shell, /event\.key\.toLocaleLowerCase\(\) === "k"/);
  assert.match(shell, /role="listbox"/);
  assert.match(shell, /onQuickAdd\(\)/);
  assert.match(shell, /getWorkspaceHref\("\/portfolio\/dividends"\)/);
  assert.match(shell, /getWorkspaceHref\("\/portfolio\/import"\)/);
  assert.doesNotMatch(shell, /fetch\(/);
});

test("mobile navigation exposes the requested five-destination hierarchy", async () => {
  const shell = await readSource("src/components/AppWorkspaceShell.tsx");
  const start = shell.indexOf('<nav className="workspace-bottom-nav"');
  const end = shell.indexOf("</nav>", start);
  const mobileNav = shell.slice(start, end);

  const orderedLabels = ['directNavigation[0]!', 'label: "Portfel"', 'label: "Rynek"', 'label: "Analiza"', "Więcej"];
  let cursor = -1;
  for (const label of orderedLabels) {
    const next = mobileNav.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `${label} should occur in mobile-navigation order`);
    cursor = next;
  }
  assert.doesNotMatch(mobileNav, /workspace-mobile-add/);
});

test("dashboard visual hierarchy keeps layout identity and persistence version unchanged", async () => {
  const [dashboard, layout] = await Promise.all([
    readSource("src/components/ConfigurableDashboard.tsx"),
    readSource("src/lib/dashboard-layout.ts"),
  ]);

  assert.match(dashboard, /data-widget-id=\{widget\.id\}/);
  assert.match(dashboard, /Najważniejsze dzisiaj/);
  assert.match(layout, /DASHBOARD_LAYOUT_VERSION = 1 as const/);
});

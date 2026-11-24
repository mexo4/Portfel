import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("../src/components/EspiWorkspace.tsx", import.meta.url), "utf8");

// An account without ESPI access is hidden from the menu, but a direct visit to
// /market/espi used to render the API's 403 as "Błąd aplikacji" with a retry
// button that can never succeed.

test("a 403 from the ESPI feed is shown as missing access, not as an application error", () => {
  assert.match(workspace, /error instanceof ApiError && error\.status === 403/);
  assert.match(workspace, /Moduł ESPI nie jest dostępny dla tego konta/);
  // The error banner (and its retry button) is suppressed while access is denied.
  assert.match(workspace, /const applicationError = accessDenied\s*\? null/);
});

test("other failures keep the application error banner with its retry button", () => {
  assert.match(workspace, /<strong>Błąd aplikacji<\/strong>/);
  assert.match(workspace, /Spróbuj ponownie/);
  assert.match(workspace, /Nie udało się odczytać raportów ESPI\./);
});

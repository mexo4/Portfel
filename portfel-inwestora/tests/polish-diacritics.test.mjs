import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const { normalizePortfolioAccounts } = await import("../src/lib/operation-engine.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// The interface used to show many texts without Polish letters ("Biezace pozycje", "Ilosc",
// "Zmiana hasla", "Wyloguj sie" ...). These pin a sample of the screens that were fixed, and the
// one place where stored data needed help.

test("account names saved with the old ASCII defaults are shown with Polish letters", () => {
  const accounts = normalizePortfolioAccounts("p1", [
    { id: "a1", name: "Domyslne konto inwestycyjne", kind: "investment", currency: "PLN" },
    { id: "a2", name: "Gotowka USD", kind: "cash", currency: "USD" },
    { id: "a3", name: "Gotowka na wakacje", kind: "cash", currency: "PLN" },
    { id: "a4", name: "XTB PLN 52586271", kind: "investment", currency: "PLN" },
  ]);
  const names = Object.fromEntries(accounts.map((account) => [account.id.split(":").pop(), account.name]));

  assert.equal(names.a1, "Domyślne konto inwestycyjne");
  assert.equal(names.a2, "Gotówka USD");
  assert.equal(names.a3, "Gotowka na wakacje", "a name the user typed is never changed");
  assert.equal(names.a4, "XTB PLN 52586271");
});

test("the screens named in the 2026-11-25 report use Polish letters", () => {
  const expectations = [
    ["src/components/AssetTable.tsx", ["Bieżące pozycje", "Średni zakup", ">Ilość<"], ["Biezace pozycje", "Sredni zakup"]],
    ["src/components/WealthWorkspace.tsx", ["Pulpit majątku", "Działka", "Samochód", "Złoto"], ["Dashboard majatku", "Dzialka", "Samochod", "Zloto"]],
    ["src/components/DividendCashWorkspace.tsx", ["Konto wpływu", "Ilość akcji", "Dzień wypłaty"], ["Konto wplywu", "Ilosc akcji", "Payment date"]],
    ["src/components/UserProfilePanel.tsx", ["Imię i nazwisko"], ["Imie i nazwisko"]],
    ["src/components/ChangePasswordPanel.tsx", ["Zmiana hasła"], ["Zmiana hasla"]],
    ["src/components/PortfolioCharts.tsx", ["Najmocniejsze i najsłabsze pozycje"], ["najslabsze"]],
  ];

  for (const [path, present, absent] of expectations) {
    const source = read(path);
    for (const text of present) assert.ok(source.includes(text), `${path} contains ${text}`);
    for (const text of absent) assert.ok(!source.includes(text), `${path} no longer contains ${text}`);
  }
});

test("patterns matched against broker files and registry text keep their ASCII spelling", () => {
  // Broker headers and PDF words are compared after diacritics are removed, so these must stay ASCII.
  const importer = read("src/lib/import-operations.ts");
  assert.ok(importer.includes('saleValue: ["przychod ze sprzedazy"'));
  assert.ok(importer.includes('"SPRZEDAZ",'));
  assert.ok(importer.includes('extractLabeledNumber(chunk, ["ilosc",'));
  // Addresses and tickers are not text.
  assert.ok(read("src/lib/server/gpw-catalog.ts").includes("https://www.gpw.pl/spolka?isin="));
  assert.ok(read("src/lib/constants.ts").includes('symbol: "SIE.DE"'));
});

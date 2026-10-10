# XTB: weryfikacja importu i historycznych danych

Importer odczytuje rzeczywisty XLSX. Kolumna `Type` określa stronę
transakcji: `Stock sell` + `CLOSE BUY` to sprzedaż longa, nie zakup.
Waluta nagłówka rachunku dotyczy kwot gotówkowych; waluta konkretnej linii
notowania dotyczy ceny jednostkowej. Nieznana waluta linii lub brak
historycznego FX nie mogą być zastąpione kursem 1:1.

## Audyt danych historycznych — bez zapisów

Z katalogu `portfel-inwestora`, z już skonfigurowanym `DATABASE_URL` i CA:

```powershell
node --env-file=.env.local --experimental-strip-types --import ./tests/register-alias-loader.mjs scripts/audit-xtb-stored.ts
node --env-file=.env.local --experimental-strip-types --import ./tests/register-alias-loader.mjs scripts/audit-xtb-stored.ts --source "C:/prywatny-katalog/historia-XTB.xlsx" --output "C:/prywatny-katalog/plan-korekty.json"
```

Audyt używa transakcji `REPEATABLE READ READ ONLY`, pobiera dokumenty
partiami i nie uruchamia normalizacji ani automatycznych migracji.
Log zawiera wyłącznie liczniki. Plan zawiera identyfikatory operacji i
dowody przed/oczekiwane, dlatego musi pozostać poza repozytorium. Nie
udostępniaj go publicznie. `--apply` jest celowo zablokowane.

`STOCK_SALE_STORED_AS_BUY` i zgodne po broker ID + numerze rachunku
`SOURCE_TRADE_MISMATCH` wskazują konkretne błędy. Sam kurs 1:1, brak
proweniencji FX lub powtórzony broker ID są przesłankami do weryfikacji,
nie upoważnieniem do usuwania lub automatycznej zmiany historii.

## Bezpieczna korekta

Naprawa parsera nie zmienia dawnych importów. Ponowny import jest
deduplikowany i **nie naprawia** wcześniej zapisanego błędnego zakupu.
Nie aktualizuj pojedynczej operacji BUY→SELL bez powiązanych lotów,
sprzedaży, kosztów i aktualnego `users.portfolio_json`.

1. Zrób szyfrowany/prywatny backup aktualnej bazy standardowymi narzędziami
   PostgreSQL, poza repozytorium. Nie podawaj URI jako argumentu/logu.
2. Zgromadź kompletne XLSX każdego rachunku danego portfela oraz historię
   późniejszych ręcznych zmian. Fragment historii nie wystarcza.
3. Uruchom dry-run i porównaj źródło z oryginalnym dokumentem, zanim
   normalizacja legacy zmieni metadata w pamięci.
4. Odtwórz import w izolowanej kopii/oddzielnym testowym portfelu. Porównaj
   jednostki, saldo każdej waluty, prowizje, zrealizowane wyniki i kompletność
   ręcznych operacji. Nie usuwaj oryginalnego portfela.
5. Dopiero po zatwierdzeniu przygotuj osobną, transakcyjną korektę dla
   wskazanego portfela z kontrolą wersji dokumentu. Ten pakiet **nie zawiera
   automatycznego zapisu korekty historycznej**: bez kompletnego źródła
   mógłby utracić prawidłowe ręczne transakcje.

Osobna prowizja jest przypisywana do kosztu transakcji tylko przy zgodnym
rachunku, walucie, symbolu i dokładnym timestampie oraz jednym kandydacie.
W przeciwnym razie pozostaje kosztem zrealizowanym z ostrzeżeniem, bez
zgadywania alokacji do lotu. W obu przypadkach obciąża gotówkę tylko raz.

## Oracle: wdrożenie po zaliczeniu testów

Nie zmieniaj DNS, bazy ani działającej usługi przed poprawnym buildem.
W gałęzi `najlepsza-wersja` push uruchamia istniejący automatyczny deploy;
do czasu zamknięcia walidacji używaj gałęzi naprawczej.

Poniższe polecenia wykonuje administrator na już zweryfikowanym połączeniu
SSH. Używają aktualnego katalogu repo `/opt/mexo/repo`, nie zastępują ENV:

```bash
cd /opt/mexo/repo
git status --short
git rev-parse HEAD  # zachowaj ten commit jako punkt rollbacku
git fetch origin
git switch --detach <ZWERYFIKOWANY_COMMIT_NAPRAWY>
npm ci --no-audit --no-fund
npm --workspace portfel-inwestora test
npm run lint
npm --workspace portfel-inwestora exec -- tsc --noEmit
CIRCLE_NODE_TOTAL=2 NEXT_TELEMETRY_DISABLED=1 \
  MEXO_BUILD_REVISION="$(git rev-parse HEAD)" \
  NODE_OPTIONS="--max-old-space-size=768" npm run build
# Dopiero jeżeli wszystkie powyższe kroki zakończyły się powodzeniem:
sudo systemctl restart mexo.service
sudo systemctl is-active mexo.service
curl -fsSI https://mexo.com.pl/login
```

Przed restartem zachowaj poprzedni działający artefakt `.next` poza katalogiem
builda, z prawami dostępu jak oryginał; Next buduje do katalogu używanego przez
działający proces. Preferowany bezprzerwowy wariant to osobny katalog release
i atomowe przełączenie usługi po buildzie. Nie wdrażaj w ciemno, jeżeli nie
potwierdzono lokalizacji `WorkingDirectory` w `systemctl cat mexo.service`.

Rollback kodu: przywróć poprzedni commit i jego działający artefakt (lub
odtwórz `npm ci` + build), następnie jeden restart i smoke test. Nie
rollbackuj bazy — ten pakiet nie zmienia schema ani dawnych danych.

Smoke test: zaloguj się; wykonaj import kompletnego testowego XLSX do
osobnego portfela; porównaj saldo źródłowe każdej waluty i jednostki; sprawdź
częściową sprzedaż, wynik, reload i drugi identyczny import (0 nowych
operacji). Brak FX ma zwrócić błąd przed zapisem. Nie testuj przez ponowny
import do wcześniej błędnie odtworzonego portfela jako sposób jego naprawy.

# Dodawanie kryptowalut do portfela (23.11.2026)

`CRYPTO_UI_ENABLED` jest włączone na stałe: krypto dodaje się do portfela tak jak akcje i ETF-y (zakładka „Krypto" w formularzu, import brokerów krypto, benchmark krypto). Flaga zostaje jako wyłącznik (`false` ukrywa wejście, nie rusza zapisanych pozycji).

## Co można dodać

Formularz, jak dla akcji, **wymaga ceny z rynku** (`if (!quote && draft.kind !== "etf" ...) return`), więc moneta bez źródła ceny nie da się dodać. Przed zmianą cenę miało tylko 10 monet (para Binance wpisana na sztywno w kodzie), a CoinGecko na produkcji bywa odrzucany (limit), więc `PEPE`, `UNI` czy `SHIB` kończyły na „Brak aktualnej ceny dla tego aktywa".

Dlatego wyszukiwanie krypto zaczyna od **katalogu** (`src/lib/crypto-catalog.ts`, 93 monety): każda ma parę USDT na Binance (cena) i id CoinGecko (historia, tożsamość). Wynik wyszukiwania z katalogu zwraca się od razu, bez pytania CoinGecko. Zapytanie spoza katalogu nadal idzie do CoinGecko, ale wyniki są sortowane po kapitalizacji (`market_cap_rank`), a nie alfabetycznie: dla `pepe` pierwszy był „Based Pepe", a nie `Pepe`.

## Reguła tożsamości

Ticker nie jest tożsamością (`PEPE`, `BTC`, `ARB` istnieją na CoinGecko po kilka razy), więc:

- para Binance jest dobierana po **id CoinGecko**, nie po symbolu. Moneta, która tylko dzieli ticker z katalogową (np. `SOL` z innym id), nie dostaje jej ceny. Wcześniej `CRYPTO_SPOT_PAIRS[symbol]` tego nie sprawdzało;
- do katalogu wchodzi tylko moneta, której cena na Binance mieści się w 3% ceny CoinGecko. To dowodzi, że to ten sam aktyw (skrypt pominął np. `FRAX`: Binance 0,198 vs CoinGecko 0,99);
- stablecoiny, tokeny oparte o złoto i tokenizowane akcje są poza katalogiem.

Katalog odświeża `node scripts/generate-crypto-catalog.mjs` (tylko odczyt: 2 zapytania do Binance, 2 do CoinGecko). Nazwy i `searchTerms` (np. `matic` → POL, `ton` → GRAM) są ręczne, więc po odświeżeniu trzeba je przejrzeć.

## Ceny poniżej grosza

Kwotowanie Binance i zapasowe CoinGecko zaokrąglało cenę do 4 miejsc, więc `PEPE`, `SHIB`, `BONK`, `FLOKI` i `LUNC` (kilka milionowych dolara) wychodziły jako `0`, a `PUMP`/`JASMY`/`VET` z błędem 1–2%. Teraz 8 miejsc, jak w zapisanym stanie portfela i historii. `formatCurrency` pokazuje wartości poniżej 0,01 z 3 cyframi znaczącymi (`0,00000353 USD`), a pola ilości i ceny w formularzu mają dla krypto `step="any"`.

## Historia

Kolejność źródeł historii krypto: CoinGecko, potem **dzienne zamknięcia Binance dla tej samej pary** (nowe, `src/lib/server/binance-history.ts`), potem zapas Yahoo. Binance jest pytany tylko po pustej odpowiedzi CoinGecko, więc przy działającym CoinGecko nic się nie zmienia. Powód: darmowy plan CoinGecko odmawia zakresów starszych niż rok, a jego limit na produkcji jest często wyczerpany. Własna rodzina kluczy cache: `portfolio-history:v2:binance:<PARA>:<start>`.

## Weryfikacja

- `tests/crypto-catalog.test.mjs` (11), `tests/crypto-history-binance.test.mjs` (4); zmieniony `tests/asset-entry-capabilities.test.mjs`.
- Na żywo z maszyny deweloperskiej (23.11.2026): ceny 12 monet przez `fetchAssetQuoteServer` (m.in. `PEPE` 0,00000354, `SHIB`, `BONK`, `UNI`, `HYPE`, `GRAM`), historia `BTCUSDT` od 2017 r. (3386 dni, 4 strony), `PEPEUSDT` od 2023 r.
- **Nie sprawdzano:** dodania monety w przeglądarce (zapisałoby pozycję na koncie), zachowania Binance z IP serwera produkcyjnego dla par spoza dawnych 10 (BTC i SOL na produkcji szły z Binance), ścieżki historii przez bazę cache (testy jej nie używają; kolejność źródeł jest przypięta testem na kodzie).

## Znane ograniczenia

- Monety spoza katalogu (np. `XMR`, `KAS`, `CRO`, `MNT`, których Binance nie ma) zależą od CoinGecko/Yahoo, więc często nie dostaną ceny i nie da się ich dodać.
- Para spoza USDT i delisting pary na Binance: moneta spada na CoinGecko, potem Yahoo (jak dotąd).
- Historia z Binance to zamknięcie dnia (UTC), z CoinGecko cena z 00:00 UTC, więc przy zmianie źródła seria może się przesunąć o ok. dzień.

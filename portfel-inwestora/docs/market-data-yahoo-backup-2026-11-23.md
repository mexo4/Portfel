# Yahoo Finance jako źródło zapasowe (23.11.2026)

Gdy provider danych nie ma instrumentu albo wyczerpał limit (HTTP 402/429), część danych bierzemy z Yahoo Finance. Yahoo nie ma oficjalnego API, więc jest zawsze **ostatnim** krokiem łańcucha, a jego brak odpowiedzi kończy się tak jak przed zmianą: brak ceny, pusta historia, błąd wyszukiwania.

## Gdzie Yahoo jest zapasem

| Obszar | Główne źródło | Yahoo wchodzi, gdy | Co sprawdzamy |
|---|---|---|---|
| Cena ETF (provider `eodhd`) | EODHD | EODHD nie zwrócił ceny (brak, awaria, limit) | symbol Yahoo wyłącznie z id EODHD (`CSPX.LSE` → `CSPX.L`, `ETFBW20TR.PL` → `ETFBW20TR.WA`), nigdy z gołego tickera; ten sam symbol w odpowiedzi; waluta równa walucie aktywa |
| Cena krypto | Binance → CoinGecko | oba nie zwróciły ceny | para `<SYMBOL>-USD`, typ CRYPTO, USD, nazwa monety (niżej), znacznik czasu nie starszy niż 60 s |
| Historia krypto | CoinGecko | CoinGecko nie ma id albo zwrócił pusto (też gdy jego darmowy plan odmawia starszego zakresu) | typ CRYPTOCURRENCY, USD, nazwa monety; osobna rodzina kluczy cache `portfolio-history:v2:yahoo-crypto:...` |
| Benchmarki „Portfel vs benchmarki” | Stooq / CoinGecko | źródło główne zwróciło pusto lub błąd (np. dzienny limit Stooq) | `SPY`, `QQQ`, `BTC-USD`, zamknięcia `close` od 2000-01-01 (jak Stooq, bez `adjclose`) |
| Wyszukiwanie ETF | OpenFIGI → katalog → EODHD | wszystkie trzy puste (też przy błędzie OpenFIGI, np. limit lub zły klucz) | tylko wyniki typu ETF; waluty i giełdy nie traktujemy jako potwierdzonych |
| Źródło ceny wybranego ETF | EODHD | EODHD nie rozpoznał listingu, wynik niejednoznaczny albo błąd | listing z Yahoo: żywa wycena potwierdza symbol i podaje walutę; listing z OpenFIGI: symbol z kodu giełdy Bloomberg, Yahoo musi nazwać go ETF |

Akcje (cena i historia) i historia ETF miały Yahoo w łańcuchu już wcześniej i nic się tam nie zmieniło.

## Reguła tożsamości

Wycena zapasowa niesie **tylko cenę**. Klient kopiuje z wyceny do zapisanego aktywa `provider`, `providerId`, `marketCurrency`, `priceScale` i `name`, więc wycena z Yahoo, która zwracałaby swoją tożsamość, przełączyłaby aktywo na stałe po jednej awarii (a dla krypto `providerId` stałby się `btc-usd` i zepsuł CoinGecko oraz historię).

Dlatego wycena zapasowa ma `backupSource: "yahoo"`, a `provider`, `providerId`, `marketCurrency`, `priceScale` i `symbol` powtarzają mapowanie z żądania. Pola `name` i `instrumentType` są pominięte. Po powrocie głównego źródła aktywo samo do niego wraca. Wyjątek: ETF dodawany przez Yahoo (z wyszukiwania lub po ustaleniu źródła ceny) dostaje `provider: "yahoo"` już przy tworzeniu, bo nie ma wtedy innego źródła, do którego miałby wracać.

## Kolizje tickerów krypto

Yahoo nie rozróżnia monet po tickerze: `ARB-USD` to „ARbit”, a nie Arbitrum, `UNI-USD` nie istnieje (Uniswap to `UNI7083-USD`). Cena lub historia z Yahoo jest przyjmowana tylko wtedy, gdy nazwa monety w odpowiedzi (np. „Chainlink USD”) zgadza się ze znaną nazwą głównej monety (`BTC`, `ETH`, `BNB`, `SOL`, `XRP`, `ADA`, `DOGE`, `DOT`, `TRX`, `AVAX`, `LINK`, `LTC`) albo z id CoinGecko zapisanym przy aktywie. Inaczej nie ma ceny zapasowej, a nie ma ceny błędnej.

## Limity i logi

- `MARKET_DATA_DIAGNOSTICS=true` włącza logi `[market-data:provider]` (status odpowiedzi, `limit: true` dla 402/429, sam host i ścieżka bez query stringa, więc bez tokenów) oraz `[market-data:backup]` (obszar, wynik `used`/`no-data`/`rejected`/`skipped` i powód).
- Po 402/429 z odpowiedzi real-time EODHD nie wywołujemy już `/eod/`, bo też zostałoby odrzucone.
- Nie ma cooldownu: wyczerpany provider jest pytany przy każdym żądaniu, a łańcuch i tak idzie dalej, bo każdy provider zwraca wtedy „brak danych”. To świadoma decyzja (mniej kodu, brak stanu).

## Znane ograniczenia

- **WIG20 nie ma zapasu.** Yahoo zwraca dla `WIG20.WA` tylko bieżący dzień, bez historii dziennej. Gdy Stooq nie odpowie, benchmark WIG20 jest pomijany, a nie przybliżany innym indeksem.
- Historia krypto z Yahoo to zamknięcia dnia, a z CoinGecko ceny z 00:00 UTC, więc przy zmianie źródła seria może się przesunąć o ok. jeden dzień.
- Z IP centrum danych Yahoo bywa throttlowane (429). Wtedy zapas nic nie zwraca (jak przed zmianą). Zachowanie z IP serwera produkcyjnego nie było sprawdzane.
- Poza zakresem: wyszukiwanie krypto (nadal tylko CoinGecko), gałąź ETF w `searchMarketAssets` (UI jej nie używa), ETF bez `providerId` (nadal bez ceny automatycznej, świadoma decyzja z `market-data.ts`).

## Weryfikacja

- `tests/yahoo-backup.test.mjs`: 28 testów na podmienionym `fetch` (limit EODHD 402, CoinGecko/Binance 429, komunikat o limicie Stooq, kolizja `ARB`, waluta niezgodna, ETF bez `providerId`, wyszukiwanie przy `rate_limit` OpenFIGI, powrót Yahoo po awarii bez zapamiętania błędu).
- Test na żywo z 23.11.2026 (tylko odczyt, z maszyny deweloperskiej): ceny ETF dla `CSPX.LSE`, `VWCE.XETRA`, `SPY.US`, `IWDA.AS`, `ETFBW20TR.PL`, odrzucenie `CSPX.LSE` żądanego w GBP, ceny `BTC` i `LINK`, historia `LINK`, `SPY`/`QQQ` od 2000 r. i `BTC-USD` od 2014 r., wyszukiwanie ETF po ISIN i po nazwie, ustalenie źródła ceny dla `CSPX.L`.
- Nie sprawdzano: zachowania z IP serwera produkcyjnego oraz CI (nie uruchamia się dla plików providerów).

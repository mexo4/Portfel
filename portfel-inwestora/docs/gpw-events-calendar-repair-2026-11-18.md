# Kalendarz wydarzeń GPW: naprawa z 18.11.2026

Gałąź `fix/gpw-events-calendar-20261118` (z `najlepsza-wersja`, 78d1689). **Nic z tego nie zostało wdrożone, wypchnięte ani zastosowane na produkcyjnej bazie.** Produkcja była czytana wyłącznie w trybie `READ ONLY` (tabele rynkowe, bez danych użytkowników), a jej obraz posłużył do pomiarów offline.

Zakres: kalendarz **wydarzeń** (raporty okresowe, dywidendy, WZA/NWZA) na `/kalendarz-gpw` i w aplikacji. Kalendarz sesji giełdowych to osobny temat (gałąź `fix/gpw-session-calendar-20261118`).

## 1. Dlaczego kalendarz był błędny

| Przyczyna | Dowód | Naprawa |
|---|---|---|
| Poprawki parsera z PR #17/#18 nie dotarły do danych: dokument jest czytany ponownie tylko wtedy, gdy jego wersja projekcji różni się od wersji w kodzie, a ta nie była podbijana po zmianach parsera. | W bazie wszystkie dokumenty harmonogramów miały wersję 10 (24.10). Parser z dnia ustawienia wersji WZA/dywidend daje na korpusie 17 / 22 zdarzeń, obecny 19 / 24. | `src/lib/gpw-projection-versions.ts`, odcisk wyników parsera + test, który pada, gdy parser zmienia wynik bez podbicia wersji. Raporty 10→11, WZA 8→9, dywidendy 8→9. |
| Ponowne czytanie nie wycofywało nieaktualnych wierszy (zostawały „niejednoznaczne”), jedno wstrzymane zdarzenie blokowało cały dokument, wiersz powiązany z dwiema kopiami komunikatu (gpw.pl i PAP) był nietykalny. | Planer uruchomiony na danych z produkcji; symulacja offline (sekcja 3). | `src/lib/report-schedule-reprojection.ts` oraz `synchronizeGlobalReportSchedules`. |
| Parser gubił lub błędnie etykietował wiersze: zawinięte wiersze listy, nagłówki, daty ISO, miesiące w mianowniku, „Q1 2026”, ordinalne kwartały; w korektach brał **starą** datę za termin (Decora, Selena FM, Grupa Azoty, TALEX) albo datę cytowanego raportu/rozporządzenia za „poprzednią”. | 671 przechowywanych dokumentów, sekcja 3; każda klasa przypięta prawdziwym komunikatem w `tests/fixtures/gpw-wrapped-schedule-rows-2026-11-18.mjs`. | `src/lib/corporate-events.ts`. |
| Data końca okresu wzięta za termin publikacji (LPP: „Q4 2026, niedziela 31.01.2027”), także w wierszu utworzonym ze strony spoza kolejki ESPI. | Komunikat LPP 1/2026: „IV kwartał 2026 – od 1 listopada do 31 stycznia 2027”. | Dowód „ten dzień zamyka ten okres” w parserze i `planPeriodEndRetirements`. |
| Kolejka przeglądu była niewidoczna: powody kwarantanny zapisywano i nigdy nie czytano. | Brak czytelników w kodzie. | Panel i endpoint zdrowia kalendarza, wpisy kolejki w formie strukturalnej. |
| Literówki w źródle (Enter Air, Pharmena, IDM „Q3 2025”, ERG „Q3 2029” dla dnia w 2026) dawały niemożliwą etykietę albo wiersz w kwarantannie. | Komunikaty emitentów. | Decyzja z 18.11.2026: wiersz **bez roku**, oznaczony „Do weryfikacji”, gdy data jest jednoznaczna. |

## 2. Co zmieniono

- **Parser** (`src/lib/corporate-events.ts`): łączenie zawiniętych wierszy, nagłówki (pojedyncze, rzymskie, z rokiem), wiersze „sam zakres”, „SA-Q1/SA-P/SA-R”, daty ISO, miesiące w mianowniku, dzień tygodnia w dacie, „Q1 2026”, „trzeci kwartał”, rok `2025/26`; korekty: nowa data pierwsza albo ostatnia („poprzedni termin to”, „Wcześniej ogłoszony … ustalony był”, „pierwotna data … była ustalona”, „nowym terminem … jest dzień”, „nowo ustalony termin to:”, „Zmiana daty publikacji”), data cytowanego raportu i rozporządzenia nie rozdziela starej i nowej, lista zastępcza czytana także obok pary dat; pominięcie sprawozdania z płatności na rzecz administracji; nowy powód `REPORT_DATE_NOT_AFTER_PERIOD_END`.
- **Dowody niebędące publikacją** (`getReportScheduleNonPublicationDates`): granice okresów (też „ten dzień zamyka okres X”), dni wstępnych wyników, daty aktów prawnych.
- **Planer i synchronizacja**: wycofanie z dowodem, wstrzymane zdarzenie chroni tylko wiersze, które wyjaśnia, wiersz współdzielony przez kopie jednego komunikatu jest wycofywany, gdy wszystkie źródła (czytane ponownie) zmieniły zdanie, formalna korekta uzupełnia lub przeetykietowuje wiersze korygowanego raportu, wiersz bez roku nie dubluje istniejącego terminu.
- **Widoczność**: `src/lib/server/gpw-calendar-health.ts` (tylko SELECT), `GET /api/admin/gpw-calendar-health` (admin, `no-store`), sekcja „Kalendarz GPW” w `/admin`.
- **Strona publiczna**: etykieta „Do weryfikacji (niespójne dane w źródle)” dla raportu bez roku; opis nie twierdzi już, że kalendarz to wyłącznie rynek główny.

## 3. Pomiary

Korpus: 671 dokumentów harmonogramów i zmian terminów z produkcji (publiczne teksty ESPI), odczyt `READ ONLY` 18.11.2026.

| | HEAD (78d1689) | po naprawie |
|---|---|---|
| dokumenty z co najmniej jednym zdarzeniem raportu | 525 | 590 |
| zdarzenia raportów / z kompletną tożsamością | 1598 / 1553 | 1788 / 1772 |
| zdarzenia do przeglądu | 147 | 122 |
| przechowywane aktywne wiersze odtworzone z tą samą tożsamością | 1372 | 1392 |
| przechowywane wiersze, których dokument już nie potwierdza | 318 | 247 |

Z 15 zdarzeń, które obecny parser „traci” względem HEAD, żadne nie jest stratą: to stare daty w korektach, błędne typy i daty z granic okresów, zastąpione właściwymi.

Symulacja stanu końcowego bazy (`scripts/simulate-gpw-report-reprojection.mjs`, bez zapisu, przybliżenie):

| | teraz | po ponownym przeczytaniu |
|---|---|---|
| aktywne wiersze raportów | 1496 | 1549 |
| bez okresu lub roku | 82 | 32 (w tym 24 oznaczone „do weryfikacji”) |
| ten sam termin, dwie etykiety | 22 | 5 |
| ten sam raport, kilka dat | 0 | 0 |
| wycofane (z powodem) | – | 62: 38 ta sama data pod inną tożsamością, 10 data rozporządzenia, 8 wiersz współdzielony, 4 granica okresu, 2 koniec nazwanego okresu |

LPP: wiersz „Q4 2026, 31.01.2027” znika; GTN: Q3 przesunięty na 28.10; IDM: jeden wiersz Q3 2026 18.11; Enter Air i ERG: „Q3, do weryfikacji” zamiast niemożliwego roku.

Testy: `npm test` 926 testów, 923 przechodzi, 3 pominięte (integracja PostgreSQL), 0 błędów. `tsc --noEmit` bez błędów, `eslint` czysty dla zmienionych plików (12 istniejących błędów w `PortfolioLineCharts.tsx` nie jest mojego autorstwa).

## 4. Narzędzia

- Po zmianie parsera: `node --experimental-strip-types --import ./tests/register-alias-loader.mjs scripts/gpw-projection-fingerprint.mjs --write` (odmawia zapisu zmienionego wyniku bez podbicia wersji w `gpw-projection-versions.ts`; `--force` tylko dla kolejnej zmiany w tej samej, jeszcze niewydanej wersji).
- Symulacja na własnym obrazie: `scripts/simulate-gpw-report-reprojection.mjs --reports reports.json --events events.json` (format w nagłówku skryptu).
- Stan danych: `/admin` albo `GET /api/admin/gpw-calendar-health`.

## 5. Wdrożenie i wycofanie (nie wykonano)

1. Przed wdrożeniem: kopia lub punkt przywracania bazy, CI z testem integracyjnym PostgreSQL (`tests/gpw-postgres-integration.test.mjs`, wymaga `MEXO_GPW_TEST_DATABASE_URL`; **nie uruchomiono go lokalnie**).
2. Po wdrożeniu zwykła synchronizacja czyta ponownie dokumenty z inną wersją (100 na przebieg, co najmniej co 5 minut przy ruchu na stronie). Postęp widać w panelu jako „do ponownej oceny”.
3. Każde wycofanie jest zapisane w `corporate_event_projection_changes` z pełnym `previous_row` i powodem `REPORT_SCHEDULE_REPROJECTION:<powód>`; do przeglądu: `SELECT * FROM corporate_event_projection_changes WHERE reason LIKE 'REPORT_SCHEDULE_REPROJECTION%' ORDER BY changed_at DESC`. Przywrócenie wiersza to ustawienie `active = TRUE` i poprzedniego `status` z `previous_row` (ręcznie, po przeglądzie).
4. Nie ma przełącznika wstrzymującego ponowne czytanie; wycofanie zmiany to wycofanie wdrożenia, a wiersze wycofane do tego czasu przywraca się z `previous_row`.

## 6. Nierozstrzygnięte

- **NewConnect**: założenie „włączmy ścieżki NC” nie ma danych. W bazie jest 448 komunikatów z newconnect.pl (168 emitentów), z czego 2 to harmonogramy i oba nie dają zdarzeń (NC publikuje EBI, którego lista nie obejmuje). Spółki NC widoczne w kalendarzu (np. 4MASS, Bioceltix, Mangata, NanoGroup) trafiają tam przez listę ESPI GPW z rynkiem „GPW”; żadne dane w bazie ich nie odróżniają (katalog notowań `tab=all` zawiera je razem z rynkiem głównym). Filtra rynku nie dodano, bo nie miałby czego filtrować. Potrzebne: pole segmentu z karty emitenta gpw.pl (niedostępnej z tej maszyny) albo lista ISIN-ów NC.
- **Wcześniejsze twierdzenie o braku Santander Bank Polska było błędne**: emitent zmienił firmę na ERSTE BANK POLSKA (24.04.2026) i jego harmonogram (3/2026) jest w bazie ze statusem SUCCESS. Brak XTB wynika z tego, że XTB nie publikuje harmonogramu w ESPI. CCC S.A. nie znaleziono w `espi_reports` pod żadną nazwą (jest MODIVO S.A.); nie ustalono, czy to luka listy.
- **Źródła**: synchronizacja PAP_ESPI ma status `PARSE_ERROR` od 09.11 (ostatni sukces), backfill GPW_WZA nie jest ukończony (strona 1). To problemy operacyjne poza tą zmianą.
- Pozostałe po symulacji (8 wierszy bez okresu nieoznaczonych jako niezweryfikowane, 5 terminów z dwiema etykietami): wiersze z daty rozporządzenia utworzone przez stronę spoza kolejki i współdzielone z dwoma komunikatami (PKN, ABE), Synektik (rok obrotowy IX–X), warianty zakresu (DNP), pojedyncze przypadki (MCR, ICE, S2B). Zostają aktywne i trafiają do kolejki.
- Parser nie czyta jeszcze: wiersza półrocznego z etykietą zawiniętą i cytatem rozporządzenia (Eurotel), zmian terminu bez żadnej daty w tym samym akapicie (Bumech); 81 z 671 dokumentów nadal nie daje zdarzeń (76 z nich zapisano wcześniej jako brak zdarzeń; wśród nich 17 zmian terminu z sierpnia–listopada 2026, głównie półrocznych, już minionych; z kwartalnych m.in. Sygnity i Bumech).
- Nie wykonano: powtórki na izolowanej bazie PostgreSQL (brak lokalnej bazy, Docker nie działa), pomiaru recall na próbce 25 emitentów względem oficjalnych komunikatów (nie ma dostępu do gpw.pl z tej maszyny), testu HTTP E2E strony.
- Faza 5 (poprzednia data przy „Termin zmieniony”, strefa czasowa przy godzinie) nie została zrobiona.

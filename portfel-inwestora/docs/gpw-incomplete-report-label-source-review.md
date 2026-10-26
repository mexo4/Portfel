# GPW: źródłowy przegląd niepełnych etykiet raportów

Stan artefaktu `artifacts/gpw-quality/projections.json` podczas przeglądu: 24 anomalie `INCOMPLETE_REPORT_LABEL` (wcześniejsza lista zadania miała 21). Każdy wskazany niżej komunikat został otwarty w publicznym serwisie GPW i sprawdzony w sekcji „Treść raportu”; nie ustalano okresów z samego tickera, nazwy ani daty wydarzenia. Linki prowadzą do oficjalnych komunikatów, identyfikowanych przez `geru_id`.

| Emitent · data w projekcji | Weryfikacja treści źródła | Oficjalne źródło |
|---|---|---|
| DEL · 2026-10-29 | Raport roczny za rok obrotowy 01.07.2025–30.06.2026 (FY 2025/26); publikacja potwierdzona. | [493765](https://www.gpw.pl/komunikat?geru_id=493765) |
| ASB · 2026-11-05 | Q3 2026; okres i rok podane w harmonogramie. | [479537](https://www.gpw.pl/komunikat?geru_id=479537) |
| ICE · 2026-11-06 | Q3 2026; okres i rok podane. | [480564](https://www.gpw.pl/komunikat?geru_id=480564) |
| DAT · 2026-11-10 | Q3 2026; okres i rok podane. | [481146](https://www.gpw.pl/komunikat?geru_id=481146) |
| INP · 2026-11-24 | Q3 2026; okres i rok podane. | [479827](https://www.gpw.pl/komunikat?geru_id=479827) |
| KGN · 2026-11-24 | Q3 2026; okres i rok podane. | [480017](https://www.gpw.pl/komunikat?geru_id=480017) |
| DEL · 2026-11-25 | Q1 roku obrotowego 01.07.2026–30.06.2027; publikacja potwierdzona. | [493765](https://www.gpw.pl/komunikat?geru_id=493765) |
| RNC · 2026-11-26 | Q3 2026; okres i rok podane. | [480307](https://www.gpw.pl/komunikat?geru_id=480307) |
| SFS · 2026-11-27 | Q3 2026; okres i rok podane. | [480835](https://www.gpw.pl/komunikat?geru_id=480835) |
| SKH · 2026-11-27 | Q3 2026; okres i rok podane. | [479711](https://www.gpw.pl/komunikat?geru_id=479711) |
| TLX · 2026-11-27 | SA-Q3 (2026); okres i rok podane. | [480082](https://www.gpw.pl/komunikat?geru_id=480082) |
| FTE · 2026-12-10 | H1 roku obrotowego 2026/27, obejmujący 01.04–30.09.2026; publikacja potwierdzona. | [487377](https://www.gpw.pl/komunikat?geru_id=487377) |
| GRX · 2027-01-29 | Q2 roku obrotowego 01.07.2026–30.06.2027, tj. październik–grudzień 2026. | [497077](https://www.gpw.pl/komunikat?geru_id=497077) |
| FTE · 2027-02-25 | Q3 roku obrotowego 2026/27; publikacja potwierdzona. | [487377](https://www.gpw.pl/komunikat?geru_id=487377) |
| DEL · 2027-05-26 | Q3 roku obrotowego 01.07.2026–30.06.2027; publikacja potwierdzona. | [493765](https://www.gpw.pl/komunikat?geru_id=493765) |
| ABE · 2027-06-08 | H1 roku obrotowego 2026/27 potwierdzony **nowszym** harmonogramem; stary komunikat [475396](https://www.gpw.pl/komunikat?geru_id=475396) dotyczy analogicznej daty **2026**, nie 2027. | [499171](https://www.gpw.pl/komunikat?geru_id=499171) |
| DEL · 2027-06-30 | **Nie jest publikacją.** To koniec roku obrotowego; brak raportu kwartalnego tego dnia. Fałszywy event z parsera. | [493765](https://www.gpw.pl/komunikat?geru_id=493765) |
| S2B · 2027-06-30 | Rzeczywista publikacja **raportu półrocznego H1**, a nie kwartalnego Q1. Nowszy komunikat mówi „I półrocze roku finansowego 2026” dla FY 01.10.2026–30.09.2027; stary [487495](https://www.gpw.pl/komunikat?geru_id=487495) opisuje poprzedni harmonogram. | [498893](https://www.gpw.pl/komunikat?geru_id=498893) |
| GRX · 2027-07-30 | Q4 roku obrotowego 01.07.2026–30.06.2027, tj. kwiecień–czerwiec 2027. | [497077](https://www.gpw.pl/komunikat?geru_id=497077) |
| ABE · 2027-09-30 | **Nie jest publikacją.** To koniec roku obrotowego 2026/27. Raport roczny ma ukazać się 07.01.2028. To stara/błędna projekcja; bieżący parser na pełnej treści nowszego źródła zwraca już 07.01.2028. | [499171](https://www.gpw.pl/komunikat?geru_id=499171) |
| ATS · 2027-09-30 | Raport roczny za FY 2026/27; publikacja potwierdzona. | [499003](https://www.gpw.pl/komunikat?geru_id=499003) |
| FON · 2027-09-30 | Raport roczny za FY 2026/27; publikacja potwierdzona. | [498808](https://www.gpw.pl/komunikat?geru_id=498808) |
| IFC · 2027-09-30 | Raport roczny za FY 2026/27; publikacja potwierdzona **nowszym** harmonogramem, nie starszym [476673](https://www.gpw.pl/komunikat?geru_id=476673). | [498809](https://www.gpw.pl/komunikat?geru_id=498809) |
| IFR · 2027-09-30 | Raport roczny za FY 2026/27; publikacja potwierdzona. | [499000](https://www.gpw.pl/komunikat?geru_id=499000) |

Wynik: w 21 wierszach istnieje rzeczywisty termin publikacji i źródło podaje brakującą etykietę; 2 wiersze (DEL 30.06.2027, ABE 30.09.2027) są fałszywymi datami publikacji, a 1 (S2B 30.06.2027) ma błędny rodzaj raportu. Żaden z 24 przypadków nie wymaga zgadywania okresu z daty; informacja jest w publicznym źródle. Nie oznacza to automatycznego naprawienia istniejących zapisów w bazie — ten przegląd nie wykonywał zapisów.

Szczególnie istotne przyczyny systemowe: koniec okresu obrachunkowego może zostać pomylony z datą publikacji, starszy i nowszy harmonogram mogą dostarczyć tę samą datę dla różnych lat, a rok finansowy (np. 2026/27) nie zawsze występuje w prostym formacie oczekiwanym przez parser. Bieżący parser już prawidłowo rozpoznaje nowszą treść ABE oraz S2B, ale projekcja bazy była nieaktualna. Parser DEL nadal wytwarzał fałszywy termin z fizycznej linii zaczynającej się od `do 30.06.2027`; to zostało zreprodukowane na pełnym źródle i poprawione ogólną regułą roli daty, bez reguły dla konkretnego emitenta.

## Dziesięć kolizji spółka–dzień

To źródłowy przegląd par aktywnych wpisów w odczytanej migawce, nie polecenie automatycznego usunięcia. W żadnym z tych dziesięciu przypadków wskazane komunikaty nie potwierdzają dwóch odrębnych zapowiedzianych publikacji na ten sam dzień. Formalna reprojekcja istniejącej bazy nie została wykonana.

| Emitent · dzień | Ocena źródłowa | Oficjalny dowód |
|---|---|---|
| IDM · 18.11.2026 | Korekta zmienia omyłkowe Q3 2025 na Q3 2026; poprzednia projekcja jest nieaktualna. | [pierwotny 480804](https://www.gpw.pl/komunikat?geru_id=480804), [korekta 480817](https://www.gpw.pl/komunikat?geru_id=480817) |
| GRX · 29.01.2027 | Jeden raport Q2 FY 2026/27; drugi opis bez okresu jest logicznym duplikatem do weryfikacji projekcji. | [497077](https://www.gpw.pl/komunikat?geru_id=497077) |
| GRX · 12.03.2027 | Jeden raport H1. Skrócona nazwa roku w źródle wymaga zachowania pełnego kontekstu roku obrotowego. | [497077](https://www.gpw.pl/komunikat?geru_id=497077) |
| ABE · 08.06.2027 | Jeden H1 FY 2026/27. Stary harmonogram dotyczy analogicznej daty w 2026 roku. | [nowy 499171](https://www.gpw.pl/komunikat?geru_id=499171), [stary 475396](https://www.gpw.pl/komunikat?geru_id=475396) |
| S2B · 30.06.2027 | Jeden raport H1; Q1 jest zapowiedziany na 17.02.2027. Wpis Q1 na 30.06 ma błędny typ/okres. | [nowy 498893](https://www.gpw.pl/komunikat?geru_id=498893), [stary 487495](https://www.gpw.pl/komunikat?geru_id=487495) |
| GRX · 30.07.2027 | Jeden raport Q4 FY 2026/27; drugi opis bez kwartału jest logicznym duplikatem do weryfikacji projekcji. | [497077](https://www.gpw.pl/komunikat?geru_id=497077) |
| ATS · 30.09.2027 | Jeden FY 2026/27; starszy harmonogram dotyczy FY 2025/26 i daty w 2026 roku. | [nowy 499003](https://www.gpw.pl/komunikat?geru_id=499003), [stary 476675](https://www.gpw.pl/komunikat?geru_id=476675) |
| FON · 30.09.2027 | Jeden FY 2026/27; starszy harmonogram dotyczy FY 2025/26 i daty w 2026 roku. | [nowy 498808](https://www.gpw.pl/komunikat?geru_id=498808), [stary 476671](https://www.gpw.pl/komunikat?geru_id=476671) |
| IFC · 30.09.2027 | Jeden FY 2026/27; starszy harmonogram dotyczy FY 2025/26 i daty w 2026 roku. | [nowy 498809](https://www.gpw.pl/komunikat?geru_id=498809), [stary 476673](https://www.gpw.pl/komunikat?geru_id=476673) |
| IFR · 30.09.2027 | Jeden FY 2026/27; starszy harmonogram dotyczy FY 2025/26 i daty w 2026 roku. | [nowy 499000](https://www.gpw.pl/komunikat?geru_id=499000), [stary 476676](https://www.gpw.pl/komunikat?geru_id=476676) |

## Trzy niezależnie sprawdzone sygnały z nowego okna źródeł

Automatyczny audyt oficjalnych publikacji z 19–23.10.2026 wskazał te trzy tytuły jako potencjalne pominięte zdarzenia. Następnie sprawdzono pełną treść oficjalnego HTML, nie opierając oceny na tytule ani na wyniku parsera:

| Raport | Ocena źródłowa | Działanie względem kalendarza |
|---|---|---|
| [IMS 499094](https://www.gpw.pl/komunikat?geru_id=499094) | Warunkowa zaliczka na dywidendę: 0,18 PLN na akcję, dzień prawa 01.12.2026, wypłata 03.12.2026; wymagana jest zgoda rady nadzorczej. | Było pominięte przez parser. Po poprawce pełna oficjalna treść daje jedno zdarzenie `PROPOSED` z prawidłowymi datami i kwotą. |
| [Stalexport Autostrady 499203](https://www.gpw.pl/komunikat?geru_id=499203) | Zaliczka jest wypłacana akcjonariuszom **spółki zależnej** Stalexport Autostrada Małopolska S.A., a nie akcjonariuszom notowanego emitenta. Brak dokładnych dat i kwoty na akcję emitenta. | Fałszywy alarm heurystyki tytułowej; nie tworzyć dywidendy emitenta. |
| [Getin Holding 499304](https://www.gpw.pl/komunikat?geru_id=499304) | Formalny termin raportu za Q3 2026 zmieniono z 30.11.2026 na 28.10.2026. | Po poprawce pełna oficjalna treść daje `QUARTERLY_REPORT` z datą 28.10 i `previousEventDate` 30.11; produkcyjnej projekcji nie zmieniano. |

Ta weryfikacja dowodzi, że sama liczba `PARSER_MISSED_EVENT` nie jest liczbą rzeczywistych FN: sygnał wymaga źródłowego rozstrzygnięcia. Trzy pełne oficjalne strony GPW zostały ponownie pobrane i przepuszczone przez parser po poprawce; wynik: IMS — jedna warunkowa zaliczka, Stalexport — zero dywidend emitenta, Getin — jedna korekta daty. Nie wykonano aktualizacji istniejących rekordów Aiven ani publikacji zmian w interfejsie.

## Dodatkowy przypadek rozstrzygnięty w audycie

[Instal Kraków 499122](https://www.gpw.pl/komunikat?geru_id=499122) opisuje wstępne wyniki po trzech kwartałach. Data 20.10.2026 oznacza zakończenie ich opracowania, **nie** publikację formalnego raportu kwartalnego. Oficjalna treść zapowiada publikację raportu na 20.11.2026. Poprzedni parser tworzył fałszywe wydarzenie na 20.10; po korekcie pełny dokument wskazuje 20.11 i pozostawia rekord do przeglądu ze względu na niepełny kontekst okresu. Nie zmieniono produkcyjnej projekcji.

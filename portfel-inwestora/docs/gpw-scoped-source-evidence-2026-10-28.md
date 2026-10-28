# GPW — pakiet źródłowy dla ograniczonej naprawy (PR #17)

**Propozycja, nie zgoda na zapis.** Stan odniesienia i pełne UUID są w
[`gpw-scoped-repair-matrix-2026-10-28.md`](gpw-scoped-repair-matrix-2026-10-28.md).
Poniższe ośmioznakowe prefiksy UUID są unikalne w tej macierzy. Pakiet grupuje
**32 modyfikacje według 24 oficjalnych komunikatów GPW**, a nie według rekordów.
Źródła `475396`/`499171` i `480804`/`480817` opisują te same rekordy;
decyzje są wypisane tylko raz. Dodatkowe cztery starsze komunikaty służą
wyłącznie porównaniu lat obrotowych, nie zwiększają liczby 24 źródeł macierzy.

Każdy krótki cytat poniżej pochodzi z sekcji „Treść raportu” wskazanego
komunikatu, odczytanej z oficjalnej strony GPW 28.10.2026. Wielokropek w
cytacie oznacza pominięcie słów, **nie zmianę daty**. Tekst źródła jest
oddzielony od wniosku o rekordzie. „Wysoka” znaczy, że treść wprost określa
termin/okres lub formalną korektę, a istniejący rekord da się porównać z
projekcją; „warunkowa” oznacza, że dezaktywacja wynika z błędnego odczytania
roli daty kontekstowej i wymaga niezależnej decyzji o konkretnym rekordzie.
Sam brak terminu w harmonogramie nie dowodzi braku każdej innej publikacji. Żaden
stopień pewności **nie jest niezależnym zatwierdzeniem**. Przed zapisem trzeba
sprawdzić aktualność źródła i świeży snapshot.

Instrukcja dla recenzenta: otwórz źródło, odszukaj wskazany fragment, porównaj
pełny UUID i stan z macierzą, a przy DEACTIVATE sprawdź rekord pozostający
aktywny. W każdym wierszu wpisz **jedną** decyzję `APPROVE`, `REJECT` albo
`NEED_MORE`, swoje inicjały/datę oraz własne uzasadnienie; dla DEACTIVATE
potrzebny jest drugi recenzent. Pola poniżej celowo są puste. Odrzucenie
jednej zależnej korekty blokuje zatwierdzenie całego atomowego zakresu.

## 1. Getin Holding — `gpw:499304`

[Raport ESPI 12/2026](https://www.gpw.pl/komunikat?geru_id=499304), „Zmiana terminu przekazania raportu okresowego”. Fragment: „na dzień 30.11.2026 r., zostanie opublikowany w dniu 28.10.2026 r.” Dotyczy **raportu kwartalnego za III kwartał 2026**, nie daty publikacji samego komunikatu (23.10). Pewność: **wysoka**.

| Rekord | Obecna projekcja → propozycja | Decyzja człowieka / uzasadnienie / data |
| --- | --- | --- |
| `6d534a6e` UPDATE | Q3 2026: 30.11.2026 → 28.10.2026; zachować ID i aktywność | `___ / ___ / ___` |

## 2. Instal Kraków — `gpw:499122`

[Raport ESPI](https://www.gpw.pl/komunikat?geru_id=499122), „Wstępne wyniki finansowe po 3 kwartałach 2026 roku”. Fragment: „Ostateczne wyniki zostaną przedstawione w raporcie kwartalnym Spółki, który zostanie opublikowany w dniu 20.11.2026 roku.” Data 20.10 dotyczy **zakończenia rozliczania wstępnych wyników**, nie raportu okresowego. Istniejący link źródłowy `480882` i termin 20.11 pozostają. Pewność: **wysoka**.

| Rekord | Obecna projekcja → propozycja | Decyzja człowieka / uzasadnienie / data |
| --- | --- | --- |
| `d7eef32a` LINK_SOURCE | Q3 2026: 20.11.2026 bez zmiany; dołączyć `499122`, nie tworzyć drugiego wydarzenia | `___ / ___ / ___` |

## 3. XTPL — `gpw:499072`

[Raport ESPI](https://www.gpw.pl/komunikat?geru_id=499072), wstępne szacunkowe przychody. Fragment: „Planowany termin publikacji raportu okresowego za III kwartał i 9 miesięcy 2026 przypada w dniu 25 listopada 2026 r.” W tekście jest także prawdopodobna omyłka `III kwartale 2025` przy danych porównawczych; nie używamy jej do ustalania terminu. Istniejący link `480169` pozostaje. Pewność: **wysoka dla daty publikacji**.

| Rekord | Obecna projekcja → propozycja | Decyzja człowieka / uzasadnienie / data |
| --- | --- | --- |
| `22e5ec05` LINK_SOURCE | Q3 2026: 25.11.2026 bez zmiany; dołączyć `499072`, nie tworzyć duplikatu | `___ / ___ / ___` |

## 4. IDM — `gpw:480817` (korekta) i `gpw:480804` (oryginał)

[Korekta ESPI](https://www.gpw.pl/komunikat?geru_id=480817) mówi wprost „z uwagi na oczywistą omyłkę pisarską koryguje raport bieżący nr 1/2026” oraz wskazuje „za III kwartał 2026 r. - 18-11-2026 r.” [Pierwotny raport](https://www.gpw.pl/komunikat?geru_id=480804) miał dla tej samej daty „za III kwartał 2025 r.” To nie są dwa różne planowane raporty; aktywny pozostaje `25113cff` (Q3 2026, 18.11). Pewność: **wysoka**.

| Rekord | Obecna projekcja → propozycja | Pozostaje aktywne | Decyzja człowieka / drugi recenzent / uzasadnienie / data |
| --- | --- | --- | --- |
| `aaf7b124` DEACTIVATE | Q3 2025: 18.11.2026 → nieaktywne; zachować historię i oba źródła | `25113cff`, Q3 2026 na 18.11.2026 | `___ / ___ / ___ / ___` |

## 5. AB S.A. — `gpw:499171` (nowy rok) i `gpw:475396` (poprzedni rok)

Kontrola pochodzenia z **oryginalnych komunikatów**, nie tylko z wniosku parsera:
[PAP 50/2025](https://pap-mediaroom.pl/biznes-i-finanse/ab-sa-502025-terminy-przekazywania-przez-spolke-raportow-okresowych-w-roku)
oraz [PDF emitenta 50/2025](https://www.ab.pl/wp-content/uploads/2025/10/RB_50_2025_terminy_raportowania-1.pdf)
podają w podstawie prawnej „Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 roku”,
natomiast termin Q1 to 26.02.2026, a H1 to 08.06.2026. Analogicznie
[PAP 25/2026](https://pap-mediaroom.pl/biznes-i-finanse/ab-sa-252026-terminy-przekazywania-przez-spolke-raportow-okresowych-w-roku)
cytuje ten sam akt prawny, lecz wyznacza Q1 na 22.02.2027 i H1 na 08.06.2027.
Oba sporne rekordy są powiązane z tymi harmonogramami, mają niekompletną
tożsamość (`QUARTERLY_REPORT::`, `HALF_YEAR_REPORT:H1:`) i datę 06.06.2025.
Zestawienie fragmentu prawnego z jawnie opisanymi datami publikacji wskazuje
na **promowanie daty aktu prawnego do daty kalendarzowej**. Nie dowodzi to, że
AB nigdy nie opublikowała *jakiegokolwiek innego* raportu 06.06.2025;
dezaktywacja dotyczy tylko tych dwóch projekcji z tych źródeł.

[Harmonogram 2026/2027](https://www.gpw.pl/komunikat?geru_id=499171) wyznacza Q1 na **22.02.2027**, półrocze na **08.06.2027**, Q3 na **23.08.2027** i raport roczny na **07.01.2028**. Fragment: „Skonsolidowany Raport za rok obrotowy 2026/2027 ... zostanie opublikowany w dniu 07-01-2028 r.” Data 30.09.2027 jest **końcem okresu**, nie publikacją. [Harmonogram 2025/2026](https://www.gpw.pl/komunikat?geru_id=475396) dotyczy innego roku i wskazuje raport roczny 07.01.2027. W obu komunikatach „6 czerwca 2025 roku” oznacza datę **rozporządzenia MF**, nie termin raportu. To uzasadnia wyłączenie tych konkretnych fałszywych projekcji 06.06.2025 na podstawie roli daty w zdaniu źródłowym; nie dowodzi braku każdej możliwej publikacji tego dnia. Pewność: **wysoka dla trzech duplikatów, warunkowa dla dwóch rekordów 06.06.2025**.

| Rekord | Obecna projekcja → propozycja | Pozostaje aktywne | Decyzja człowieka / drugi recenzent / uzasadnienie / data |
| --- | --- | --- | --- |
| `d4eb35ba` DEACTIVATE | roczny na 30.09.2027 (koniec FY) → nieaktywne | `f1b9781d`, FY 2026/27 na 07.01.2028 | `___ / ___ / ___ / ___` |
| `026701ae` DEACTIVATE | osobny H1 „UNIT” 08.06.2027 → nieaktywne; emitent zapowiedział jednostkowy jako część skonsolidowanego | `df3c91a3`, H1 FY 2026/27 na 08.06.2027 | `___ / ___ / ___ / ___` |
| `bfad642e` DEACTIVATE | roczny FY bez roku 07.01.2028 → nieaktywne | `f1b9781d`, FY 2026/27 na 07.01.2028 | `___ / ___ / ___ / ___` |
| `797979f1` DEACTIVATE | kwartalny 06.06.2025 → nieaktywne; data z cytatu prawnego, nie z terminu raportu | `e681e508` Q1 FY 2025/26 i `1c1bf8c9` Q3 pozostają aktywne; nie orzekamy o innych publikacjach tego dnia | `___ / ___ / ___ / ___` |
| `e20269d0` DEACTIVATE | półroczny 06.06.2025 → nieaktywne; ten sam fragment prawny | `16e1f289` H1 FY 2025/26 i `df3c91a3` H1 FY 2026/27 pozostają aktywne | `___ / ___ / ___ / ___` |

## 6. DELKO — `gpw:493765`

Oryginalny [komunikat GPW 17/2026](https://www.gpw.pl/komunikat?geru_id=493765)
w tytule i pierwszym zdaniu opisuje „rok obrotowy trwający od 01.07.2026
do 30.06.2027”; dalej wylicza osobne terminy publikacji: Q1 25.11.2026,
H1 25.03.2027, Q3 26.05.2027. Rekord `558db458` jest kwartalny z pustym
okresem/rokiem i datą 30.06.2027, powiązany z tym źródłem. To wskazuje na
**promowanie końca roku obrotowego do daty publikacji**, a nie na dowód,
że emitent nie mógł opublikować dowolnego innego dokumentu 30.06.2027.

[Harmonogram ESPI](https://www.gpw.pl/komunikat?geru_id=493765) podaje krótko: „29.10.2026 roku”, „25.11.2026 r.”, „26.05.2027 r.” odpowiednio dla rocznego FY 2025/26, Q1 FY 2026/27 i Q3 FY 2026/27. Fragment „od 01.07.2026 do 30.06.2027” opisuje **granice roku obrotowego**, nie termin raportu 30.06.2027. Pewność: **wysoka dla trzech uzupełnień okresu, warunkowa dla dezaktywacji 30.06**.

| Rekord | Obecna projekcja → propozycja | Pozostaje aktywne | Decyzja człowieka / drugi recenzent gdy dotyczy / uzasadnienie / data |
| --- | --- | --- | --- |
| `fc1afce0` UPDATE | roczny 29.10.2026: FY pusty → FY 2025/26 | — | `___ / ___ / ___` |
| `64f527b7` UPDATE | Q1 25.11.2026: rok pusty → FY 2026/27 | — | `___ / ___ / ___` |
| `88f792d4` UPDATE | Q3 26.05.2027: rok pusty → FY 2026/27 | — | `___ / ___ / ___` |
| `558db458` DEACTIVATE | kwartalny 30.06.2027 → nieaktywne; to koniec FY, nie termin wskazanej publikacji | aktywne pozostają właściwe Q1 `64f527b7`, H1 z harmonogramu oraz Q3 `88f792d4`; inne publikacje nie są tu oceniane | `___ / ___ / ___ / ___` |

## 7. GreenX — `gpw:497077`

[Harmonogram ESPI](https://www.gpw.pl/komunikat?geru_id=497077) opisuje rok od 01.07.2026 do 30.06.2027. Fragmenty: „drugi kwartał_ - 29 stycznia 2027 r.”, „12 marca 2027 r.” i „czwarty kwartał_ - 30 lipca 2027 r.” Trzy wiersze mają te same daty i typy co wiersze z pełnym rokiem obrotowym; nie dezaktywować innych okresów ani WZA wspomnianego w tym samym raporcie. Pewność: **wysoka, przy ponownym sprawdzeniu par rekordów**.

| Rekord | Obecna projekcja → propozycja | Pozostaje aktywne | Decyzja człowieka / drugi recenzent / uzasadnienie / data |
| --- | --- | --- | --- |
| `cbaa3f37` DEACTIVATE | Q2 `::2026` 29.01.2027 → nieaktywne | `b0b2c661`, Q2 FY 2026/27, ta sama data | `___ / ___ / ___ / ___` |
| `fc9bdce2` DEACTIVATE | H1 `:2026` 12.03.2027 → nieaktywne | `c255431c`, H1 FY 2026/27, ta sama data | `___ / ___ / ___ / ___` |
| `967798d8` DEACTIVATE | Q4 `::2027` 30.07.2027 → nieaktywne | `b9ccbd42`, Q4 FY 2026/27, ta sama data | `___ / ___ / ___ / ___` |

## 8. SYN2BIO — `gpw:498893`

[Harmonogram ESPI](https://www.gpw.pl/komunikat?geru_id=498893) mówi: „jednostkowy raport półroczny _SA-P_ za I półrocze ... - 30 czerwca 2027 r.” i osobno Q1 17.02.2027. Dnia 30.06 nie ma Q1; aktywne H1 `0758efb2` musi zostać. Pewność: **wysoka**.

| Rekord | Obecna projekcja → propozycja | Pozostaje aktywne | Decyzja człowieka / drugi recenzent / uzasadnienie / data |
| --- | --- | --- | --- |
| `767dd194` DEACTIVATE | Q1 30.06.2027 → nieaktywne | `0758efb2`, H1 30.06.2027; także `e736ed7c`, Q1 17.02.2027 | `___ / ___ / ___ / ___` |

## 9–12. Roczne raporty estońskich emitentów — cztery osobne źródła

Nie są jedną spółką ani jednym wydarzeniem. Każdy [stary harmonogram FON](https://www.gpw.pl/komunikat?geru_id=476671), [IFC](https://www.gpw.pl/komunikat?geru_id=476673), [IFR](https://www.gpw.pl/komunikat?geru_id=476676) i [ATS](https://www.gpw.pl/komunikat?geru_id=476675) wskazuje 30.09.2026 dla FY 2025/26. Poniższe cztery nowe komunikaty wskazują **30.09.2027 dla FY 2026/27**. Stary rok nie może być alternatywną tożsamością nowego wydarzenia.

| Źródło i dosłowny fragment | Rekord: obecna projekcja → propozycja | Pozostaje aktywne | Pewność | Decyzja człowieka / drugi recenzent / uzasadnienie / data |
| --- | --- | --- | --- | --- |
| [FON `498808`](https://www.gpw.pl/komunikat?geru_id=498808): „Jednostkowy raport roczny za rok obrotowy 2026-2027 ... 30.09.2027 r.” | `5ad5b2d7` DEACTIVATE: FY bez roku 30.09.2027 → nieaktywne | `e47c4ebc`, FY 2026/27, 30.09.2027 | wysoka | `___ / ___ / ___ / ___` |
| [Investment Friends Capital `498809`](https://www.gpw.pl/komunikat?geru_id=498809): „30 września 2027 r. - jednostkowy raport roczny za rok obrotowy 2026/2027” | `155e2ea1` DEACTIVATE: FY bez roku 30.09.2027 → nieaktywne | `dbb1f027`, FY 2026/27, 30.09.2027 | wysoka | `___ / ___ / ___ / ___` |
| [Investment Friends `499000`](https://www.gpw.pl/komunikat?geru_id=499000): „Jednostkowy raport roczny za rok obrotowy 2026-2027 ... 30.09.2027 r.” | `387e263a` DEACTIVATE: FY bez roku 30.09.2027 → nieaktywne | `28fb4848`, FY 2026/27, 30.09.2027 | wysoka | `___ / ___ / ___ / ___` |
| [Atlantis `499003`](https://www.gpw.pl/komunikat?geru_id=499003): „Jednostkowy raport roczny za rok obrotowy 2026-2027 ... 30.09.2027 r.” | `3c80b262` DEACTIVATE: FY bez roku 30.09.2027 → nieaktywne | `f6d643d5`, FY 2026/27, 30.09.2027 | wysoka | `___ / ___ / ___ / ___` |

## 13. Grupa Forte — `gpw:487377`

[Harmonogram ESPI](https://www.gpw.pl/komunikat?geru_id=487377) określa rok 01.04.2026–31.03.2027. Fragmenty: „za I półrocze roku obrotowego 2026/27” (10.12.2026) i „za III kwartały roku obrotowego 2026/27” (25.02.2027). Pewność: **wysoka**.

| Rekord | Obecna projekcja → propozycja | Decyzja człowieka / uzasadnienie / data |
| --- | --- | --- |
| `87d41cb1` UPDATE | H1 10.12.2026: rok pusty → FY 2026/27 | `___ / ___ / ___` |
| `acf77358` UPDATE | Q3 25.02.2027: kwartał/rok puste → Q3 FY 2026/27 | `___ / ___ / ___` |

## 14–22. Jednoznaczne terminy Q3 2026 — dziewięć osobnych źródeł

Każda pozycja niżej odnosi się do **innego emitenta i raportu GPW**. Zmienia
tylko brakujący okres w istniejącym aktywnym rekordzie, nie jego datę.

| Komunikat GPW i dokładny fragment | Rekord: obecna projekcja → propozycja | Pewność | Decyzja człowieka / uzasadnienie / data |
| --- | --- | --- | --- |
| [ASBIS `479537`](https://www.gpw.pl/komunikat?geru_id=479537): „za III kw. 2026 roku - 5 listopada 2026 r.” | `47b28b21` UPDATE: 05.11, `QUARTERLY_REPORT::` → `Q3:2026` | wysoka | `___ / ___ / ___` |
| [Skarbiec `479711`](https://www.gpw.pl/komunikat?geru_id=479711): „do dnia 30 września 2026 r. - 27 listopada 2026 r.” | `2625f297` UPDATE: 27.11, `Q3:` → `Q3:2026` | wysoka | `___ / ___ / ___` |
| [INPRO `479827`](https://www.gpw.pl/komunikat?geru_id=479827): „za III kwartał 2026 r. - w dniu 24.11.2026 r.” | `4c184155` UPDATE: 24.11, `QUARTERLY_REPORT::` → `Q3:2026` | wysoka | `___ / ___ / ___` |
| [KOGENERACJA `480017`](https://www.gpw.pl/komunikat?geru_id=480017): „III kwartał - 24 listopada 2026 r.” | `22fe9002` UPDATE: 24.11, `Q3:` → `Q3:2026` (nagłówek „za 2026 rok”) | wysoka | `___ / ___ / ___` |
| [TALEX `480082`](https://www.gpw.pl/komunikat?geru_id=480082): „SA-Q3 _2026_ 27 listopada 2026 roku” | `d687beb6` UPDATE: 27.11, `QUARTERLY_REPORT::` → `Q3:2026` | wysoka | `___ / ___ / ___` |
| [REINO `480307`](https://www.gpw.pl/komunikat?geru_id=480307): „za III kw. 2026 roku - dnia 26 listopada 2026 r.” | `32716906` UPDATE: 26.11, `QUARTERLY_REPORT::` → `Q3:2026` | wysoka | `___ / ___ / ___` |
| [MEDINICE `480564`](https://www.gpw.pl/komunikat?geru_id=480564): „06.11.2026 r. - za III. kw.” | `793d5137` UPDATE: 06.11, `QUARTERLY_REPORT::` → `Q3:2026` (harmonogram 2026) | wysoka | `___ / ___ / ___` |
| [Sfinks `480835`](https://www.gpw.pl/komunikat?geru_id=480835): „27 listopada 2026 r. - Skonsolidowany Raport kwartalny za III kwartał” | `3dba107b` UPDATE: 27.11, `Q3:` → `Q3:2026` (rok obrotowy 2026) | wysoka | `___ / ___ / ___` |
| [DataWalk `481146`](https://www.gpw.pl/komunikat?geru_id=481146): „za III kwartał 2026 roku ... - 10 listopada 2026 r.” | `d31c86b2` UPDATE: 10.11, `QUARTERLY_REPORT::2026` → `Q3:2026` | wysoka | `___ / ___ / ___` |

## Wyłączenie i kontrola przed produkcją

`gpw:499257` pozostaje **REVIEW**, bez proponowanej daty i bez wiersza
decyzji. Brak wspólnego event ID/source ID w statycznym manifeście nie jest
wiecznym dowodem niezależności: po świeżym snapshotcie trzeba ponownie
sprawdzić także emitenta, ISIN, relacje source→event i nowe kolizje tożsamości.
Nie osłabiać globalnego NO-GO. Dziesięć `NO_CHANGE` z macierzy pozostaje
kontrolą niezmienności, szczególnie zachowanych wierszy GRX, ABE, IDM, S2B
i czterech raportów rocznych. WZA i dywidendy nie są objęte naprawą.

**Bilans oceny źródłowej:** 29/32 korekt ma jednoznaczny pozytywny fragment
albo formalne sprostowanie połączone z aktywnym odpowiednikiem. Trzy
dezaktywacje (`797979f1`, `e20269d0`, `558db458`) mają silne, lecz pośrednie
uzasadnienie: kontekstowa data prawna/koniec FY została błędnie podniesiona do
terminu raportu. Wymagają szczególnie uważnego ludzkiego potwierdzenia
proweniencji i braku niezależnego źródła wydarzenia. **0/32** ma w tym pakiecie
niezależną ludzką akceptację; wszystkie pola decyzji pozostają puste.

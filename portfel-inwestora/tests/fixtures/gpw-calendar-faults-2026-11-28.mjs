// Real ESPI notices (public regulatory filings, gpw.pl) behind the calendar faults found on 28.11.2026.
// gpwReportDateChanges: notices that move a periodic report. `expected` holds every report event a reader of the
// filing obtains, as [type, date, period, year, held for review]; each was read against the filing itself, or the
// report came out on that very day. gpwDividendNotices: dividend notices, as
// [identity, record date, payment date, amount per share, status]. `text` is the exact parser input.
export const gpwReportDateChanges = [
  {
    "id": "gpw:501097",
    "issuer": "SYN2BIO SPÓŁKA AKCYJNA",
    "note": "Syn2bio: annual report for the financial year 2025 (Oct–Sep) moved from 3 to 17 December",
    "expected": [
      [
        "ANNUAL_REPORT",
        "2026-12-17",
        "FY",
        "2025",
        true
      ]
    ],
    "text": "SYN2BIO SPÓŁKA AKCYJNA (21/2026) Zmiana terminu publikacji jednostkowego raportu rocznego za rok finansowy 2025\nZmiana terminu publikacji jednostkowego raportu rocznego za rok finansowy 2025\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n21\n/\n2026\n\nData sporządzenia:\n\nSkrócona nazwa emitenta\n\nSYN2BIO S.A.\n\nTemat\n\nZmiana terminu publikacji jednostkowego raportu rocznego za rok finansowy 2025\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki Syn2bio SA z siedzibą w Warszawie _\"Emitent\"_, zgodnie z § 84 ust. 2\nRozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r. w sprawie informacji bieżących\ni okresowych przekazywanych przez emitentów papierów wartościowych oraz warunków uznawania\nza równoważne informacji wymaganych przepisami prawa państwa niebędącego państwem\nczłonkowskim _Dz.U. 2025 poz. 755; dalej: \"Rozporządzenie\"_, informuje o zmianie na\ndzień 17 grudnia 2026 r. terminu przekazania do publicznej wiadomości jednostkowego\nraportu rocznego _SA-R_ za rok finansowy 2025 trwający od 1 października 2025 r. do\n30 września 2026 r.\nPierwotna data publikacji raportu rocznego była ustalona na dzień 3 grudnia 2026 r.,\nzgodnie z informacją przekazaną raportem bieżącym ESPI nr 19/2026 z 15 października\n2026 r.\nPozostałe terminy oraz informacje wskazane w ww. raporcie bieżącym nie ulegają zmianie."
  },
  {
    "id": "gpw:501064",
    "issuer": "VOXEL SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-25",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "VOXEL SPÓŁKA AKCYJNA (24/2026) Zmiana terminu publikacji skonsolidowanego raportu kwartalnego za III kwartał 2026 roku\nZmiana terminu publikacji skonsolidowanego raportu kwartalnego za III kwartał 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n24\n/\n2026\n\nData sporządzenia:\n2026-11-23\n\nSkrócona nazwa emitenta\n\nVOXEL S.A.\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego raportu kwartalnego za III kwartał 2026\nroku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd VOXEL S.A. z siedzibą w Krakowie _dalej: \"Spółka\"_ informuje o zmianie terminu\nprzekazania\ndo publicznej wiadomości skonsolidowanego raportu kwartalnego za III kwartał 2026\nroku, o którym Spółka informowała w raporcie bieżącym nr 1/2026 przekazanym do publicznej\nwiadomości\n30 stycznia 2026 roku.\n\nSkonsolidowany raport kwartalny za III kwartał 2026 roku zostanie opublikowany 25\nlistopada 2026 roku zamiast 26 listopada 2026 roku.\n\nPodstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025\nr. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim."
  },
  {
    "id": "gpw:500991",
    "issuer": "PCF GROUP SPÓŁKA AKCYJNA",
    "note": "PCF: Q3 2026 moved from 26 to 27 November; the old date follows „został określony na”",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-27",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "PCF GROUP SPÓŁKA AKCYJNA (29/2026) Zmiana daty przekazania skonsolidowanego raportu kwartalnego za trzeci kwartał 2026 roku\nZmiana daty przekazania skonsolidowanego raportu kwartalnego za trzeci kwartał 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n29\n/\n2026\n\nData sporządzenia:\n\nSkrócona nazwa emitenta\n\nPCF GROUP S.A.\n\nTemat\n\nZmiana daty przekazania skonsolidowanego raportu kwartalnego za trzeci kwartał 2026\nroku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 1/2026 z dnia 28 stycznia 2026 r., Zarząd PCF\nGroup S.A. informuje o zmianie terminu publikacji skonsolidowanego raportu kwartalnego\nza trzeci kwartał 2026 roku.\n\nSkonsolidowany raport kwartalny Grupy Kapitałowej PCF Group S.A. za trzeci kwartał\n2026 roku zostanie opublikowany 27 listopada 2026 r.\n\nStanowi to zmianę terminu publikacji powyższego raportu, który w raporcie bieżącym\nnr 1/2026 z dnia 28 stycznia 2026 r. został określony na 26 listopada 2026 r.\n\nPodstawa prawna szczegółowa: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6\nczerwca 2025 r. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów\npapierów wartościowych oraz warunków uznawania za równoważne informacji wymaganych\nprzepisami prawa państwa niebędącego państwem członkowskim."
  },
  {
    "id": "gpw:500663",
    "issuer": "BUMECH SPÓŁKA AKCYJNA",
    "note": "Bumech: „o przesunięciu terminu … na dzień 30 listopada”",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-30",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "BUMECH SPÓŁKA AKCYJNA (68/2026) Zmiana terminu publikacji raportu okresowego za trzy kwartały 2026 roku\nZmiana terminu publikacji raportu okresowego za trzy kwartały 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n68\n/\n2026\n\nData sporządzenia:\n2026-11-17\n\nSkrócona nazwa emitenta\n\nBUMECH S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za trzy kwartały 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 8/2026 z dnia 30 stycznia 2026 roku, Zarząd Emitenta\npostanawia\no przesunięciu terminu publikacji skonsolidowanego raportu za trzy kwartały 2026 roku\nna dzień\n30 listopada 2026 roku _poniedziałek_."
  },
  {
    "id": "gpw:500659",
    "issuer": "KRYNICA VITAMIN SPÓŁKA AKCYJNA",
    "note": "Krynica Vitamin: „Aktualnie planowany termin publikacji to 27 listopada”",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-27",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "KRYNICA VITAMIN SPÓŁKA AKCYJNA (24/2026) Zmiana terminu publikacji raportu za III kwartał 2026 roku\nZmiana terminu publikacji raportu za III kwartał 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n24\n/\n2026\n\nData sporządzenia:\n2026-11-17\n\nSkrócona nazwa emitenta\n\nKRYNICA VITAMIN S.A.\n\nTemat\n\nZmiana terminu publikacji raportu za III kwartał 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie informacje biece i okresowe\n\nTreść raportu:\n\nZarząd Krynica Vitamin S.A. _\"Spółka\"_ informuje o zmianie terminu przekazania do\npublicznej wiadomości raportu kwartalnego Spółki za III kwartał 2026 roku. Zgodnie\nz informacją przekazaną raportem bieżącym nr 2/2026 pierwotna data publikacji ww.\nraportu była ustalona na dzień 19 listopada 2026 r. Aktualnie planowany termin publikacji\nto 27 listopada 2026 r."
  },
  {
    "id": "gpw:500651",
    "issuer": "TRAKCJA SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-20",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "TRAKCJA SPÓŁKA AKCYJNA (56/2026) Zmiana terminu publikacji raportu okresowego za trzeci kwartał 2026 roku\nZmiana terminu publikacji raportu okresowego za trzeci kwartał 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n56\n/\n2026\n\nData sporządzenia:\n2026-11-17\n\nSkrócona nazwa emitenta\n\nTRAKCJA S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za trzeci kwartał 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki Trakcja S.A. _\"Spółka\"_ w nawiązaniu do raportu bieżącego nr 2/2026\nz dnia 20 stycznia 2026 r. informuje, że termin publikacji raportu okresowego za trzeci\nkwartał 2026 roku, planowany pierwotnie na 25 listopada 2026 r., zostaje przesunięty\nna 20 listopada 2026 r.Podstawa prawna:\n§ 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 roku w sprawie\ninformacji bieżących i okresowych przekazywanych przez emitentów papierów wartościowych\noraz warunków uznawania za równoważne informacji wymaganych przepisami prawa państwa\nniebędącego państwem członkowskim."
  },
  {
    "id": "gpw:500649",
    "issuer": "BOWIM SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-20",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "BOWIM SPÓŁKA AKCYJNA (21/2026) Zmiana terminu publikacji raportu okresowego za III kwartał 2026 r.\nZmiana terminu publikacji raportu okresowego za III kwartał 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n21\n/\n2026\n\nData sporządzenia:\n2026-11-17\n\nSkrócona nazwa emitenta\n\nBowim\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za III kwartał 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Bowim S.A. _\"Emitent\"_, działając na podstawie § 84 ust. 2 Rozporządzenia Ministra\nFinansów z dnia 6 czerwca 2025 roku w sprawie informacji bieżących i okresowych przekazywanych\nprzez emitentów papierów wartościowych oraz warunków uznawania za równoważne informacji\nwymaganych przepisami prawa państwa niebędącego państwem członkowskim _Dz. U. 2025\npoz. 755; \"Rozporządzenie\"_ informuje o zmianie terminu publikacji skonsolidowanego\nraportu kwartalnego zawierającego skrócone jednostkowe informacje finansowe za III\nkwartał 2026 r.\n\nZgodnie z raportem bieżącym nr 1/2026, Emitent ustalił następujący termin:\nI. Skonsolidowany raport kwartalny zawierający skrócone jednostkowe informacje finansowe\nza III kwartał 2026 r. - termin publikacji w dniu 26.11.2026 r.\n\nEmitent informuje, iż nowo ustalony termin to:\nI. Skonsolidowany raport kwartalny zawierający skrócone jednostkowe informacje finansowe\nza III kwartał 2026 r. - termin publikacji w dniu 20.11.2026 r.\n\nPodstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025\nroku\nw sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim _Dz. U. 2025 poz. 755_."
  },
  {
    "id": "gpw:500535",
    "issuer": "GOBARTO SPÓŁKA AKCYJNA",
    "note": "Gobarto: „zostanie opublikowany 26 listopada 2026 roku a nie 18 listopada”",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-26",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "GOBARTO SPÓŁKA AKCYJNA (11/2026) GOBARTO S.A. - zmiana terminu publikacji raportu za III kwartał 2026\nGOBARTO S.A. - zmiana terminu publikacji raportu za III kwartał 2026\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n11\n/\n2026\n\nData sporządzenia:\n2026-11-16\n\nSkrócona nazwa emitenta\n\nGOBARTO SA\n\nTemat\n\nGOBARTO S.A. - zmiana terminu publikacji raportu za III kwartał 2026\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW oparciu o § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 roku\nw sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim _dalej: Rozporządzenie_, Zarząd Gobarto\nSpółka Akcyjna z siedzibą w Warszawie _dalej: Emitent_, informuje o zmianie terminu\npublikacji skonsolidowanego raportu kwartalnego za III kwartał 2026 roku zawierającego\nkwartalną informację finansową jednostki dominującej, o której w mowa w § 63 ust.\n1 Rozporządzenia. Raport ten zostanie opublikowany 26 listopada 2026 roku a nie 18\nlistopada 2026 roku, jak Emitent informował w Raporcie bieżącym nr 1/2026 z dnia 8\nstycznia 2026 roku."
  },
  {
    "id": "gpw:500449",
    "issuer": "ASM GROUP SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-17",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "ASM GROUP SPÓŁKA AKCYJNA (13/2026) Zmiana terminu publikacji raportu kwartalnego za III kwartał 2026 roku\nZmiana terminu publikacji raportu kwartalnego za III kwartał 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n13\n/\n2026\n\nData sporządzenia:\n2026-11-12\n\nSkrócona nazwa emitenta\n\nASM GROUP S.A.\n\nTemat\n\nZmiana terminu publikacji raportu kwartalnego za III kwartał 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie informacje biece i okresowe\n\nTreść raportu:\n\nZarząd ASM Group S.A. z siedzibą w Warszawie _\"Spółka\"_ informuje o zmianie terminu\nprzekazania do publicznej wiadomości raportu kwartalnego Spółki za III kwartał 2026\nr.\n\nZgodnie z treścią raportu bieżącego nr 1/2026 z dnia 30 stycznia 2026 r., termin publikacji\nraportu kwartalnego za III kwartał 2026 r. został określony na dzień 30 listopada\n2026 r.\n\nNowy termin publikacji raportu kwartalnego za III kwartał 2026 r. został wyznaczony\nna dzień 17 listopada 2026 r.\n\npodstawa prawna: art. 56 ust. 1 pkt 2 ustawy o ofercie publicznej i warunkach wprowadzania\ninstrumentów\nfinansowych do zorganizowanego systemu obrotu oraz o spółkach publicznych w zw. z\n§ 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 roku w sprawie\ninformacji bieżących i okresowych przekazywanych przez emitentów papierów wartościowych\noraz warunków uznawania za równoważne informacji wymaganych przepisami prawa państwa\nniebędącego państwem członkowskim."
  },
  {
    "id": "gpw:500397",
    "issuer": "REINO CAPITAL SPÓŁKA AKCYJNA",
    "note": "REINO: „za III kw. 2026 roku”, new date 17 November first, the old 26 November after („uprzednio ustalona”)",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-17",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "REINO CAPITAL SPÓŁKA AKCYJNA (15/2026) Zmiana terminu publikacji raportu okresowego za III kw.2026 r.\nZmiana terminu publikacji raportu okresowego za III kw.2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n15\n/\n2026\n\nData sporządzenia:\n2026-11-12\n\nSkrócona nazwa emitenta\n\nREINO CAPITAL SA\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za III kw.2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki REINO Capital S.A. _dalej jako \"Spółka\"_, w nawiązaniu do raportu bieżącego\nnr 1/2026 z dnia 16 stycznia br., informuje o zmianie terminu publikacji rozszerzonego\nskonsolidowanego raportu kwartalnego Grupy Kapitałowej REINO Capital S.A. za III kw.\n2026 roku.\n\nNowy termin publikacji rozszerzonego skonsolidowanego raportu kwartalnego za okres\n9 miesięcy zakończony 30 września 2026 roku został wyznaczony na dzień 17 listopada\n2026 roku.\n\nData publikacji wskazanego raportu była uprzednio ustalona na dzień 26 listopada 2026\nroku.\n\nPozostałe terminy i informacje wskazane w raporcie bieżącym nr 1/2026 na dzień publikacji\nniniejszego raportu nie ulegają zmianie.Podstawa prawna:\n§ 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 29 marca 2018 r. w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa\nniebędącego państwem członkowskim"
  },
  {
    "id": "gpw:500357",
    "issuer": "BANK OCHRONY ŚRODOWISKA SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-13",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "BANK OCHRONY ŚRODOWISKA SPÓŁKA AKCYJNA (23/2026) Zmiana terminu publikacji raportu okresowego za 3Q 2026 r.\nZmiana terminu publikacji raportu okresowego za 3Q 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n23\n/\n2026\n\nData sporządzenia:\n2026-11-10\n\nSkrócona nazwa emitenta\n\nBOŚ SA\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za 3Q 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 1/2026 z dnia 21 stycznia 2026 r. Zarząd Banku\nOchrony Środowiska S.A. z siedzibą w Warszawie niniejszym informuje o zmianie terminu\nprzekazania do publicznej wiadomości Skonsolidowanego raportu kwartalnego Grupy Kapitałowej\nBOŚ S.A. za III kwartał 2026 r.\n\nPierwotna data publikacji wyżej wskazanego raportu ustalona była na 19 listopada 2026\nr.\n\nNowy termin publikacji Skonsolidowanego raportu kwartalnego Grupy Kapitałowej BOŚ\nS.A. za III kwartał 2026 r. został wyznaczony na dzień: 13 listopada 2026 r."
  },
  {
    "id": "gpw:500241",
    "issuer": "GRUPA PRACUJ SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-17",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "GRUPA PRACUJ SPÓŁKA AKCYJNA (15/2026) Zmiana terminu publikacji raportu okresowego za III kwartał 2026 r.\nZmiana terminu publikacji raportu okresowego za III kwartał 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n15\n/\n2026\n\nData sporządzenia:\n2026-11-09\n\nSkrócona nazwa emitenta\n\nGRUPA PRACUJ S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za III kwartał 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki Grupa Pracuj S.A. z siedzibą w Warszawie _\"Spółka\"_ informuje o zmianie\nterminu przekazania przez Spółkę do publicznej wiadomości skonsolidowanego raportu\nkwartalnego za\nIII kwartał 2026 r.\nZgodnie z raportem bieżącym nr 01/2026 z dnia 22 stycznia 2026 r., pierwotnie zadeklarowaną\ndatą publikacji tego raportu był dzień 19 listopada 2026 r. Nowy termin publikacji\nskonsolidowanego raportu kwartalnego za III kwartał 2026 r. wyznaczono na dzień 17\nlistopada 2026 r.\nSzczegółowa podstawa prawna:\n§ 84 ust. 2 rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r. w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa niebędącego\npaństwem członkowskim."
  },
  {
    "id": "gpw:500170",
    "issuer": "ZAKŁAD BUDOWY MASZYN ZREMB-CHOJNICE SPÓŁKA AKCYJNA",
    "note": "ZREMB: „Nowy termin … wyznaczono na 10 listopada. Dotychczasowy termin … przypadał na 20 listopada”",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-10",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "ZAKŁAD BUDOWY MASZYN ZREMB-CHOJNICE SPÓŁKA AKCYJNA (39/2026) Zmiana terminu publikacji jednostkowego raportu kwartalnego za III kwartał 2026 roku\nZmiana terminu publikacji jednostkowego raportu kwartalnego za III kwartał 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n39\n/\n2026\n\nData sporządzenia:\n2026-11-06\n\nSkrócona nazwa emitenta\n\nZREMB-CHOJNICE S.A.\n\nTemat\n\nZmiana terminu publikacji jednostkowego raportu kwartalnego za III kwartał 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Zakładu Budowy Maszyn \"ZREMB-CHOJNICE\" S.A. _\"Emitent\", \"Spółka\"_, w nawiązaniu\ndo raportu bieżącego nr 1/2026 z dnia 22 stycznia 2026 r. dotyczącego terminów publikacji\nraportów okresowych w 2026 roku, informuje o zmianie terminu przekazania do publicznej\nwiadomości jednostkowego raportu kwartalnego za III kwartał 2026 roku.\n\nNowy termin publikacji raportu wyznaczono na 10 listopada 2026 r. Dotychczasowy termin\npublikacji przypadał na 20 listopada 2026 r.\n\nSzczegółowa podstawa prawna: § 84 ust. 2 w związku z § 83 ust. 1 Rozporządzenia Ministra\nFinansów z dnia 6 czerwca 2025 r. w sprawie informacji bieżących i okresowych przekazywanych\nprzez emitentów papierów wartościowych oraz warunków uznawania za równoważne informacji\nwymaganych przepisami prawa państwa niebędącego państwem członkowskim _Dz. U. z 2025\nr. poz. 755_."
  },
  {
    "id": "gpw:500167",
    "issuer": "CFI HOLDING SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-16",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "CFI HOLDING SPÓŁKA AKCYJNA (9/2026) Zmiana terminu publikacji raportu okresowego.\nZmiana terminu publikacji raportu okresowego.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n9\n/\n2026\n\nData sporządzenia:\n2026-11-06\n\nSkrócona nazwa emitenta\n\nCFI HOLDING S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd CFI Holding S.A. z siedzibą we Wrocławiu, _dalej: \"Emitent\" \"Spółka \"_, w nawiązaniu\ndo raportu bieżącego nr 2/2026 z dnia 29 stycznia 2026 r. informuje o zmianie terminu\nprzekazania do publicznej wiadomości raportu rocznego zawierającego: Skonsolidowany\nraport kwartalny zawierający skrócone jednostkowe informacje finansowe za III kwartał\n2026 r.\n\nData publikacji wskazanego raportu zgodnie z treścią raporu bieżącego nr 2/2026 została\nustalona na dzień 9 listopada 2026 roku.\n\nNowy termin publikacji Skonsolidowanego raportu kwartalnego zawierającego skrócone\njednostkowe informacje finansowe za III kwartał 2026 r - został wyznaczony na dzień\n16 listopada 2026 roku.\n\nPozostałe terminy i informacje wskazane w raporcie bieżącym nr 2/2026 na dzień publikacji\nniniejszego raportu nie ulegają zmianie.\n\nSzczegółowa podstawa prawna:\n\n§ 80 ust. 2 Rozporządzenia Ministra Finansów z dnia 29 marca 2018 roku w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa niebędącego\npaństwem członkowskim."
  },
  {
    "id": "gpw:500084",
    "issuer": "TENDERHUT SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-09",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "TENDERHUT SPÓŁKA AKCYJNA (31/2026) Zmiana terminu publikacji raportu okresowego\nZmiana terminu publikacji raportu okresowego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n31\n/\n2026\n\nData sporządzenia:\n2026-11-05\n\nSkrócona nazwa emitenta\n\nTENDERHUT S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd TenderHut S.A. \"Emitenta\" informuje, że zmianie ulegnie termin publikacji skonsolidowanego\nraportu kwartalnego za III kwartał 2026 roku, wskazany raportem bieżącym nr 1/2026\nz dnia 12 stycznia 2026 roku. Pierwotnie wskazany na dzień 30 listopada 2026 roku\ntermin publikacji skonsolidowanego kwartalnego za III kwartał 2026 roku został przesunięty\nna dzień 9 listopada 2026 roku."
  },
  {
    "id": "gpw:500028",
    "issuer": "MAGNA POLONIA SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-27",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "MAGNA POLONIA SPÓŁKA AKCYJNA (15/2026) Zmiana terminu publikacji raportu kwartalnego za III kwartał 2026 roku\nZmiana terminu publikacji raportu kwartalnego za III kwartał 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n15\n/\n2026\n\nData sporządzenia:\n2026-11-04\n\nSkrócona nazwa emitenta\n\n06MAGNA\n\nTemat\n\nZmiana terminu publikacji raportu kwartalnego za III kwartał 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie informacje biece i okresowe\n\nTreść raportu:\n\nZarząd Magna Polonia Spółka Akcyjna _Emitent, Spółka_ informuje o zmianie terminu\nprzekazania do publicznej wiadomości skonsolidowanego raportu kwartalnego za III kwartał\n2026 roku. Raport zostanie opublikowany w dniu 27 listopada 2026 roku. Zgodnie z treścią\nraportu bieżącego nr 1/2026 z dnia 22 stycznia 2026 roku pierwotny termin publikacji\nraportu określony był na dzień 20 listopada 2026 roku."
  },
  {
    "id": "gpw:499833",
    "issuer": "LENA LIGHTING SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-05",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "LENA LIGHTING SPÓŁKA AKCYJNA (18/2026) Zmiana daty publikacji raportu za trzeci kwartał 2026 roku.\nZmiana daty publikacji raportu za trzeci kwartał 2026 roku.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n18\n/\n2026\n\nData sporządzenia:\n2026-11-02\n\nSkrócona nazwa emitenta\n\nLENA LIGHTING\n\nTemat\n\nZmiana daty publikacji raportu za trzeci kwartał 2026 roku.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Lena Lighting S.A. działając na podstawie przepisu § 84 ust. 2 pkt 2 Rozporządzenia\nMinistra Finansów z dnia 06 czerwca 2025 r. w sprawie informacji bieżących i okresowych\nprzekazywanych przez emitentów papierów wartościowych oraz warunków uznawania za równoważne\ninformacji wymaganych przepisami prawa państwa niebędącego państwem członkowskim [Dz.U.\nz 2025 r. poz. 755] informuje, że publikacja rozszerzonego raportu kwartalnego za\ntrzeci kwartał 2026 roku zawierającego skrócone skonsolidowane sprawozdanie finansowe\ngrupy oraz skrócone jednostkowe dane finansowe, którego data została wyznaczona na\ndzień 13 listopada 2026 r. _raport bieżący nr 1/2026 z dnia 23 stycznia 2026 r._,\nzostaje przesunięta na dzień 05 listopada 2026 r."
  },
  {
    "id": "gpw:499714",
    "issuer": "KORPORACJA GOSPODARCZA EFEKT SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-06",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "KORPORACJA GOSPODARCZA EFEKT SPÓŁKA AKCYJNA (15/2026) Zmiana terminu publikacji raportu okresowego\nZmiana terminu publikacji raportu okresowego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n15\n/\n2026\n\nData sporządzenia:\n2026-10-30\n\nSkrócona nazwa emitenta\n\nEFEKT\n\nTemat\n\nZmiana terminu publikacji raportu okresowego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Korporacji Gospodarczej \"efekt\" S.A. z siedzibą w Krakowie, _dalej: \"Emitent\"\n\"Spółka \"_, w nawiązaniu do raportu bieżącego nr 1/2026 z dnia 29 stycznia 2026 r.\ninformuje o zmianie terminu przekazania do publicznej wiadomości raportu rocznego\nzawierającego: Skonsolidowany raport kwartalny zawierający skrócone jednostkowe informacje\nfinansowe za III kwartał 2026 r.\n\nData publikacji wskazanego raportu zgodnie z treścią raporu bieżącego nr 1/2026 została\nustalona na dzień 30 października 2026 roku.\n\nNowy termin publikacji Skonsolidowanego raportu kwartalnego zawierającego skrócone\njednostkowe informacje finansowe za III kwartał 2026 r - został wyznaczony na dzień\n6 listopada 2026 roku.\n\nPozostałe terminy i informacje wskazane w raporcie bieżącym nr 1/2026 na dzień publikacji\nniniejszego raportu nie ulegają zmianie.\n\nSzczegółowa podstawa prawna:\n\n§ 80 ust. 2 Rozporządzenia Ministra Finansów z dnia 29 marca 2018 roku w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa niebędącego\npaństwem członkowskim."
  },
  {
    "id": "gpw:499701",
    "issuer": "MOSTOSTAL PŁOCK SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-02",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "MOSTOSTAL PŁOCK SPÓŁKA AKCYJNA (20/2026) Zmiana terminu przekazania raportu okresowego\nZmiana terminu przekazania raportu okresowego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n20\n/\n2026\n\nData sporządzenia:\n2026-10-30\n\nSkrócona nazwa emitenta\n\nMOSTALPLC\n\nTemat\n\nZmiana terminu przekazania raportu okresowego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 2/2026 z dnia 14.01.2026 roku, Zarząd Mostostal\nPłock S.A. informuje o zmianie terminu przekazania do publicznej wiadomości raportu\nza III kwartał 2026 roku.\n\nPoprzedni termin - 27.11.2026 r.\nAktualny termin - 02.11.2026 r.\n\nPodstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 06 czerwca 2025\nroku w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim _Dz.U. 2025 poz. 755_."
  },
  {
    "id": "gpw:499609",
    "issuer": "ENERGOINSTAL SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-04",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "ENERGOINSTAL SPÓŁKA AKCYJNA (22/2026) Zmiana terminu publikacji skonsolidowanego raportu kwartalnego za III kwartał 2026 r.\nZmiana terminu publikacji skonsolidowanego raportu kwartalnego za III kwartał 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n22\n/\n2026\n\nData sporządzenia:\n2026-10-29\n\nSkrócona nazwa emitenta\n\nENERGOINSTAL S.A.\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego raportu kwartalnego za III kwartał 2026\nr.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd ENERGOINSTAL S. A. w nawiązaniu do raportu bieżącego nr 1/2026 z dnia 23.01.2026\nr., informuje o zmianie terminu publikacji skonsolidowanego raportu kwartalnego za\nIII kwartał 2026 r., z dnia 19 listopada 2026 r. na dzień 04 listopada 2026 r."
  },
  {
    "id": "gpw:499578",
    "issuer": "LUNA GLOBAL SPÓŁKA AKCYJNA",
    "note": "Luna Global: second change, from 30 October to 6 November",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-11-06",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "LUNA GLOBAL SPÓŁKA AKCYJNA (27/2026) Zmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 roku\nZmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n27\n/\n2026\n\nData sporządzenia:\n\nSkrócona nazwa emitenta\n\nLUNA GLOBAL S.A.\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki LUNA GLOBAL S.A. _dalej: \"Spółka\"_, w nawiązaniu do raportu bieżącego\nnr 23/2026 z dnia 28 września 2026 r. oraz raportu bieżącego nr 26/2026 z dnia 14\npaździernika 2026 r. informuje, że dokonał ponownej weryfikacji terminu przekazania\ndo publicznej wiadomości skonsolidowanego raportu półrocznego za I półrocze 2026 roku.\nZgodnie z raportem bieżącym nr 26/2026 z dnia 14 października 2026 r., zadeklarowaną\ndatą publikacji skonsolidowanego raportu półrocznego za I półrocze 2026 r. był dzień\n30 października 2026 r. Termin ten uległ zmianie, a nowa data publikacji skonsolidowanego\nraportu półrocznego za I półrocze 2026 r. została wyznaczona na dzień 6 listopada\n2026 r.\nZmiana terminu publikacji skonsolidowanego raportu półrocznego za I półrocze 2026\nr. ma związek z dokonaną przez Spółkę rewizją podejścia co do metody księgowego rozliczenia\ntransakcji nabycia przez Spółkę 100% udziałów w kapitale zakładowym Luna Corporate\nsp. z o.o. oraz wynikającą z tego koniecznością kontynuowania, we współpracy z audytorem\nSpółki, prac związanych z przeglądem śródrocznych sprawozdań finansowych, które na\ndzień publikacji niniejszego raportu nie zostały jeszcze zakończone.\n\nSzczegółowa podstawa prawna:\n§ 84 ust. 2 rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r. w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa niebędącego\npaństwem członkowskim."
  },
  {
    "id": "gpw:499450",
    "issuer": "ODLEWNIE POLSKIE SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-10-30",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "ODLEWNIE POLSKIE SPÓŁKA AKCYJNA (15/2026) Zmiana terminu publikacji raportu okresowego za III kwartał 2026 r.\nZmiana terminu publikacji raportu okresowego za III kwartał 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n15\n/\n2026\n\nData sporządzenia:\n2026-10-27\n\nSkrócona nazwa emitenta\n\nODLEWNIE\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za III kwartał 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Spółki Akcyjnej ODLEWNIE POLSKIE z siedzibą w Starachowicach niniejszym zmienia\ndatę publikacji raportu okresowego Spółki za III kwartał 2026 roku z dnia 16 listopada\n2026 roku, podanego w terminarzu raportem bieżącym nr 1/2026 z dnia 28 stycznia 2026\nroku, na dzień 30 października 2026 roku.\n\nSzczegółowa podstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 10\nczerwca 2025 r. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów\npapierów wartościowych oraz warunków uznania za równoważne informacji wymaganych przepisami\nprawa państwa nie będącego państwem członkowskim _Dz. U. z 2025 r. poz. 755_."
  },
  {
    "id": "gpw:499402",
    "issuer": "4MASS SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-02",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "4MASS SPÓŁKA AKCYJNA (38/2026) Zmiana terminu publikacji raportu za III kwartał 2026 roku\nZmiana terminu publikacji raportu za III kwartał 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n38\n/\n2026\n\nData sporządzenia:\n2026-10-26\n\nSkrócona nazwa emitenta\n\n4MASS S.A.\n\nTemat\n\nZmiana terminu publikacji raportu za III kwartał 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd 4MASS S.A. z siedzibą w Wołominie _dalej: \"Spółka\"_, działając na podstawie\n§ 84 ust. 2 rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r. w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa niebędącego\npaństwem członkowskim, informuje o zmianie terminu przekazania raportu kwartalnego\nza III kwartał 2026 r., określonego w raporcie bieżącym nr 38/2025 z dnia 18 grudnia\n2025 r. w sprawie harmonogramu publikacji raportów okresowych w 2026 roku.\n\nPoprzednio wyznaczony termin przekazania raportu kwartalnego za III kwartał 2026 r.\nprzypadał na dzień 23 listopada 2026 r., nowym terminem przekazania raportu za III\nkwartał 2026 roku jest dzień 2 listopada 2026 r."
  },
  {
    "id": "gpw:499359",
    "issuer": "SPYROSOFT SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-27",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "SPYROSOFT SPÓŁKA AKCYJNA (19/2026) Zmiana terminu publikacji raportu kwartalnego\nZmiana terminu publikacji raportu kwartalnego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n19\n/\n2026\n\nData sporządzenia:\n2026-10-26\n\nSkrócona nazwa emitenta\n\nSPYROSOFT S.A.\n\nTemat\n\nZmiana terminu publikacji raportu kwartalnego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Spyrosoft S.A. [\"Spółka\"] informuje o zmianie terminu przekazania do publicznej\nwiadomości rozszerzonego skonsolidowanego raportu za III kwartał 2026 roku [\"Raport\nkwartalny\"].\nRaport kwartalny zostanie opublikowany w dniu 27 listopada 2026 r. zamiast, jak określono\npierwotnie w raporcie bieżącym nr 1/2026, w dniu 24 listopada 2026 r."
  },
  {
    "id": "gpw:499304",
    "issuer": "GETIN HOLDING SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-10-28",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "GETIN HOLDING SPÓŁKA AKCYJNA (12/2026) Zmiana terminu przekazania raportu okresowego\nZmiana terminu przekazania raportu okresowego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n12\n/\n2026\n\nData sporządzenia:\n2026-10-23\n\nSkrócona nazwa emitenta\n\nGETIN\n\nTemat\n\nZmiana terminu przekazania raportu okresowego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nGetin Holding S.A. informuje, że raport kwartalny za III kwartał 2026, którego termin\nprzekazania do publicznej wiadomości został wyznaczony w raporcie bieżącym nr 1/2026\nz dnia 22.01.2026 r. na dzień 30.11.2026 r., zostanie opublikowany w dniu 28.10.2026\nr.\n\nPodstawa prawna: art. 56 ust. 1 pkt 2 lit. a ustawy z dnia 29 lipca 2005 r. o ofercie\npublicznej i warunkach wprowadzania instrumentów finansowych do zorganizowanego systemu\nobrotu oraz o spółkach publicznych _Dz. U. z 2025, poz. 592, t.j. ze zm._ w związku\nz § 84 ust. 2 rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r. w sprawie\ninformacji bieżących i okresowych przekazywanych przez emitentów papierów wartościowych\noraz warunków uznawania za równoważne informacji wymaganych przepisami prawa państwa\nniebędącego państwem członkowskim _Dz. U. z 2025 r., poz. 755 ze zm._."
  },
  {
    "id": "gpw:498847",
    "issuer": "EQUNICO SE",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-16",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "EQUNICO SE (69/2026) Zmiana terminu publikacji raportu okresowego za III kwartał 2026 roku\nZmiana terminu publikacji raportu okresowego za III kwartał 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n69\n/\n2026\n\nData sporządzenia:\n2026-10-14\n\nSkrócona nazwa emitenta\n\nEQUNICO SE\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za III kwartał 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd EQUNICO SE _\"Spółka\"_ informuje o zmianie terminu publikacji skonsolidowanego\nraportu okresowego Spółki za III kwartał 2026 roku, którego publikacja, zgodnie z\nkalendarzem opublikowanym przez Spółkę w raporcie bieżącym 3/2026 z 20 stycznia 2026\nroku, miała nastąpić 27 listopada 2026 roku.\nSkonsolidowany raport okresowy Spółki za III kwartał 2026 roku zostanie przekazany\ndo publicznej wiadomości w dniu 16 listopada 2026 roku.\n\nPodstawa prawna:\n§ 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r. w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa niebędącego\npaństwem członkowskim _Dz.U. 2025 poz. 755_."
  },
  {
    "id": "gpw:498767",
    "issuer": "SYGNITY SPÓŁKA AKCYJNA",
    "note": "Sygnity: „decyzję o wyznaczeniu nowej daty publikacji Raportu na dzień 10 listopada”",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-10",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "SYGNITY SPÓŁKA AKCYJNA (28/2026) Zmiana terminu przekazania skonsolidowanego raportu kwartalnego za III kwartał roku obrotowego 2026\nZmiana terminu przekazania skonsolidowanego raportu kwartalnego za III kwartał roku obrotowego 2026\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n28\n/\n2026\n\nData sporządzenia:\n2026-10-13\n\nSkrócona nazwa emitenta\n\nSYGNITY\n\nTemat\n\nZmiana terminu przekazania skonsolidowanego raportu kwartalnego za III kwartał roku\nobrotowego 2026\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie informacje biece i okresowe\n\nTreść raportu:\n\nZarząd Sygnity S.A. z siedzibą w Warszawie _\"Spółka\"_, niniejszym informuje, że zmianie\nulega termin przekazania do publicznej wiadomości skonsolidowanego raportu okresowego\nSpółki za okres sprawozdawczy od 1 stycznia 2026 roku do 30 września 2026 roku _\"Raport\"_.\nZgodnie z raportem bieżącym nr 3/2026 z dnia 28 stycznia 2026 roku Raport miał zostać\nprzekazany do publicznej wiadomości w dniu 12 listopada 2026 roku.\n\nW dniu 13 października 2026 roku Zarząd Spółki podjął decyzję o wyznaczeniu nowej\ndaty publikacji Raportu na dzień 10 listopada 2026 roku.\n\nSzczegółowa podstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6\nczerwca 2025 r. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów\npapierów wartościowych oraz warunków uznawania za równoważne informacji wymaganych\nprzepisami prawa państwa niebędącego państwem członkowskim _Dz.U. z 2025 r. poz. 755,\nz późn. zm._."
  },
  {
    "id": "gpw:498256",
    "issuer": "ENERGA SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-05",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "ENERGA SPÓŁKA AKCYJNA (49/2026) Zmiana terminu publikacji skonsolidowanego raportu kwartalnego za III kwartał 2026 roku\nZmiana terminu publikacji skonsolidowanego raportu kwartalnego za III kwartał 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n49\n/\n2026\n\nData sporządzenia:\n\nSkrócona nazwa emitenta\n\nENERGA S.A.\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego raportu kwartalnego za III kwartał 2026\nroku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Spółki Energa SA, w nawiązaniu do raportu bieżącego nr 3/2026 z 30 stycznia\nbr. informuje, że skonsolidowany raport kwartalny Grupy Energa za III kwartał 2026\nroku, którego termin publikacji wyznaczono pierwotnie na 19 listopada 2026 roku, zostanie\nopublikowany w dniu 5 listopada 2026 roku."
  },
  {
    "id": "gpw:498075",
    "issuer": "SIMFABRIC SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-10-01",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "SIMFABRIC SPÓŁKA AKCYJNA (24/2026) Zmiana terminu publikacji rozszerzonego skonsolidowanego raportu półrocznego za I półrocze 2026 roku\nZmiana terminu publikacji rozszerzonego skonsolidowanego raportu półrocznego za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n24\n/\n2026\n\nData sporządzenia:\n2026-09-30\n\nSkrócona nazwa emitenta\n\nSIMFABRIC S.A.\n\nTemat\n\nZmiana terminu publikacji rozszerzonego skonsolidowanego raportu półrocznego za I\npółrocze 2026 roku\n\nPodstawa prawna\n\nInne uregulowania\n\nTreść raportu:\n\nZarząd SimFabric S.A. z siedzibą w Warszawie, w nawiązaniu do raportu bieżącego ESPI\n2/2026 z dnia 13.01.2026 roku, dotyczącego terminów publikacji raportów okresowych\nw 2026 roku, informuje o zmianie terminu publikacji rozszerzonego skonsolidowanego\nraportu półrocznego za I półrocze 2026 roku, którego publikacja przewidziana była\nna dzień 30 września 2026 roku.\n\nNowy termin publikacji rozszerzonego skonsolidowanego raportu półrocznego za I półrocze\n2026 roku został ustalony na dzień 1 października 2026 roku."
  },
  {
    "id": "gpw:497801",
    "issuer": "NANOGROUP SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-10-29",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "NANOGROUP SPÓŁKA AKCYJNA (46/2026) Zmiana terminu publikacji raportu okresowego\nZmiana terminu publikacji raportu okresowego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n46\n/\n2026\n\nData sporządzenia:\n2026-09-28\n\nSkrócona nazwa emitenta\n\nNANOGROUP S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd NanoGroup S.A. _\"Spółka\", \"Emitent\"_ w nawiązaniu do raportu bieżącego z dnia\n20 stycznia 2026 r. oznaczonego numerem 2/2026, informuje o zmianie terminu przekazania\ndo publicznej wiadomości skonsolidowanego raportu kwartalnego za III kwartał 2026\nroku.\nPoprzedni termin - 26 listopada 2026 r.\nAktualny termin - 29 października 2026 r."
  },
  {
    "id": "gpw:497722",
    "issuer": "NEW TECH CAPITAL SPÓŁKA AKCYJNA",
    "note": "New Tech Capital: 30 instead of 29 September; „połrocze” misspelt, so no year",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        null,
        true
      ]
    ],
    "text": "NEW TECH CAPITAL SPÓŁKA AKCYJNA (15/2026) Zmiana daty publikacji raportu półrocznego.\nZmiana daty publikacji raportu półrocznego.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n15\n/\n2026\n\nData sporządzenia:\n2026-09-25\n\nSkrócona nazwa emitenta\n\nNEW TECH CAPITAL S.A.\n\nTemat\n\nZmiana daty publikacji raportu półrocznego.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nNew Tech Capital S.A. informuje, że raport za pierwsze połrocze 2026 r. zostanie opublikowany\n30 września 2026 r., a nie jak wcześniej planowano 29 września 2026 r."
  },
  {
    "id": "gpw:497720",
    "issuer": "FOODHUB SPÓŁKA AKCYJNA",
    "note": "FoodHub: 30 September; two earlier dates (29 and 25 September) are both replaced",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "FOODHUB SPÓŁKA AKCYJNA (25/2026) Zmiana terminu publikacji skonsolidowanego rozszerzonego raportu okresowego za I półrocze 2026 r\nZmiana terminu publikacji skonsolidowanego rozszerzonego raportu okresowego za I półrocze 2026 r\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n25\n/\n2026\n\nData sporządzenia:\n2026-09-25\n\nSkrócona nazwa emitenta\n\nFoodHub S.A.\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego rozszerzonego raportu okresowego za I półrocze\n2026 r\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd FoodHub S.A. informuje o zmianie terminu przekazania do publicznej wiadomości\nskonsolidowanego rozszerzonego raportu okresowego FoodHub S.A. za I półrocze 2026\nr. Raport, o którym mowa powyżej opublikowany zostanie w dniu 30 września 2026 r.\nZgodnie z treścią raportu bieżącego nr 1/2026 z dnia 21 stycznia 2026 r. i treścią\nraporty bieżącego 23/2026 z 21 września 2026 r. raport miał zostać opublikowany w\ndniu 29 września 2026 r.\n\nPierwotny termin publikacji ww. raportu określony był na dzień 25 września 2026 r."
  },
  {
    "id": "gpw:497683",
    "issuer": "M.W. TRADE SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "M.W. TRADE SPÓŁKA AKCYJNA (30/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n30\n/\n2026\n\nData sporządzenia:\n2026-09-25\n\nSkrócona nazwa emitenta\n\nM.W. TRADE\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki M.W. Trade S.A. z siedzibą we Wrocławiu _\"Spółka\"; \"Emitent\"_ informuje,\nże termin publikacji skonsolidowanego raportu za I półrocze 2026 roku, wyznaczony\nzgodnie z raportem bieżącym nr 1/2026 z dnia 19 stycznia 2026 roku, na dzień 28 września\n2026 roku, zostaje przesunięty na dzień 30 września 2026 roku.\n\nPrzesunięcie terminu spowodowane jest zwiększonym zakresem prac księgowych związanych\nz włączeniem do Grupy Kapitałowej spółki Sigma Defence S.A. _poprzednio VR Factory\nGames S.A._.\n\nPozostałe terminy publikacji raportów okresowych pozostają bez zmian.\n\nPodstawa prawna: § 84 ust.2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025\nroku w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim.Rafał Wasilewski - Prezes Zarządu\nM.W. Trade S.A.\n\nMaciej Mizuro - Wiceprezes Zarządu M.W. Trade S.A."
  },
  {
    "id": "gpw:497677",
    "issuer": "PKP CARGO SPÓŁKA AKCYJNA W RESTRUKTURYZACJI",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "PKP CARGO SPÓŁKA AKCYJNA W RESTRUKTURYZACJI (78/2026) Zmiana terminu przekazania do publicznej wiadomości skonsolidowanego raportu za I półrocze 2026 roku\nZmiana terminu przekazania do publicznej wiadomości skonsolidowanego raportu za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n78\n/\n2026\n\nData sporządzenia:\n2026-09-25\n\nSkrócona nazwa emitenta\n\nPKP CARGO S.A. W RESTRUKTURYZACJI\n\nTemat\n\nZmiana terminu przekazania do publicznej wiadomości skonsolidowanego raportu za I\npółrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 1/2026 z dnia 12 stycznia 2026 roku Zarządca\nmasy sanacyjnej PKP CARGO S.A. w restrukturyzacji _\"Spółka\"_ informuje, iż podjął\ndecyzję o zmianie terminu publikacji skonsolidowanego raportu Spółki za I półrocze\n2026 roku z dnia 28 września 2026 roku na 30 września 2026 roku.\n\nPozostałe terminy publikacji raportów okresowych Spółki w 2026 roku pozostają bez\nzmian."
  },
  {
    "id": "gpw:497675",
    "issuer": "ALL IN! GAMES SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "ALL IN! GAMES SPÓŁKA AKCYJNA (22/2026) Zmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 r.\nZmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n22\n/\n2026\n\nData sporządzenia:\n2026-09-25\n\nSkrócona nazwa emitenta\n\nALL IN! GAMES S.A.\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie informacje biece i okresowe\n\nTreść raportu:\n\nZarząd All in! Games S.A. z siedzibą w Krakowie _\"Spółka\"_ w nawiązaniu do raportu\nESPI nr 1/2026 z dnia 12 stycznia 2026 r. _w którym Spółka przekazała terminy\npublikacji raportów okresowych w 2026 r._, niniejszym informuje o zmianie terminu\npublikacji skonsolidowanego raportu za I półrocze 2026 r. z dnia 29 września 2026\nr.\nna dzień 30 września 2026 r.\nZarząd przypomina, że zgodnie z §63 ust. 3 Rozporządzenia Ministra Finansów z\ndnia 6 czerwca 2025 r. w sprawie informacji bieżących i okresowych przekazywanych\nprzez emitentów papierów wartościowych oraz warunków uznawania za równoważne\ninformacji wymaganych przepisami prawa państwa niebędącego państwem\nczłonkowskim, w skonsolidowanym raporcie za I półrocze 2026 r. zawarte będzie\npółroczne skrócone jednostkowe sprawozdanie finansowe Spółki za ten okres. Tym\nsamym Spółka nie będzie przekazywać odrębnego jednostkowego raportu\npółrocznego."
  },
  {
    "id": "gpw:497553",
    "issuer": "ZAKŁADY PRZEMYSŁU CUKIERNICZEGO OTMUCHÓW SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-28",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "ZAKŁADY PRZEMYSŁU CUKIERNICZEGO OTMUCHÓW SPÓŁKA AKCYJNA (19/2026) Zmiana terminu publikacji rozszerzonego skonsolidowanego raportu za I półrocze 2026 roku.\nZmiana terminu publikacji rozszerzonego skonsolidowanego raportu za I półrocze 2026 roku.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n19\n/\n2026\n\nData sporządzenia:\n2026-09-24\n\nSkrócona nazwa emitenta\n\nZPC OTMUCHÓW S.A.\n\nTemat\n\nZmiana terminu publikacji rozszerzonego skonsolidowanego raportu za I półrocze 2026\nroku.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd ZPC OTMUCHÓW S.A. [Spółka] informuje o zmianie terminu przekazania przez Spółkę\ndo publicznej wiadomości rozszerzonego skonsolidowanego raportu za I półrocze 2026\nroku z pierwotnie deklarowanego terminu publikacji, tj. z dnia 30 września 2026 roku,\nna nowy termin publikacji tj. na dzień 28 września 2026 r."
  },
  {
    "id": "gpw:497455",
    "issuer": "AILLERON SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-28",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "AILLERON SPÓŁKA AKCYJNA (26/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n26\n/\n2026\n\nData sporządzenia:\n2026-09-23\n\nSkrócona nazwa emitenta\n\nAILLERON S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Ailleron SA z siedzibą w Krakowie _\"Spółka\"_, działając na podstawie § 84 ust.\n2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 roku w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa niebędącego\npaństwem członkowskim, niniejszym informuje o zmianie terminu przekazania przez Spółkę\ndo publicznej wiadomości skonsolidowanego raportu półrocznego za I półrocze 2026 roku.\n\nZgodnie z treścią raportu bieżącego ESPI nr 3/2026 z dnia 15 stycznia 2026 r. pierwotny\ntermin publikacji skonsolidowanego raportu półrocznego za I półrocze 2026 roku został\nokreślony na dzień\n29 września 2026 r. Spółka informuje, że raport ten zostanie opublikowany w dniu 28\nwrześnia 2026 r."
  },
  {
    "id": "gpw:497434",
    "issuer": "TOWER INVESTMENTS SPÓŁKA AKCYJNA",
    "note": "Tower Investments: „nową datą publikacji … będzie dzień 29 września”",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-29",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "TOWER INVESTMENTS SPÓŁKA AKCYJNA (27/2026) Zmiana terminu publikacji raportu półrocznego\nZmiana terminu publikacji raportu półrocznego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n27\n/\n2026\n\nData sporządzenia:\n2026-09-22\n\nSkrócona nazwa emitenta\n\nTOWER INVESTMENTS S.A.\n\nTemat\n\nZmiana terminu publikacji raportu półrocznego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Tower Investments S.A. _Spółka_ w nawiązaniu do raportu bieżącego nr 5/2026\nz dnia 31 stycznia 2026 r. w sprawie terminów publikacji raportów okresowych w roku\nobrotowym 2026, informuje, że niniejszym dokonuje zmiany terminu publikacji raportu\nśródrocznego za I półrocze 2026 roku.\n\nZgodnie z treścią raportu bieżącego nr 5/2026 publikacja tego planowana była na dzień\n25 września 2026 roku. Zarząd Spółki informuje, że nową datą publikacji raportu za\nI półrocze 2026 roku będzie dzień 29 września 2026 r."
  },
  {
    "id": "gpw:497431",
    "issuer": "SCANWAY SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-29",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "SCANWAY SPÓŁKA AKCYJNA (41/2026) Zmiana terminu publikacji raportu półrocznego\nZmiana terminu publikacji raportu półrocznego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n41\n/\n2026\n\nData sporządzenia:\n2026-09-22\n\nSkrócona nazwa emitenta\n\nSCANWAY S.A.\n\nTemat\n\nZmiana terminu publikacji raportu półrocznego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie informacje biece i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 8/2026 w sprawie harmonogramu publikacji raportów\nokresowych w 2026 roku, Zarząd Scanway S.A. informuje o zmianie terminu publikacji\nskonsolidowanego raportu za I półrocze 2026 roku, który zostanie opublikowany w dniu\n29 września 2026 r. zamiast, jak wskazano pierwotnie w ww. raporcie, w dniu 30 września\n2026 r."
  },
  {
    "id": "gpw:497430",
    "issuer": "FOODHUB SPÓŁKA AKCYJNA",
    "note": "FoodHub correction: the typo 2025 corrected, 29 September 2026",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-29",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "FOODHUB SPÓŁKA AKCYJNA (23/2026) Korekta raportu bieżącego nr 23/2026 z w sprawie zmiany terminu publikacji skonsolidowanego rozszerzonego raportu okresowego za I półrocze 2026 r.\nKorekta raportu bieżącego nr 23/2026 z w sprawie zmiany terminu publikacji skonsolidowanego rozszerzonego raportu okresowego za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n23\n/\n2026\nK\n\nData sporządzenia:\n2026-09-22\n\nSkrócona nazwa emitenta\n\nFoodHub S.A.\n\nTemat\n\nKorekta raportu bieżącego nr 23/2026 z w sprawie zmiany terminu publikacji skonsolidowanego\nrozszerzonego raportu okresowego za I półrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd FoodHub S.A. przekazuje korektę raportu bieżącego nr 23/2026 z dnia 21 września\n2026 r. Korekta dotyczy omyłki pisarskiej w planowanej dacie publikacji raportu -\nbyło: \"29 września 2025 r.\", powinno być: \"29 września 2026 r.\"\n\nPełna treść raportu bieżącego po dokonaniu korekty jest następująca:\n\nZarząd FoodHub S.A. informuje o zmianie terminu przekazania do publicznej wiadomości\nskonsolidowanego rozszerzonego raportu okresowego FoodHub S.A. za I półrocze 2026\nr. Raport, o którym mowa powyżej opublikowany zostanie w dniu 29 września 2026 r.\nZgodnie z treścią raportu bieżącego nr 1/2026 z dnia 21 stycznia 2026 r. pierwotny\ntermin publikacji ww. raportu określony był na dzień 25 września 2026 r."
  },
  {
    "id": "gpw:497416",
    "issuer": "INC SPÓŁKA AKCYJNA",
    "note": "INC: „który miał być opublikowany w dniu 24 września …, zostanie opublikowany w dniu 29 września”",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-29",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "INC SPÓŁKA AKCYJNA (18/2026) Zmiana terminu publikacji raportu okresowego\nZmiana terminu publikacji raportu okresowego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n18\n/\n2026\n\nData sporządzenia:\n2026-09-22\n\nSkrócona nazwa emitenta\n\nINC\n\nTemat\n\nZmiana terminu publikacji raportu okresowego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Spółki informuje, że skonsolidowany raport półroczny PSr za I półrocze 2026\nr. zawierający skrócone jednostkowe informacje finansowe, który miał być opublikowany\nw dniu 24 września 2026 r., zostanie opublikowany w dniu 29 września 2026 r."
  },
  {
    "id": "gpw:497361",
    "issuer": "FOODHUB SPÓŁKA AKCYJNA",
    "note": "FoodHub: the source says 29 September 2025 (a typo it corrected the next day)",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2025-09-29",
        "H1",
        "2026",
        true
      ]
    ],
    "text": "FOODHUB SPÓŁKA AKCYJNA (23/2026) Zmiana terminu publikacji skonsolidowanego rozszerzonego raportu okresowego za I półrocze 2026 r.\nZmiana terminu publikacji skonsolidowanego rozszerzonego raportu okresowego za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n23\n/\n2026\n\nData sporządzenia:\n2026-09-21\n\nSkrócona nazwa emitenta\n\nFoodHub S.A.\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego rozszerzonego raportu okresowego za I półrocze\n2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd FoodHub S.A. informuje o zmianie terminu przekazania do publicznej wiadomości\nskonsolidowanego rozszerzonego raportu okresowego FoodHub S.A. za I półrocze 2026\nr. Raport, o którym mowa powyżej opublikowany zostanie w dniu 29 września 2025 r.\nZgodnie z treścią raportu bieżącego nr 1/2026 z dnia 21 stycznia 2026 r. pierwotny\ntermin publikacji ww. raportu określony był na dzień 25 września 2026 r."
  },
  {
    "id": "gpw:497362",
    "issuer": "CFI HOLDING SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-25",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "CFI HOLDING SPÓŁKA AKCYJNA (8/2026) Zmiana terminu publikacji raportu okresowego.\nZmiana terminu publikacji raportu okresowego.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n8\n/\n2026\n\nData sporządzenia:\n2026-09-21\n\nSkrócona nazwa emitenta\n\nCFI HOLDING S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd CFI Holding S.A. z siedzibą we Wrocławiu _dalej: \"Emitent\" \"Spółka \"_, w nawiązaniu\ndo raportu bieżącego nr 2/2026 z dnia 29 stycznia 2026 r., informuje o zmianie terminu\nprzekazania do publicznej wiadomości raportu okresowego zawierającego: Skonsolidowany\nraport za I półrocze 2026 roku zawierający skrócone jednostkowe informacje finansowe.\n\nData publikacji wskazanego raportu zgodnie z treścią raporu bieżącego nr 2/2026 została\nustalona na dzień 22 września 2026 roku.\n\nNowy termin publikacji Skonsolidowanego raportu za I półrocze 2026 roku zawierającego\nskrócone jednostkowe informacje finansowe - został wyznaczony na dzień 25 września\n2026 roku.\n\nPozostałe terminy i informacje wskazane w raporcie bieżącym nr 2/2026 na dzień publikacji\nniniejszego raportu nie ulegają zmianie.\n\nSzczegółowa podstawa prawna:\n\n§ 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r roku w sprawie\ninformacji bieżących i okresowych przekazywanych przez emitentów papierów wartościowych\noraz warunków uznawania za równoważne informacji wymaganych przepisami prawa państwa\nniebędącego państwem członkowskim."
  },
  {
    "id": "gpw:497358",
    "issuer": "IDM SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-28",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "IDM SPÓŁKA AKCYJNA (14/2026) Zmiana terminu publikacji raportu za I półrocze 2026 r.\nZmiana terminu publikacji raportu za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n14\n/\n2026\n\nData sporządzenia:\n\nSkrócona nazwa emitenta\n\nIDM SA\n\nTemat\n\nZmiana terminu publikacji raportu za I półrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd IDM S.A. _dalej: IDMSA lub Spółka_ stosownie do § 84 ust. 2 Rozporządzenia\nMinistra Finansów z dnia 10.06.2025 r. w sprawie informacji bieżących i okresowych\nprzekazywanych przez emitentów papierów wartościowych oraz warunków uznawania za równoważne\ninformacji wymaganych przepisami państwa niebędącego państwem członkowskim _dalej:\nRozporządzenie_ w odniesieniu do raportu bieżącego IDMSA\nnr 1/2026 z dnia 26.01.2026 r. następnie skorygowanego w tym samym dniu raportem\nbieżącym\nnr 1/2026_Korekta - w sprawie terminów raportów okresowych w roku 2026 - niniejszym\nprzekazuje do publicznej wiadomości, że termin publikacji raportu za pierwsze półrocze\n2026 wyznaczony pierwotnie na dzień 23.09.2026 r. zostaje przesunięty na dzień 28.09.2026\nr."
  },
  {
    "id": "gpw:497354",
    "issuer": "YARRL SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "YARRL SPÓŁKA AKCYJNA (26/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n26\n/\n2026\n\nData sporządzenia:\n2026-09-21\n\nSkrócona nazwa emitenta\n\nYARRL S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie informacje biece i okresowe\n\nTreść raportu:\n\nZarząd yarrl S.A. _ \"Emitent\"_ w nawiązaniu do raportu bieżącego nr 2/2026 z dnia\n22 stycznia 2026 roku, dotyczącego terminów publikacji raportów okresowych w 2026\nroku, informuje, że zmianie ulegnie termin publikacji raportu za I półrocze 2026 r.\nz pierwotnie deklarowanego terminu publikacji, tj. z dnia 24 września 2026 roku, na\nnowy termin publikacji, tj. na dzień 30 września 2026 roku.\n\nPozostałe terminy publikacji raportów okresowych pozostają bez zmian.\n\nZmiana wynika z wydłużenia harmonogramu prac związanych z przeglądem śródrocznych\nsprawozdań finansowych spółek Grupy Kapitałowej yarrl S.A.\n\nPodstawa prawna § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 06 czerwca 2025\nroku w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim"
  },
  {
    "id": "gpw:497348",
    "issuer": "DGA SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-24",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "DGA SPÓŁKA AKCYJNA (16/2026) Zmiana terminu publikacji raportu za I półrocze 2026 r.\nZmiana terminu publikacji raportu za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n16\n/\n2026\n\nData sporządzenia:\n2026-09-21\n\nSkrócona nazwa emitenta\n\nDGA\n\nTemat\n\nZmiana terminu publikacji raportu za I półrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 1/2026 z dnia 30 stycznia 2026 roku, Zarząd DGA\nS.A. niniejszym informuje, iż zmianie ulega termin publikacji raportu finansowego\nza I półrocze 2026 r. Data określona pierwotnie na dzień 30 września 2026 r. zostaje\nzmieniona na dzień 24 września 2026 roku."
  },
  {
    "id": "gpw:497346",
    "issuer": "ZAMET SPÓŁKA AKCYJNA",
    "note": "ZAMET: half-year report 25 instead of 30 September; Q3 unchanged and undated",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-25",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "ZAMET SPÓŁKA AKCYJNA (14/2026) Informacja o zmianie terminu publikacji raportu półrocznego za I półrocze 2026 roku.\nInformacja o zmianie terminu publikacji raportu półrocznego za I półrocze 2026 roku.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n14\n/\n2026\n\nData sporządzenia:\n2026-09-21\n\nSkrócona nazwa emitenta\n\nZAMET S.A.\n\nTemat\n\nInformacja o zmianie terminu publikacji raportu półrocznego za I półrocze 2026 roku.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd ZAMET S.A. z siedzibą w Piotrkowie Trybunalskim _\"Emitent\"_ informuje, że raport\npółroczny Emitenta za I półrocze 2026 roku, zostanie opublikowany w dniu 25 września\n2026 roku _a nie w dniu 30 września 2026 roku, jak wskazano w raporcie bieżącym nr\n1/2026_. Data publikacji raportu kwartalnego za III kwartał 2026 roku pozostaje bez\nzmian.\n\nPodstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025\nr. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim."
  },
  {
    "id": "gpw:497341",
    "issuer": "ORLEN SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-11-05",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "ORLEN SPÓŁKA AKCYJNA (35/2026) Zmiana terminu publikacji raportu okresowego za 3 kwartał 2026 roku\nZmiana terminu publikacji raportu okresowego za 3 kwartał 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n35\n/\n2026\n\nData sporządzenia:\n2026-09-21\n\nSkrócona nazwa emitenta\n\nORLEN S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za 3 kwartał 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nORLEN S.A. informuje o zmianie terminu publikacji skonsolidowanego raportu okresowego\nza 3 kwartał 2026 roku z 19 listopada 2026 roku na 5 listopada 2026 roku."
  },
  {
    "id": "gpw:497288",
    "issuer": "KRAKCHEMIA SPÓŁKA AKCYJNA",
    "note": "Krakchemia: the report type is named only in the sentence before the date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-22",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "KRAKCHEMIA SPÓŁKA AKCYJNA (34/2026) ZMIANA TERMINU PUBLIKACJI RAPORTU OKRESOWEGO\nZMIANA TERMINU PUBLIKACJI RAPORTU OKRESOWEGO\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n34\n/\n2026\n\nData sporządzenia:\n2026-09-18\n\nSkrócona nazwa emitenta\n\nKRAKCHEMIA S.A.\n\nTemat\n\nZMIANA TERMINU PUBLIKACJI RAPORTU OKRESOWEGO\n\nPodstawa prawna\n\nInne uregulowania\n\nTreść raportu:\n\nZarząd KRAKCHEMIA S.A._\"Spółka\"_, w nawiązaniu do raportu bieżącego nr 1/2026 z dnia\n28 stycznia 2026 r. ws. terminów przekazywania raportów okresowych w 2026 roku, niniejszym\ninformuje o zmianie terminu przekazania do publicznej wiadomości raportu półrocznego\nza I półrocze 2026 roku.\nPierwotny termin publikacji wskazanego powyżej raportu określony został na dzień 25\nwrześnia 2026 roku _omyłkowo opisany w treści w/w. raportu datą 25 września 2025 roku_.\nSpółka informuje, że powyższy raport okresowy zostanie opublikowany w dniu 22 września\n2026 roku.\nPozostałe terminy i informacje wskazane w raporcie bieżącym nr 1/2026, na dzień publikacji\nniniejszego raportu nie ulegają zmianie.\nPodstawa prawna:\n§ 84 ust 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r. w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa niebędącego\npaństwem członkowskim"
  },
  {
    "id": "gpw:497110",
    "issuer": "MAGNA POLONIA SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "MAGNA POLONIA SPÓŁKA AKCYJNA (9/2026) Zmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku\nZmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n9\n/\n2026\n\nData sporządzenia:\n2026-09-16\n\nSkrócona nazwa emitenta\n\n06MAGNA\n\nTemat\n\nZmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie informacje biece i okresowe\n\nTreść raportu:\n\nZarząd Magna Polonia Spółka Akcyjna _Emitent, Spółka_ informuje o zmianie terminu\nprzekazania do publicznej wiadomości skonsolidowanego raportu półrocznego za I półrocze\n2026 roku. Raport zostanie opublikowany w dniu 30 września 2026 roku. Zgodnie z treścią\nraportu bieżącego nr 1/2026 z dnia 22 stycznia 2026 roku pierwotny termin publikacji\nraportu określony był na dzień 25 września 2026 roku"
  },
  {
    "id": "gpw:497007",
    "issuer": "MBANK SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-10-28",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "MBANK SPÓŁKA AKCYJNA (51/2026) KOREKTA METADANYCH ESAP; Zmiana terminu publikacji raportu finansowego za III kwartał 2026 r. i wybranych niezaudytowanych danych finansowych za IV kwartał 2026 r.\nKOREKTA METADANYCH ESAP; Zmiana terminu publikacji raportu finansowego za III kwartał 2026 r. i wybranych niezaudytowanych danych finansowych za IV kwartał 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n51\n/\n2026\nKOR\n\nData sporządzenia:\n2026-09-15\n\nSkrócona nazwa emitenta\n\nmBank S.A.\n\nTemat\n\nKOREKTA METADANYCH ESAP; Zmiana terminu publikacji raportu finansowego za III kwartał\n2026 r. i wybranych niezaudytowanych danych finansowych za IV kwartał 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie informacje biece i okresowe\n\nTreść raportu:\n\nKOREKTA METADANYCH ESAP;\nW nawiązaniu do raportu bieżącego nr 59/2025 z dnia 4 listopada 2025 r. Zarząd Spółki\nmBank S.A. informuje o zmianie terminu publikacji Skonsolidowanego raportu kwartalnego\nza III kwartał 2026 r. oraz wybranych niezaudytowanych danych finansowych dla Grupy\nmBanku S.A. za IV kwartał 2026 r. Skonsolidowany raport kwartalny za III kwartał 2026\nr. zostanie opublikowany 28 października 2026 r. zamiast 29 października 2026 r.,\nzaś wybrane niezaudytowane dane finansowe dla Grupy mBanku S.A. za IV kwartał 2026\nr. zostaną opublikowane 4 lutego 2027 r. zamiast 5 lutego 2027 r."
  },
  {
    "id": "gpw:497002",
    "issuer": "ACTION SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-25",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "ACTION SPÓŁKA AKCYJNA (49/2026) Zmiana terminu przekazywania raportów okresowych ACTION S.A. w 2026 roku\nZmiana terminu przekazywania raportów okresowych ACTION S.A. w 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n49\n/\n2026\n\nData sporządzenia:\n\nSkrócona nazwa emitenta\n\nACTION S.A.\n\nTemat\n\nZmiana terminu przekazywania raportów okresowych ACTION S.A. w 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd ACTION S.A. _Spółka, Emitent_ informuje, że zmianie ulega termin publikacji\nraportu okresowego ACTION S.A., tj. skonsolidowanego raportu półrocznego za 2026 rok.\nTermin publikacji określony na dzień 28 września 2026 roku _opublikowany w raporcie\nbieżącym nr 1/2026 z dnia 7 stycznia 2026 roku_ zostaje zmieniony na dzień 25 września\n2026 roku."
  },
  {
    "id": "gpw:496985",
    "issuer": "TARCZYŃSKI SPÓŁKA AKCYJNA",
    "note": "Tarczyński: „Nowy termin publikacji ww. raportu został ustalony na dzień 17 września”",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-17",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "TARCZYŃSKI SPÓŁKA AKCYJNA (14/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 roku TARCZYŃSKI S.A.\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku TARCZYŃSKI S.A.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n14\n/\n2026\n\nData sporządzenia:\n2026-09-14\n\nSkrócona nazwa emitenta\n\nTARCZYŃSKI S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku TARCZYŃSKI S.A.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Spółki Tarczyński S.A. _\"Spółka\", \"Emitent\"_ w nawiązaniu do raportu bieżącego\nnr 1/2026 z dnia 26 stycznia 2026 r. w sprawie harmonogramu przekazywania raportów\nokresowych w 2026 roku, niniejszym informuje o zmianie terminu publikacji skonsolidowanego\nraportu półrocznego zawierającego półroczne skrócone jednostkowe sprawozdanie finansowe\nza okres od 01.01.2026 roku do 30.06.2026 roku, którego publikacja miała nastąpić\nw dniu 30 września 2026 roku.\n\nNowy termin publikacji ww. raportu został ustalony na dzień 17 września 2026 roku.\n\nSzczegółowa podstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6\nczerwca 2025 roku w sprawie informacji bieżących i okresowych przekazywanych przez\nemitentów papierów wartościowych oraz warunków uznawania za równoważne informacji\nwymaganych przepisami prawa państwa niebędącego państwem członkowskim."
  },
  {
    "id": "gpw:496978",
    "issuer": "BOWIM SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-17",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "BOWIM SPÓŁKA AKCYJNA (16/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n16\n/\n2026\n\nData sporządzenia:\n2026-09-14\n\nSkrócona nazwa emitenta\n\nBowim\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Bowim S.A. _\"Emitent\"_, działając na podstawie § 84 ust. 2 Rozporządzenia Ministra\nFinansów z dnia 6 czerwca 2025 roku w sprawie informacji bieżących i okresowych przekazywanych\nprzez emitentów papierów wartościowych oraz warunków uznawania za równoważne informacji\nwymaganych przepisami prawa państwa niebędącego państwem członkowskim _Dz. U. 2025\npoz. 755; \"Rozporządzenie\"_ informuje o zmianie terminu publikacji skonsolidowanego\nraportu okresowego za I półrocze 2026 r.\n\nZgodnie z raportem bieżącym nr 1/2026, Emitent ustalił następujący termin:\nI. Skonsolidowany raport półroczny za I półrocze 2026 r. zawierający skrócone jednostkowe\ninformacje finansowe - termin publikacji w dniu 24.09.2026 r.\n\nEmitent informuje, iż nowo ustalony termin to:\nI. Skonsolidowany raport półroczny za I półrocze 2026 r. zawierający skrócone jednostkowe\ninformacje finansowe - termin publikacji w dniu 17.09.2026 r.\n\nPozostałe terminy publikacji raportów okresowych w 2026 r. wskazane przez Emitenta\nw raporcie bieżącym nr 1/2026 pozostają bez zmian.\n\nPodstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025\nroku w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim _Dz. U. 2025 poz. 755_."
  },
  {
    "id": "gpw:496976",
    "issuer": "SATIS GROUP SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-29",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "SATIS GROUP SPÓŁKA AKCYJNA (11/2026) Zmiana terminu publikacji skonsolidowanego raportu za pierwsze półrocze 2026 roku\nZmiana terminu publikacji skonsolidowanego raportu za pierwsze półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n11\n/\n2026\n\nData sporządzenia:\n2026-09-14\n\nSkrócona nazwa emitenta\n\nSATIS GROUP SA\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego raportu za pierwsze półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki Satis Group S.A. z siedzibą w Warszawie w nawiązaniu do raportu bieżącego\nnr 1/2026 z 30 stycznia 2026 roku, w którym został przekazany harmonogram przekazywania\nraportów okresowych w 2026 roku, informuje, że zmianie ulega termin publikacji śródrocznego\nskróconego skonsolidowanego raportu półrocznego za pierwsze półrocze 2026 roku z pierwotnie\ndeklarowanego terminu publikacji, tj. z 18 września 2026 roku, na nowy termin publikacji,\ntj. na 29 września 2026 roku.\nPozostałe terminy przekazania raportów okresowych w roku 2026 pozostają bez zmian."
  },
  {
    "id": "gpw:496950",
    "issuer": "MBANK SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-10-28",
        "Q3",
        "2026",
        false
      ]
    ],
    "text": "MBANK SPÓŁKA AKCYJNA (51/2026) Zmiana terminu publikacji raportu finansowego za III kwartał 2026 r. i wybranych niezaudytowanych danych finansowych za IV kwartał 2026 r.\nZmiana terminu publikacji raportu finansowego za III kwartał 2026 r. i wybranych niezaudytowanych danych finansowych za IV kwartał 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n51\n/\n2026\n\nData sporządzenia:\n2026-09-14\n\nSkrócona nazwa emitenta\n\nmBank S.A.\n\nTemat\n\nZmiana terminu publikacji raportu finansowego za III kwartał 2026 r. i wybranych niezaudytowanych\ndanych finansowych za IV kwartał 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie informacje biece i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 59/2025 z dnia 4 listopada 2025 r. Zarząd Spółki\nmBank S.A. informuje o zmianie terminu publikacji Skonsolidowanego raportu kwartalnego\nza III kwartał 2026 r. oraz wybranych niezaudytowanych danych finansowych dla Grupy\nmBanku S.A. za IV kwartał 2026 r. Skonsolidowany raport kwartalny za III kwartał 2026\nr. zostanie opublikowany 28 października 2026 r. zamiast 29 października 2026 r.,\nzaś wybrane niezaudytowane dane finansowe dla Grupy mBanku S.A. za IV kwartał 2026\nr. zostaną opublikowane 4 lutego 2027 r. zamiast 5 lutego 2027 r."
  },
  {
    "id": "gpw:496884",
    "issuer": "POZNAŃSKA KORPORACJA BUDOWLANA PEKABEX SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "POZNAŃSKA KORPORACJA BUDOWLANA PEKABEX SPÓŁKA AKCYJNA (52/2026) Zmiana terminu publikacji raportów okresowych\nZmiana terminu publikacji raportów okresowych\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n52\n/\n2026\n\nData sporządzenia:\n2026-09-11\n\nSkrócona nazwa emitenta\n\nPEKABEX\n\nTemat\n\nZmiana terminu publikacji raportów okresowych\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Poznańskiej Korporacji Budowlanej Pekabex S.A. _\"Emitent\"_ informuje o zmianie\nterminu przekazania do informacji publicznej skonsolidowanego raportu półrocznego\nza I półrocze 2026 roku, w stosunku do terminów podanych w raporcie bieżącym Emitenta\nnr 5/2026 tj. z dnia 24 września 2026 r. na dzień 30 września 2026 r."
  },
  {
    "id": "gpw:496874",
    "issuer": "RANK PROGRESS SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-24",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "RANK PROGRESS SPÓŁKA AKCYJNA (22/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026r.\nZmiana terminu publikacji raportu okresowego za I półrocze 2026r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n22\n/\n2026\n\nData sporządzenia:\n2026-09-11\n\nSkrócona nazwa emitenta\n\nRANK PROGRESS S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Rank Progress S.A. _ \"Emitent\"_ w nawiązaniu do raportu bieżącego nr 1/2026\nz dnia 19 stycznia 2026 roku, dotyczącego terminów publikacji raportów okresowych\nw 2026 roku, informuje, że zmianie ulega termin publikacji raportu za I półrocze 2026r\nz pierwotnie deklarowanego terminu publikacji, tj. z dnia 17 września 2026 roku, na\nnowy termin publikacji, tj. na dzień 24 września 2026 roku.\nPozostałe terminy publikacji raportów okresowych pozostają bez zmian.\n\nPodstawa prawna\n§ 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 06 czerwca 2025 roku w sprawie\ninformacji bieżących i okresowych przekazywanych przez emitentów papierów wartościowych\noraz warunków uznawania za równoważne informacji wymaganych przepisami prawa państwa\nniebędącego państwem członkowskim."
  },
  {
    "id": "gpw:496855",
    "issuer": "FABRYKA OBRABIAREK RAFAMET SPÓŁKA AKCYJNA W RESTRUKTURYZACJI",
    "note": "Rafamet: 30.09 instead of 17.09",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "FABRYKA OBRABIAREK RAFAMET SPÓŁKA AKCYJNA W RESTRUKTURYZACJI (42/2022) Zmiana terminu przekazania rozszerzonego skonsolidowanego raportu półrocznego za I półrocze 2026 r.\nZmiana terminu przekazania rozszerzonego skonsolidowanego raportu półrocznego za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n42\n/\n2022\n\nData sporządzenia:\n2026-09-11\n\nSkrócona nazwa emitenta\n\nRAFAMET\n\nTemat\n\nZmiana terminu przekazania rozszerzonego skonsolidowanego raportu półrocznego za I\npółrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Fabryki Obrabiarek RAFAMET S.A. w restrukturyzacji informuje, że zmianie ulega\ntermin publikacji rozszerzonego skonsolidowanego raportu półrocznego za I półrocze\n2026 r. Raport zostanie przekazany do publicznej wiadomości w dniu 30.09.2026 r. Dotychczasowy\ntermin przekazania raportu przypadał na dzień 17.09.2026 r.\n\nPodstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025\nr. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim _Dz. U. z 2025 r., poz. 755_."
  },
  {
    "id": "gpw:496853",
    "issuer": "GIEŁDA PRAW MAJĄTKOWYCH VINDEXUS SPÓŁKA AKCYJNA",
    "note": "Vindexus: half-year report; the old plan mentions the annual report by mistake",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-25",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "GIEŁDA PRAW MAJĄTKOWYCH VINDEXUS SPÓŁKA AKCYJNA (23/2026) Zmiana terminu publikacji raportu okresowego.\nZmiana terminu publikacji raportu okresowego.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n23\n/\n2026\n\nData sporządzenia:\n2026-09-11\n\nSkrócona nazwa emitenta\n\nVINDEXUS S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Giełdy Praw Majątkowych \"Vindexus\" S.A. z siedzibą w Warszawie informuje, że\nzmianie ulega termin publikacji skonsolidowanego raportu za I półrocze 2026 r.\nRaport opublikowany zostanie w dniu 25 września 2026 roku.\nWedług pierwotnego planu Emitenta jednostkowy oraz skonsolidowany raport roczny za\n2025 rok miał być opublikowany w dniu 15 września 2026 roku, o czym Emitent informował\nRaportem Bieżącym nr 4/2026 z dnia 28 stycznia 2026 roku."
  },
  {
    "id": "gpw:496811",
    "issuer": "WIELTON SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "WIELTON SPÓŁKA AKCYJNA (36/2026) Zmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku\nZmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n36\n/\n2026\n\nData sporządzenia:\n2026-09-10\n\nSkrócona nazwa emitenta\n\nWIELTON S.A.\n\nTemat\n\nZmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Wielton S.A. _\"Spółka\"_ informuje o zmianie terminu przekazania do publicznej\nwiadomości rozszerzonego skonsolidowanego raportu półrocznego za I półrocze 2026 roku.\nRaport zostanie opublikowany w dniu 30 września 2026 roku. Zgodnie z treścią raportu\nbieżącego nr 2/2026 z dnia 15 stycznia 2026 roku pierwotny termin publikacji raportu\nokreślony był na dzień 24 września 2026 roku."
  },
  {
    "id": "gpw:496790",
    "issuer": "TALEX SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-14",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "TALEX SPÓŁKA AKCYJNA (13/2026) Zmiana terminu przekazania raportu półrocznego (SA-P 2026)\nZmiana terminu przekazania raportu półrocznego (SA-P 2026)\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n13\n/\n2026\n\nData sporządzenia:\n2026-09-10\n\nSkrócona nazwa emitenta\n\nTALEX\n\nTemat\n\nZmiana terminu przekazania raportu półrocznego _SA-P 2026_\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd TALEX S.A. informuje, że termin przekazania do publicznej wiadomości raportu\nokresowego Spółki za pierwsze półrocze 2026 roku _SA-P 2026_, ustalony na dzień 30\nwrześnia 2026 roku, uległ zmianie. Raport zostanie przekazany do publicznej wiadomości\nw dniu 14 września 2026 roku."
  },
  {
    "id": "gpw:496739",
    "issuer": "ODLEWNIE POLSKIE SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-14",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "ODLEWNIE POLSKIE SPÓŁKA AKCYJNA (12/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n12\n/\n2026\n\nData sporządzenia:\n2026-09-10\n\nSkrócona nazwa emitenta\n\nODLEWNIE\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Spółki Akcyjnej ODLEWNIE POLSKIE z siedzibą w Starachowicach niniejszym zmienia\ndatę publikacji raportu okresowego Spółki za I półrocze 2026 roku z dnia 29 września\n2026 roku, podanego w terminarzu raportem bieżącym nr 1/2026 z dnia 28 stycznia 2026\nroku, na dzień 14 września 2026 roku.\n\nSzczegółowa podstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 10\nczerwca 2025 r. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów\npapierów wartościowych oraz warunków uznania za równoważne informacji wymaganych przepisami\nprawa państwa nie będącego państwem członkowskim _Dz. U. z 2025 r. poz. 755_."
  },
  {
    "id": "gpw:496720",
    "issuer": "XPLUS SPÓŁKA AKCYJNA",
    "note": "XPLUS: new 14 September, old 15 September",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-14",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "XPLUS SPÓŁKA AKCYJNA (14/2026) Zmiana terminu publikacji raportu okresowego\nZmiana terminu publikacji raportu okresowego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n14\n/\n2026\n\nData sporządzenia:\n2026-09-09\n\nSkrócona nazwa emitenta\n\nXPLUS S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki XPLUS S.A _\"Emitent\"_ zgodnie z § 84 ust. 2 Rozporządzenia Ministra\nFinansów z dnia 6 czerwca 2025 r. w sprawie informacji bieżących i okresowych przekazywanych\nprzez emitentów papierów wartościowych oraz warunków uznawania za równoważne informacji\nwymaganych przepisami prawa państwa niebędącego państwem członkowskim informuje, że\nniniejszym dokonuje zmiany terminu publikacji raportu półrocznego za 2026 r.\n\nZgodnie z treścią raportu bieżącego nr 1/2026 z dnia 21 stycznia 2026 r., publikacja\nraportu półrocznego za 2026 r. planowana była na dzień 15 września 2026 r. Zarząd\nEmitenta informuje, że nową datą publikacji tego raportu będzie 14 września 2026 r.\n\nPozostałe terminy publikacji raportów okresowych pozostają bez zmian"
  },
  {
    "id": "gpw:496694",
    "issuer": "JASTRZĘBSKA SPÓŁKA WĘGLOWA SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-29",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "JASTRZĘBSKA SPÓŁKA WĘGLOWA SPÓŁKA AKCYJNA (63/2026) Zmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 roku\nZmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n63\n/\n2026\n\nData sporządzenia:\n2026-09-09\n\nSkrócona nazwa emitenta\n\nJSW S.A.\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Jastrzębskiej Spółki Węglowej S.A. [\"JSW\"] informuje, iż zmianie uległ termin\npublikacji skonsolidowanego raportu za I półrocze 2026 roku. Zgodnie z harmonogramem\npublikacji raportów okresowych w 2026 roku, opublikowanym przez JSW raportem bieżącym\nnr 4/2026 w dniu 21 stycznia 2026 roku, deklarowanym dniem publikacji skonsolidowanego\nraportu za I półrocze 2026 roku był dzień 15 września 2026 roku.\nNowy termin publikacji skonsolidowanego raportu za I półrocze 2026 roku został wyznaczony\nna dzień 29 września 2026 roku.\n\nPodstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025\nr. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim."
  },
  {
    "id": "gpw:496478",
    "issuer": "INTER CARS SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-08",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "INTER CARS SPÓŁKA AKCYJNA (25/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n25\n/\n2026\n\nData sporządzenia:\n2026-09-04\n\nSkrócona nazwa emitenta\n\nINTERCARS\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Inter Cars S.A. z siedzibą w Swobodni _\"Spółka\"_, informuje o zmianie terminu\nprzekazania do publicznej wiadomości raportu okresowego za I półrocze 2026 roku _\"Raport\"_,\nwyznaczonego zgodnie z raportem bieżącym nr 2/2026 z dnia 26 stycznia 2026 roku, na\ndzień 10 września 2026 roku. Nowy termin publikacji Raportu ustala się na dzień 8\nwrześnia 2026 roku.\n\nJednocześnie Zarząd Spółki informuje, iż pozostałe daty publikacji raportów okresowych\npozostają bez zmian.\n\nPodstawa prawna:\n\nArt. 56 ust. 1 pkt 2 ustawy z dnia 29 lipca 2005 roku o ofercie publicznej i warunków\nwprowadzania instrumentów finansowych do zorganizowanego systemu obrotu oraz o spółkach\npublicznych w zw. § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025\nroku w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim"
  },
  {
    "id": "gpw:496370",
    "issuer": "KORPORACJA GOSPODARCZA EFEKT SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-07",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "KORPORACJA GOSPODARCZA EFEKT SPÓŁKA AKCYJNA (12/2026) Zmiana terminu publikacji raportu okresowego.\nZmiana terminu publikacji raportu okresowego.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n12\n/\n2026\n\nData sporządzenia:\n2026-09-03\n\nSkrócona nazwa emitenta\n\nEFEKT\n\nTemat\n\nZmiana terminu publikacji raportu okresowego.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Korporacji Gospodarczej \"efekt\" S.A. z siedzibą w Krakowie, _dalej: \"Emitent\"\n\"Spółka \"_, w nawiązaniu do raportu bieżącego nr 1/2026 z dnia 29 stycznia 2026 r.,\ninformuje o zmianie terminu przekazania do publicznej wiadomości raportu rokresowego\nzawierającego: Skonsolidowany raport za I półrocze 2026 roku zawierający skrócone\njednostkowe informacje finansowe.\n\nData publikacji wskazanego raportu zgodnie z treścią raporu bieżącego nr 1/2026 została\nustalona na dzień 31 sierpnia 2026 roku.\n\nNowy termin publikacji Skonsolidowanego raportu za I półrocze 2026 roku zawierającego\nskrócone jednostkowe informacje finansowe - został wyznaczony na dzień 7 września\n2026 roku.\n\nPozostałe terminy i informacje wskazane w raporcie bieżącym nr 1/2026 na dzień publikacji\nniniejszego raportu nie ulegają zmianie.\n\nSzczegółowa podstawa prawna:\n\n§ 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r roku w sprawie\ninformacji bieżących i okresowych przekazywanych przez emitentów papierów wartościowych\noraz warunków uznawania za równoważne informacji wymaganych przepisami prawa państwa\nniebędącego państwem członkowskim."
  },
  {
    "id": "gpw:496285",
    "issuer": "PRZEDSIĘBIORSTWO HYDRAULIKI SIŁOWEJ HYDROTOR S.A.",
    "note": "Hydrotor: „o zmianie terminu przekazania … za I półrocze 2026 r. na dzień 30 września”",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "PRZEDSIĘBIORSTWO HYDRAULIKI SIŁOWEJ HYDROTOR S.A. (18/2026) Zmiana terminu przekazania raportu półrocznego za 2026 r.\nZmiana terminu przekazania raportu półrocznego za 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n18\n/\n2026\n\nData sporządzenia:\n2026-09-02\n\nSkrócona nazwa emitenta\n\nHYDROTOR\n\nTemat\n\nZmiana terminu przekazania raportu półrocznego za 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Spółki Hydrotor S.A. informuje o zmianie terminu przekazania do informacji\npublicznej raportu półrocznego jednostkowego i raportu półrocznego skonsolidowanego\nza I półrocze 2026 r. na dzień 30 września 2026 r., w stosunku do terminu podanego\nw raporcie bieżącym Emitenta nr RB 1/2026 z dnia 8 stycznia 2026 r."
  },
  {
    "id": "gpw:496272",
    "issuer": "IZOLACJA-JAROCIN SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-23",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "IZOLACJA-JAROCIN SPÓŁKA AKCYJNA (9/2026) Zmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku\nZmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n9\n/\n2026\n\nData sporządzenia:\n2026-09-01\n\nSkrócona nazwa emitenta\n\nIZOLACJA\n\nTemat\n\nZmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd IZOLACJI-JAROCIN SA informuje o zmianie terminu przekazania do publicznej wiadomości\nraportu półrocznego za I półrocze 2026 roku.\n\nZgodnie z raportem bieżącym nr 01/2026 z dnia 19 stycznia 2026 r., pierwotnie zadeklarowaną\ndatą publikacji tego raportu był dzień 25 września 2026 r. Nowy termin publikacji\nraportu półrocznego za I półrocze 2026 r. wyznaczono na dzień 23 września 2026 r.\n\nPodstawa prawna: §80 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025\nr. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim."
  },
  {
    "id": "gpw:496241",
    "issuer": "TERMO-REX SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-10",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "TERMO-REX SPÓŁKA AKCYJNA (6/2026) Zmiana terminu publikacji przez Termo-Rex SA Raportu półrocznego za I półrocze 2026r.\nZmiana terminu publikacji przez Termo-Rex SA Raportu półrocznego za I półrocze 2026r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n6\n/\n2026\n\nData sporządzenia:\n2026-09-01\n\nSkrócona nazwa emitenta\n\nTERMO-REX S.A.\n\nTemat\n\nZmiana terminu publikacji przez Termo-Rex SA Raportu półrocznego za I półrocze 2026r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Termo-Rex S.A. z siedzibą w Jaworznie _\"Spółka\"_ w nawiązaniu do raportu bieżącego\nnr 1/2026 z dnia\n21 stycznia 2026 roku w sprawie harmonogramu przekazywania raportów okresowych w\n2026 roku, przekazuje do wiadomości publicznej informację - o zmianie terminu publikacji\nRaportu półrocznego za I półrocze 2026 r. Datę publikacji wskazanego raportu pierwotnie\nustalono na dzień - 15 września 2026 r.\nNowy termin przekazania do wiadomości publicznej Raportu półrocznego Spółki za I\npółrocze 2026 r. to 10 września 2026 r. Pozostałe terminy przekazywania raportów\nokresowych w 2026 roku wskazane przez Spółkę w raporcie bieżącym nr 1/2026 z dnia\n21 stycznia 2026 roku pozostają bez zmian.\n\nPodstawa prawna:\n§ 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 roku, w sprawie\ninformacji bieżących\ni okresowych przekazywanych przez emitentów papierów wartościowych oraz warunków uznawania\nza równoważne informacji wymaganych przepisami prawa państwa niebędącego państwem\nczłonkowskim."
  },
  {
    "id": "gpw:496206",
    "issuer": "QUANTUM SOFTWARE SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-18",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "QUANTUM SOFTWARE SPÓŁKA AKCYJNA (8/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n8\n/\n2026\n\nData sporządzenia:\n2026-09-01\n\nSkrócona nazwa emitenta\n\nQUANTUM SOFTWARE SA\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki Quantum software S.A. z siedzibą w Krakowie _\"Spółka\"_ informuje o zmianie\nterminu przekazania do publicznej wiadomości półrocznego skróconego skonsolidowanego\nsprawozdania finansowego za I półrocze 2026 r.\n\nZgodnie z raportem bieżącym nr 01/2026 z dnia 28 stycznia 2026 r., pierwotnie zadeklarowaną\ndatą publikacji tego raportu był dzień 30 września 2026 r. Nowy termin publikacji\nskonsolidowanego raportu półrocznego za I półrocze 2026 r. wyznaczono na dzień 18\nwrześnia 2026 r.\n\nPozostałe terminy publikacji raportów okresowych przekazane raportem bieżącym nr 01/2026\nz dnia 28 stycznia 2026 r. pozostają bez zmian.\n\nSzczegółowa podstawa prawna:\n§ 84 ust. 2 rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r. w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa niebędącego\npaństwem członkowskim."
  },
  {
    "id": "gpw:496167",
    "issuer": "ENEA SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-10",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "ENEA SPÓŁKA AKCYJNA (40/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n40\n/\n2026\n\nData sporządzenia:\n2026-08-31\n\nSkrócona nazwa emitenta\n\nENEA\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 6/2026, Zarząd Enea S.A. informuje, iż podjął\ndecyzję o zmianie terminu publikacji raportu okresowego za I półrocze 2026 r. z dnia\n9 września 2026 r., na dzień 10 września 2026 r."
  },
  {
    "id": "gpw:496133",
    "issuer": "LUBELSKI WĘGIEL BOGDANKA SPÓŁKA AKCYJNA",
    "note": "Bogdanka: new 10 September, old 9 September",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-10",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "LUBELSKI WĘGIEL BOGDANKA SPÓŁKA AKCYJNA (16/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n16\n/\n2026\n\nData sporządzenia:\n2026-08-31\n\nSkrócona nazwa emitenta\n\nLW BOGDANKA S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Lubelskiego Węgla Bogdanka S.A. _\"Spółka\"_ z siedzibą w Bogdance informuje\no zmianie terminu przekazania do publicznej wiadomości skonsolidowanego raportu półrocznego\nza I półrocze 2026 roku na dzień 10 września 2026 roku.\n\nPierwotna data publikacji tego raportu była ustalona na dzień 9 września 2026 roku,\nzgodnie z informacją przekazaną raportem bieżącym nr 3/2026 z dnia 30 stycznia 2026\nroku.\n\nPodstawa prawna ogólna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca\n2025 r.\nw sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim."
  },
  {
    "id": "gpw:495932",
    "issuer": "COMP SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-28",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "COMP SPÓŁKA AKCYJNA (28/2026) Zmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 roku\nZmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n28\n/\n2026\n\nData sporządzenia:\n2026-08-27\n\nSkrócona nazwa emitenta\n\nCOMP\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego raportu za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Comp S.A. informuje o zmianie terminu publikacji skonsolidowanego raportu za\nI półrocze 2026 roku z dnia 31 sierpnia 2026 r. na dzień 28 września 2026 r.\n\nZmiana wynika z wydłużenia harmonogramu procedur przeglądu śródrocznych sprawozdań\nfinansowych we współpracy z nowym audytorem Grupy Kapitałowej Comp S.A.\n\nPozostałe terminy publikacji raportów okresowych wskazane w raporcie bieżącym nr 1/2026\nz dnia 28 stycznia 2026 r. pozostają bez zmian."
  },
  {
    "id": "gpw:495890",
    "issuer": "ONDE SPÓŁKA AKCYJNA",
    "note": "ONDE: „miał zostać opublikowany w dniu 10 września … zostanie opublikowany w dniu 28 września”",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-28",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "ONDE SPÓŁKA AKCYJNA (38/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 roku.\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n38\n/\n2026\n\nData sporządzenia:\n2026-08-26\n\nSkrócona nazwa emitenta\n\nONDE S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 roku.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd ONDE S.A. z siedzibą w Toruniu _\"Emitent\"_, niniejszym informuje, że półroczny\nskonsolidowany raport okresowy Emitenta za I półrocze 2026 roku, który zgodnie z treścią\nraportu bieżącego Emitenta nr 1/2026 z dnia 12 stycznia 2026 r. miał zostać opublikowany\nw dniu 10 września 2026 r. zostanie opublikowany w dniu 28 września 2026 r.\n\nTermin publikacji skonsolidowanego raportu okresowego za III kwartał 2026 r. wskazany\nw raporcie bieżącym Emitenta nr 1/2026 nie ulega zmianie.\n\nSzczegółowa podstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6\nczerwca 2025 r. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów\npapierów wartościowych oraz warunków uznawania za równoważne informacji wymaganych\nprzepisami prawa państwa niebędącego państwem członkowskim."
  },
  {
    "id": "gpw:495846",
    "issuer": "ERBUD SPÓŁKA AKCYJNA",
    "note": "ERBUD: the same wording as ONDE",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-28",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "ERBUD SPÓŁKA AKCYJNA (25/2026) Zmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku.\nZmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n25\n/\n2026\n\nData sporządzenia:\n2026-08-26\n\nSkrócona nazwa emitenta\n\nERBUD S.A.\n\nTemat\n\nZmiana terminu publikacji raportu półrocznego za I półrocze 2026 roku.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd ERBUD SA. z siedzibą w Warszawie _\"Emitent\"_, niniejszym informuje, że półroczny\nskonsolidowany raport okresowy Emitenta za I półrocze 2026 roku, który zgodnie z treścią\nraportu bieżącego Emitenta nr 1/2026 z dnia 12 stycznia 2026 r. miał zostać opublikowany\nw dniu 10 września 2026 r. zostanie opublikowany w dniu 28 września 2026 r.\n\nTermin publikacji skonsolidowanego raportu okresowego za III kwartał 2026 r. wskazany\nw raporcie bieżącym Emitenta nr 1/2026 nie ulega zmianie.\n\nSzczegółowa podstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6\nczerwca 2025 r. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów\npapierów wartościowych oraz warunków uznawania za równoważne informacji wymaganych\nprzepisami prawa państwa niebędącego państwem członkowskim."
  },
  {
    "id": "gpw:495817",
    "issuer": "CI GAMES SPÓŁKA EUROPEJSKA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "CI GAMES SPÓŁKA EUROPEJSKA (31/2026) Zmiana terminu publikacji skonsolidowanego raportu półrocznego za I półrocze 2026 r.\nZmiana terminu publikacji skonsolidowanego raportu półrocznego za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n31\n/\n2026\n\nData sporządzenia:\n2026-08-25\n\nSkrócona nazwa emitenta\n\nCI GAMES S.E.\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego raportu półrocznego za I półrocze 2026\nr.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki Cl Games SE z siedzibą w Warszawie _\"Spółka\"_ w nawiązaniu do raportu\nbieżącego numer 2/2026 z dnia 19 stycznia 2026 roku, informuje o podjęciu decyzji\no zmianie terminu publikacji przez Spółkę skonsolidowanego raportu półrocznego za\nI półrocze 2026 r. z dnia 24 września 2026 roku na dzień 30 września 2026 roku.\nPozostałe informacje wskazane w raporcie bieżącym numer 2/2026 nie ulegają zmianie.\nSzczegółowa podstawa: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca\n2025 w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim."
  },
  {
    "id": "gpw:495776",
    "issuer": "MOSTOSTAL PŁOCK SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-08-27",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "MOSTOSTAL PŁOCK SPÓŁKA AKCYJNA (18/2026) Zmiana terminu przekazania raportu okresowego\nZmiana terminu przekazania raportu okresowego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n18\n/\n2026\n\nData sporządzenia:\n2026-08-25\n\nSkrócona nazwa emitenta\n\nMOSTALPLC\n\nTemat\n\nZmiana terminu przekazania raportu okresowego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 2/2026 z dnia 14.01.2026 roku, Zarząd Mostostal\nPłock S.A. informuje o zmianie terminu przekazania do publicznej wiadomości raportu\nza I półrocze 2026 roku.\n\nPoprzedni termin - 30.09.2026 r.\nAktualny termin - 27.08.2026 r.\n\nPodstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 06 czerwca 2025\nroku\nw sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim _Dz.U. 2025 poz. 755_."
  },
  {
    "id": "gpw:495694",
    "issuer": "MEDINICE SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-08-28",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "MEDINICE SPÓŁKA AKCYJNA (39/2026) Zmiana terminu publikacji skonsolidowanego raportu półrocznego za Ipółrocze 2026 r.\nZmiana terminu publikacji skonsolidowanego raportu półrocznego za Ipółrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n39\n/\n2026\n\nData sporządzenia:\n2026-08-21\n\nSkrócona nazwa emitenta\n\nMEDINICE S.A.\n\nTemat\n\nZmiana terminu publikacji skonsolidowanego raportu półrocznego za Ipółrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd MEDINICE S.A. _\"Spółka\"_ informuje o zmianie terminu publikacji skonsolidowanego\nraportu półrocznego za I półrocze 2026 r., zawierającego półroczne skrócone skonsolidowane\nsprawozdanie finansowe za I półrocze 2026 r. oraz skrócone jednostkowe sprawozdanie\nfinansowe za I półrocze 2026 r., sporządzone zgodnie z obowiązującymi przepisami i\npoddane przeglądowi przez firmę audytorską.\n\nZgodnie z raportem bieżącym nr 3/2026 z dnia 21 stycznia 2026 r. Spółka ustaliła następujący\ntermin przekazania skonsolidowanego raportu półrocznego za Ipółrocze 2026 r.: 11 września\n2026 r.\n\nSpółka informuje, iż nowo ustalony, wcześniejszy termin przekazania skonsolidowanego\nraportu półrocznego za I półrocze 2026 r. to: 28 sierpnia 2026 r.\n\nPozostałe terminy przekazywania raportów okresowych w 2026 r. wskazane przez Spółkę\nw raporcie bieżącym nr 3/2026 z dnia 21 stycznia 2026 r. pozostają bez zmian.\n\nInformacja o zmianie terminu publikacji skonsolidowanego raportu półrocznego za I\npółrocze 2026 r. jest przekazywana zgodnie z wymogami art. 56 ust. 1 pkt 2 ustawy\no ofercie publicznej oraz § 84 ust. 2 rozporządzenia Ministra Finansów z dnia 6czerwca\n2025 r. _tj. szczegółowa podstawa prawna_."
  },
  {
    "id": "gpw:495684",
    "issuer": "AC SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-08-26",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "AC SPÓŁKA AKCYJNA (16/2026) Zmiana daty przekazania raportu półrocznego za I półrocze 2026 roku\nZmiana daty przekazania raportu półrocznego za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n16\n/\n2026\n\nData sporządzenia:\n2026-08-21\n\nSkrócona nazwa emitenta\n\nAC S.A.\n\nTemat\n\nZmiana daty przekazania raportu półrocznego za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nAC S.A. z siedzibą w Białymstoku _dalej jako \"Spółka\"_ w nawiązaniu do raportu bieżącego\nnr 2/2026 z dnia 27 stycznia 2026 r. podaje do publicznej wiadomości nowy termin publikacji\nraportu półrocznego za I półrocze 2026 roku:\n\nRaport półroczny za I półrocze 2026 roku: 26 sierpnia 2026 r.\n\nWcześniej ogłoszony termin przekazania tego raportu był ustalony na dzień 31 sierpnia\n2026 r.\n\nPodstawa prawna: § 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025\nr. w sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim."
  },
  {
    "id": "gpw:495438",
    "issuer": "GRUPA VIRTUS SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-08-20",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "GRUPA VIRTUS SPÓŁKA AKCYJNA (55/2026) Zmiana terminu publikacji raportu za I półrocze 2026 roku\nZmiana terminu publikacji raportu za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n55\n/\n2026\n\nData sporządzenia:\n2026-08-17\n\nSkrócona nazwa emitenta\n\nGRUPA VIRTUS S.A.\n\nTemat\n\nZmiana terminu publikacji raportu za I półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Grupa Virtus S.A. z siedzibą w Warszawie _\"Spółka\"_ działając na podstawie\n§ 84 ust. 2 rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 roku w sprawie\ninformacji bieżących i okresowych przekazywanych przez emitentów papierów wartościowych\noraz warunków uznawania za równoważne informacji wymaganych przepisami prawa państwa\nniebędącego państwem członkowskim, niniejszym informuje o zmianie terminu publikacji\nraportu za I półrocze 2026 roku.\nW raporcie bieżącym nr 1/2026 z dnia 27 stycznia 2026 roku Spółka wskazała, że publikacja\nraportu za I półrocze 2026 roku planowana jest na dzień 18 września 2026 roku.\n\nNowym terminem publikacji raportu za I półrocze 2026 roku jest dzień 20 sierpnia 2026\nroku."
  },
  {
    "id": "gpw:495426",
    "issuer": "GRUPA PRACUJ SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-08-25",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "GRUPA PRACUJ SPÓŁKA AKCYJNA (13/2026) Zmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n13\n/\n2026\n\nData sporządzenia:\n2026-08-17\n\nSkrócona nazwa emitenta\n\nGRUPA PRACUJ S.A.\n\nTemat\n\nZmiana terminu publikacji raportu okresowego za I półrocze 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki Grupa Pracuj S.A. z siedzibą w Warszawie _\"Spółka\"_ informuje o zmianie\nterminu przekazania przez Spółkę do publicznej wiadomości skonsolidowanego raportu\npółrocznego za\nI półrocze 2026 r.\n\nZgodnie z raportem bieżącym nr 01/2026 z dnia 22 stycznia 2026 r., pierwotnie zadeklarowaną\ndatą publikacji tego raportu był dzień 27 sierpnia 2026 r. Nowy termin publikacji\nskonsolidowanego raportu półrocznego za I półrocze 2026 r. wyznaczono na dzień 25\nsierpnia 2026 r.\nPozostałe terminy publikacji raportów okresowych przekazane raportem bieżącym nr 01/2026\nz dnia 22 stycznia 2026 r. pozostają bez zmian.\n\nSzczegółowa podstawa prawna:\n§ 84 ust. 2 rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r. w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa niebędącego\npaństwem członkowskim."
  },
  {
    "id": "gpw:495287",
    "issuer": "KINO POLSKA TV SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-17",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "KINO POLSKA TV SPÓŁKA AKCYJNA (17/2026) Zmiana terminu przekazania raportu okresowego\nZmiana terminu przekazania raportu okresowego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n17\n/\n2026\n\nData sporządzenia:\n2026-08-13\n\nSkrócona nazwa emitenta\n\nKino Polska TV S.A.\n\nTemat\n\nZmiana terminu przekazania raportu okresowego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Kino Polska TV S.A. _\"Spółka\"_ niniejszym informuje, że ulega zmianie termin\nprzekazania skonsolidowanego raportu półrocznego za I półrocze 2026 r. _\"Raport\"_.\n\nPrzyczyną przedmiotowej zmiany są kwestie techniczne, związane ze zmianą infrastruktury\ntechnologicznej Spółki.\n\nZgodnie z raportem bieżącym nr 1/2026 z dnia 14 stycznia 2026 r., przewidzianym terminem\npublikacji Raportu był 20 sierpnia 2026 r.\n\nNowy termin przekazania skonsolidowanego raportu półrocznego za I półrocze 2026 r.\nzostaje ustalony na 17 września 2026 r.\n\nPozostałe terminy publikacji raportów okresowych, wskazane w raporcie bieżącym nr\n1/2026, pozostają bez zmian.\n\nPodstawa prawna:\n§ 84 ust. 2 Rozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r. w sprawie informacji\nbieżących i okresowych przekazywanych przez emitentów papierów wartościowych oraz\nwarunków uznawania za równoważne informacji wymaganych przepisami prawa państwa niebędącego\npaństwem członkowskim."
  },
  {
    "id": "gpw:495214",
    "issuer": "SPYROSOFT SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-18",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "SPYROSOFT SPÓŁKA AKCYJNA (13/2026) Zmiana terminu publikacji raportu półrocznego\nZmiana terminu publikacji raportu półrocznego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n13\n/\n2026\n\nData sporządzenia:\n2026-08-12\n\nSkrócona nazwa emitenta\n\nSPYROSOFT S.A.\n\nTemat\n\nZmiana terminu publikacji raportu półrocznego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Spyrosoft S.A. [\"Spółka\"] informuje o zmianie terminu przekazania do publicznej\nwiadomości rozszerzonego skonsolidowanego raportu za I półrocze 2026 roku [\"Raport\npółroczny\"].\nRaport półroczny zostanie opublikowany w dniu 18 września 2026 r. zamiast, jak określono\npierwotnie w raporcie bieżącym nr 1/2026, w dniu 17 września 2026 r.\nTerminy publikacji pozostałych raportów okresowych w 2026 roku pozostają bez zmian."
  },
  {
    "id": "gpw:495016",
    "issuer": "MCI CAPITAL ALTERNATYWNA SPÓŁKA INWESTYCYJNA SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-04",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "MCI CAPITAL ALTERNATYWNA SPÓŁKA INWESTYCYJNA SPÓŁKA AKCYJNA (16/2026) Zmiana terminu przekazania skonsolidowanego i jednostkowego raportu półrocznego za I półrocze 2026 roku\nZmiana terminu przekazania skonsolidowanego i jednostkowego raportu półrocznego za I półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n16\n/\n2026\n\nData sporządzenia:\n2026-08-06\n\nSkrócona nazwa emitenta\n\nMCI CAPITAL ASI S.A.\n\nTemat\n\nZmiana terminu przekazania skonsolidowanego i jednostkowego raportu półrocznego za\nI półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd MCI Capital ASI S.A. _\"Spółka\"_, w nawiązaniu do raportu bieżącego nr 3/2026\nz dnia 30 stycznia 2026 r. oraz raportu bieżącego nr 6/2026 z dnia 17 marca 2026 r.,\ninformuje o zmianie terminu przekazania skonsolidowanego i jednostkowego raportu półrocznego\nza I półrocze 2026 roku z dnia 9 września 2026 roku na dzień 4 września 2026 roku.\n\nMając na uwadze powyższe, Spółka podaje do publicznej wiadomości zaktualizowane terminy\nprzekazania raportów okresowych w 2026 roku:\n- Skonsolidowany i jednostkowy raport roczny za 2025 rok - 30 marca 2026 r.;\n- Skonsolidowany i jednostkowy raport za I kwartał 2026 roku - 15 maja 2026 r.;\n- Skonsolidowany i jednostkowy raport półroczny za I półrocze 2026 roku - 4 września\n2026 r.;\n- Skonsolidowany i jednostkowy raport za III kwartał 2026 roku - 17 listopada 2026\nr.\n\nNa podstawie § 79 ust. 2 Rozporządzenia Ministra Finansów z dnia 29 marca 2018 roku\nw sprawie informacji bieżących i okresowych przekazywanych przez emitentów papierów\nwartościowych oraz warunków uznawania za równoważne informacji wymaganych przepisami\nprawa państwa niebędącego państwem członkowskim _\"Rozporządzenie\"_, Spółka nie przekazuje\nraportu kwartalnego za II oraz IV kwartał 2026 roku.\n\nZgodnie z § 63 ust. 1 Rozporządzenia Spółka będzie przekazywała skonsolidowane raporty\nkwartalne zawierające kwartalną informację finansową jednostki dominującej i nie będzie\nprzekazywała odrębnych raportów kwartalnych."
  },
  {
    "id": "gpw:493671",
    "issuer": "BUMECH SPÓŁKA AKCYJNA",
    "note": "Bumech: half-year report moved to 30 September",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-09-30",
        "H1",
        "2026",
        false
      ]
    ],
    "text": "BUMECH SPÓŁKA AKCYJNA (31/2026) Zmiana terminu publikacji raportu za pierwsze półrocze 2026 roku\nZmiana terminu publikacji raportu za pierwsze półrocze 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n31\n/\n2026\n\nData sporządzenia:\n2026-07-13\n\nSkrócona nazwa emitenta\n\nBUMECH S.A.\n\nTemat\n\nZmiana terminu publikacji raportu za pierwsze półrocze 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 8/2026 z dnia 30 stycznia 2026 roku, Zarząd Emitenta\npostanawia\no przesunięciu terminu publikacji jednostkowego i skonsolidowanego raportu za pierwsze\npółrocze 2026 roku na dzień 30 września 2026 roku _środa_."
  },
  {
    "id": "gpw:491723",
    "issuer": "SYN2BIO SPÓŁKA AKCYJNA",
    "note": "Syn2bio: half-year report of the financial year 2025 moved to 30 June",
    "expected": [
      [
        "HALF_YEAR_REPORT",
        "2026-06-30",
        "H1",
        "2025",
        false
      ]
    ],
    "text": "SYN2BIO SPÓŁKA AKCYJNA (17/2026) Zmiana terminu publikacji jednostkowego raportu okresowego za I półrocze roku finansowego 2025\nZmiana terminu publikacji jednostkowego raportu okresowego za I półrocze roku finansowego 2025\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n17\n/\n2026\n\nData sporządzenia:\n2026-06-18\n\nSkrócona nazwa emitenta\n\nSYN2BIO S.A.\n\nTemat\n\nZmiana terminu publikacji jednostkowego raportu okresowego za I półrocze roku finansowego\n2025\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd spółki Syn2bio SA z siedzibą w Warszawie _\"Emitent\"_, zgodnie z § 80 ust. 1\nRozporządzenia Ministra Finansów z dnia 6 czerwca 2025 r. w sprawie informacji bieżących\ni okresowych przekazywanych przez emitentów papierów wartościowych oraz warunków uznawania\nza równoważne informacji wymaganych przepisami prawa państwa niebędącego państwem\nczłonkowskim _Dz.U. 2025 poz. 755; dalej: \"Rozporządzenie\"_, informuje o zmianie na\ndzień 30 czerwca 2026 r. terminu przekazania do publicznej wiadomości jednostkowego\nraportu półrocznego _SA-P_ za I półrocze roku finansowego 2025 trwającego od 1 października\n2025 r. do 30 września 2026 r.\nPierwotna data publikacji raportu okresowego była ustalona na dzień 25 czerwca 2026\nr., zgodnie z informacją przekazaną raportem bieżącym ESPI nr 14/2026 z 29 kwietnia\n2026 r.\nPozostałe terminy oraz informacje wskazane w ww. raporcie bieżącym nie ulegają zmianie."
  },
  {
    "id": "gpw:490645",
    "issuer": "INTERSPORT POLSKA SPÓŁKA AKCYJNA",
    "note": "Intersport: annual report 2025/2026 on 24 June instead of 30 July",
    "expected": [
      [
        "ANNUAL_REPORT",
        "2026-06-24",
        "FY",
        "2025/2026",
        false
      ]
    ],
    "text": "INTERSPORT POLSKA SPÓŁKA AKCYJNA (14/2026) Zmiana terminu przekazania raportu za rok obrotowy 2025/2026\nZmiana terminu przekazania raportu za rok obrotowy 2025/2026\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n14\n/\n2026\n\nData sporządzenia:\n2026-06-03\n\nSkrócona nazwa emitenta\n\nINTERSPORT S.A.\n\nTemat\n\nZmiana terminu przekazania raportu za rok obrotowy 2025/2026\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nINTERSPORT Polska S.A. z siedzibą w Cholerzynie, Cholerzyn 382, 32-060 Liszki, wpisanej\ndo rejestru przedsiębiorców prowadzonego przez Sąd Rejonowy dla Krakowa Śródmieścia\nw Krakowie XII Wydział Gospodarczy Krajowego Rejestru Sądowego pod numerem KRS: 216182,\nkapitał zakładowy w wysokości 15.452.505,70 zł, wpłacony w całości, NIP 676-001-65-53\ninformuje, że raport okresowy za rok obrotowy 2025/2026 trwający od 1 kwietnia 2025\nroku do 31 marca 2026 roku zostanie opublikowany 24 czerwca 2026 roku _czwartek_.\nZgodnie z raportem bieżącym nr 10/2026 raport miał być przekazany 30 lipca 2026 roku."
  },
  {
    "id": "gpw:489946",
    "issuer": "TOWER INVESTMENTS SPÓŁKA AKCYJNA",
    "note": "Tower Investments: one new date, 16 June, for the annual report 2025 and the Q1 2026 report, each named with its period",
    "expected": [
      [
        "ANNUAL_REPORT",
        "2026-06-16",
        "FY",
        "2025",
        false
      ],
      [
        "QUARTERLY_REPORT",
        "2026-06-16",
        "Q1",
        "2026",
        false
      ]
    ],
    "text": "TOWER INVESTMENTS SPÓŁKA AKCYJNA (16/2026) Zmiana terminów publikacji raportów okresowych\nZmiana terminów publikacji raportów okresowych\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n16\n/\n2026\n\nData sporządzenia:\n2026-05-27\n\nSkrócona nazwa emitenta\n\nTOWER INVESTMENTS S.A.\n\nTemat\n\nZmiana terminów publikacji raportów okresowych\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Tower Investments S.A. _\"Emitent\"_ w nawiązaniu do raportów bieżących 5/2026,\n12/2026 i 13/2026 dotyczących terminów publikacji raportów okresowych w 2026 roku\ninformuje, że z powodów technicznych zmuszony jest dokonać zmiany terminów publikacji\nraportów rocznych za rok 2025 wraz z korektą sprawozdań za rok 2024 i półrocze 2025\noraz publikacji raportu kwartalnego za I kwartał 2026 roku.\n\nNowy termin publikacji raportów: 16 czerwca 2026 roku."
  },
  {
    "id": "gpw:489762",
    "issuer": "PCF GROUP SPÓŁKA AKCYJNA",
    "note": "PCF: Q1 2026 on 29 instead of 28 May",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-05-29",
        "Q1",
        "2026",
        false
      ]
    ],
    "text": "PCF GROUP SPÓŁKA AKCYJNA (10/2026) Zmiana daty przekazania skonsolidowanego raportu kwartalnego za pierwszy kwartał 2026 r.\nZmiana daty przekazania skonsolidowanego raportu kwartalnego za pierwszy kwartał 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n10\n/\n2026\n\nData sporządzenia:\n2026-05-26\n\nSkrócona nazwa emitenta\n\nPCF GROUP S.A.\n\nTemat\n\nZmiana daty przekazania skonsolidowanego raportu kwartalnego za pierwszy kwartał 2026\nr.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 1/2026 z dnia 28 stycznia 2026 r., Zarząd PCF\nGroup S.A. informuje o zmianie terminu publikacji skonsolidowanego raportu kwartalnego\nza pierwszy kwartał 2026 r.\nSkonsolidowany raport Grupy Kapitałowej PCF Group S.A. za pierwszy kwartał 2026 r.\nzostanie opublikowany w dniu 29 maja 2026 r.\nStanowi to zmianę terminu publikacji powyższego raportu, który w raporcie bieżącym\nnr 1/2026 z dnia 28 stycznia 2026 r. został określony na dzień 28 maja 2026 r."
  },
  {
    "id": "gpw:489581",
    "issuer": "ACTION SPÓŁKA AKCYJNA",
    "note": "the report came out on the new date",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-05-28",
        "Q1",
        "2026",
        false
      ]
    ],
    "text": "ACTION SPÓŁKA AKCYJNA (24/2026) Zmiana terminu przekazywania raportów okresowych ACTION S.A. w 2026 roku\nZmiana terminu przekazywania raportów okresowych ACTION S.A. w 2026 roku\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n24\n/\n2026\n\nData sporządzenia:\n\nSkrócona nazwa emitenta\n\nACTION S.A.\n\nTemat\n\nZmiana terminu przekazywania raportów okresowych ACTION S.A. w 2026 roku\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd ACTION S.A. _Spółka, Emitent_ informuje, że zmianie ulega termin publikacji\nraportu okresowego ACTION S.A., tj. skonsolidowanego raportu za pierwszy kwartał 2026\nroku. Termin publikacji określony na dzień 29 maja 2026 roku _opublikowany w raporcie\nbieżącym nr 1/2026 z dnia 7 stycznia 2026 roku_ zostaje zmieniony na dzień 28 maja\n2026 roku."
  },
  {
    "id": "gpw:489327",
    "issuer": "TOWER INVESTMENTS SPÓŁKA AKCYJNA",
    "note": "Tower Investments: Q1 2026 on 31 May (later moved again by a notice naming several reports)",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-05-31",
        "Q1",
        "2026",
        false
      ]
    ],
    "text": "TOWER INVESTMENTS SPÓŁKA AKCYJNA (15/2026) Zmiana terminu publikacji raportu kwartalnego\nZmiana terminu publikacji raportu kwartalnego\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n15\n/\n2026\n\nData sporządzenia:\n2026-05-21\n\nSkrócona nazwa emitenta\n\nTOWER INVESTMENTS S.A.\n\nTemat\n\nZmiana terminu publikacji raportu kwartalnego\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Tower Investments S.A. _Spółka_ w nawiązaniu do raportu bieżącego nr 5/2026\nz dnia 31 stycznia 2026 r. w sprawie terminów publikacji raportów okresowych w roku\nobrotowym 2026, informuje, że niniejszym dokonuje zmiany terminu publikacji raportu\nkwartalnego za I kwartał 2026 roku.\n\nZgodnie z treścią raportu bieżącego nr 5/2026 publikacja tego planowana była na dzień\n26 maja 2026 roku. Zarząd Spółki informuje, że nową datą publikacji raportu kwartalnego\nza I kwartał 2026 rok będzie dzień 31 maja 2026 r."
  },
  {
    "id": "gpw:489665",
    "issuer": "DGA SPÓŁKA AKCYJNA",
    "note": "DGA: „raportu finansowego za I kw. 2026 r.”, 29 May changed to 1 June",
    "expected": [
      [
        "QUARTERLY_REPORT",
        "2026-06-01",
        "Q1",
        "2026",
        false
      ]
    ],
    "text": "DGA SPÓŁKA AKCYJNA (7/2026) Zmiana terminu publikacji raportu za I kw. 2026 r.\nZmiana terminu publikacji raportu za I kw. 2026 r.\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n7\n/\n2026\n\nData sporządzenia:\n2026-05-26\n\nSkrócona nazwa emitenta\n\nDGA\n\nTemat\n\nZmiana terminu publikacji raportu za I kw. 2026 r.\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego nr 1/2026 z dnia 30 stycznia 2026 roku, Zarząd DGA\nS.A. niniejszym informuje, iż zmianie ulega termin publikacji raportu finansowego\nza I kw. 2026 r. Data określona pierwotnie na dzień 29 maja 2026 r. zostaje zmieniona\nna dzień 1 czerwca 2026 roku."
  },
  {
    "id": "gpw:487052",
    "issuer": "TOWER INVESTMENTS SPÓŁKA AKCYJNA",
    "note": "Tower Investments: annual report „za rok 2025”; „raportów okresowych w roku obrotowym 2026” is the schedule's year",
    "expected": [
      [
        "ANNUAL_REPORT",
        "2026-04-30",
        "FY",
        "2025",
        false
      ]
    ],
    "text": "TOWER INVESTMENTS SPÓŁKA AKCYJNA (12/2026) Zmiana terminu publikacji raportów rocznych za 2025 rok\nZmiana terminu publikacji raportów rocznych za 2025 rok\nKOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n12\n/\n2026\n\nData sporządzenia:\n2026-04-23\n\nSkrócona nazwa emitenta\n\nTOWER INVESTMENTS S.A.\n\nTemat\n\nZmiana terminu publikacji raportów rocznych za 2025 rok\n\nPodstawa prawna\n\nArt. 56 ust. 1 pkt 2 Ustawy o ofercie - informacje bieżące i okresowe\n\nTreść raportu:\n\nZarząd Tower Investments S.A. _Spółka_ w nawiązaniu do raportu bieżącego nr 5/2026\nz dnia 31 stycznia 2026 r. w sprawie terminów publikacji raportów okresowych w roku\nobrotowym 2026, informuje, że niniejszym dokonuje zmiany terminu publikacji skonsolidowanego\ni jednostkowego raportu rocznego za rok 2025.\n\nZgodnie z treścią raportu bieżącego nr 5/2026 publikacja tych raportów planowana była\nna dzień 27 kwietnia 2026 roku. Zarząd Spółki informuje, że nową datą publikacji raportów\nrocznych za 2025 rok będzie dzień 30 kwietnia 2026 r."
  }
];

export const gpwDividendNotices = [
  {
    "id": "gpw:499203",
    "note": "Stalexport: an advance a subsidiary pays its own shareholders",
    "expected": [],
    "text": "KOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n38\n/\n2026\n\nData sporządzenia:\n2026-10-21\n\nSkrócona nazwa emitenta\n\nSTALEXPORT AUTOSTRADY\n\nTemat\n\nPodjęcie przez Zarząd Stalexport Autostrada Małopolska S.A. uchwały o wypłacie zaliczki\nna poczet przewidywanej dywidendy na koniec roku obrotowego 2026\n\nPodstawa prawna\n\nArt. 17 ust. 1 Rozporządzenia MAR - informacje poufne\n\nTreść raportu:\n\nZarząd Stalexport Autostrady S.A. _dalej: Emitent_ informuje, że dnia 21 października\n2026 r. Zarząd Stalexport Autostrada Małopolska S.A. _spółki zależnej Emitenta_ podjął\nuchwałę w sprawie wypłaty akcjonariuszom Stalexport Autostrada Małopolska S.A. zaliczki\nna poczet przewidywanej dywidendy na koniec roku obrotowego 2026 o następującej treści:\n\n\"Uchwała nr 01/10/2026\n\nZarządu Stalexport Autostrada Małopolska S.A.\nz siedzibą w Mysłowicach\nz dnia 21 października 2026 r.\n\nw sprawie: wypłaty akcjonariuszom Stalexport Autostrada Małopolska S.A. zaliczki na\npoczet przewidywanej dywidendy na koniec roku obrotowego 2026\n\n1. Na podstawie § 12 ust. 1, § 12 ust. 3 pkt _7_ i § 30 ust. 5 Statutu Stalexport\nAutostrada Małopolska S.A. oraz Art. 349 Kodeksu spółek handlowych Zarząd Stalexport\nAutostrada Małopolska S.A. postanawia o wypłacie na rzecz akcjonariuszy zaliczki na\npoczet przewidywanej dywidendy, według następujących warunków i zasad:\n\na_ wypłata zaliczki nastąpi w terminie od dnia 30.11.2026 r. do dnia 31.12.2026\nr.;\n\nb_ łączna kwota zaliczki będzie wynosić PLN 105.396.114,85 _słownie: sto pięć milionów\ntrzysta dziewięćdziesiąt sześć tysięcy sto czternaście złotych 85/100_;\n\nc_ wypłata zaliczki nastąpi w całości ze środków zgromadzonych na kapitale rezerwowym;\n\nd_ ustalenie akcjonariuszy uprawionych do otrzymania zaliczki nastąpi w siódmym\ndniu poprzedzającym wypłatę zaliczki.\n\n2. Na podstawie § 30 ust. 5 Statutu Stalexport Autostrada Małopolska S.A. wypłata\nzaliczki nastąpi po uprzedniej zgodzie na jej dokonanie udzielonej przez Radę Nadzorczą\nStalexport Autostrada Małopolska S.A.\n\n3. Niniejsza uchwała wchodzi w życie z dniem podjęcia.\"\n\nPodstawa prawna:\n\nArt. 17 ust. 1 Rozporządzenia Parlamentu Europejskiego i Rady UE NR 596/2014 z dnia\n16 kwietnia 2014 r. w sprawie nadużyć na rynku _rozporządzenie w sprawie nadużyć na\nrynku_ oraz uchylające dyrektywę 2003/6/WE Parlamentu Europejskiego i Rady i dyrektywy\nKomisji 2003/124/WE, 2003/125/WE i 2004/72/WE."
  },
  {
    "id": "gpw:500273",
    "note": "Echo Investment: conditional advance",
    "expected": [
      [
        "dividend:2026:advance:2026-12-09",
        "2026-12-09",
        "2026-12-16",
        0.4,
        "PROPOSED"
      ]
    ],
    "text": "KOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n31\n/\n2026\n\nData sporządzenia:\n2026-11-10\n\nSkrócona nazwa emitenta\n\nECHO\n\nTemat\n\nUchwała w sprawie warunkowej wypłaty zaliczki na poczet przyszłej dywidendy za rok\nobrotowy 2026\n\nPodstawa prawna\n\nArt. 17 ust. 1 Rozporządzenia MAR - informacje poufne\n\nTreść raportu:\n\nZarząd spółki Echo Investment S.A. _\"Spółka\"_ informuje, że w dniu 10 listopada 2026\nroku, biorąc pod uwagę, że:\na. zatwierdzone jednostkowe sprawozdania finansowe Spółki za rok obrotowy 2025 wykazało\nzysk netto w wysokości 129.056.490,56 PLN;\nb. Spółka osiągnęła od końca ubiegłego roku obrotowego do dnia 31 marca 2026 roku\nzysk netto w wysokości 42.331.952,50 PLN;\npostanowił warunkowo wypłacić akcjonariuszom Spółki zaliczkę na poczet przyszłej dywidendy\nza rok obrotowy 2026 _dalej Zaliczka Dywidendowa_ na następujących zasadach:\nŁączna kwota przeznaczona na wypłatę Zaliczki Dywidendowej wyniesie 165.076.232,80\nPLN tj. 0,40 PLN na 1 akcję _dalej Kwota Zaliczki Dywidendowej_. Na Kwotę Zaliczki\nDywidendowej składa się:\na.kwota 20.000.000,00 PLN, która nie przekracza połowy zysku netto Spółki osiągniętego\nod końca poprzedniego roku obrotowego, wykazanego w sprawozdaniu finansowym sporządzonym\nna dzień 31 marca 2026 r. i obejmującym okres od 1 stycznia 2026 r. do 31 marca 2026\nr. zbadanym przez biegłego rewidenta z PricewaterhouseCoopers Polska spółka z ograniczoną\nodpowiedzialnością Audyt Sp.k. siedzibą w Warszawie,\nb.kwota 145.076.232,80 PLN pochodząca z kapitału rezerwowego utworzonego z przeznaczeniem\nna wypłatę dywidendy lub zaliczek na poczet dywidendy _Fundusz Dywidendowy_.\nLiczba akcji objętych wypłatą Zaliczki Dywidendowej na dzień Uchwały: 412 690 582.\nZaliczka Dywidendowa zostanie wypłacona w dniu 16 grudnia 2026 r. _Data Wypłaty Zaliczki\nDywidendowej_.\nDo Zaliczki Dywidendowej będą uprawnieni akcjonariusze posiadający akcje Spółki w\ndniu 9 grudnia 2026 r. tj. na 7 dni przed Datą Wypłaty Zaliczki Dywidendowej.\n\nZaliczka Dywidendowa zostanie wypłacona pod warunkiem uzyskania zgody Rady Nadzorczej\nw terminie do Daty Wypłaty Zaliczki Dywidendowej."
  },
  {
    "id": "gpw:500623",
    "note": "Atlanta Poland: recommendation with both days, no per-share amount",
    "expected": [
      [
        "dividend:2026:single",
        "2027-03-05",
        "2027-04-02",
        null,
        "PROPOSED"
      ]
    ],
    "text": "KOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n8\n/\n2026\n\nData sporządzenia:\n2026-11-17\n\nSkrócona nazwa emitenta\n\nATLANTAPL\n\nTemat\n\nDeklaracja w sprawie wypłaty dywidendy z zysku netto za rok obrotowy 2025/2026.\n\nPodstawa prawna\n\nArt. 17 ust. 1 Rozporządzenia MAR - informacje poufne\n\nTreść raportu:\n\nATLANTA POLAND SA, działając na podstawie art. 17 ust 1 Rozporządzenia MAR informuje,\niż w dniu 17 listopada 2026 Zarząd Spółki podjął uchwałę w przedmiocie przedstawienia\nRadzie Nadzorczej Spółki wniosku dotyczącego sposobu rozporządzenia zyskiem netto\nosiągniętym przez ATLANTA POLAND S.A. w roku obrotowym 2025/2026 zakończonym 30 czerwca\n2026 roku. Zarząd ATLANTA POLAND S.A. postanowił przedstawić Radzie Nadzorczej Spółki\nwniosek dotyczący sposobu rozporządzenia zyskiem netto w kwocie 17 022\n428,69 zł, osiągniętym przez ATLANTA POLAND S.A. w roku obrotowym 2025/2026 zakończonym\n30 czerwca 2026 roku, poprzez: a_ przeznaczenie kwoty 5 178 118,40 zł na wypłatę dywidendy\ndla akcjonariuszy ATLANTA POLAND S.A. b_ przeznaczenie kwoty 11 844 310,29 zł na\nkapitał zapasowy ATLANTA POLAND S.A. Ponadto Zarząd ATLANTA POLAND S.A. rekomendował,\naby dzień dywidendy został ustalony na dzień 5 marca 2027 roku, natomiast termin wypłaty\ndywidendy na dzień 2 kwietnia 2027 roku."
  },
  {
    "id": "gpw:500853",
    "note": "Votum: second advance of 2026",
    "expected": [
      [
        "dividend:2026:advance:2026-12-16",
        "2026-12-16",
        "2026-12-23",
        1.5,
        "PROPOSED"
      ]
    ],
    "text": "KOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n42\n/\n2026\n\nData sporządzenia:\n2026-11-19\n\nSkrócona nazwa emitenta\n\nVOTUM S.A.\n\nTemat\n\nDecyzja Zarządu Votum S.A. o zamiarze wypłaty drugiej zaliczki na poczet dywidendy\nza 2026 r.\n\nPodstawa prawna\n\nArt. 17 ust. 1 Rozporządzenia MAR - informacje poufne\n\nTreść raportu:\n\nZarząd Spółki Votum S.A. z siedzibą we Wrocławiu _dalej: \"Spółka\"_ informuje, że w\ndniu dzisiejszym, w oparciu o zbadaną przez niezależnego biegłego rewidenta śródroczną\nskróconą informację finansową spółki za okres sześciu miesięcy zakończony 30 czerwca\n2026 roku, podjął uchwałę o przedłożeniu Radzie Nadzorczej wniosku dotyczącego wypłaty\nakcjonariuszom drugiej zaliczki na poczet dywidendy za 2026 rok w kwocie 18 000 000,00\nzł _słownie: osiemnaście milionów złotych_, co oznacza, że na jedną akcję będzie przypadać\nkwota 1,50 zł _słownie: jeden złoty pięćdziesiąt groszy_. Spółka wskazuje jednocześnie,\nże zostały spełnione warunki formalne niezbędne do wypłaty drugiej zaliczki na poczet\ndywidendy, wynikające z art. 349 Kodeksu spółek handlowych.\nSpółka rekomenduje dzień 16 grudnia 2026 r. jako dzień, według którego ustalać się\nbędzie uprawnionych do zaliczki na poczet dywidendy za rok 2026, a jako termin wypłaty\nzaliczki na poczet dywidendy - dzień 23 grudnia 2026 r. Wszystkie akcje spółki w liczbie\n12 000 000 będą objęte zaliczką na poczet dywidendy za 2026 rok.\nWarunkiem wypłaty zaliczki jest uzyskanie zgody Rady Nadzorczej spółki w terminie\ndo dnia wypłaty zaliczki."
  },
  {
    "id": "gpw:501259",
    "note": "Text: board's request for an advance",
    "expected": [
      [
        "dividend:2026:advance:2026-12-28",
        "2026-12-28",
        "2027-01-04",
        1.21,
        "PROPOSED"
      ]
    ],
    "text": "KOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n17\n/\n2026\n\nData sporządzenia:\n2026-11-25\n\nSkrócona nazwa emitenta\n\nText S.A.\n\nTemat\n\nWniosek Zarządu w sprawie wypłaty zaliczki na poczet przewidywanej dywidendy z zysku\nza 2026/27 rok finansowy\n\nPodstawa prawna\n\nArt. 17 ust. 1 Rozporządzenia MAR - informacje poufne\n\nTreść raportu:\n\nZarząd Text S.A. _\"Spółka\"_ informuje, że w dniu 25 listopada 2026 r. podjął decyzję\no zwróceniu się do Rady Nadzorczej z wnioskiem w sprawie wyrażenia zgody na wypłatę\nzaliczki na poczet przewidywanej dywidendy za rok obrotowy 2026/27, przy uwzględnieniu\nponiższych parametrów ustalenia i wypłaty zaliczki na poczet dywidendy:\n\n- Kwota zaliczki na poczet przewidywanej dywidendy: 31.157.500,00 zł - która to kwota\nstanowi nie więcej niż połowę zysku netto Spółki wykazanego w sprawozdaniu finansowym\nsporządzonym na dzień 30 września 2026 roku i zbadanym przez biegłego rewidenta,\n- zaliczką będzie objęte 25.750.000 akcji Spółki\n- kwota zaliczki, przypadająca na 1 akcję Spółki, wyniesie: 1,21 zł\n- planowany dzień ustalenia akcjonariuszy uprawnionych do zaliczki: 28 grudnia 2026\nr.\n- planowany dzień wypłaty zaliczki: 4 stycznia 2027 r."
  },
  {
    "id": "gpw:501483",
    "note": "Text: the advance resolved after the board's consent",
    "expected": [
      [
        "dividend:2026:advance:2026-12-28",
        "2026-12-28",
        "2027-01-04",
        1.21,
        "CONFIRMED"
      ]
    ],
    "text": "KOMISJA NADZORU FINANSOWEGO\n\nRaport bieżący nr\n18\n/\n2026\n\nData sporządzenia:\n2026-11-27\n\nSkrócona nazwa emitenta\n\nText S.A.\n\nTemat\n\nWniosek Zarządu w sprawie wypłaty zaliczki na poczet przewidywanej dywidendy z zysku\nza 2026/27 rok finansowy\n\nPodstawa prawna\n\nArt. 17 ust. 1 Rozporządzenia MAR - informacje poufne\n\nTreść raportu:\n\nW nawiązaniu do raportu bieżącego 17/2026, Zarząd Text S.A. _\"Spółka\"_ informuje,\nże w dniu 27 listopada 2026 r., po otrzymaniu zgody od Rady Nadzorczej Spółki, podjął\nuchwałę o wypłacie zaliczki na poczet przewidywanej dywidendy za rok obrotowy 2026/27,\nprzy uwzględnieniu poniższych parametrów ustalenia i wypłaty zaliczki na poczet dywidendy:\n\n- Kwota zaliczki na poczet przewidywanej dywidendy: 31.157.500,00 zł - która to kwota\nstanowi nie więcej niż połowę zysku netto Spółki wykazanego w sprawozdaniu finansowym\nsporządzonym na dzień 30 września 2026 roku i zbadanym przez biegłego rewidenta,\n- zaliczką będzie objęte 25.750.000 akcji Spółki\n- kwota zaliczki, przypadająca na 1 akcję Spółki, wyniesie: 1,21 zł\n- planowany dzień ustalenia akcjonariuszy uprawnionych do zaliczki: 28 grudnia 2026\nr.\n- planowany dzień wypłaty zaliczki: 4 stycznia 2027 r."
  }
];

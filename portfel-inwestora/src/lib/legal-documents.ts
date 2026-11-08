export type LegalDocumentKind = "privacy" | "terms";
export type LegalSection = { heading: string; paragraphs: string[] };
export type LegalDocumentVersion = {
  kind: LegalDocumentKind;
  version: string;
  title: string;
  status: "draft";
  sections: LegalSection[];
};

// Keep draft text versioned and separate from publication approval. Only an
// explicit, reviewed entry below can make a version the active public copy.
export const LEGAL_DRAFTS: Record<LegalDocumentKind, LegalDocumentVersion> = {
  privacy: {
    kind: "privacy",
    version: "0.1.0-draft",
    title: "Projekt polityki prywatności Mexo",
    status: "draft",
    sections: [
      { heading: "Status projektu i administrator", paragraphs: [
        "To jest projekt do weryfikacji przez operatora Mexo i prawnika. Nie jest zatwierdzoną ani obowiązującą polityką prywatności. Administrator danych, adres kontaktowy i dane rejestrowe: DO UZUPEŁNIENIA.",
      ] },
      { heading: "Jakie dane są przetwarzane", paragraphs: [
        "W zależności od użytych funkcji Mexo może przechowywać: adres e-mail, nazwę wyświetlaną, datę założenia konta, ustawienia profilu i preferencje; hasło w postaci skrótu kryptograficznego; identyfikator Google i adres e-mail zwrócone w OAuth; dane portfeli, rachunków, walut, instrumentów, ilości, cen, transakcji, dywidend, gotówki, opłat, podatków, notatek, ręcznych wycen i korekt; watchlistę, benchmarki, tagi, układy dashboardu i ustawienia analityki.",
        "Dane techniczne mogą obejmować skróty tokenów sesji i bezpieczeństwa, daty ich utworzenia/wygaśnięcia oraz pseudonimizowane liczniki ochrony przed nadużyciami. Zakres logów reverse proxy, Cloudflare, systemu i monitoringu musi zostać potwierdzony przez operatora.",
      ] },
      { heading: "Cele i podstawy przetwarzania — do zatwierdzenia", paragraphs: [
        "Możliwe cele operacyjne obejmują utworzenie i utrzymanie konta, zapis danych wprowadzonych przez użytkownika, udostępnianie funkcji portfelowych, uwierzytelnianie, ochronę przed nadużyciami, wysyłkę wiadomości dotyczących konta i realizację żądań użytkownika. Właściwa podstawa prawna dla każdego celu (w tym ewentualna umowa, obowiązek prawny lub prawnie uzasadniony interes), niezbędność danych i okresy przechowywania: DO UZUPEŁNIENIA po ocenie operatora i prawnika.",
        "Mexo nie powinno wykorzystywać danych portfela do marketingu ani profilowania reklamowego bez odrębnej, zgodnej z prawem podstawy i zatwierdzonego procesu. Nie dodano zgód marketingowych w ramach tej wersji.",
      ] },
      { heading: "Dostawcy i infrastruktura — do potwierdzenia umowami", paragraphs: [
        "Repozytorium zawiera integracje z PostgreSQL/Aiven, Oracle Cloud, Cloudflare, Google OAuth i Resend. To nie przesądza, które podmioty są procesorami, jakie są ich role, lokalizacje danych, podprocesorzy, transfery, zabezpieczenia umowne ani czy każda integracja jest aktywna w danym środowisku. Operator musi zweryfikować umowy, regiony, listy podprocesorów i konfigurację produkcji; wszystkie te informacje: DO UZUPEŁNIENIA przed publikacją.",
        "Mexo korzysta też z zewnętrznych źródeł danych rynkowych i korporacyjnych. Należy ustalić, jakie zapytania identyfikujące instrumenty mogą być wysyłane do dostawców, jakie logi powstają i jakie ograniczenia licencyjne dotyczą danych. Nie eksportujemy do użytkownika współdzielonych danych rynkowych ani cache dostawców.",
      ] },
      { heading: "Cookies i logi", paragraphs: [
        "Aplikacja używa technicznego cookie sesji oraz krótkotrwałych cookies OAuth i potwierdzenia operacji bezpieczeństwa. Ich konkretne nazwy, czas życia, zakres, podstawa prawna i ustawienia produkcyjne powinny być utrzymywane w aktualnym wykazie cookies. Kod repozytorium nie wskazuje na wdrożony zewnętrzny skrypt analityczny; baner cookies i konfigurację Cloudflare, Nginx, logów i monitoringu należy potwierdzić w produkcji.",
      ] },
      { heading: "Cele, podstawy i retencja", paragraphs: [
        "Nie zatwierdzono okresów retencji dla aktywnych kont, logów, tokenów, eksportów, kopii zapasowych ani kopii u procesorów. Wartości i zasady retencji, harmonogram usuwania, wyjątki oraz sposób informowania o nich: DO UZUPEŁNIENIA. Nie należy wywodzić terminów z czasu życia pojedynczego cookie lub tokenu.",
      ] },
      { heading: "Dostęp, eksport i usunięcie", paragraphs: [
        "W centrum Prywatność i dane użytkownik może pobrać kopię danych oraz zainicjować usunięcie konta po ponownym uwierzytelnieniu. Usunięcie aktywnych rekordów PostgreSQL nie edytuje historycznych kopii zapasowych ani systemów procesorów; harmonogramy i wyjątki retencyjne: DO UZUPEŁNIENIA. Eksport nie obejmuje haseł, tokenów, współdzielonego cache rynku ani danych dostawców, których ponowne udostępnianie nie zostało potwierdzone.",
        "Zakres, sposób i terminy obsługi praw dostępu, sprostowania, usunięcia, ograniczenia, sprzeciwu, przenoszenia i skargi do właściwego organu wymagają weryfikacji prawnej. Kontakt administratora oraz organ właściwy: DO UZUPEŁNIENIA. Jeśli przetwarzanie opiera się na zgodzie, sposób jej wycofania bez wpływu na zgodność wcześniejszego przetwarzania: DO UZUPEŁNIENIA.",
      ] },
      { heading: "Bezpieczeństwo i incydenty", paragraphs: [
        "Aplikacja stosuje m.in. hashowanie haseł, chronione sesje, kontrolę dostępu właściciela, ograniczanie prób i bezpieczne wyzwanie przed usunięciem konta. Rzeczywiste procedury zgłaszania incydentów, osoba kontaktowa i terminy operacyjne muszą zostać zatwierdzone przez operatora; nie są deklaracją, że każde ryzyko zostało wyeliminowane.",
      ] },
      { heading: "Informacje inwestycyjne", paragraphs: [
        "Mexo prezentuje informacje portfelowe i rynkowe, w tym dane dostarczane przez zewnętrznych dostawców. Źródła, zakres licencji, opóźnienia i warunki dalszego udostępniania wymagają potwierdzenia przed publikacją ostatecznej wersji dokumentu.",
      ] },
    ],
  },
  terms: {
    kind: "terms",
    version: "0.1.0-draft",
    title: "Projekt regulaminu Mexo",
    status: "draft",
    sections: [
      { heading: "Status projektu i operator", paragraphs: [
        "To jest projekt do weryfikacji przez operatora Mexo i prawnika. Nie jest zatwierdzonym ani obowiązującym regulaminem. Dane usługodawcy, kontakt, adres i zasady reklamacji: DO UZUPEŁNIENIA.",
      ] },
      { heading: "Usługa", paragraphs: [
        "Mexo jest aplikacją internetową do zapisywania i przeglądania informacji o portfelach, instrumentach i operacjach użytkownika oraz do prezentacji danych rynkowych i analiz. Zakres funkcji, dostępność, ograniczenia i wymagania techniczne: DO UZUPEŁNIENIA po zatwierdzeniu zakresu premiery.",
        "Usługa nie powinna być opisywana jako gwarancja poprawności danych rynkowych ani jako indywidualna rekomendacja inwestycyjna. Ostateczne postanowienia o charakterze informacji, odpowiedzialności i prawach konsumenta wymagają przeglądu prawnego.",
      ] },
      { heading: "Konto i dane użytkownika", paragraphs: [
        "Użytkownik powinien chronić dane logowania, podawać prawdziwe dane wymagane do obsługi konta i sprawdzać poprawność wpisywanych transakcji. Zakres zabronionego użycia, bezpieczeństwo konta, moderacja, zawieszenie usługi, procedura reklamacji i kontakt operatora: DO UZUPEŁNIENIA po przeglądzie prawnym.",
      ] },
      { heading: "Dane inwestycyjne i źródła rynkowe", paragraphs: [
        "Użytkownik odpowiada za poprawność danych ręcznie wprowadzonych i importowanych. Dane rynkowe, kursy, wydarzenia korporacyjne i wyniki obliczeń mogą zależeć od dostępności, kompletności, opóźnień, licencji i jakości zewnętrznych źródeł. Zakres ograniczeń dostawców oraz dozwolony sposób użycia: DO UZUPEŁNIENIA. Mexo nie jest w tym projekcie przedstawiane jako doradca inwestycyjny; indywidualne rekomendacje nie są deklarowaną usługą.",
      ] },
      { heading: "Plany i płatności", paragraphs: [
        "Konfiguracja produktu przewiduje Free (0 zł), Basic (3,99 zł), Standard (6,99 zł), Pro (11,99 zł) i Expert (14,99 zł) za 30 dni. W tej wersji samodzielny zakup płatnych planów nie jest aktywny; powyższe ceny nie stanowią działającej oferty zakupu. Macierz funkcji i limity planów, warunki płatności, odstąpienia, odnowienia, rozliczeń i reklamacji wymagają osobnego zatwierdzenia przed uruchomieniem sprzedaży.",
      ] },
      { heading: "Prawa i postanowienia końcowe", paragraphs: [
        "Użytkownik może pobrać dane i zainicjować zamknięcie konta z ustawień po ponownym uwierzytelnieniu. Okresy retencji kopii, wyjątki, procedury reklamacyjne i pozasądowe, prawo właściwe, wymagane informacje dla usług elektronicznych, zasady zmian regulaminu, data wejścia w życie i dane usługodawcy: DO UZUPEŁNIENIA po konsultacji prawnej. Nie należy uznawać tego projektu za podstawę do rozpoczęcia świadczenia usługi na nowych warunkach.",
      ] },
    ],
  },
};

export type LegalApproval = { version: string; approvedAt: string; approvedBy: string };

export type ApprovedLegalDocument = Omit<LegalDocumentVersion, "status"> & { status: "approved" };

// Empty by default. Publication requires a reviewed commit with an explicit
// version, timestamp and responsible approver; no draft is silently final.
export const LEGAL_DOCUMENT_APPROVALS: Partial<Record<LegalDocumentKind, LegalApproval>> = {};
export const LEGAL_APPROVED_DOCUMENTS: Partial<Record<LegalDocumentKind, ApprovedLegalDocument>> = {};

export const resolveLegalDocument = (kind: LegalDocumentKind) => {
  const draft = LEGAL_DRAFTS[kind];
  const approval = LEGAL_DOCUMENT_APPROVALS[kind];
  const approved = LEGAL_APPROVED_DOCUMENTS[kind];
  if (!approval || !approved || approved.version !== approval.version || !approval.approvedAt.trim() || !approval.approvedBy.trim()) {
    return { document: draft, status: "draft" as const, approval: null };
  }
  return { document: approved, status: "approved" as const, approval };
};

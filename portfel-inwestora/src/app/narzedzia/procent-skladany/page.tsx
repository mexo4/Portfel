import type { Metadata } from "next";
import Link from "next/link";
import CompoundInterestCalculator from "./CompoundInterestCalculator";
import CompoundInterestGuide from "./CompoundInterestGuide";
import styles from "./page.module.css";

const SITE_URL = "https://mexo.com.pl";
const PAGE_PATH = "/narzedzia/procent-skladany";

export const metadata: Metadata = {
  title: "Kalkulator procentu składanego | Mexo",
  description:
    "Darmowy kalkulator procentu składanego Mexo. Sprawdź, jak może rosnąć kapitał przy regularnych wpłatach, stopie zwrotu i długim horyzoncie.",
  alternates: { canonical: `${SITE_URL}${PAGE_PATH}` },
  openGraph: {
    title: "Kalkulator procentu składanego | Mexo",
    description:
      "Policz przyszłą wartość inwestycji i zobacz, jaka część wyniku pochodzi z wpłat, a jaka z procentu składanego.",
    url: `${SITE_URL}${PAGE_PATH}`,
    siteName: "Mexo",
    locale: "pl_PL",
    type: "website",
  },
};

const faq = [
  {
    question: "Czym jest procent składany?",
    answer:
      "Procent składany oznacza, że kolejne zyski są naliczane również od wcześniej wypracowanych zysków. Z czasem baza, od której naliczany jest zwrot, rośnie.",
  },
  {
    question: "Czy kalkulator uwzględnia regularne wpłaty?",
    answer:
      "Tak. Miesięczna wpłata jest dodawana na koniec każdego miesiąca i od kolejnego miesiąca uczestniczy w dalszym wzroście kapitału.",
  },
  {
    question: "Czy podana stopa zwrotu jest gwarantowana?",
    answer:
      "Nie. To założenie używane wyłącznie do symulacji matematycznej. Rzeczywiste wyniki inwestycji zmieniają się w czasie i mogą być także ujemne.",
  },
  {
    question: "Czy kalkulator uwzględnia podatki i opłaty?",
    answer:
      "Nie. Wynik jest uproszczoną symulacją i nie uwzględnia podatków, kosztów transakcyjnych, opłat funduszy, zmian kursów walut ani inflacji.",
  },
  {
    question: "Czy wynik jest prognozą przyszłej wartości inwestycji?",
    answer:
      "Nie. To scenariusz matematyczny oparty na stałej, hipotetycznej stopie zwrotu. Rzeczywiste wyniki mogą być zmienne i ujemne, a końcowa wartość może różnić się od symulacji.",
  },
  {
    question: "Czy kalkulator zakłada reinwestowanie wypracowanego wzrostu?",
    answer:
      "Tak, model zakłada, że wypracowany wzrost pozostaje w wartości inwestycji i może uczestniczyć w dalszym wzroście. Nie modeluje osobno wypłat ani ręcznych decyzji o reinwestowaniu dywidend.",
  },
];

export default function CompoundInterestPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <main className="marketing-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <nav className="marketing-nav" aria-label="Nawigacja">
        <Link href="/" className="brand-link">Mexo</Link>
        <div className="marketing-nav-actions">
          <Link href="/pricing" className="ghost-button">Cennik</Link>
          <Link href="/login" className="ghost-button">Logowanie</Link>
          <Link href="/register" className="primary-button">Załóż konto</Link>
        </div>
      </nav>

      <section className={styles.hero}>
        <p className="eyebrow">Narzędzia inwestora</p>
        <h1>Kalkulator procentu składanego</h1>
        <p className={styles.lead}>
          Sprawdź, jak regularne inwestowanie i czas mogą zmienić wartość
          kapitału. Wynik aktualizuje się od razu podczas zmiany założeń.
        </p>
      </section>

      <CompoundInterestCalculator />
      <CompoundInterestGuide />

      <section className={styles.faqSection}>
        <p className="eyebrow">FAQ</p>
        <h2>Najczęstsze pytania</h2>
        <div className={styles.faqList}>
          {faq.map((item) => (
            <details key={item.question} className={styles.faqItem}>
              <summary>
                <span>{item.question}</span>
                <span className={styles.faqPlus} aria-hidden="true">+</span>
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.cta}>
        <div>
          <p className="eyebrow">Mexo</p>
          <h2>Symulacja to początek. Potem śledź prawdziwy portfel.</h2>
          <p>
            Pozycje, transakcje, wyniki, gotówka, dywidendy i wydarzenia
            rynkowe w jednym miejscu.
          </p>
        </div>
        <Link href="/register" className="primary-button">Załóż darmowe konto</Link>
      </section>

      <footer className={styles.footer}>
        <span>© Mexo</span>
        <span>
          Kalkulator ma charakter informacyjny i nie stanowi rekomendacji inwestycyjnej.
        </span>
      </footer>
    </main>
  );
}

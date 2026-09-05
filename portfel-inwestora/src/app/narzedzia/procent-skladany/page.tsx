import type { Metadata } from "next";
import Link from "next/link";
import CompoundInterestCalculator from "./CompoundInterestCalculator";
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

      <section className={styles.explainer}>
        <div>
          <p className="eyebrow">Jak czytać wynik</p>
          <h2>Wpłaty budują bazę. Czas pozwala działać procentowi składanemu.</h2>
        </div>
        <div className={styles.explainerCopy}>
          <p>
            Kalkulator rozdziela końcową wartość inwestycji na wpłacony kapitał
            oraz przyrost wynikający z przyjętej stopy zwrotu. Dzięki temu
            od razu widać, jak wraz z wydłużaniem horyzontu rośnie znaczenie
            samego procentu składanego.
          </p>
          <p>
            Symulacja zakłada stałą roczną stopę zwrotu przeliczaną na okresy
            miesięczne oraz regularną wpłatę na koniec każdego miesiąca.
            Rzeczywisty rynek nie rośnie w tak równym tempie.
          </p>
        </div>
      </section>

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

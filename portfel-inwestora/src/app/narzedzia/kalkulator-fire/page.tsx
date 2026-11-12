import type { Metadata } from "next";
import Link from "next/link";
import FireCalculator from "./FireCalculator";
import styles from "./page.module.css";

const SITE_URL = "https://mexo.com.pl";
const PAGE_PATH = "/narzedzia/kalkulator-fire";

export const metadata: Metadata = {
  title: "Kalkulator FIRE | Mexo",
  description:
    "Sprawdź, jaki kapitał może być potrzebny do finansowej niezależności i jak zmieniają go wydatki, oszczędności, inflacja oraz SWR.",
  alternates: { canonical: `${SITE_URL}${PAGE_PATH}` },
  openGraph: {
    title: "Kalkulator FIRE | Mexo",
    description:
      "Zbuduj własny scenariusz drogi do niezależności finansowej — bez obietnic, z jasnymi założeniami.",
    url: `${SITE_URL}${PAGE_PATH}`,
    siteName: "Mexo",
    locale: "pl_PL",
    type: "website",
  },
};

const faq = [
  {
    question: "Czym jest FIRE?",
    answer:
      "FIRE to skrót od Financial Independence, Retire Early — finansowej niezależności, przy której kapitał może pokrywać koszty życia bez konieczności pracy zarobkowej.",
  },
  {
    question: "Jak kalkulator wylicza cel FIRE?",
    answer:
      "Cel FIRE to roczne wydatki podzielone przez wybraną bezpieczną stopę wypłaty (SWR). Przy SWR 4% oznacza to 25-krotność rocznych wydatków.",
  },
  {
    question: "Czy zasada 4% jest gwarancją?",
    answer:
      "Nie. To historyczna reguła orientacyjna, a nie gwarancja bezpieczeństwa. Ryzyko kolejności stóp zwrotu, podatki, opłaty i zmiany stylu życia mogą zmienić rzeczywisty wynik.",
  },
  {
    question: "Po co uwzględniać inflację?",
    answer:
      "W trybie realnym kalkulator przelicza stopę zwrotu na wartość po inflacji i utrzymuje cel w dzisiejszych złotych. Dzięki temu łatwiej ocenić przyszłą siłę nabywczą kapitału.",
  },
  {
    question: "Czy wynik oznacza konkretną datę emerytury?",
    answer:
      "Nie. To scenariusz matematyczny oparty na stałych założeniach. Rzeczywista droga będzie zmienna, dlatego warto regularnie aktualizować wydatki, wpłaty i przyjęte parametry.",
  },
];

export default function FireCalculatorPage() {
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
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
        <h1>Kalkulator FIRE</h1>
        <p className={styles.lead}>
          Zobacz, jak wydatki, regularne inwestowanie i czas mogą przybliżyć Cię
          do finansowej niezależności. To mapa scenariusza, nie obietnica daty.
        </p>
      </section>

      <FireCalculator />

      <section className={styles.methodology} aria-labelledby="methodology-title">
        <div>
          <p className="eyebrow">Jak liczymy</p>
          <h2 id="methodology-title">Prosty model, jawne założenia.</h2>
        </div>
        <div className={styles.methodologyCopy}>
          <p>
            Cel FIRE to roczne wydatki podzielone przez bezpieczną stopę wypłaty.
            Projekcja korzysta z miesięcznego składania kapitału i regularnej wpłaty
            na koniec każdego miesiąca.
          </p>
          <p>
            W trybie realnym stopa zwrotu jest korygowana o inflację, dzięki czemu
            zarówno cel, jak i wartości na wykresie można czytać w dzisiejszych złotych.
          </p>
        </div>
      </section>

      <section className={styles.drivers} aria-labelledby="drivers-title">
        <div className={styles.driversHeading}>
          <p className="eyebrow">Dźwignie FIRE</p>
          <h2 id="drivers-title">Co najbardziej przyspiesza drogę?</h2>
          <p>Nie każda zmiana założenia ma ten sam ciężar. Zacznij od rzeczy, na które masz wpływ.</p>
        </div>
        <ol className={styles.driverList}>
          <li><span>01</span><div><h3>Wydatki</h3><p>Każda stała złotówka mniej zwiększa oszczędności i obniża docelowy kapitał jednocześnie.</p></div></li>
          <li><span>02</span><div><h3>Stopa oszczędności</h3><p>Regularna wpłata buduje bazę szybciej niż jednorazowe zrywy i daje efekt procentu składanego.</p></div></li>
          <li><span>03</span><div><h3>Założona stopa</h3><p>Niewielka różnica w stopie mocno zmienia długi scenariusz, dlatego nie traktuj jej jak gwarancji.</p></div></li>
          <li><span>04</span><div><h3>Czas</h3><p>Najdłużej pracują pieniądze, które są w portfelu od początku. Cierpliwość jest częścią planu.</p></div></li>
        </ol>
      </section>

      <aside className={styles.limits} aria-labelledby="limits-title">
        <div className={styles.limitsMark} aria-hidden="true">i</div>
        <div>
          <p className="eyebrow">Granice symulacji</p>
          <h2 id="limits-title">Rzeczywista droga nie jest gładką linią.</h2>
          <p>
            Kalkulator nie modeluje kolejności stóp zwrotu, podatków, prowizji,
            zmian kursów walut ani nagłych zmian wydatków. Wynik ma pomóc rozmawiać
            o założeniach i budować plan, a nie zastępować decyzję inwestycyjną.
          </p>
        </div>
      </aside>

      <section className={styles.faqSection} aria-labelledby="faq-title">
        <p className="eyebrow">FAQ</p>
        <h2 id="faq-title">Najczęstsze pytania</h2>
        <div className={styles.faqList}>
          {faq.map((item) => (
            <details key={item.question} className={styles.faqItem}>
              <summary><span>{item.question}</span><span className={styles.faqPlus} aria-hidden="true">+</span></summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.cta}>
        <div>
          <p className="eyebrow">Mexo</p>
          <h2>Scenariusz to początek. Potem obserwuj prawdziwy portfel.</h2>
          <p>Śledź pozycje, transakcje, gotówkę, dywidendy i wynik w jednym miejscu.</p>
          <div className={styles.relatedLinks}>
            <Link href="/narzedzia/procent-skladany">Procent składany ↗</Link>
            <Link href="/kalendarz-gpw">Kalendarz GPW ↗</Link>
          </div>
        </div>
        <Link href="/register" className="primary-button">Załóż darmowe konto</Link>
      </section>

      <footer className={styles.footer}>
        <span>© Mexo</span>
        <span>Kalkulator ma charakter informacyjny i nie stanowi rekomendacji inwestycyjnej.</span>
      </footer>
    </main>
  );
}

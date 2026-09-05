import type { Metadata } from "next";
import CompoundInterestCalculator from "./CompoundInterestCalculator";

const SITE_URL = "https://mexo.com.pl";
const PAGE_PATH = "/narzedzia/procent-skladany";

export const metadata: Metadata = {
  title: "Kalkulator procentu składanego | Mexo",
  description:
    "Darmowy kalkulator procentu składanego. Sprawdź, jak może rosnąć kapitał przy regularnych wpłatach, wybranej stopie zwrotu i inflacji.",
  alternates: { canonical: `${SITE_URL}${PAGE_PATH}` },
  openGraph: {
    title: "Kalkulator procentu składanego | Mexo",
    description:
      "Policz przyszłą wartość inwestycji, wpływ regularnych wpłat oraz inflacji.",
    url: `${SITE_URL}${PAGE_PATH}`,
    siteName: "Mexo",
    locale: "pl_PL",
    type: "website",
  },
};

const faq = [
  {
    question: "Co to jest procent składany?",
    answer:
      "Procent składany oznacza, że kolejne zyski są naliczane nie tylko od początkowego kapitału, ale także od wcześniej wypracowanych zysków.",
  },
  {
    question: "Czy kalkulator uwzględnia regularne wpłaty?",
    answer:
      "Tak. Możesz podać miesięczną wpłatę. Kalkulator zakłada wpłatę na koniec każdego miesiąca.",
  },
  {
    question: "Czy wynik jest gwarantowany?",
    answer:
      "Nie. To symulacja matematyczna oparta na podanej stopie zwrotu. Rzeczywiste wyniki inwestycji mogą być wyższe lub niższe.",
  },
  {
    question: "Po co uwzględniać inflację?",
    answer:
      "Inflacja obniża realną siłę nabywczą pieniędzy. Kalkulator pokazuje więc także orientacyjną wartość końcowego kapitału w dzisiejszych pieniądzach.",
  },
];

export default function CompoundInterestPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-zinc-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 transition hover:text-zinc-950"
          >
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 bg-white font-semibold">
              M
            </span>
            Mexo
          </a>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16 lg:px-8">
        <div className="max-w-3xl">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Narzędzia inwestora
          </p>
          <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
            Kalkulator procentu składanego
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-base leading-7 text-zinc-600 sm:text-lg">
            Zobacz, jak może zmieniać się wartość kapitału przy regularnym
            inwestowaniu. Porównaj wpłacony kapitał, zysk oraz realną wartość
            pieniędzy po uwzględnieniu inflacji.
          </p>
        </div>
      </section>

      <CompoundInterestCalculator />

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              Jak to działa
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em]">
              Małe różnice mają duży wpływ w długim terminie.
            </h2>
          </div>
          <div className="space-y-5 text-sm leading-7 text-zinc-600 sm:text-base">
            <p>
              Kalkulator wykorzystuje miesięczną kapitalizację oraz zakłada,
              że regularna wpłata jest dopisywana na koniec każdego miesiąca.
              Podana roczna stopa zwrotu jest przeliczana na stopę miesięczną.
            </p>
            <p>
              Wynik realny po inflacji pokazuje orientacyjną siłę nabywczą
              końcowego kapitału w dzisiejszych pieniądzach. Nie jest to
              prognoza przyszłych wyników rynku.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
              FAQ
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em]">
              Najczęstsze pytania
            </h2>
          </div>

          <div className="mt-8 divide-y divide-zinc-200 border-y border-zinc-200">
            {faq.map((item) => (
              <details key={item.question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-medium">
                  {item.question}
                  <span className="text-xl font-light text-zinc-400 transition group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="max-w-3xl pt-3 text-sm leading-6 text-zinc-600">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-[28px] border border-zinc-200 bg-zinc-950 px-6 py-10 text-white sm:px-10 sm:py-12">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Mexo
          </p>
          <div className="mt-3 flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-[-0.03em]">
                Symulacja to początek. Śledź swój rzeczywisty portfel.
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-300 sm:text-base">
                Mexo łączy pozycje, wyniki, dywidendy, gotówkę i wydarzenia
                rynkowe w jednym miejscu.
              </p>
            </div>
            <a
              href="/"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100"
            >
              Przejdź do Mexo
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-7 text-xs text-zinc-500 sm:px-6 lg:px-8">
          <span>© Mexo</span>
          <span>
            Kalkulator ma charakter informacyjny i nie stanowi rekomendacji
            inwestycyjnej.
          </span>
        </div>
      </footer>
    </main>
  );
}

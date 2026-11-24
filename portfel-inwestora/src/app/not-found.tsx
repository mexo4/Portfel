import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Nie znaleziono strony",
  robots: { index: false, follow: false },
};

export default function NotFoundPage() {
  return (
    <main className="page-shell">
      <div className="auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">Błąd 404</p>
          <h1 className="auth-title">Nie znaleziono strony</h1>
          <p className="section-copy mt-6">
            Ta strona nie istnieje albo została przeniesiona. Sprawdź adres albo wróć do Mexo.
          </p>

          <p className="section-copy mt-6">
            <Link href="/" className="auth-link">
              Wróć na stronę główną
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

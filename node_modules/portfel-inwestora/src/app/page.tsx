import Link from "next/link";
import { getCurrentAccountData } from "@/lib/server/auth";

const featureItems = [
  "Akcje, ETF-y, krypto i obligacje skarbowe w jednym portfelu",
  "Wycena w PLN z kursami FX i historia sprzedazy",
  "Wykresy struktury, wyniku i porownania z benchmarkami",
];

export default async function HomePage() {
  const accountData = await getCurrentAccountData();
  const appHref = accountData ? "/app" : "/register";

  return (
    <main className="marketing-shell">
      <nav className="marketing-nav" aria-label="Nawigacja">
        <Link href="/" className="brand-link">
          Portfel Inwestora
        </Link>
        <div className="marketing-nav-actions">
          <Link href="/pricing" className="ghost-button">
            Cennik
          </Link>
          {accountData ? (
            <Link href="/app" className="primary-button">
              Otworz aplikacje
            </Link>
          ) : (
            <Link href="/login" className="ghost-button">
              Logowanie
            </Link>
          )}
        </div>
      </nav>

      <section className="marketing-hero">
        <div className="marketing-hero-copy">
          <p className="eyebrow">Portfolio tracker dla inwestora</p>
          <h1>Portfel Inwestora</h1>
          <p>
            Prywatny panel do sledzenia aktywow, transakcji, obligacji i wyniku w PLN.
            Startujesz za darmo, a Pro odblokowuje wieksze portfele.
          </p>
          <div className="marketing-actions">
            <Link href={appHref} className="primary-button">
              {accountData ? "Przejdz do portfela" : "Zaloz darmowe konto"}
            </Link>
            <Link href="/pricing" className="ghost-button">
              Zobacz plany
            </Link>
          </div>
        </div>

        <div className="hero-product-shot" aria-hidden="true">
          <div className="shot-toolbar">
            <span />
            <span />
            <span />
          </div>
          <div className="shot-grid">
            <div className="shot-main-metric">
              <span>Wartosc portfela</span>
              <strong>128 420 PLN</strong>
            </div>
            <div className="shot-small-metric tone-positive">+12.8%</div>
            <div className="shot-chart">
              <span style={{ height: "42%" }} />
              <span style={{ height: "60%" }} />
              <span style={{ height: "52%" }} />
              <span style={{ height: "78%" }} />
              <span style={{ height: "68%" }} />
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-band">
        <div className="marketing-feature-grid">
          {featureItems.map((item) => (
            <article key={item} className="marketing-feature">
              <span className="feature-mark" />
              <p>{item}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

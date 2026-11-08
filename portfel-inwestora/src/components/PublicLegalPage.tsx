import Link from "next/link";
import { resolveLegalDocument, type LegalDocumentKind } from "@/lib/legal-documents";

export default function PublicLegalPage({ kind }: { kind: LegalDocumentKind }) {
  const { document, status, approval } = resolveLegalDocument(kind);
  return (
    <main className="marketing-shell legal-page">
      <nav className="marketing-nav" aria-label="Nawigacja Mexo">
        <Link href="/" className="brand-link">Mexo</Link>
        <div className="marketing-nav-actions">
          <Link href="/privacy" className="marketing-nav-legal" aria-current={kind === "privacy" ? "page" : undefined}>Prywatność</Link>
          <Link href="/terms" className="marketing-nav-legal" aria-current={kind === "terms" ? "page" : undefined}>Regulamin</Link>
          <Link href="/register" className="ghost-button">Utwórz konto</Link>
        </div>
      </nav>
      <article className="legal-document panel">
        <p className="eyebrow">Dokument {document.version}</p>
        <h1>{document.title}</h1>
        {status === "draft" ? (
          <aside className="legal-draft-notice" role="status">
            <strong>PROJEKT — NIEZATWIERDZONY · DO UZUPEŁNIENIA</strong>
            <p>Ten tekst jest materiałem do przeglądu przez operatora i prawnika. Nie jest ostatecznym dokumentem prawnym ani potwierdzeniem zgodności. Nie należy traktować go jako aktualnie obowiązującej polityki lub regulaminu.</p>
          </aside>
        ) : (
          <p className="legal-approved-meta">Wersja {approval?.version} · zatwierdzono {approval?.approvedAt} przez {approval?.approvedBy}</p>
        )}
        {document.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </section>
        ))}
        <footer><Link href="/privacy">Prywatność</Link><Link href="/terms">Regulamin</Link><Link href="/">Wróć do Mexo</Link></footer>
      </article>
    </main>
  );
}

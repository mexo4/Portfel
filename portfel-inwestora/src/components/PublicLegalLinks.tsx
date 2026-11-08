import Link from "next/link";

export default function PublicLegalLinks() {
  return <nav className="public-legal-links" aria-label="Dokumenty Mexo"><Link href="/privacy">Prywatność</Link><Link href="/terms">Regulamin</Link></nav>;
}

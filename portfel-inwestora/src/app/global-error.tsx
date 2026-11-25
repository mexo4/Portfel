"use client";

import Link from "next/link";
import { useEffect } from "react";
import { reloadOnceForChunkError } from "@/lib/chunk-load-error";
import "./globals.css";

// A chunk that failed to load (see `chunk-load-error.ts`) is retried with one reload; any other
// error, or a chunk that fails again, gets a Polish message instead of the default English screen.

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    try {
      reloadOnceForChunkError(error, {
        storage: window.sessionStorage,
        reload: () => window.location.reload(),
        now: Date.now,
      });
    } catch {
      // sessionStorage itself can throw when site data is blocked; the message below stays.
    }
  }, [error]);

  return (
    <html lang="pl">
      <body>
        <main className="page-shell">
          <div className="auth-shell">
            <section className="panel auth-card">
              <p className="eyebrow">Błąd ładowania</p>
              <h1 className="auth-title">Nie udało się wczytać strony</h1>
              <p className="section-copy mt-6">
                Połączenie z serwerem na chwilę się przerwało albo aplikacja została właśnie zaktualizowana.
                Odśwież stronę, a jeśli to nie pomoże, wróć na stronę główną.
              </p>
              <p className="section-copy mt-6">
                <button type="button" className="auth-link" onClick={() => window.location.reload()}>
                  Odśwież stronę
                </button>
                {" · "}
                <Link href="/" className="auth-link">
                  Wróć na stronę główną
                </Link>
              </p>
            </section>
          </div>
        </main>
      </body>
    </html>
  );
}

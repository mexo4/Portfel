"use client";

import Link from "next/link";
import { useState } from "react";
import { requestPasswordReset } from "@/lib/api";

export default function PasswordResetRequestCard() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    setPreviewUrl(null);

    try {
      const response = await requestPasswordReset(email);
      setMessage(
        "Jesli konto z tym adresem istnieje, link do ustawienia nowego hasla jest gotowy."
      );
      setPreviewUrl(response.previewUrl);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Nie udalo sie przygotowac resetu hasla."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="page-shell">
      <div className="auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">Reset hasla</p>
          <h1 className="auth-title">Odzyskaj dostep do konta</h1>
          <p className="section-copy">
            Podaj email przypisany do konta. W trybie developerskim pokazemy Ci od razu
            link do resetu.
          </p>

          <div className="auth-form mt-6">
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="twoj@email.com"
              />
            </label>

            {message ? <p className="field-note">{message}</p> : null}
            {previewUrl ? (
              <p className="field-note">
                Tryb developerski:{" "}
                <a className="auth-link" href={previewUrl}>
                  otworz formularz nowego hasla
                </a>
              </p>
            ) : null}
            {error ? <p className="field-note field-note-error">{error}</p> : null}

            <button
              className="primary-button"
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Przygotowuje link..." : "Wyslij link resetu"}
            </button>
          </div>

          <p className="section-copy mt-6">
            Pamietasz haslo?{" "}
            <Link href="/login" className="auth-link">
              Wroc do logowania
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

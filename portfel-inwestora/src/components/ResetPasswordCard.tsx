"use client";

import Link from "next/link";
import { useState } from "react";
import { resetPassword } from "@/lib/api";

type ResetPasswordCardProps = {
  token: string;
};

export default function ResetPasswordCard({ token }: ResetPasswordCardProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!token.trim()) {
      setError("Brakuje tokenu resetu hasla.");
      return;
    }

    if (password.length < 8) {
      setError("Nowe haslo musi miec co najmniej 8 znakow.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Hasla musza byc identyczne.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await resetPassword({ token, password });
      setSuccess("Haslo zostalo zmienione. Mozesz zalogowac sie nowym haslem.");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Nie udalo sie zmienic hasla."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="page-shell">
      <div className="auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">Nowe haslo</p>
          <h1 className="auth-title">Ustaw nowe haslo</h1>
          <p className="section-copy">
            Link resetu jest jednorazowy i po zmianie hasla wylogowujemy wszystkie stare
            sesje tego konta.
          </p>

          <div className="auth-form mt-6">
            <label className="field">
              <span>Nowe haslo</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 8 znakow"
              />
            </label>

            <label className="field">
              <span>Powtorz haslo</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Wpisz to samo haslo jeszcze raz"
              />
            </label>

            {success ? <p className="field-note">{success}</p> : null}
            {error ? <p className="field-note field-note-error">{error}</p> : null}

            <button
              className="primary-button"
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={isSubmitting || Boolean(success)}
            >
              {isSubmitting ? "Zmieniam haslo..." : "Zapisz nowe haslo"}
            </button>
          </div>

          <p className="section-copy mt-6">
            <Link href="/login" className="auth-link">
              Wroc do logowania
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

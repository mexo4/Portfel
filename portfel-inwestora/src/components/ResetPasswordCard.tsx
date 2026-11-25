"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { resetPassword } from "@/lib/api";
import PasswordField from "@/components/PasswordField";

type ResetPasswordCardProps = {
  token: string;
};

export default function ResetPasswordCard({ token }: ResetPasswordCardProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const confirmPasswordRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = async () => {
    if (!token.trim()) {
      setError("Brakuje tokenu resetu hasła.");
      return;
    }

    if (password.length < 8) {
      setError("Nowe hasło musi mieć co najmniej 8 znaków.");
      passwordRef.current?.focus();
      return;
    }

    if (password !== confirmPassword) {
      setError("Hasła muszą być identyczne.");
      confirmPasswordRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await resetPassword({ token, password });
      setSuccess("Hasło zostało zmienione. Możesz zalogować się nowym hasłem.");
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Nie udało się zmienić hasła."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="page-shell">
      <div className="auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">Nowe hasło</p>
          <h1 className="auth-title">Ustaw nowe hasło</h1>
          <p className="section-copy">
            Link resetu jest jednorazowy i po zmianie hasła wylogowujemy wszystkie stare
            sesje tego konta.
          </p>

          <div className="auth-form mt-6">
            <PasswordField
              label="Nowe hasło"
              value={password}
              inputRef={passwordRef}
              autoComplete="new-password"
              onChange={setPassword}
              placeholder="Minimum 8 znaków"
            />

            <PasswordField
              label="Powtórz hasło"
              value={confirmPassword}
              inputRef={confirmPasswordRef}
              autoComplete="new-password"
              onChange={setConfirmPassword}
              placeholder="Wpisz to samo hasło jeszcze raz"
            />

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
              {isSubmitting ? "Zmieniam hasło..." : "Zapisz nowe hasło"}
            </button>
          </div>

          <p className="section-copy mt-6">
            <Link href="/login" className="auth-link">
              Wróć do logowania
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

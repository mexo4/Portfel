"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { loginUser, registerUser } from "@/lib/api";

type AuthCardProps = {
  mode: "login" | "register";
};

export default function AuthCard({ mode }: AuthCardProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isRegister = mode === "register";

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      if (isRegister) {
        await registerUser({
          displayName,
          email,
          password,
        });
      } else {
        await loginUser({
          email,
          password,
        });
      }

      router.push("/app");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Nie udalo sie zapisac formularza."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="page-shell">
      <div className="auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">{isRegister ? "Rejestracja" : "Logowanie"}</p>
          <h1 className="auth-title">
            {isRegister ? "Zaloz prawdziwe konto inwestora" : "Zaloguj sie do swojego portfela"}
          </h1>
          <p className="section-copy">
            {isRegister
              ? "Twoje konto, profil i portfel beda zapisane po stronie serwera, a nie tylko w przegladarce."
              : "Po zalogowaniu zobaczysz swoj profil i dane portfela przypiete do konta."}
          </p>

          <div className="auth-form mt-6">
            {isRegister ? (
              <label className="field">
                <span>Nazwa uzytkownika</span>
                <input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="Np. Jan Kowalski"
                />
              </label>
            ) : null}

            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="twoj@email.com"
              />
            </label>

            <label className="field">
              <span>Haslo</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 8 znakow"
              />
            </label>

            {!isRegister ? (
              <p className="field-note">
                <Link href="/forgot-password" className="auth-link">
                  Nie pamietasz hasla?
                </Link>
              </p>
            ) : null}

            {error ? <p className="field-note field-note-error">{error}</p> : null}

            <button
              className="primary-button"
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Przetwarzam..."
                : isRegister
                  ? "Utworz konto"
                  : "Zaloguj sie"}
            </button>
          </div>

          <div className="hero-meta mt-6">
            <span className="tag">sesja w bezpiecznym cookie</span>
            <span className="tag">konto zapisane w SQLite</span>
            <span className="tag">haslo szyfrowane przez bcrypt</span>
            <span className="tag">weryfikacja email i reset hasla</span>
          </div>

          <p className="section-copy mt-6">
            {isRegister ? "Masz juz konto?" : "Nie masz jeszcze konta?"}{" "}
            <Link href={isRegister ? "/login" : "/register"} className="auth-link">
              {isRegister ? "Zaloguj sie" : "Zarejestruj sie"}
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

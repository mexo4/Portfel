import Link from "next/link";
import { verifyEmailToken } from "@/lib/server/auth";

type VerifyEmailPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  const params = await searchParams;
  const token = params.token ?? "";

  let title = "Email zweryfikowany";
  let copy = "Adres email zostal potwierdzony. Mozesz wrocic do aplikacji i korzystac z konta.";
  let isError = false;

  try {
    await verifyEmailToken(token);
  } catch (error) {
    title = "Nie udalo sie zweryfikowac emaila";
    copy =
      error instanceof Error
        ? error.message
        : "Link weryfikacyjny jest niepoprawny albo juz wygasl.";
    isError = true;
  }

  return (
    <main className="page-shell">
      <div className="auth-shell">
        <section className="panel auth-card">
          <p className="eyebrow">Weryfikacja email</p>
          <h1 className="auth-title">{title}</h1>
          <p className={isError ? "field-note field-note-error mt-6" : "section-copy mt-6"}>
            {copy}
          </p>

          <p className="section-copy mt-6">
            <Link href={isError ? "/" : "/login"} className="auth-link">
              {isError ? "Wroc do aplikacji" : "Przejdz do logowania"}
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}

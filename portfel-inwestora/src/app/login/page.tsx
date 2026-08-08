import { redirect } from "next/navigation";
import AuthCard from "@/components/AuthCard";
import { getCurrentAccountData } from "@/lib/server/auth";

type LoginPageProps = {
  searchParams: Promise<{
    oauthError?: string;
    oauthNotice?: string;
    verified?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const accountData = await getCurrentAccountData();

  if (accountData) {
    redirect("/app");
  }

  const params = await searchParams;
  const initialNotice =
    params.oauthNotice ??
    (params.verified ? "Email potwierdzony. Mozesz sie zalogowac." : null);

  return <AuthCard mode="login" initialError={params.oauthError ?? null} initialNotice={initialNotice} />;
}

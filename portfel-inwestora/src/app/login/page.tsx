import { redirect } from "next/navigation";
import AuthCard from "@/components/AuthCard";
import { getCurrentAccountData } from "@/lib/server/auth";

export default async function LoginPage() {
  const accountData = await getCurrentAccountData();

  if (accountData) {
    redirect("/");
  }

  return <AuthCard mode="login" />;
}

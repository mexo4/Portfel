import { redirect } from "next/navigation";
import AuthCard from "@/components/AuthCard";
import { getCurrentAccountData } from "@/lib/server/auth";
import { getGoogleOAuthConfigurationPresence } from "@/lib/server/oauth";

export default async function RegisterPage() {
  const accountData = await getCurrentAccountData();

  if (accountData) {
    redirect("/app");
  }

  const googleOAuthConfiguration = getGoogleOAuthConfigurationPresence();
  const googleOAuthAvailable =
    process.env.NODE_ENV === "production" ||
    (googleOAuthConfiguration.googleClientIdPresent &&
      googleOAuthConfiguration.googleClientSecretPresent);

  return <AuthCard mode="register" googleOAuthAvailable={googleOAuthAvailable} />;
}

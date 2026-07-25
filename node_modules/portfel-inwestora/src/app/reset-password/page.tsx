import ResetPasswordCard from "@/components/ResetPasswordCard";

type ResetPasswordPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;

  return <ResetPasswordCard token={params.token ?? ""} />;
}

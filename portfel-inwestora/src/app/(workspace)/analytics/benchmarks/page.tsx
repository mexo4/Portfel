import { redirect } from "next/navigation";

export default async function BenchmarksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const key of ["portfolio", "currency"]) {
    const value = raw[key];
    if (typeof value === "string" && value) params.set(key, value);
  }
  redirect(`/analytics/charts${params.size ? `?${params.toString()}` : ""}`);
}

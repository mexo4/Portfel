import { NextResponse } from "next/server";
import { buildBenchmarkComparisons } from "@/lib/server/benchmarks";
import type { BenchmarkInvestment } from "@/types/portfolio";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      investments?: BenchmarkInvestment[];
    };

    const comparisons = await buildBenchmarkComparisons(payload.investments ?? []);

    return NextResponse.json({ comparisons });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Nie udalo sie policzyc porownania z benchmarkami.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}

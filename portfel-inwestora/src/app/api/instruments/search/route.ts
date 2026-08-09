import { NextResponse } from "next/server";
import { getCurrentAccountData } from "@/lib/server/auth";
import {
  OpenFigiSearchError,
  searchEtfInstruments,
} from "@/lib/server/openfigi";

export const runtime = "nodejs";

const errorMessageFor = (error: OpenFigiSearchError) => {
  switch (error.code) {
    case "configuration":
      return "Wyszukiwanie ETF jest chwilowo niedostepne. Skontaktuj sie z obsluga.";
    case "rate_limit":
      return "Wyszukiwanie ETF jest chwilowo zbyt obciazone. Sprobuj za chwile.";
    default:
      return "Nie udalo sie wyszukac instrumentow. Sprobuj ponownie.";
  }
};

export async function GET(request: Request) {
  const account = await getCurrentAccountData();

  if (!account) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim().replace(/\s+/g, " ").slice(0, 128);

  if (query.length < 1) {
    return NextResponse.json({ groups: [] });
  }

  try {
    const groups = await searchEtfInstruments(query, undefined, account.user.id);
    return NextResponse.json({ groups });
  } catch (error) {
    if (error instanceof OpenFigiSearchError) {
      const status = error.code === "rate_limit" ? 429 : error.code === "configuration" ? 503 : 502;
      return NextResponse.json({ error: errorMessageFor(error) }, { status });
    }

    console.error("GET /api/instruments/search failed");
    return NextResponse.json(
      { error: "Nie udalo sie wyszukac instrumentow. Sprobuj ponownie." },
      { status: 500 }
    );
  }
}

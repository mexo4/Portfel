import { NextResponse } from "next/server";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import {
  OpenFigiSearchError,
  searchEtfInstruments,
} from "@/lib/server/openfigi";

export const runtime = "nodejs";

const errorResponseFor = (error: OpenFigiSearchError) => {
  switch (error.code) {
    case "configuration":
    case "invalid_credentials":
      return {
        status: 503,
        message: "Wyszukiwanie ETF jest obecnie niedostępne.",
      };
    case "rate_limit":
      return {
        status: 429,
        message: "Limit wyszukiwania został chwilowo wykorzystany. Spróbuj ponownie za moment.",
      };
    case "network":
    case "timeout":
      return {
        status: 502,
        message: "Nie udało się połączyć z usługą wyszukiwania ETF.",
      };
    default:
      return {
        status: 502,
        message: "Nie udało się wyszukać ETF-ów. Spróbuj ponownie.",
      };
  }
};

export async function GET(request: Request) {
  const user = await getCurrentAuthenticatedUser();

  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("q") ?? "").trim().replace(/\s+/g, " ").slice(0, 128);

  if (!query) {
    return NextResponse.json({ groups: [] });
  }

  try {
    const groups = await searchEtfInstruments(query, undefined, user.id);
    return NextResponse.json({ groups });
  } catch (error) {
    if (error instanceof OpenFigiSearchError) {
      const response = errorResponseFor(error);
      return NextResponse.json(
        { error: response.message, code: error.code },
        { status: response.status }
      );
    }

    console.error("GET /api/etf/search failed");
    return NextResponse.json(
      {
        error: "Nie udało się wyszukać ETF-ów. Spróbuj ponownie.",
        code: "provider_unavailable",
      },
      { status: 500 }
    );
  }
}

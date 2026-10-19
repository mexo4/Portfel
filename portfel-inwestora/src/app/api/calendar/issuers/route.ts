import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { query } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const searchIssuers = unstable_cache(async (search: string) => query<{
  ticker: string; company_name: string;
}>(`
  SELECT issuer.ticker, MIN(issuer.company_name) AS company_name
  FROM corporate_event_instruments AS issuer
  WHERE issuer.market = 'GPW'
    AND issuer.ticker <> ''
    AND (
      POSITION(LOWER($1) IN LOWER(issuer.ticker)) > 0
      OR POSITION(LOWER($1) IN LOWER(issuer.company_name)) > 0
    )
  GROUP BY issuer.ticker
  ORDER BY CASE WHEN UPPER(issuer.ticker) = UPPER($1) THEN 0 ELSE 1 END, issuer.ticker
  LIMIT 12
`, [search]), ["mexo-ical-issuers-v1"], { revalidate: 300 });

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams.get("search")?.trim() ?? "";
  if (search.length < 2 || search.length > 70) {
    return NextResponse.json({ issuers: [] }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    });
  }
  try {
    const issuers = (await searchIssuers(search)).map((row) => ({
      ticker: row.ticker.toUpperCase(), companyName: row.company_name,
    }));
    return NextResponse.json({ issuers }, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300" },
    });
  } catch (error) {
    console.error("[gpw-ical-issuers] query failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Lista spółek chwilowo niedostępna." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

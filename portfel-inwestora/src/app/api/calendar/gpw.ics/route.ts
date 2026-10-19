import { NextResponse } from "next/server";
import { parseIcalCategories, serializeIcal } from "@/lib/gpw-ical";
import { readPublicIcalEvents } from "@/lib/server/public-gpw-ical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const warsawToday = () => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const addMonths = (value: string, months: number) => {
  const [year, month, day] = value.split("-").map(Number);
  const start = new Date(Date.UTC(year!, month! - 1 + months, 1, 12));
  const last = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(day!, last));
  return start.toISOString().slice(0, 10);
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const categories = parseIcalCategories(url.searchParams.get("categories"));
  if (!categories) {
    return NextResponse.json({ error: "Wybierz reports, dividends i/lub meetings." }, {
      status: 400, headers: { "Cache-Control": "no-store" },
    });
  }
  const today = warsawToday();
  const from = addDays(today, -60);
  const to = addMonths(today, 15);
  try {
    const events = await readPublicIcalEvents(from, to, categories);
    const body = serializeIcal(events, categories);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="mexo-gpw.ics"',
        "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[public-gpw-ical] failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Kalendarz jest chwilowo niedostępny." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

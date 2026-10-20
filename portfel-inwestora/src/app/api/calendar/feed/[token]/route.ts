import { NextResponse } from "next/server";
import { serializeIcal } from "@/lib/gpw-ical";
import { getCalendarSubscriptionByToken } from "@/lib/server/calendar-subscriptions";
import { readPublicIcalEvents } from "@/lib/server/public-gpw-ical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };

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

export async function GET(_request: Request, context: Context) {
  const { token } = await context.params;
  try {
    const subscription = await getCalendarSubscriptionByToken(token);
    if (!subscription) {
      return NextResponse.json({ error: "Subskrypcja nie istnieje lub została unieważniona." }, {
        status: 404, headers: { "Cache-Control": "no-store" },
      });
    }
    const today = warsawToday();
    const events = await readPublicIcalEvents(
      addDays(today, -60), addMonths(today, 15), subscription.categories, subscription.tickers,
    );
    const body = serializeIcal(events, subscription.categories, [], {
      sourceUrl: subscription.sourceUrl,
      title: `Mexo — ${subscription.name}`,
    });
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="mexo-gpw.ics"',
        "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    console.error("[private-gpw-ical] failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Kalendarz jest chwilowo niedostępny." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

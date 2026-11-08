import { NextResponse } from "next/server";
import { AccountExportTooLargeError, createAccountDataExport } from "@/lib/server/account-privacy";
import { getCurrentAuthenticatedUser } from "@/lib/server/auth";
import { applyAuthRateLimit } from "@/lib/server/auth-rate-limit-response";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const user = await getCurrentAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  const limited = await applyAuthRateLimit(request, "accountExport", user.id);
  if (limited) {
    limited.headers.set("Cache-Control", "private, no-store");
    return limited;
  }

  try {
    const archive = await createAccountDataExport(user.id);
    if (!archive) return NextResponse.json({ error: "Konto nie jest już dostępne." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(new Blob([archive], { type: "application/zip" }), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="mexo-export-${date}.zip"`,
        "Content-Length": String(archive.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof AccountExportTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413, headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ error: "Nie udało się przygotować kompletnego eksportu. Spróbuj ponownie później." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}

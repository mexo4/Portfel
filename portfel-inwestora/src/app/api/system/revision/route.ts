import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Public release metadata only. The response must never be CDN/browser cached. */
export async function GET() {
  const revision = process.env.MEXO_BUILD_REVISION?.trim() || "local";
  return NextResponse.json(
    { revision },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
        "X-Mexo-Revision": revision,
      },
    }
  );
}

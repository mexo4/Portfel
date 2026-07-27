import { NextResponse } from "next/server";
import { Resend } from "resend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;

  console.log(Boolean(process.env.RESEND_API_KEY));

  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "Missing RESEND_API_KEY" },
      { status: 500 }
    );
  }

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: "Mexo <noreply@mexo.com.pl>",
      to: "supportmexo@gmail.com",
      subject: "Test wysyłki Mexo",
      html: "<p>Test email działa.</p>",
    });

    console.log("test-email resend.emails.send result", result);

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("test-email resend.emails.send error", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown email error",
      },
      { status: 500 }
    );
  }
}

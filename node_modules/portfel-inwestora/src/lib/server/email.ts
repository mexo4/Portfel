type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const EMAIL_FROM = process.env.EMAIL_FROM ?? "Portfel inwestora <onboarding@resend.dev>";

export const sendEmail = async ({ to, subject, text, html }: EmailPayload) => {
  if (!RESEND_API_KEY) {
    return { sent: false, reason: "missing_resend_key" as const };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to,
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    throw new Error("Nie udalo sie wyslac emaila weryfikacyjnego.");
  }

  return { sent: true, reason: null };
};

export const sendVerificationEmail = async (email: string, verificationUrl: string) =>
  sendEmail({
    to: email,
    subject: "Potwierdz konto w Portfelu inwestora",
    text: `Potwierdz konto, otwierajac link: ${verificationUrl}`,
    html: `<p>Potwierdz konto w Portfelu inwestora.</p><p><a href="${verificationUrl}">Potwierdz email</a></p>`,
  });

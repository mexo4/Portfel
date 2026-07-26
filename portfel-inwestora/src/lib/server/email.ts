type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

const DEFAULT_EMAIL_FROM = "Portfel inwestora <onboarding@resend.dev>";

const getResendApiKey = () => process.env.RESEND_API_KEY ?? "";

const getEmailFrom = () => process.env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM;

const redactEmailForLogs = (email: string) => {
  const [localPart, domain] = email.split("@");

  if (!localPart || !domain) {
    return "***";
  }

  return `${localPart.slice(0, 2)}***@${domain}`;
};

const readResendResponseBody = async (response: Response) => {
  const responseText = await response.text().catch(() => "");

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return responseText;
  }
};

export const sendEmail = async ({ to, subject, text, html }: EmailPayload) => {
  const resendApiKey = getResendApiKey();
  const from = getEmailFrom();
  const logContext = {
    to: redactEmailForLogs(to),
    from,
    subject,
  };

  if (!resendApiKey) {
    console.warn("resend.emails.send skipped", {
      ...logContext,
      reason: "missing_resend_key",
    });

    return { sent: false, reason: "missing_resend_key" as const };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      html,
    }),
  });

  const responseBody = await readResendResponseBody(response);

  console.log("resend.emails.send result", {
    ...logContext,
    ok: response.ok,
    status: response.status,
    response: responseBody,
  });

  if (!response.ok) {
    console.error("resend.emails.send rejected", {
      ...logContext,
      status: response.status,
      response: responseBody,
    });

    throw new Error(`Nie udalo sie wyslac emaila weryfikacyjnego. Resend status: ${response.status}.`);
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

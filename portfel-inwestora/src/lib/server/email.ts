import { Resend } from "resend";

type SendEmailResult = {
  sent: boolean;
  reason: "missing_resend_key" | null;
  id?: string;
};

type ActionEmailPayload = {
  to: string;
  subject: string;
  title: string;
  intro: string;
  buttonLabel: string;
  buttonUrl: string;
  securityNote: string;
};

const MEXO_FROM = "Mexo <noreply@mexo.com.pl>";
const MEXO_BRAND_COLOR = "#0f766e";
const MEXO_ACCENT_COLOR = "#14b8a6";

const getResendApiKey = () => process.env.RESEND_API_KEY ?? "";

const redactEmailForLogs = (email: string) => {
  const [localPart, domain] = email.split("@");

  if (!localPart || !domain) {
    return "***";
  }

  return `${localPart.slice(0, 2)}***@${domain}`;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const createActionEmailHtml = ({
  title,
  intro,
  buttonLabel,
  buttonUrl,
  securityNote,
}: Omit<ActionEmailPayload, "to" | "subject">) => {
  const escapedTitle = escapeHtml(title);
  const escapedIntro = escapeHtml(intro);
  const escapedButtonLabel = escapeHtml(buttonLabel);
  const escapedButtonUrl = escapeHtml(buttonUrl);
  const escapedSecurityNote = escapeHtml(securityNote);

  return `
<!doctype html>
<html lang="pl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapedTitle}</title>
  </head>
  <body style="margin:0;background:#f6f8fb;color:#111827;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:${MEXO_BRAND_COLOR};padding:24px 28px;">
                <div style="font-size:24px;line-height:1;font-weight:800;color:#ffffff;letter-spacing:0;">Mexo</div>
                <div style="margin-top:8px;font-size:13px;line-height:1.5;color:#ccfbf1;">Portfel inwestora</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 28px 12px;">
                <h1 style="margin:0;font-size:24px;line-height:1.3;color:#111827;">${escapedTitle}</h1>
                <p style="margin:18px 0 0;font-size:16px;line-height:1.7;color:#374151;">${escapedIntro}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 28px;">
                <a href="${escapedButtonUrl}" style="display:inline-block;background:${MEXO_BRAND_COLOR};color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;line-height:1;padding:15px 22px;border-radius:10px;">
                  ${escapedButtonLabel}
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;">
                <p style="margin:0;font-size:14px;line-height:1.7;color:#6b7280;">Jeśli przycisk nie działa, skopiuj i wklej ten link w przeglądarce:</p>
                <p style="margin:8px 0 0;font-size:13px;line-height:1.6;word-break:break-all;color:${MEXO_BRAND_COLOR};">${escapedButtonUrl}</p>
                <div style="margin-top:24px;padding:16px;border-left:4px solid ${MEXO_ACCENT_COLOR};background:#f0fdfa;border-radius:8px;">
                  <p style="margin:0;font-size:14px;line-height:1.6;color:#0f766e;">${escapedSecurityNote}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">To jest automatyczna wiadomość od Mexo. Nie odpowiadaj na ten email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
};

const createActionEmailText = ({
  title,
  intro,
  buttonLabel,
  buttonUrl,
  securityNote,
}: Omit<ActionEmailPayload, "to" | "subject">) =>
  [
    title,
    "",
    intro,
    "",
    `${buttonLabel}: ${buttonUrl}`,
    "",
    securityNote,
    "",
    "To jest automatyczna wiadomość od Mexo. Nie odpowiadaj na ten email.",
  ].join("\n");

const sendActionEmail = async (payload: ActionEmailPayload): Promise<SendEmailResult> => {
  const resendApiKey = getResendApiKey();
  const logContext = {
    to: redactEmailForLogs(payload.to),
    from: MEXO_FROM,
    subject: payload.subject,
  };

  if (!resendApiKey) {
    console.warn("resend email skipped", {
      ...logContext,
      reason: "missing_resend_key",
    });

    return { sent: false, reason: "missing_resend_key" };
  }

  const resend = new Resend(resendApiKey);
  const result = await resend.emails.send({
    from: MEXO_FROM,
    to: payload.to,
    subject: payload.subject,
    text: createActionEmailText(payload),
    html: createActionEmailHtml(payload),
  });

  console.log("resend email result", {
    ...logContext,
    sent: Boolean(result.data?.id),
    id: result.data?.id,
    error: result.error,
  });

  if (result.error) {
    console.error("resend email rejected", {
      ...logContext,
      error: result.error,
    });

    throw new Error("Nie udało się wysłać wiadomości email.");
  }

  return {
    sent: true,
    reason: null,
    id: result.data?.id,
  };
};

export const sendVerificationEmail = (email: string, verificationUrl: string) =>
  sendActionEmail({
    to: email,
    subject: "Potwierdź adres email – Mexo",
    title: "Potwierdź adres email",
    intro:
      "Dziękujemy za założenie konta w Mexo. Kliknij przycisk poniżej, aby potwierdzić adres email i aktywować dostęp do aplikacji.",
    buttonLabel: "Potwierdź adres email",
    buttonUrl: verificationUrl,
    securityNote:
      "Jeśli nie zakładałeś konta w Mexo, możesz bezpiecznie zignorować tę wiadomość.",
  });

export const sendPasswordResetEmail = (email: string, resetUrl: string) =>
  sendActionEmail({
    to: email,
    subject: "Reset hasła – Mexo",
    title: "Ustaw nowe hasło",
    intro:
      "Otrzymaliśmy prośbę o zresetowanie hasła do Twojego konta Mexo. Kliknij przycisk poniżej, aby ustawić nowe hasło.",
    buttonLabel: "Ustaw nowe hasło",
    buttonUrl: resetUrl,
    securityNote:
      "Jeśli nie prosiłeś o reset hasła, możesz zignorować tę wiadomość. Dotychczasowe hasło pozostanie bez zmian.",
  });

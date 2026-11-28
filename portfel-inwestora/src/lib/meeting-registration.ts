/** The registration day of a general meeting (dzień rejestracji uczestnictwa). Pure, server/client-neutral. */

export type GeneralMeetingRegistrationSource = "OFFICIAL" | "STATUTORY_CALCULATION" | "UNKNOWN";

/** Art. 406¹ KSH: calendar days, including weekends. Only call for a verified public-company WZA. */
export const getStatutoryMeetingRegistrationDate = (meetingDate: string): string | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) return undefined;
  const date = new Date(`${meetingDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== meetingDate) return undefined;
  date.setUTCDate(date.getUTCDate() - 16);
  return date.toISOString().slice(0, 10);
};

/** An issuer registered in Poland: the ISIN's country code is PL. Art. 406¹ KSH binds such public companies. */
export const isPolishIssuerIsin = (isin: string | null | undefined) => /^PL[A-Z0-9]{9}\d$/.test((isin ?? "").toUpperCase());

/**
 * The day a meeting's notice states, else, for a company registered in Poland, 16 days before the meeting as
 * the law fixes it. Notices state the day mostly in a PDF that the ESPI attachment server does not hand to
 * automated readers, so the law is what fills the day in. A foreign issuer (Allegro.eu, GreenX Metals) follows
 * its own law: without its notice, the day stays unknown.
 */
export const resolveMeetingRegistrationDate = (
  meetingDate: string, officialDate: string | null | undefined, isin: string | null | undefined
): { date?: string; source: GeneralMeetingRegistrationSource } => {
  if (officialDate) return { date: officialDate, source: "OFFICIAL" };
  const statutory = isPolishIssuerIsin(isin) ? getStatutoryMeetingRegistrationDate(meetingDate) : undefined;
  return statutory ? { date: statutory, source: "STATUTORY_CALCULATION" } : { source: "UNKNOWN" };
};

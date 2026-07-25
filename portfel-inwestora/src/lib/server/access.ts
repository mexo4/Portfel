const DEFAULT_ADMIN_EMAILS = ["okninskimikolaj@gmail.com"];
const DEFAULT_PRO_EMAILS = DEFAULT_ADMIN_EMAILS;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const getConfiguredEmails = (keys: string[]) =>
  keys.flatMap((key) => (process.env[key] ?? "").split(","))
    .map((email) => email.trim().toLowerCase())
    .filter((email): email is string => Boolean(email));

const getAdminEmails = () =>
  Array.from(
    new Set([
      ...DEFAULT_ADMIN_EMAILS,
      ...getConfiguredEmails(["ADMIN_EMAIL", "ADMIN_EMAILS"]),
    ])
  );

const getForcedProEmails = () =>
  Array.from(
    new Set([
      ...DEFAULT_PRO_EMAILS,
      ...getConfiguredEmails(["PRO_EMAIL", "PRO_EMAILS"]),
    ])
  );

export const isAdminEmail = (email: string) =>
  getAdminEmails().includes(normalizeEmail(email));

export const isForcedProEmail = (email: string) =>
  getForcedProEmails().includes(normalizeEmail(email));

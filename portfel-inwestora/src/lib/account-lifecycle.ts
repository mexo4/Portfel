export const canDeleteAdministrator = (role: string, administratorCount: number) =>
  role !== "admin" || administratorCount > 1;

export const MAX_ACCOUNT_EXPORT_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
export const MAX_ACCOUNT_EXPORT_ROWS_PER_DATASET = 50_000;
export const MAX_ACCOUNT_EXPORT_TOTAL_ROWS = 100_000;

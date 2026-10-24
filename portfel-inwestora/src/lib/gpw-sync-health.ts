export type GpwSyncHealth = "COMPLETE" | "INCOMPLETE" | "FAILED";

/** A successful bounded batch is not the same as a completed backlog. */
export const getGpwSyncHealth = ({
  errors = 0,
  pending = 0,
}: {
  errors?: number;
  pending?: number;
}): GpwSyncHealth => {
  if (errors > 0) return "FAILED";
  if (pending > 0) return "INCOMPLETE";
  return "COMPLETE";
};

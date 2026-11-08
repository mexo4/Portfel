import type { AuthenticatedUser } from "@/types/portfolio";

/** Authorization is based on persisted roles, never a runtime email match. */
export const hasAdminRole = (user: Pick<AuthenticatedUser, "role">) => user.role === "admin";

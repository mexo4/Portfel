import {
  normalizeDashboardLayout,
  type DashboardLayout,
} from "@/lib/dashboard-layout";
import { execute, queryOne } from "@/lib/server/db";

type DashboardLayoutRow = {
  layout_json: string;
  revision: number;
  updated_at: string;
};

export type StoredDashboardLayout = {
  layout: DashboardLayout;
  revision: number;
  updatedAt: string | null;
};

const parseStoredLayout = (value: string) => {
  try {
    return normalizeDashboardLayout(JSON.parse(value) as unknown);
  } catch {
    return normalizeDashboardLayout(null);
  }
};

export const getUserDashboardLayout = async (userId: string): Promise<StoredDashboardLayout> => {
  const row = await queryOne<DashboardLayoutRow>(
    `SELECT layout_json, revision, updated_at
     FROM user_dashboard_layouts
     WHERE user_id = $1`,
    [userId]
  );

  if (!row) {
    return {
      layout: normalizeDashboardLayout(null),
      revision: 0,
      updatedAt: null,
    };
  }

  return {
    layout: parseStoredLayout(row.layout_json),
    revision: row.revision,
    updatedAt: row.updated_at,
  };
};

/**
 * The only persisted payload is a normalized, versioned arrangement of widget
 * identifiers. User portfolio data never travels through this path.
 */
export const saveUserDashboardLayout = async (
  userId: string,
  candidate: unknown
): Promise<StoredDashboardLayout> => {
  const layout = normalizeDashboardLayout(candidate);
  const updatedAt = new Date().toISOString();

  await execute(
    `INSERT INTO user_dashboard_layouts (user_id, layout_json, revision, updated_at)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (user_id)
     DO UPDATE SET
       layout_json = EXCLUDED.layout_json,
       revision = user_dashboard_layouts.revision + 1,
       updated_at = EXCLUDED.updated_at
     WHERE user_dashboard_layouts.layout_json IS DISTINCT FROM EXCLUDED.layout_json`,
    [userId, JSON.stringify(layout), updatedAt]
  );

  const stored = await getUserDashboardLayout(userId);
  return stored;
};

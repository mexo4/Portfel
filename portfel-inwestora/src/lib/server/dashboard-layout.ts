import {
  DEFAULT_MOBILE_DASHBOARD_LAYOUT,
  normalizeDashboardLayout,
  normalizeDashboardScopeLayouts,
  type DashboardScopeLayouts,
} from "@/lib/dashboard-layout";
import { execute, queryOne } from "@/lib/server/db";

type ScopedLayoutRow = {
  desktop_layout_json: string;
  mobile_layout_json: string;
  revision: number;
  updated_at: string;
};

type LegacyLayoutRow = {
  layout_json: string;
  revision: number;
  updated_at: string;
};

export type StoredDashboardScopeLayouts = {
  scopeKey: string;
  layouts: DashboardScopeLayouts;
  revision: number;
  updatedAt: string | null;
  inheritedFromLegacy?: boolean;
};

const parseJson = (value: string) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

/**
 * Missing per-scope layouts inherit the legacy user layout without mutating
 * the old table. The first explicit save creates an independent scope row.
 */
export const getUserDashboardLayouts = async (
  userId: string,
  scopeKey: string
): Promise<StoredDashboardScopeLayouts> => {
  const row = await queryOne<ScopedLayoutRow>(
    `SELECT desktop_layout_json, mobile_layout_json, revision, updated_at
     FROM user_dashboard_layout_scopes
     WHERE user_id = $1 AND scope_key = $2`,
    [userId, scopeKey]
  );

  if (row) {
    return {
      scopeKey,
      layouts: normalizeDashboardScopeLayouts({
        desktop: parseJson(row.desktop_layout_json),
        mobile: parseJson(row.mobile_layout_json),
      }),
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  }

  const legacy = await queryOne<LegacyLayoutRow>(
    `SELECT layout_json, revision, updated_at FROM user_dashboard_layouts WHERE user_id = $1`,
    [userId]
  );
  if (legacy) {
    const desktop = normalizeDashboardLayout(parseJson(legacy.layout_json));
    return {
      scopeKey,
      layouts: {
        desktop,
        mobile: normalizeDashboardLayout(desktop, DEFAULT_MOBILE_DASHBOARD_LAYOUT),
      },
      revision: 0,
      updatedAt: legacy.updated_at,
      inheritedFromLegacy: true,
    };
  }

  return {
    scopeKey,
    layouts: normalizeDashboardScopeLayouts(null),
    revision: 0,
    updatedAt: null,
  };
};

export const saveUserDashboardLayouts = async (
  userId: string,
  scopeKey: string,
  candidate: unknown
): Promise<StoredDashboardScopeLayouts> => {
  const layouts = normalizeDashboardScopeLayouts(candidate);
  const desktopJson = JSON.stringify(layouts.desktop);
  const mobileJson = JSON.stringify(layouts.mobile);
  const updatedAt = new Date().toISOString();

  await execute(
    `INSERT INTO user_dashboard_layout_scopes (
       user_id, scope_key, desktop_layout_json, mobile_layout_json, revision, updated_at
     ) VALUES ($1, $2, $3, $4, 1, $5)
     ON CONFLICT (user_id, scope_key)
     DO UPDATE SET
       desktop_layout_json = EXCLUDED.desktop_layout_json,
       mobile_layout_json = EXCLUDED.mobile_layout_json,
       revision = user_dashboard_layout_scopes.revision + 1,
       updated_at = EXCLUDED.updated_at
     WHERE user_dashboard_layout_scopes.desktop_layout_json IS DISTINCT FROM EXCLUDED.desktop_layout_json
        OR user_dashboard_layout_scopes.mobile_layout_json IS DISTINCT FROM EXCLUDED.mobile_layout_json`,
    [userId, scopeKey, desktopJson, mobileJson, updatedAt]
  );

  return getUserDashboardLayouts(userId, scopeKey);
};

// Compatibility exports for older tests and call sites. New code always uses
// an explicit scope and both device layouts.
export const getUserDashboardLayout = (userId: string) => getUserDashboardLayouts(userId, "all");
export const saveUserDashboardLayout = (userId: string, candidate: unknown) =>
  saveUserDashboardLayouts(userId, "all", { desktop: candidate, mobile: candidate });

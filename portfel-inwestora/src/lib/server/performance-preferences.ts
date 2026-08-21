import { normalizePerformanceMetricIds } from "@/lib/performance-preferences";
import { execute, queryOne } from "@/lib/server/db";

type PreferenceRow = { visible_metrics_json: string; revision: number; updated_at: string };

const parseMetrics = (value: string) => {
  try { return normalizePerformanceMetricIds(JSON.parse(value)); } catch { return normalizePerformanceMetricIds(null); }
};

export const getUserPerformancePreferences = async (userId: string) => {
  const row = await queryOne<PreferenceRow>(
    "SELECT visible_metrics_json, revision, updated_at FROM user_performance_preferences WHERE user_id = $1",
    [userId]
  );
  return {
    visibleMetrics: row ? parseMetrics(row.visible_metrics_json) : normalizePerformanceMetricIds(null),
    revision: row?.revision ?? 0,
    updatedAt: row?.updated_at ?? null,
  };
};

export const saveUserPerformancePreferences = async (userId: string, candidate: unknown) => {
  const visibleMetrics = normalizePerformanceMetricIds(candidate);
  const json = JSON.stringify(visibleMetrics);
  const updatedAt = new Date().toISOString();
  await execute(
    `INSERT INTO user_performance_preferences (user_id, visible_metrics_json, revision, updated_at)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       visible_metrics_json = EXCLUDED.visible_metrics_json,
       revision = user_performance_preferences.revision + 1,
       updated_at = EXCLUDED.updated_at
     WHERE user_performance_preferences.visible_metrics_json IS DISTINCT FROM EXCLUDED.visible_metrics_json`,
    [userId, json, updatedAt]
  );
  return getUserPerformancePreferences(userId);
};

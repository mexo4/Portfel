"use client";

import ConfigurableDashboard from "@/components/ConfigurableDashboard";

/** Keep the dashboard route out of the all-routes client barrel. */
export function WorkspaceDashboardPage() {
  return <ConfigurableDashboard />;
}

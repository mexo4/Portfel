/** Effective privileges required by the current scoped-repair executor. */
export const REPAIR_ROLE = "mexo_gpw_repair";
export const REPAIR_READ_TABLES = ["corporate_event_instruments", "corporate_events",
  "corporate_event_sources", "corporate_event_history", "corporate_event_projection_changes",
  "espi_reports", "espi_sync_state"];
export const REPAIR_WRITE_PRIVILEGES = [["corporate_events", "UPDATE"],
  ["corporate_event_sources", "INSERT"], ["corporate_event_history", "INSERT"],
  ["corporate_event_projection_changes", "INSERT"]];
export const REPAIR_FORBIDDEN_PRIVILEGES = [["users", ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]],
  ["core_operations", ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]],
  ["corporate_events", ["DELETE", "TRUNCATE"]],
  ...["corporate_event_sources", "corporate_event_history", "corporate_event_projection_changes"]
    .map((table) => [table, ["UPDATE", "DELETE", "TRUNCATE"]])];

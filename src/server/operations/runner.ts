import { createOperationsReporter, type OperationsSink } from "./alerts";

type Dependencies = {
  maintain(): Promise<Record<string, number> | null>;
  backupIfNeeded(): Promise<boolean>;
  diagnose(): Promise<string[]>;
  sink: OperationsSink;
};
export function createOperationsRunner(deps: Dependencies) {
  const report = createOperationsReporter(deps.sink);
  const failures = new Set<string>();
  let maintenanceAt = -Infinity, backupAt = -Infinity, running = false;
  const interval = 15 * 60_000;
  return { async tick(now = new Date()) {
    if (running) return { status: "busy" as const, issues: [] as string[] };
    running = true;
    try {
      if (now.getTime() - maintenanceAt >= interval) {
        try {
          const counts = await deps.maintain();
          if (counts) {
            maintenanceAt = now.getTime(); failures.delete("MAINTENANCE_FAILED");
            if (Object.values(counts).some(count => count > 0)) await deps.sink.write({ at: now.toISOString(), type: "maintenance", issues: [], counts });
          }
        } catch { maintenanceAt = now.getTime(); failures.add("MAINTENANCE_FAILED"); }
      }
      if (now.getTime() - backupAt >= interval) {
        backupAt = now.getTime();
        try {
          const created = await deps.backupIfNeeded(); failures.delete("BACKUP_FAILED");
          if (created) await deps.sink.write({ at: now.toISOString(), type: "backup", issues: [] });
        } catch { failures.add("BACKUP_FAILED"); }
      }
      let diagnostics: string[];
      try { diagnostics = await deps.diagnose(); } catch { diagnostics = ["DATABASE_UNAVAILABLE"]; }
      const issues = [...new Set([...failures, ...diagnostics])].sort();
      await report(issues, now);
      return { status: issues.length ? "attention" as const : "ok" as const, issues };
    } finally { running = false; }
  } };
}

import type { inspectBackups, inspectDatabase } from "./diagnostics";

export function operationsIssues(database: Awaited<ReturnType<typeof inspectDatabase>>, backups: Awaited<ReturnType<typeof inspectBackups>>) {
  const issues: string[] = [];
  if (database.privilegedRole) issues.push("RUNTIME_ROLE_PRIVILEGED");
  if (!database.migrationsCurrent) issues.push("MIGRATIONS_PENDING");
  if (!database.queue) issues.push("QUEUE_UNAVAILABLE");
  else {
    if (database.queue.failed) issues.push("DELIVERY_FAILED");
    if (database.queue.expiredLeases) issues.push("EXPIRED_LEASES");
    if (database.queue.pending && (database.queue.oldestSeconds ?? 0) > 300) issues.push("QUEUE_DELAYED");
  }
  if (!backups.count) issues.push("BACKUP_MISSING");
  else {
    if ((backups.latestAgeSeconds ?? 0) > 86_400) issues.push("BACKUP_OLDER_THAN_24H");
    if (!backups.verified) issues.push("BACKUP_NOT_VERIFIED");
  }
  return issues;
}

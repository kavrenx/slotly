import { readFile } from "node:fs/promises";
import { inspectBackups, inspectDatabase } from "../src/server/operations/diagnostics";
import { loadEnvironment } from "./lib/environment";
import { backupDirectory, reportOperationError } from "./lib/operations";

try {
  const env = loadEnvironment();
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as { entries: { when: number }[] };
  const database = await inspectDatabase(env, journal.entries.map(e => e.when));
  const backups = await inspectBackups(backupDirectory);
  const issues = [];
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
  console.log(JSON.stringify({ status: issues.length ? "attention" : "ok", database, backups, issues }, null, 2));
  if (issues.length) process.exitCode = 2;
} catch (error) { reportOperationError(error); }

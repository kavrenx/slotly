import { readFile } from "node:fs/promises";
import { inspectBackups, inspectDatabase } from "../src/server/operations/diagnostics";
import { loadEnvironment } from "./lib/environment";
import { backupDirectory, reportOperationError } from "./lib/operations";
import { operationsIssues } from "../src/server/operations/status";

try {
  const env = loadEnvironment();
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as { entries: { when: number }[] };
  const database = await inspectDatabase(env, journal.entries.map(e => e.when));
  const backups = await inspectBackups(backupDirectory);
  const issues = operationsIssues(database, backups);
  console.log(JSON.stringify({ status: issues.length ? "attention" : "ok", database, backups, issues }, null, 2));
  if (issues.length) process.exitCode = 2;
} catch (error) { reportOperationError(error); }

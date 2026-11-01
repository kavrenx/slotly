import { readFile } from "node:fs/promises";
import { loadEnvironment } from "./lib/environment";
import { parseIdentityEnv } from "../src/server/config/schema";
import { inspectBackups, inspectDatabase } from "../src/server/operations/diagnostics";
import { operationsIssues } from "../src/server/operations/status";
import { localReviewReadiness } from "../src/server/operations/readiness";

try {
  loadEnvironment();
  const env = parseIdentityEnv(process.env);
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as { entries: { when: number }[] };
  const database = await inspectDatabase(env, journal.entries.map(entry => entry.when));
  const backups = await inspectBackups(".local/backups");
  const result = localReviewReadiness({ appUrl: env.APP_URL, databaseUrl: env.DATABASE_URL, mailTransport: env.MAIL_TRANSPORT, issues: operationsIssues(database, backups) });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 2;
} catch { console.error("Проверка локальной готовности не завершена; подробности подключения и данные скрыты."); process.exitCode = 1; }

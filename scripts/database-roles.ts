import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabasePool } from "../src/server/db/connection";
import { configureDatabaseAccess, createDatabaseLogin } from "../src/server/db/privileges";
import { loadDatabaseEnvironment } from "./lib/database-environment";

// Local provisioning only. Hosted PostgreSQL has provider-specific role policies.
try {
  const env = loadDatabaseEnvironment("admin"), adminUrl = new URL(env.DATABASE_URL);
  if (env.NODE_ENV === "production" || !["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname)) throw new Error("Local database required");
  const envPath = resolve(".env.local"), original = await readFile(envPath, "utf8");
  const operationsPath = resolve(".env.operations.local");
  let migrationUrl: URL, applicationUrl: URL;
  if (process.env.MIGRATION_DATABASE_URL && process.env.RUNTIME_DATABASE_URL) {
    migrationUrl = new URL(process.env.MIGRATION_DATABASE_URL); applicationUrl = new URL(process.env.RUNTIME_DATABASE_URL);
  } else {
    const suffix = randomUUID().replaceAll("-", "");
    migrationUrl = new URL(adminUrl); applicationUrl = new URL(adminUrl);
    migrationUrl.username = `slotly_migrate_${suffix}`; migrationUrl.password = randomBytes(32).toString("hex");
    applicationUrl.username = `slotly_app_${suffix}`; applicationUrl.password = randomBytes(32).toString("hex");
    const key = process.env.BACKUP_ENCRYPTION_KEY;
    if (!key || !/^[a-f0-9]{64}$/iu.test(key)) throw new Error("Run setup first");
    await mkdir(resolve(".local/access"), { recursive: true, mode: 0o700 });
    await writeFile(resolve(`.local/access/env-before-roles_${Date.now()}.txt`), original, { flag: "wx", mode: 0o600 });
    // Save recoverable credentials before the transactional role changes.
    await writeFile(operationsPath, [
      "# Operator CLIs only; never copy into the web deployment.",
      `ADMIN_DATABASE_URL=${adminUrl.toString()}`, `MIGRATION_DATABASE_URL=${migrationUrl.toString()}`,
      `RUNTIME_DATABASE_URL=${applicationUrl.toString()}`, `BACKUP_ENCRYPTION_KEY=${key}`, "",
    ].join("\n"), { flag: "wx", mode: 0o600 });
  }
  for (const url of [migrationUrl, applicationUrl]) {
    if (url.host !== adminUrl.host || url.pathname !== adminUrl.pathname || url.search || url.hash || !url.password) throw new Error("Database target mismatch");
  }
  if (!/^slotly_migrate_[a-f0-9]{32}$/u.test(migrationUrl.username) || !/^slotly_app_[a-f0-9]{32}$/u.test(applicationUrl.username)) throw new Error("Unexpected local roles");
  const admin = createDatabasePool(env);
  try {
    const client = await admin.connect();
    try {
      if (!(await client.query("select rolsuper from pg_roles where rolname=current_user")).rows[0].rolsuper) throw new Error("Local administrator required");
      await client.query("BEGIN");
      try {
        for (const url of [migrationUrl, applicationUrl]) {
          if (!(await client.query("select 1 from pg_roles where rolname=$1", [url.username])).rowCount) await createDatabaseLogin(client, url.username, decodeURIComponent(url.password));
        }
        await configureDatabaseAccess(client, migrationUrl.username, applicationUrl.username);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    } finally { client.release(); }
  } finally { await admin.end(); }
  const application = createDatabasePool({ ...env, DATABASE_URL: applicationUrl.toString() });
  try { await application.query("select count(*) from slotly.booking_pages"); } finally { await application.end(); }
  const updated = original.replace(/^DATABASE_URL=.*$/mu, `DATABASE_URL=${applicationUrl.toString()}`)
    .replace(/^BACKUP_ENCRYPTION_KEY=.*\r?\n?/mu, "");
  await writeFile(envPath + ".slotlytmp", updated, { mode: 0o600 }); await rename(envPath + ".slotlytmp", envPath);
  console.log("Роли настроены. Приложение использует ограниченный доступ; миграции и копии — .env.operations.local.");
  console.log("Перезапустите веб-сервер и обработчик. Пароли и прежние настройки сохранены только локально.");
} catch {
  console.error("Не удалось настроить роли. Настройки подключения и секреты скрыты; см. docs/security.md."); process.exitCode = 1;
}

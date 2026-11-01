import { readFile, readdir, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ServerEnv } from "../config/schema";
import { createDatabasePool } from "../db/connection";

export async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function inspectBackups(directory: string, now = new Date()) {
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
  const candidates = await Promise.all(names.filter(name => /^\d{4}-\d{2}-\d{2}T[\dZ-]+_[a-f0-9-]{36}\.slotlybackup$/u.test(name)).map(async name => ({ name, info: await stat(join(directory, name)) })));
  const archives = candidates.filter(c => c.info.isFile()).sort((a, b) => b.name.localeCompare(a.name));
  const latest = archives[0];
  if (!latest) return { count: 0, latestAgeSeconds: null, verified: false };
  const receiptPath = join(directory, latest.name + ".verified.json");
  let verified = false;
  try {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { kind?: string; sha256?: string };
    verified = receipt.kind === "slotly-backup-verification-v1" && receipt.sha256 === await hashFile(join(directory, latest.name));
  } catch { /* Missing, stale or malformed receipt never proves recovery. */ }
  return { count: archives.length, latestAgeSeconds: Math.max(0, Math.floor((now.getTime() - latest.info.mtimeMs) / 1000)), verified };
}
export async function inspectDatabase(env: ServerEnv, expectedMigrations: number[], now = new Date()) {
  const pool = createDatabasePool(env);
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const objects = await client.query<{ migrations: string | null; outbox: string | null }>("select to_regclass('drizzle.__drizzle_migrations')::text as migrations,to_regclass('slotly.notification_outbox')::text as outbox");
      const rows = objects.rows[0]!.migrations ? (await client.query<{ created_at: string }>("select created_at from drizzle.__drizzle_migrations order by created_at")).rows : [];
      const migrationsCurrent = JSON.stringify(rows.map(r => Number(r.created_at))) === JSON.stringify(expectedMigrations);
      const queue = objects.rows[0]!.outbox ? (await client.query<{ pending: number; failed: number; oldestSeconds: number | null; expiredLeases: number }>(`select
        count(*) filter(where sent_at is null and failed_at is null)::int as pending,
        count(*) filter(where failed_at is not null)::int as failed,
        greatest(0,extract(epoch from ($1::timestamptz-min(created_at) filter(where sent_at is null and failed_at is null))))::int as "oldestSeconds",
        count(*) filter(where sent_at is null and failed_at is null and locked_until <= $1)::int as "expiredLeases"
        from slotly.notification_outbox`, [now.toISOString()])).rows[0]! : null;
      const role = await client.query<{ privileged: boolean }>("select rolsuper or rolcreaterole as privileged from pg_roles where rolname=current_user");
      await client.query("COMMIT");
      return { available: true, migrationsCurrent, migrationsApplied: rows.length, queue, privilegedRole: role.rows[0]!.privileged };
    } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
  } finally { await pool.end(); }
}

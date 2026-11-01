import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import type { PoolClient } from "pg";
import type { ServerEnv } from "../config/schema";
import { createDatabasePool } from "../db/connection";
import { decryptBackup, encryptBackup, type BackupManifest } from "./backup-format";
import { createPrivateWorkspace, postgresConnection, removePrivateWorkspace, startPostgresTool } from "./postgres-tools";
import { OperationError } from "./errors";
import { hashFile } from "./diagnostics";

export type BackupOptions = { env: ServerEnv; key: Buffer; binDirectory?: string; signal?: AbortSignal };
function identifier(name: string) { return '"' + name.replaceAll('"', '""') + '"'; }
async function inventory(client: PoolClient): Promise<Pick<BackupManifest, "tables" | "migrations">> {
  const tableRows = await client.query<{ schema: string; name: string }>(`select table_schema as schema, table_name as name from information_schema.tables
    where table_type='BASE TABLE' and table_schema in ('slotly','drizzle') order by table_schema,table_name`);
  const names = tableRows.rows.map(r => `${r.schema}.${r.name}`);
  if (!["drizzle.__drizzle_migrations", "slotly.bookings", "slotly.occupancies", "slotly.booking_events", "slotly.notification_outbox"].every(name => names.includes(name)) || names.some(name => !/^(slotly|drizzle)\.[a-z_]+$/u.test(name))) throw new OperationError("DATABASE_NOT_MIGRATED");
  const counts = await client.query<{ name: string; count: string }>(tableRows.rows.map(r =>
    `select '${r.schema}.${r.name}' as name,count(*)::text as count from ${identifier(r.schema)}.${identifier(r.name)}`).join(" union all "));
  const migrations = await client.query<{ created_at: string }>("select created_at from drizzle.__drizzle_migrations order by created_at");
  return { tables: Object.fromEntries(counts.rows.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(r => [r.name, r.count])), migrations: migrations.rows.map(r => Number(r.created_at)) };
}
export async function createBackup(options: BackupOptions, directory: string) {
  const workspace = await createPrivateWorkspace(), pool = createDatabasePool(options.env);
  let client: PoolClient | undefined;
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const connection = await postgresConnection(options.env, workspace);
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const exported = await client.query<{ snapshot: string }>("select pg_export_snapshot() as snapshot");
    const manifest: BackupManifest = { format: 1, createdAt: new Date().toISOString(), ...await inventory(client) };
    const database = decodeURIComponent(new URL(options.env.DATABASE_URL).pathname.slice(1));
    const filename = `${manifest.createdAt.replace(/[:.]/gu, "-")}_${randomUUID()}.slotlybackup`;
    const path = join(directory, filename);
    const dump = startPostgresTool("pg_dump", [...connection.args, "--dbname", database, "--format=custom", "--no-owner", "--no-acl", "--snapshot", exported.rows[0]!.snapshot], connection.env, options.binDirectory, options.signal);
    dump.child.stdin.end();
    const snapshotClient = client;
    const encryption = encryptBackup(dump.child.stdout, manifest, options.key, path, async () => {
      await dump.done; await snapshotClient.query("COMMIT");
    });
    try { await encryption; }
    catch { dump.child.kill(); await Promise.allSettled([encryption, dump.done]); throw new OperationError("BACKUP_FAILED"); }
    return { path, createdAt: manifest.createdAt, bytes: (await stat(path)).size };
  } finally {
    if (client) { await client.query("ROLLBACK").catch(() => {}); client.release(); }
    await pool.end(); await removePrivateWorkspace(workspace);
  }
}

export async function verifyBackup(options: BackupOptions, source: string, recoveryTarget?: string) {
  const sourceDatabase = decodeURIComponent(new URL(options.env.DATABASE_URL).pathname.slice(1));
  const target = recoveryTarget ?? `slotly_restore_${randomUUID().replaceAll("-", "")}`;
  if ((recoveryTarget !== undefined ? !/^slotly_recovered_[a-z0-9_]{1,40}$/u.test(target) : !/^slotly_restore_[a-f0-9]{32}$/u.test(target)) || target === sourceDatabase) throw new OperationError("UNSAFE_RESTORE_TARGET");
  const workspace = await createPrivateWorkspace();
  // Recovery must still work if the original database has been lost.
  const maintenanceUrl = new URL(options.env.DATABASE_URL); maintenanceUrl.pathname = "/postgres";
  const admin = createDatabasePool({ ...options.env, DATABASE_URL: maintenanceUrl.toString() });
  let created = false, retained = false;
  try {
    if (!(await lstat(source)).isFile()) throw new OperationError("BACKUP_INVALID");
    const snapshot = join(workspace, "archive.slotlybackup");
    await copyFile(source, snapshot, constants.COPYFILE_EXCL); await chmod(snapshot, 0o600);
    const discard = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const manifest = await decryptBackup(snapshot, options.key, discard);
    // Authentication completed before creating a database or executing dump SQL.
    const connection = await postgresConnection(options.env, workspace);
    await admin.query(`CREATE DATABASE ${identifier(target)} TEMPLATE template0`); created = true;
    const restore = startPostgresTool("pg_restore", [...connection.args, "--dbname", target, "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"], connection.env, options.binDirectory, options.signal);
    restore.child.stdout.resume();
    const decryption = decryptBackup(snapshot, options.key, restore.child.stdin);
    try { await Promise.all([decryption, restore.done]); }
    catch { restore.child.kill(); await Promise.allSettled([decryption, restore.done]); throw new OperationError("RESTORE_FAILED"); }
    const url = new URL(options.env.DATABASE_URL); url.pathname = `/${target}`;
    const restored = createDatabasePool({ ...options.env, DATABASE_URL: url.toString() });
    try {
      const client = await restored.connect();
      try {
        const actual = await inventory(client);
        if (JSON.stringify(actual) !== JSON.stringify({ tables: manifest.tables, migrations: manifest.migrations })) throw new OperationError("RESTORE_MISMATCH");
        const invalid = await client.query<{ count: number }>(`select count(*)::int as count from pg_constraint c join pg_namespace n on n.oid=c.connamespace
          where n.nspname in ('slotly','drizzle') and not c.convalidated`);
        if (invalid.rows[0]!.count) throw new OperationError("RESTORE_MISMATCH");
        const result = { verified: true, createdAt: manifest.createdAt, tablesChecked: Object.keys(actual.tables).length, migrationsChecked: actual.migrations.length, sha256: await hashFile(snapshot), recoveredDatabase: recoveryTarget ?? null };
        retained = recoveryTarget !== undefined;
        return result;
      } finally { client.release(); }
    } finally { await restored.end(); }
  } finally {
    try {
      // Only this invocation's successfully-created, random database is removed.
      if (created && !retained) await admin.query(`DROP DATABASE ${identifier(target)}`);
    } finally { await admin.end(); await removePrivateWorkspace(workspace); }
  }
}

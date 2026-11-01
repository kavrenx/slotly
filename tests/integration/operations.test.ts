import { randomBytes, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDatabase, transaction } from "../helpers/database";
import { fixture, insertCompleteBooking, moveBooking, cancelBooking } from "../helpers/domain";
import { loadDatabaseEnvironment } from "../../scripts/lib/database-environment";
import { createBackup, verifyBackup, type BackupOptions } from "../../src/server/operations/backups";
import { createPrivateWorkspace, removePrivateWorkspace } from "../../src/server/operations/postgres-tools";
import { hashFile, inspectDatabase } from "../../src/server/operations/diagnostics";
import { encryptBackup } from "../../src/server/operations/backup-format";
import { Readable } from "node:stream";

let test: Awaited<ReturnType<typeof createTestDatabase>>, directory: string, options: BackupOptions;
beforeAll(async () => {
  test = await createTestDatabase(); directory = await createPrivateWorkspace();
  const env = loadDatabaseEnvironment("admin"), url = new URL(env.DATABASE_URL);
  url.pathname = "/" + (await test.pool.query("select current_database() as name")).rows[0].name;
  const binDirectory = process.env.PG_BIN_DIR || (process.platform === "win32" ? resolve(".local/postgres-tools/bin") : undefined);
  options = { env: { ...env, DATABASE_URL: url.toString() }, key: randomBytes(32), ...(binDirectory ? { binDirectory } : {}) };
  const f = await fixture(test.pool);
  await transaction(test.pool, async client => {
    const made = await insertCompleteBooking(client, f);
    await moveBooking(client, made.booking.id, made.occupancy, "2027-01-05T10:00:00Z");
    const occupied = (await client.query("select * from slotly.occupancies where id=$1", [made.occupancy.id])).rows[0];
    await cancelBooking(client, made.booking.id, { ...made.occupancy, startAt: occupied.start_at, endAt: occupied.end_at }, "organizer", "Проверка сохранения истории");
  });
});
afterAll(async () => { await test?.close(); if (directory) await removePrivateWorkspace(directory); });
async function restoreDatabases() { return (await test.pool.query("select datname from pg_database where datname like 'slotly_restore_%' order by datname")).rows; }

it("backs up and restores all application tables, migrations and history without touching the source", async () => {
  const before = await test.pool.query("select to_jsonb(b) as booking from slotly.bookings b order by id");
  const databases = await restoreDatabases(); const backup = await createBackup(options, directory);
  expect(backup.bytes).toBeGreaterThan(100);
  expect(await verifyBackup(options, backup.path)).toMatchObject({ verified: true, tablesChecked: 19, migrationsChecked: 9, sha256: await hashFile(backup.path) });
  expect(await restoreDatabases()).toEqual(databases); expect((await test.pool.query("select to_jsonb(b) as booking from slotly.bookings b order by id")).rows).toEqual(before.rows);
}, 60_000);
it("rejects damaged archives and a wrong key before restoring", async () => {
  const backup = await createBackup(options, directory), databases = await restoreDatabases();
  await expect(verifyBackup({ ...options, key: randomBytes(32) }, backup.path)).rejects.toMatchObject({ code: "BACKUP_AUTH_FAILED" });
  const bytes = await readFile(backup.path); bytes[40] = bytes[40]! ^ 1;
  const broken = join(directory, "broken.slotlybackup"); await writeFile(broken, bytes);
  await expect(verifyBackup(options, broken)).rejects.toBeDefined(); expect(await restoreDatabases()).toEqual(databases);
}, 60_000);
it("removes its temporary database when an authenticated archive cannot be restored", async () => {
  const path = join(directory, "invalid-dump.slotlybackup"), before = await restoreDatabases();
  await encryptBackup(Readable.from(Buffer.from("PGDMP invalid custom archive")), { format: 1, createdAt: new Date().toISOString(), tables: {}, migrations: [] }, options.key, path);
  await expect(verifyBackup(options, path)).rejects.toMatchObject({ code: "RESTORE_FAILED" });
  expect(await restoreDatabases()).toEqual(before);
});
it("uses one exported snapshot even when a writer commits during backup", async () => {
  const f = await fixture(test.pool), holding = await test.pool.connect();
  await holding.query("BEGIN"); await holding.query("LOCK TABLE slotly.bookings IN ACCESS EXCLUSIVE MODE");
  const pending = createBackup(options, directory); void pending.catch(() => {});
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const status = await test.pool.query("select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='slotly' and wait_event_type='Lock') as waiting");
      if (status.rows[0].waiting) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
    await insertCompleteBooking(holding, f, { start: "2027-01-06T10:00:00Z" }); await holding.query("COMMIT");
    const backup = await pending; expect((await verifyBackup(options, backup.path)).verified).toBe(true);
  } finally { await holding.query("ROLLBACK"); holding.release(); await pending.catch(() => {}); }
}, 60_000);
it("reports migration drift and queue problems without exposing recipients", async () => {
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as { entries: { when: number }[] };
  const status = await inspectDatabase(options.env, journal.entries.map(e => e.when));
  expect(status).toMatchObject({ available: true, migrationsCurrent: true, migrationsApplied: 9 }); expect(status.queue!.pending).toBeGreaterThan(0);
  expect(JSON.stringify(status)).not.toContain("example.invalid");
  expect((await inspectDatabase(options.env, [1])).migrationsCurrent).toBe(false);
});
it("can recover after loss of the original database and never replaces an existing target", async () => {
  const backup = await createBackup(options, directory);
  const url = new URL(options.env.DATABASE_URL); url.pathname = "/missing_slotly_original";
  expect((await verifyBackup({ ...options, env: { ...options.env, DATABASE_URL: url.toString() } }, backup.path)).verified).toBe(true);
  await expect(verifyBackup(options, backup.path, "postgres")).rejects.toMatchObject({ code: "UNSAFE_RESTORE_TARGET" });
  const target = `slotly_recovered_test_${randomUUID().replaceAll("-", "")}`;
  let created = false;
  try {
    expect((await verifyBackup(options, backup.path, target)).recoveredDatabase).toBe(target); created = true;
    await expect(verifyBackup(options, backup.path, target)).rejects.toBeDefined();
    expect((await test.pool.query("select 1 from pg_database where datname=$1", [target])).rowCount).toBe(1);
  } finally { if (created && /^slotly_recovered_test_[a-f0-9]{32}$/u.test(target)) await test.pool.query(`DROP DATABASE "${target}"`); }
}, 60_000);

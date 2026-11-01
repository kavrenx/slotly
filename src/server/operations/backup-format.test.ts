import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encryptBackup, decryptBackup, readBackupKey, type BackupManifest } from "./backup-format";
import { createPrivateWorkspace, removePrivateWorkspace, postgresConnection } from "./postgres-tools";
import { hashFile, inspectBackups } from "./diagnostics";

let directory: string;
const key = randomBytes(32), plaintext = Buffer.from("PGDMP private guest@example.invalid appointment and credential data");
const manifest: BackupManifest = { format: 1, createdAt: "2027-01-04T06:00:00Z", tables: { "slotly.bookings": "1" }, migrations: [1793471583831] };
const filename = () => `2027-01-04T06-00-00-000Z_${randomUUID()}.slotlybackup`;
beforeEach(async () => { directory = await createPrivateWorkspace(); });
afterEach(async () => { vi.unstubAllEnvs(); await removePrivateWorkspace(directory); });
function sink() { const chunks: Buffer[] = []; return { chunks, output: new Writable({ write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); } }) }; }
it("round-trips the archive and encrypted manifest, without plaintext or partial files", async () => {
  const path = join(directory, filename());
  await encryptBackup(Readable.from(plaintext), manifest, key, path);
  const raw = await readFile(path); expect(raw.includes(plaintext)).toBe(false); expect(raw.includes(Buffer.from("slotly.bookings"))).toBe(false);
  const target = sink(); expect(await decryptBackup(path, key, target.output)).toEqual(manifest); expect(Buffer.concat(target.chunks)).toEqual(plaintext);
  expect((await readdir(directory)).some(name => name.endsWith(".partial"))).toBe(false);
});
it("uses a new nonce for identical archives", async () => {
  const a = join(directory, filename()), b = join(directory, filename());
  await encryptBackup(Readable.from(plaintext), manifest, key, a); await encryptBackup(Readable.from(plaintext), manifest, key, b);
  expect(await readFile(a)).not.toEqual(await readFile(b));
});
it.each([0, 10, 35, -1])("rejects tampering at byte %i", async position => {
  const path = join(directory, filename()); await encryptBackup(Readable.from(plaintext), manifest, key, path);
  const raw = await readFile(path); const index = position < 0 ? raw.length - 1 : position; raw[index] = raw[index]! ^ 1; await writeFile(path, raw);
  await expect(decryptBackup(path, key, sink().output)).rejects.toBeDefined();
});
it("rejects a wrong key and a truncated file", async () => {
  const path = join(directory, filename()); await encryptBackup(Readable.from(plaintext), manifest, key, path);
  await expect(decryptBackup(path, randomBytes(32), sink().output)).rejects.toMatchObject({ code: "BACKUP_AUTH_FAILED" });
  await writeFile(path, (await readFile(path)).subarray(0, 30));
  await expect(decryptBackup(path, key, sink().output)).rejects.toMatchObject({ code: "BACKUP_INVALID" });
});
it("never replaces an existing backup or publishes a failed producer", async () => {
  const path = join(directory, filename()); await encryptBackup(Readable.from(plaintext), manifest, key, path); const before = await readFile(path);
  await expect(encryptBackup(Readable.from(Buffer.from("PGDMP another")), manifest, key, path)).rejects.toBeDefined(); expect(await readFile(path)).toEqual(before);
  const failed = join(directory, filename());
  await expect(encryptBackup(Readable.from(plaintext), manifest, key, failed, async () => { throw new Error("producer failed"); })).rejects.toThrow("producer failed");
  expect(await readdir(directory)).toEqual([path.split(/[\\/]/u).at(-1)]);
});
it("only treats a matching restoration receipt as verified", async () => {
  expect(await inspectBackups(directory)).toMatchObject({ count: 0, verified: false });
  const path = join(directory, filename()); await encryptBackup(Readable.from(plaintext), manifest, key, path);
  expect((await inspectBackups(directory)).verified).toBe(false);
  await writeFile(path + ".verified.json", JSON.stringify({ kind: "slotly-backup-verification-v1", sha256: await hashFile(path) }));
  expect((await inspectBackups(directory)).verified).toBe(true);
  const raw = await readFile(path); raw[30] = raw[30]! ^ 1; await writeFile(path, raw);
  expect((await inspectBackups(directory)).verified).toBe(false);
});
it("requires an independent 32-byte backup key", () => {
  expect(readBackupKey(key.toString("hex"))).toEqual(key);
  for (const value of [undefined, "replace-with-backup-encryption-key", "short", key.toString("hex")]) expect(() => readBackupKey(value, key.toString("hex"))).toThrow();
});
it("keeps credentials out of args and escapes the temporary pgpass file", async () => {
  for (const name of ["ADMIN_DATABASE_URL", "MIGRATION_DATABASE_URL", "RUNTIME_DATABASE_URL", "SMTP_PASSWORD"]) vi.stubEnv(name, "operator-only-credential");
  const password = "abc:de\\f", env = { NODE_ENV: "test" as const, APP_URL: "http://localhost:3000", DATABASE_SSL: "disable" as const, DATABASE_URL: `postgresql://slotly:${encodeURIComponent(password)}@127.0.0.1:54329/slotly` };
  const connection = await postgresConnection(env, directory);
  expect(connection.args.join(" ")).not.toContain(password); expect(connection.env.PGPASSWORD).toBeUndefined();
  expect(connection.env.DATABASE_URL).toBeUndefined(); expect(connection.env.BACKUP_ENCRYPTION_KEY).toBeUndefined(); expect(connection.env.BETTER_AUTH_SECRET).toBeUndefined();
  expect(connection.env.ADMIN_DATABASE_URL).toBeUndefined(); expect(connection.env.MIGRATION_DATABASE_URL).toBeUndefined(); expect(connection.env.RUNTIME_DATABASE_URL).toBeUndefined();
  expect(connection.env.SMTP_PASSWORD).toBeUndefined();
  expect(await readFile(connection.env.PGPASSFILE!, "utf8")).toBe("127.0.0.1:54329:*:slotly:abc\\:de\\\\f\n");
});

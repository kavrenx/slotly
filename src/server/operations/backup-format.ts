import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, link, open, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform, type TransformCallback, type Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { OperationError } from "./errors";

const MAGIC = Buffer.from("SLOTLYB1");
const HEADER_SIZE = MAGIC.length + 12;
const TAG_SIZE = 16;
const MAX_MANIFEST = 65_536;
const manifestSchema = z.strictObject({
  format: z.literal(1), createdAt: z.iso.datetime(),
  migrations: z.array(z.number().int().positive()).max(4096),
  tables: z.record(z.string().regex(/^(slotly|drizzle)\.[a-z_]+$/u), z.string().regex(/^\d{1,20}$/u)),
});
export type BackupManifest = z.infer<typeof manifestSchema>;

export function readBackupKey(value: string | undefined, authSecret?: string) {
  if (!value || !/^[a-f0-9]{64}$/iu.test(value) || value.toLowerCase() === authSecret?.toLowerCase()) throw new OperationError("BACKUP_KEY_REQUIRED");
  return Buffer.from(value, "hex");
}

// v1: authenticated header (magic + nonce), encrypted length + JSON manifest +
// custom-format pg_dump, then the 16-byte GCM tag. No plaintext dump on disk.
export async function encryptBackup(input: Readable, manifest: BackupManifest, key: Buffer, destination: string, beforePublish?: () => Promise<void>) {
  const json = Buffer.from(JSON.stringify(manifestSchema.parse(manifest)));
  if (json.length > MAX_MANIFEST) throw new OperationError("BACKUP_INVALID");
  const length = Buffer.alloc(4); length.writeUInt32BE(json.length);
  const nonce = randomBytes(12), header = Buffer.concat([MAGIC, nonce]);
  const cipher = createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(header);
  const temporary = join(dirname(destination), `.${randomUUID()}.partial`);
  let owned = false;
  const output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
  output.once("open", () => { owned = true; });
  try {
    output.write(header);
    cipher.write(Buffer.concat([length, json]));
    await pipeline(input, cipher, output);
    await appendFile(temporary, cipher.getAuthTag());
    const handle = await open(temporary, "r+");
    try { await handle.sync(); } finally { await handle.close(); }
    await beforePublish?.();
    // Atomic publication, no replacement of an existing backup.
    await link(temporary, destination);
  } finally { if (owned) await unlink(temporary); }
}

class PayloadDecoder extends Transform {
  manifest: BackupManifest | undefined;
  private prefix = Buffer.alloc(0);
  private archivePrefix = Buffer.alloc(0);
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    try {
      let data = chunk;
      if (!this.manifest) {
        this.prefix = Buffer.concat([this.prefix, chunk]);
        if (this.prefix.length < 4) { callback(); return; }
        const size = this.prefix.readUInt32BE();
        if (!size || size > MAX_MANIFEST) throw new OperationError("BACKUP_INVALID");
        if (this.prefix.length < size + 4) { callback(); return; }
        this.manifest = manifestSchema.parse(JSON.parse(this.prefix.subarray(4, 4 + size).toString("utf8")));
        data = this.prefix.subarray(4 + size); this.prefix = Buffer.alloc(0);
      }
      if (this.archivePrefix.length < 5) this.archivePrefix = Buffer.concat([this.archivePrefix, data.subarray(0, 5 - this.archivePrefix.length)]);
      if (this.archivePrefix.length === 5 && this.archivePrefix.toString("ascii") !== "PGDMP") throw new OperationError("BACKUP_INVALID");
      this.push(data); callback();
    } catch { callback(new OperationError("BACKUP_INVALID")); }
  }
  override _flush(callback: TransformCallback) {
    callback(this.manifest && this.archivePrefix.length === 5 ? null : new OperationError("BACKUP_INVALID"));
  }
}

// The caller authenticates a private encrypted snapshot fully before passing a
// second decryption stream to pg_restore: GCM can emit bytes before final auth.
export async function decryptBackup(path: string, key: Buffer, output: Writable): Promise<BackupManifest> {
  const handle = await open(path, "r");
  let header: Buffer, tag: Buffer, size: number;
  try {
    size = (await handle.stat()).size;
    if (size < HEADER_SIZE + TAG_SIZE + 10) throw new OperationError("BACKUP_INVALID");
    header = Buffer.alloc(HEADER_SIZE); tag = Buffer.alloc(TAG_SIZE);
    await handle.read(header, 0, HEADER_SIZE, 0); await handle.read(tag, 0, TAG_SIZE, size - TAG_SIZE);
  } finally { await handle.close(); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new OperationError("BACKUP_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(MAGIC.length));
  decipher.setAAD(header); decipher.setAuthTag(tag);
  const decoder = new PayloadDecoder();
  try { await pipeline(createReadStream(path, { start: HEADER_SIZE, end: size - TAG_SIZE - 1 }), decipher, decoder, output); }
  catch { throw new OperationError("BACKUP_AUTH_FAILED"); }
  return decoder.manifest!;
}

import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type LocalMail = { to: string; subject: string; text: string; actionUrl?: string; messageId?: string; createdAt?: string };
export const localMailDirectory = resolve(".local/mail");
export async function sendLocalMail(message: LocalMail, directory = localMailDirectory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const id = message.messageId ?? randomUUID(); const createdAt = message.createdAt ?? new Date().toISOString();
  if (!/^[a-f0-9-]{36}$/u.test(id) || !Number.isFinite(Date.parse(createdAt))) throw new Error("Invalid local mail metadata");
  const target = resolve(directory, `${Date.parse(createdAt)}-${id}.json`);
  const temporary = resolve(directory, `.tmp-${randomUUID()}`);
  const payload = JSON.stringify({ ...message, createdAt });
  try {
    await writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
    // Publish the complete file without replacing an existing message. Atomic
    // hard-link creation also avoids Windows' concurrent rename/replace race.
    try { await link(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || await readFile(target, "utf8") !== payload) throw error;
    }
  } finally { await unlink(temporary).catch(() => {}); }
}

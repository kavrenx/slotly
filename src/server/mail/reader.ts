// Development mailbox viewer only. Never imported by application routes.
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { localMailDirectory, type LocalMail } from "./local";

export async function readLocalMail(directory = localMailDirectory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const names = (await readdir(directory)).filter((name) => /^\d+-[a-f0-9-]+\.json$/.test(name)).sort().reverse().slice(0, 50);
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(resolve(directory, name), "utf8")) as LocalMail & { createdAt: string }));
}

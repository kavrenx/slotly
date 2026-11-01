import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ServerEnv } from "../config/schema";
import { OperationError } from "./errors";

export async function createPrivateWorkspace() {
  return mkdtemp(join(tmpdir(), "slotly-ops-"));
}
export async function removePrivateWorkspace(directory: string) {
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith("slotly-ops-")) throw new OperationError("UNSAFE_TEMP_PATH");
  await rm(directory, { recursive: true, force: true });
}
export async function postgresConnection(env: ServerEnv, directory: string) {
  const url = new URL(env.DATABASE_URL);
  if (url.search || url.hash || !/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/u.test(decodeURIComponent(url.pathname.slice(1)))) throw new OperationError("BACKUP_CONNECTION_OPTIONS");
  const host = url.hostname.replace(/^\[|\]$/gu, ""), port = url.port || "5432";
  const user = decodeURIComponent(url.username), password = decodeURIComponent(url.password);
  if (/[\r\n]/u.test(user + password + host)) throw new OperationError("BACKUP_CONNECTION_OPTIONS");
  const escape = (value: string) => value.replace(/\\/gu, "\\\\").replace(/:/gu, "\\:");
  const passfile = join(directory, "pgpass");
  await writeFile(passfile, `${escape(host)}:${port}:*:${escape(user)}:${escape(password)}\n`, { flag: "wx", mode: 0o600 });
  await chmod(passfile, 0o600);
  // Do not leak application secrets into client subprocess environments, and
  // do not allow inherited libpq options to redirect or weaken the connection.
  const childEnv: NodeJS.ProcessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.toUpperCase().startsWith("PG") && !/(?:^|_)DATABASE_URL$/iu.test(key) && !["BETTER_AUTH_SECRET", "BACKUP_ENCRYPTION_KEY"].includes(key.toUpperCase()))), NODE_ENV: env.NODE_ENV };
  Object.assign(childEnv, { PGPASSFILE: passfile, PGSSLMODE: env.DATABASE_SSL === "disable" ? "disable" : "verify-full", PGGSSENCMODE: "disable", PGCONNECT_TIMEOUT: "10", PGAPPNAME: "slotly-operations", PGOPTIONS: "-c timezone=UTC" });
  if (env.DATABASE_SSL === "verify-full") childEnv.PGSSLROOTCERT = "system";
  return { env: childEnv, args: ["--host", host, "--port", port, "--username", user, "--no-password"] };
}
export function startPostgresTool(name: "pg_dump" | "pg_restore", args: string[], env: NodeJS.ProcessEnv, binDirectory?: string, signal?: AbortSignal) {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const command = binDirectory ? join(resolve(binDirectory), executable) : executable;
  const child: ChildProcessWithoutNullStreams = spawn(command, args, { env, stdio: "pipe", windowsHide: true, timeout: 600_000, ...(signal ? { signal } : {}) });
  let warnings = false;
  child.stderr.on("data", () => { warnings = true; });
  const done = new Promise<void>((resolveDone, reject) => {
    child.once("error", () => reject(new OperationError("POSTGRES_TOOL_FAILED")));
    child.once("close", code => code === 0 && !warnings ? resolveDone() : reject(new OperationError("POSTGRES_TOOL_FAILED")));
  });
  // A stream may fail first; attach a handler immediately, but still await done.
  void done.catch(() => {});
  return { child, done };
}

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { loadEnvironment } from "./lib/environment";
import { createDatabasePool } from "../src/server/db/connection";
import { maintainExpiredData } from "../src/server/operations/retention";
import { createLocalOperationsSink } from "../src/server/operations/alerts";
import { createOperationsRunner } from "../src/server/operations/runner";
import { inspectBackups, inspectDatabase } from "../src/server/operations/diagnostics";
import { operationsIssues } from "../src/server/operations/status";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort()); process.once("SIGTERM", () => controller.abort());
const env = loadEnvironment();
if (process.argv.slice(2).length > 1 || ![new URL(env.APP_URL).hostname, new URL(env.DATABASE_URL).hostname].every(host => ["localhost", "127.0.0.1", "[::1]"].includes(host)) ||
  process.argv.slice(2).some(arg => arg !== "--once")) throw new Error("ops:local поддерживает только локальные APP_URL и PostgreSQL; флаг --once необязателен.");
const pool = createDatabasePool(env), directory = resolve(".local/backups");
const sink = createLocalOperationsSink();
async function backup() {
  const status = await inspectBackups(directory);
  if (status.count && status.verified && (status.latestAgeSeconds ?? Infinity) < 86_400) return false;
  await new Promise<void>((accept, reject) => {
    // Operator credentials are loaded only inside this separate CLI process.
    const child = spawn(process.execPath, ["--import", "tsx", resolve("scripts/backup.ts")], { stdio: "ignore", windowsHide: true });
    const stop = () => {
      if (!child.pid || child.exitCode !== null) return;
      if (process.platform === "win32") spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else child.kill("SIGTERM");
    };
    const timer = globalThis.setTimeout(stop, 30 * 60_000);
    controller.signal.addEventListener("abort", stop, { once: true });
    if (controller.signal.aborted) stop();
    const cleanup = () => { clearTimeout(timer); controller.signal.removeEventListener("abort", stop); };
    child.once("error", () => { cleanup(); reject(new Error("BACKUP_FAILED")); });
    child.once("close", code => { cleanup(); if (code === 0) accept(); else reject(new Error("BACKUP_FAILED")); });
  });
  return true;
}
try {
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")) as { entries: { when: number }[] };
  // A session lock allows one operations worker per database, including restarts.
  const lock = await pool.connect();
  lock.on("error", () => controller.abort());
  try {
    if (!(await lock.query("select pg_try_advisory_lock(hashtextextended('slotly:operations-worker:v1',0)) as acquired")).rows[0].acquired) throw new Error("OPERATIONS_ALREADY_RUNNING");
    const runner = createOperationsRunner({ sink, backupIfNeeded: backup,
      maintain: async () => (await maintainExpiredData(pool, { apply: true })).counts,
      diagnose: async () => operationsIssues(await inspectDatabase(env, journal.entries.map(entry => entry.when)), await inspectBackups(directory)),
    });
    console.log("[operations] Локальное обслуживание: очистка, копии и события в .local/operations. Внешние сервисы не подключены.");
    do {
      try {
        await lock.query("select 1");
        const result = await runner.tick();
        if (process.argv.includes("--once")) { if (result.status === "attention") process.exitCode = 2; break; }
      } catch {
        console.error("[operations] Цикл обслуживания не завершён; подробности скрыты.");
        if (process.argv.includes("--once")) { process.exitCode = 1; break; }
        // A lost lock connection must not run alongside a replacement worker.
        try { await lock.query("select 1"); } catch { throw new Error("OPERATIONS_LOCK_LOST"); }
      }
      await setTimeout(60_000, undefined, { signal: controller.signal }).catch(() => {});
    } while (!controller.signal.aborted);
    await lock.query("select pg_advisory_unlock(hashtextextended('slotly:operations-worker:v1',0))");
  } finally { lock.release(); }
} catch { console.error("[operations] Обслуживание остановлено. Проверьте локальную базу и отсутствие второго экземпляра; секреты скрыты."); process.exitCode = 1; }
finally { await pool.end(); }

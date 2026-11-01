import { existsSync } from "node:fs";
import { resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { loadDatabaseEnvironment } from "./lib/database-environment";

const env = loadDatabaseEnvironment("admin");
const url = new URL(env.DATABASE_URL);
if (env.NODE_ENV === "production" || url.hostname !== "127.0.0.1" || env.DATABASE_SSL !== "disable") {
  throw new Error("db:local работает только с локальным 127.0.0.1 без TLS, вне production.");
}
const database = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-z][a-z0-9_]{0,62}$/.test(database)) {
  throw new Error("Для db:local нужно простое имя базы: строчные латинские буквы, цифры, подчёркивания.");
}
const databaseDir = resolve(".local/postgres");
const postgres = new EmbeddedPostgres({
  databaseDir,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port || "5432"),
  persistent: true,
  autoRehydrateSymlinks: true,
  authMethod: "scram-sha-256",
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-h", "127.0.0.1", "-c", "timezone=UTC"],
  onLog: () => {},
  onError: () => {},
});

let running = false;
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    if (running) await postgres.stop();
    console.log("Локальный PostgreSQL остановлен. Данные сохранены в .local/postgres.");
  } catch {
    console.error("Не удалось штатно остановить локальный PostgreSQL.");
    process.exitCode = 1;
  }
}

try {
  if (!existsSync(resolve(databaseDir, "PG_VERSION"))) await postgres.initialise();
  await postgres.start();
  running = true;
  process.on("SIGINT", () => { void stop(); });
  process.on("SIGTERM", () => { void stop(); });
  const client = postgres.getPgClient();
  try {
    await client.connect();
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (!result.rowCount) await postgres.createDatabase(database);
  } finally {
    await client.end();
  }
  console.log(`Локальный PostgreSQL готов на 127.0.0.1:${url.port || "5432"}. Оставьте терминал открытым; Ctrl+C — остановка.`);
} catch {
  console.error("Не удалось запустить локальный PostgreSQL. Проверьте порт, права на .local/postgres и неизменность локальных учётных данных.");
  process.exitCode = 1;
  await stop();
}

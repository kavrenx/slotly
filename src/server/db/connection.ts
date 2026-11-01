import { Pool } from "pg";
import type { ServerEnv } from "../config/schema";

export function createDatabasePool(env: ServerEnv) {
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL === "verify-full" ? { rejectUnauthorized: true } : false,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    options: "-c timezone=UTC",
    application_name: "slotly",
  });
  pool.on("error", () => {
    console.error("[database] Потеряно фоновое соединение PostgreSQL; детали подключения скрыты.");
  });
  return pool;
}

import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabasePool } from "../src/server/db/connection";
import { loadEnvironment } from "./lib/environment";

const pool = createDatabasePool(loadEnvironment());
try {
  await migrate(drizzle(pool), { migrationsFolder: resolve("drizzle") });
  console.log("Миграции PostgreSQL применены.");
} catch {
  console.error("Не удалось применить миграции. Проверьте доступность базы и конфигурацию; секреты скрыты.");
  process.exitCode = 1;
} finally {
  await pool.end();
}

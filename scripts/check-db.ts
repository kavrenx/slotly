import { createDatabasePool } from "../src/server/db/connection";
import { loadEnvironment } from "./lib/environment";

const pool = createDatabasePool(loadEnvironment());
try {
  const result = await pool.query<{ timezone: string }>("SELECT current_setting('TimeZone') AS timezone");
  if (result.rows[0]?.timezone !== "UTC") throw new Error("Timezone mismatch");
  console.log("PostgreSQL доступен; часовой пояс соединения — UTC.");
} catch {
  console.error("Проверка PostgreSQL не пройдена. Проверьте запуск базы и конфигурацию; секреты скрыты.");
  process.exitCode = 1;
} finally {
  await pool.end();
}

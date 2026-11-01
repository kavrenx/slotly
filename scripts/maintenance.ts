import { createDatabasePool } from "../src/server/db/connection";
import { maintainExpiredData } from "../src/server/operations/retention";
import { loadEnvironment } from "./lib/environment";

const pool = createDatabasePool(loadEnvironment());
try {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== "--apply")) throw new Error("INVALID_ARGUMENTS");
  console.log(JSON.stringify(await maintainExpiredData(pool, { apply: args.includes("--apply") }), null, 2));
} catch {
  console.error("Очистка не выполнена. По умолчанию команда только считает просроченные служебные записи; --apply удаляет ограниченную порцию. Детали данных скрыты."); process.exitCode = 1;
} finally { await pool.end(); }

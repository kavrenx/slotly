import { loadEnvironment } from "./lib/environment";
import { parseIdentityEnv } from "../src/server/config/schema";

try {
  const env = loadEnvironment(process.argv.includes("--production") ? "production" : undefined);
  parseIdentityEnv({ ...process.env, NODE_ENV: env.NODE_ENV });
  console.log("Переменные окружения корректны. Значения секретов скрыты.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Ошибка конфигурации");
  process.exitCode = 1;
}

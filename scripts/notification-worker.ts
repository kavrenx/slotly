import { setTimeout } from "node:timers/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { loadEnvironment } from "./lib/environment";
import { parseIdentityEnv } from "../src/server/config/schema";
import { createDatabasePool } from "../src/server/db/connection";
import * as schema from "../src/server/db/schema";
import { sendLocalMail } from "../src/server/mail/local";
import { deliverNextNotification, notificationQueueStatus, retryFailedNotifications } from "../src/modules/notifications/worker";

loadEnvironment();
const env = parseIdentityEnv(process.env);
const pool = createDatabasePool(env);
const database = drizzle(pool, { schema });
const options = process.argv.slice(2);
if (options.some(option => !["--once", "--status", "--retry-failed"].includes(option)) || options.length > 1) {
  console.error("Используйте --once, --status или --retry-failed."); await pool.end(); process.exit(1);
}
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
try {
  if (options.includes("--status")) console.log(await notificationQueueStatus(database));
  else if (options.includes("--retry-failed")) console.log(`Возвращено в очередь: ${(await retryFailedNotifications(database)).length}.`);
  else {
    console.log("[notifications] Обработчик запущен. Письма сохраняются только в локальной почте.");
    let processed = 0;
    while (!controller.signal.aborted) {
      try {
        const result = await deliverNextNotification({ database, appUrl: env.APP_URL, secret: env.BETTER_AUTH_SECRET, sendMail: sendLocalMail });
        if (result !== "idle") { processed++; console.log(`[notifications] ${result}`); }
        if (options.includes("--once") && (result === "idle" || processed >= 100)) break;
        if (result === "idle") await setTimeout(1000, undefined, { signal: controller.signal });
      } catch {
        if (controller.signal.aborted) break;
        console.error("[notifications] Очередь временно недоступна; подробности скрыты.");
        if (options.includes("--once")) { process.exitCode = 1; break; }
        await setTimeout(5000, undefined, { signal: controller.signal }).catch(() => {});
      }
    }
  }
} catch { console.error("[notifications] Команда не выполнена; подробности скрыты."); process.exitCode = 1; }
finally { await pool.end(); }

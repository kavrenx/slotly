import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readBackupKey } from "../../src/server/operations/backup-format";
import { OperationError } from "../../src/server/operations/errors";
import { loadEnvironment } from "./environment";

export const backupDirectory = resolve(".local/backups");
export function operationOptions() {
  const env = loadEnvironment();
  const key = readBackupKey(process.env.BACKUP_ENCRYPTION_KEY, process.env.BETTER_AUTH_SECRET);
  const localTools = resolve(".local/postgres-tools/bin");
  const binDirectory = process.env.PG_BIN_DIR || (process.platform === "win32" && existsSync(resolve(localTools, "pg_dump.exe")) ? localTools : undefined);
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort()); process.once("SIGTERM", () => controller.abort());
  return { env, key, signal: controller.signal, ...(binDirectory ? { binDirectory } : {}) };
}
const messages: Record<string, string> = {
  BACKUP_KEY_REQUIRED: "Нужен отдельный BACKUP_ENCRYPTION_KEY: выполните npm run setup и сохраните ключ отдельно от копий.",
  BACKUP_CONNECTION_OPTIONS: "Операции требуют простого имени базы и URL без дополнительных параметров.",
  BACKUP_FAILED: "Копия не создана. Проверьте подключение, свободное место и клиентские утилиты PostgreSQL 18.",
  POSTGRES_TOOL_FAILED: "Клиентская утилита PostgreSQL завершилась с ошибкой. Проверьте PG_BIN_DIR и совместимость версий.",
  BACKUP_INVALID: "Файл не является поддерживаемой копией Slotly.",
  BACKUP_AUTH_FAILED: "Не удалось подтвердить целостность копии. Проверьте ключ и файл; восстановление не выполнено.",
  DATABASE_NOT_MIGRATED: "В базе не найдена полная схема Slotly. Проверьте подключение и миграции.",
  RESTORE_FAILED: "Проверка восстановления завершилась с ошибкой клиентской утилиты PostgreSQL.",
  RESTORE_MISMATCH: "Восстановленная база не совпала с сохранённым снимком или содержит непроверенные ограничения.",
  UNSAFE_RESTORE_TARGET: "Восстановление допускается только в новую базу slotly_recovered_*. Рабочая база не может быть целью.",
  USAGE: "Используйте db:backup, db:verify-backup -- файл или db:restore-backup -- файл slotly_recovered_имя.",
};
export function reportOperationError(error: unknown) {
  const code = error instanceof OperationError ? error.code : "OPERATION_FAILED";
  console.error(`[operations] ${messages[code] ?? "Операция не выполнена. Подробности подключения и данные скрыты."} (${code})`);
  process.exitCode = 1;
}

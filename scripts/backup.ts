import { writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { createBackup, verifyBackup } from "../src/server/operations/backups";
import { backupDirectory, operationOptions, reportOperationError } from "./lib/operations";
import { OperationError } from "../src/server/operations/errors";

try {
  const options = operationOptions();
  const args = process.argv.slice(2);
  let path: string, recoveryTarget: string | undefined;
  if (args.length === 0) {
    const backup = await createBackup(options, backupDirectory); path = backup.path;
    console.log(`Зашифрованная копия: ${relative(process.cwd(), path)} (${backup.bytes} байт).`);
  } else if (args.length === 2 && args[0] === "--verify") path = resolve(args[1]!);
  else if (args.length === 3 && args[0] === "--restore") { path = resolve(args[1]!); recoveryTarget = args[2]!; }
  else throw new OperationError("USAGE");
  const result = await verifyBackup(options, path, recoveryTarget);
  await writeFile(path + ".verified.json", JSON.stringify({ kind: "slotly-backup-verification-v1", ...result, verifiedAt: new Date().toISOString() }), { mode: 0o600 });
  console.log(`Восстановление проверено: ${result.tablesChecked} таблиц, ${result.migrationsChecked} миграций.`);
  console.log(result.recoveredDatabase ? `Новая база сохранена: ${result.recoveredDatabase}. Подключение приложения не изменено.` : "Временная база удалена.");
} catch (error) { reportOperationError(error); }

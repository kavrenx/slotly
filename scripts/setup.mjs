import { randomBytes } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";

const template = await readFile(new URL("../.env.example", import.meta.url), "utf8");
try {
  await writeFile(
    new URL("../.env.local", import.meta.url),
    template.replace("replace-with-local-password", randomBytes(24).toString("hex"))
      .replace("replace-with-random-secret", randomBytes(32).toString("hex"))
      .replace("replace-with-backup-encryption-key", randomBytes(32).toString("hex")),
    { flag: "wx", mode: 0o600 },
  );
  console.log("Создан .env.local со случайным локальным паролем. Секреты не выводятся.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  const file = new URL("../.env.local", import.meta.url);
  const existing = await readFile(file, "utf8");
  const operations = await readFile(new URL("../.env.operations.local", import.meta.url), "utf8").catch(error => { if (error.code === "ENOENT") return ""; throw error; });
  const additions = [];
  if (!/^BETTER_AUTH_SECRET=/m.test(existing)) additions.push(`BETTER_AUTH_SECRET=${randomBytes(32).toString("hex")}`);
  if (!/^MAIL_TRANSPORT=/m.test(existing)) additions.push("MAIL_TRANSPORT=local");
  if (!/^BACKUP_ENCRYPTION_KEY=/m.test(existing + "\n" + operations)) additions.push(`BACKUP_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`);
  if (additions.length) await appendFile(file, "\n" + additions.join("\n") + "\n");
  console.log(".env.local сохранён; недостающие настройки добавлены без вывода секретов.");
}

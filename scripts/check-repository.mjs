import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";

const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).split("\0").filter(Boolean);
if (!paths.length) throw new Error("Сначала добавьте подготовленные файлы в Git.");
const problems = [];
const forbiddenPath = /(^|\/)(?:node_modules|\.next|\.local|coverage|out|dist|test-results|playwright-report|\.vercel)(?:\/|$)|(?:^|\/)\.env(?!\.example$)|(?:\.log|\.dump|\.sql\.gz|\.backup|\.slotlybackup(?:\.verified\.json)?|\.bak|\.pem|\.key|\.p12|\.pfx|\.tsbuildinfo)$|(?:^|\/)next-env\.d\.ts$/iu;
const secrets = [
  /-{5}BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-{5}/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
];
for (const path of paths) {
  if (forbiddenPath.test(path)) { problems.push(`${path}: локальный или сгенерированный файл`); continue; }
  const info = lstatSync(path);
  if (!info.isFile()) { problems.push(`${path}: ожидается обычный файл, а не ссылка`); continue; }
  if (info.size > 2 * 1024 * 1024) { problems.push(`${path}: файл больше 2 МиБ; проверьте его назначение`); continue; }
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8000).includes(0)) continue;
  if (secrets.some(pattern => pattern.test(bytes.toString("utf8")))) problems.push(`${path}: возможный секрет`);
}
if (problems.length) {
  console.error("Проверка состава репозитория не пройдена:\n" + problems.join("\n")); process.exitCode = 1;
} else console.log(`Проверено файлов: ${paths.length}. Локальные данные и известные форматы секретов не найдены.`);

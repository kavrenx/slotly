import { spawn } from "node:child_process";
import { resolve } from "node:path";

const mode = process.argv[2];
if (!["dev", "start"].includes(mode)) throw new Error("Expected dev or start");
const env = { ...process.env, NODE_ENV: mode === "start" ? "production" : "development" };
const children = [
  spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), mode, "--hostname", "127.0.0.1", ...process.argv.slice(3)], { stdio: "inherit", env, windowsHide: true }),
  spawn(process.execPath, ["--import", "tsx", resolve("scripts/notification-worker.ts")], { stdio: "inherit", env, windowsHide: true }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true; process.exitCode = code;
  for (const child of children) if (child.exitCode === null && child.pid) {
    // Next dev owns a server subprocess. Windows kill() alone terminates only
    // its parent, leaving the port occupied after Ctrl+C.
    if (process.platform === "win32") spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else child.kill("SIGTERM");
  }
}
for (const child of children) {
  child.on("error", () => { console.error("Не удалось запустить приложение или обработчик уведомлений."); stop(1); });
  child.on("exit", code => { if (!stopping) stop(code ?? 1); });
}
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());

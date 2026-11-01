import { appendFile, lstat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export type OperationsEvent = { at: string; type: "attention" | "recovered" | "maintenance" | "backup"; issues: string[]; counts?: Record<string, number> };
export type OperationsSink = { write(event: OperationsEvent): Promise<void> };
export function createLocalOperationsSink(directory = resolve(".local/operations")): OperationsSink {
  return { async write(event) {
    if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u.test(event.at) || !Number.isFinite(Date.parse(event.at)) ||
      !["attention", "recovered", "maintenance", "backup"].includes(event.type) ||
      event.issues.some(code => !/^[A-Z][A-Z0-9_]{0,63}$/u.test(code)) ||
      Object.entries(event.counts ?? {}).some(([key, value]) => !/^[a-zA-Z]{1,40}$/u.test(key) || !Number.isSafeInteger(value) || value < 0)) throw new Error("INVALID_OPERATIONS_EVENT");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await lstat(directory)).isSymbolicLink()) throw new Error("UNSAFE_OPERATIONS_DIRECTORY");
    const path = join(directory, `events-${event.at.slice(0, 10)}.jsonl`);
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error("UNSAFE_OPERATIONS_FILE");
    // Serialize only the whitelist: arbitrary exception bodies cannot enter logs.
    await appendFile(path, JSON.stringify({ at: event.at, type: event.type, issues: event.issues, ...(event.counts ? { counts: event.counts } : {}) }) + "\n", { mode: 0o600 });
  } };
}
export function createOperationsReporter(sink: OperationsSink) {
  let previous: string | undefined;
  return async (issues: string[], at: Date) => {
    const sorted = [...new Set(issues)].sort();
    const signature = sorted.join(",");
    if (signature === previous || (previous === undefined && !sorted.length)) { previous = signature; return; }
    await sink.write({ at: at.toISOString(), type: sorted.length ? "attention" : "recovered", issues: sorted });
    previous = signature;
  };
}

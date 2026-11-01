import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createPrivateWorkspace, removePrivateWorkspace } from "./postgres-tools";
import { createLocalOperationsSink, createOperationsReporter, type OperationsEvent } from "./alerts";
import { createOperationsRunner } from "./runner";
import { localReviewReadiness } from "./readiness";

let directory: string;
beforeEach(async () => { directory = await createPrivateWorkspace(); });
afterEach(async () => { await removePrivateWorkspace(directory); });
it("records only state changes and recovery, with no arbitrary event fields", async () => {
  const sink = createLocalOperationsSink(directory), report = createOperationsReporter(sink), at = new Date("2027-01-01T10:00:00Z");
  await report([], at); await report(["BACKUP_MISSING", "DELIVERY_FAILED"], at);
  await report(["DELIVERY_FAILED", "BACKUP_MISSING"], at); await report([], at); await report([], at);
  await sink.write({ at: at.toISOString(), type: "maintenance", issues: [], counts: { authSessions: 2 }, private: "guest@example.invalid secret" } as OperationsEvent);
  const text = await readFile(join(directory, "events-2027-01-01.jsonl"), "utf8");
  const events = text.trim().split("\n").map(line => JSON.parse(line) as OperationsEvent);
  expect(events.map(event => event.type)).toEqual(["attention", "recovered", "maintenance"]);
  expect(text).not.toContain("guest@example.invalid"); expect(text).not.toContain("secret");
});
it("rejects unsafe event contents before writing them", async () => {
  const sink = createLocalOperationsSink(directory);
  await expect(sink.write({ at: "2027-01-01T10:00:00Z", type: "attention", issues: ["private@example.invalid"] })).rejects.toThrow("INVALID_OPERATIONS_EVENT");
  expect(await readdir(directory)).toEqual([]);
});
it("retains failed maintenance state during backoff and reports recovery only after a successful retry", async () => {
  let fails = true, cleanups = 0, backups = 0;
  const events: OperationsEvent[] = [];
  const runner = createOperationsRunner({ maintain: async () => { cleanups++; if (fails) throw new Error("private error"); return { authSessions: 1 }; },
    backupIfNeeded: async () => { backups++; return false; }, diagnose: async () => [], sink: { write: async event => { events.push(event); } } });
  const start = Date.parse("2027-01-01T10:00:00Z");
  expect((await runner.tick(new Date(start))).issues).toContain("MAINTENANCE_FAILED");
  fails = false;
  expect((await runner.tick(new Date(start + 60_000))).issues).toContain("MAINTENANCE_FAILED");
  expect(cleanups).toBe(1); expect(backups).toBe(1);
  expect((await runner.tick(new Date(start + 900_000))).status).toBe("ok");
  expect(events.map(event => event.type)).toEqual(["attention", "maintenance", "recovered"]);
  expect(JSON.stringify(events)).not.toContain("private error");
});
it("prevents overlapping operations cycles and releases its guard after completion", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const runner = createOperationsRunner({ maintain: async () => { await pending; return {}; }, backupIfNeeded: async () => false,
    diagnose: async () => [], sink: { write: async () => {} } });
  const first = runner.tick(); expect((await runner.tick()).status).toBe("busy");
  finish(); expect((await first).status).toBe("ok"); expect((await runner.tick()).status).toBe("ok");
});
it("accepts local adapters for design review without declaring a public release ready", () => {
  const input = { appUrl: "http://localhost:3000", databaseUrl: "postgresql://test:fake@127.0.0.1/slotly", mailTransport: "local" as const, issues: [] };
  expect(localReviewReadiness(input)).toMatchObject({ ready: true, publicLaunch: { ready: false } });
  expect(localReviewReadiness({ ...input, mailTransport: "smtp" }).issues).toContain("LOCAL_MAIL_REQUIRED");
  expect(localReviewReadiness({ ...input, issues: ["MIGRATIONS_PENDING"] }).ready).toBe(false);
  expect(localReviewReadiness({ ...input, appUrl: "https://slotly.example" }).issues).toContain("LOCAL_APP_REQUIRED");
});

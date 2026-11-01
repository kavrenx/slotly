import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sendLocalMail } from "./local";
import { readLocalMail } from "./reader";

it("atomically retries the same OTP mail and still reads organizer action links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slotly-mail-test-"));
  try {
    const message = { to: "guest@example.invalid", subject: "Код", text: "Тестовый код: 123456", messageId: randomUUID(), createdAt: "2027-01-04T06:00:00.000Z" };
    await Promise.all(Array.from({ length: 16 }, () => sendLocalMail(message, directory)));
    await expect(sendLocalMail({ ...message, text: "Different payload for the same message" }, directory)).rejects.toBeDefined();
    await sendLocalMail({ to: "owner@example.invalid", subject: "Почта", text: "Подтвердите почту", actionUrl: "http://localhost:3000/verify-email#token=fake", createdAt: "2027-01-04T06:01:00.000Z" }, directory);
    await writeFile(join(directory, ".tmp-interrupted"), "incomplete");
    const messages = await readLocalMail(directory);
    expect(messages).toHaveLength(2); expect(messages[0]!.actionUrl).toContain("/verify-email#token=fake"); expect(messages[1]).toMatchObject(message);
    expect((await readdir(directory)).filter((name) => name.endsWith(".json"))).toHaveLength(2);
    await expect(sendLocalMail({ ...message, messageId: "../not-a-file" }, directory)).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

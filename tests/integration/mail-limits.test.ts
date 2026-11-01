import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/database";
import * as schema from "../../src/server/db/schema";
import type { Database } from "../../src/server/db/types";
import { MailBudgetExceeded, guardIdentityMailRequest, parseMailBudgetPolicy, reserveMailLimits, withMailBudget } from "../../src/server/mail/limits";
import { deliverNextNotification } from "../../src/modules/notifications/worker";
import { fixture, insertCompleteBooking } from "../helpers/domain";
import { transaction } from "../helpers/database";

let test: Awaited<ReturnType<typeof createTestDatabase>>, database: Database;
const secret = randomBytes(32).toString("hex");
beforeAll(async () => { test = await createTestDatabase({ restricted: true }); database = drizzle(test.pool, { schema }); });
beforeEach(async () => { await test.pool.query("delete from slotly.mail_delivery_limits"); });
afterAll(async () => { await test?.close(); });

it("reserves a shared SMTP budget atomically across concurrent senders and recipients", async () => {
  let sent = 0;
  const mail = withMailBudget({ sendMail: async () => { sent++; }, verify: async () => {}, close() {} }, database, secret,
    parseMailBudgetPolicy({ MAIL_MAX_PER_HOUR: "3" }));
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => mail.sendMail({ to: `guest${i}@example.invalid`, subject: "Test", text: "Test" })));
  expect(sent).toBe(3); expect(results.filter(r => r.status === "fulfilled")).toHaveLength(3);
  expect(results.filter(r => r.status === "rejected").every(r => r.reason instanceof MailBudgetExceeded)).toBe(true);
  const counts = (await test.pool.query("select count from slotly.mail_delivery_limits order by count desc")).rows.map(row => row.count);
  expect(counts.filter(count => count === 3)).toHaveLength(2); // hour + day
  expect(counts).toHaveLength(8); // two global + two per successful recipient
});
it("rolls back every bucket when one is full, and resets exactly at expiry", async () => {
  const now = new Date("2027-01-01T10:00:00Z");
  const limits = [{ scope: "first", maximum: 1, seconds: 60 }, { scope: "second", maximum: 3, seconds: 3600 }];
  await reserveMailLimits(database, secret, limits, now);
  await expect(reserveMailLimits(database, secret, limits, new Date(now.getTime() + 1000))).rejects.toMatchObject({ retryAfter: 59 });
  expect((await test.pool.query("select sum(count)::int as total from slotly.mail_delivery_limits")).rows[0].total).toBe(2);
  await reserveMailLimits(database, secret, limits, new Date(now.getTime() + 60_000));
  expect((await test.pool.query("select sum(count)::int as total from slotly.mail_delivery_limits")).rows[0].total).toBe(3);
});
it("normalizes recipient request limits and stores neither addresses nor raw scopes", async () => {
  await guardIdentityMailRequest(database, secret, " Guest@Example.invalid ", "127.0.0.1");
  await expect(guardIdentityMailRequest(database, secret, "guest@example.invalid", "127.0.0.1")).rejects.toBeInstanceOf(MailBudgetExceeded);
  const rows = (await test.pool.query("select * from slotly.mail_delivery_limits")).rows;
  expect(rows).toHaveLength(4); expect(rows.every(row => /^[a-f0-9]{64}$/u.test(row.key))).toBe(true);
  expect(JSON.stringify(rows)).not.toContain("guest@example.invalid"); expect(JSON.stringify(rows)).not.toContain("auth-request");
  for (let i = 0; i < 9; i++) await guardIdentityMailRequest(database, secret, `other${i}@example.invalid`, "127.0.0.1");
  await expect(guardIdentityMailRequest(database, secret, "one-too-many@example.invalid", "127.0.0.1")).rejects.toBeInstanceOf(MailBudgetExceeded);
  expect((await test.pool.query("select count(*)::int as n from slotly.mail_delivery_limits")).rows[0].n).toBe(22);
});
it("retains quota after an ambiguous SMTP failure and fails closed when counters are unavailable", async () => {
  let attempts = 0;
  const mail = withMailBudget({ sendMail: async () => { attempts++; throw new Error("SMTP failed"); }, verify: async () => {}, close() {} }, database, secret,
    parseMailBudgetPolicy({ MAIL_MAX_PER_HOUR: "1" }));
  const message = { to: "guest@example.invalid", subject: "Test", text: "Test" };
  await expect(mail.sendMail(message)).rejects.toThrow("SMTP failed");
  await expect(mail.sendMail(message)).rejects.toBeInstanceOf(MailBudgetExceeded); expect(attempts).toBe(1);
  await test.adminPool.query("ALTER TABLE slotly.mail_delivery_limits RENAME TO unavailable_test_limits");
  try { await expect(mail.sendMail(message)).rejects.toBeDefined(); expect(attempts).toBe(1); }
  finally { await test.adminPool.query("ALTER TABLE slotly.unavailable_test_limits RENAME TO mail_delivery_limits"); }
});
it("defers budget-blocked notifications without consuming delivery attempts or losing the queue item", async () => {
  const f = await fixture(test.pool);
  await transaction(test.pool, client => insertCompleteBooking(client, f));
  const now = new Date("2027-01-01T10:00:00Z");
  const result = await deliverNextNotification({ database, secret, appUrl: "http://localhost:3000", clock: () => now,
    sendMail: async () => { throw new MailBudgetExceeded(3600); } });
  expect(result).toBe("deferred");
  const row = (await test.pool.query("select attempts,available_at,sent_at,failed_at,lease_token,last_error from slotly.notification_outbox where last_error='MAIL_RATE_LIMITED'")).rows[0];
  expect(row).toMatchObject({ attempts: 0, sent_at: null, failed_at: null, lease_token: null, last_error: "MAIL_RATE_LIMITED" });
  expect(row.available_at.toISOString()).toBe("2027-01-01T11:00:00.000Z");
});

import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import * as schema from "../../src/server/db/schema";
import type { Database } from "../../src/server/db/types";
import { fixture, insertCompleteBooking, moveBooking, cancelBooking } from "../helpers/domain";
import { createTestDatabase, transaction } from "../helpers/database";
import { deliverNextNotification, LEASE_MS, MAX_ATTEMPTS, notificationQueueStatus, retryFailedNotifications, type NotificationDependencies } from "../../src/modules/notifications/worker";
import { sendLocalMail, type LocalMail } from "../../src/server/mail/local";
import { readLocalMail } from "../../src/server/mail/reader";
import { validManagementToken } from "../../src/modules/booking-management/token";
import { renderBookingNotification } from "../../src/modules/notifications/mail";
import { changeBooking } from "../../src/modules/booking-management/service";

let database: Awaited<ReturnType<typeof createTestDatabase>>, db: Database, now: Date;
const secret = randomBytes(32).toString("hex"), appUrl = "http://localhost:3000";
let messages: LocalMail[], deps: NotificationDependencies;
beforeAll(async () => { database = await createTestDatabase({ restricted: true }); db = drizzle(database.pool, { schema }); });
beforeEach(async () => {
  await db.delete(schema.notificationOutbox); messages = []; now = new Date("2027-01-04T06:00:00Z");
  deps = { database: db, appUrl, secret, clock: () => now, sendMail: async mail => { messages.push(mail); } };
});
afterAll(async () => { await database?.close(); });
async function setup() {
  const f = await fixture(database.pool);
  return { ...f, ...await transaction(database.pool, client => insertCompleteBooking(client, f)) };
}
async function drain(dependencies = deps) {
  for (let i = 0; i < 30; i++) if (await deliverNextNotification(dependencies) === "idle") return;
  throw new Error("Queue failed to drain");
}
async function rows() { return db.select().from(schema.notificationOutbox); }

it("commits exactly two recipient snapshots with a booking event and freezes them", async () => {
  const f = await setup(); const saved = await rows(); expect(saved).toHaveLength(2);
  expect(saved.find(r => r.audience === "guest")).toMatchObject({ recipientEmail: f.booking.guestEmail, recipientTimezone: "Europe/Minsk", attempts: 0 });
  expect(saved.find(r => r.audience === "organizer")!.recipientEmail).toContain("@example.invalid");
  await expect(db.update(schema.notificationOutbox).set({ recipientEmail: "hijack@example.invalid" }).where(eq(schema.notificationOutbox.id, saved[0]!.id))).rejects.toThrow();
  await db.update(schema.organizers).set({ displayName: "Updated name" }).where(eq(schema.organizers.id, f.organizer.id));
  await db.update(schema.authUsers).set({ email: "updated@example.invalid" }).where(eq(schema.authUsers.id, f.organizer.userId));
  await drain(); expect(messages.map(m => m.to)).toEqual(expect.arrayContaining(saved.map(r => r.recipientEmail)));
  expect(messages.every(m => !m.text.includes("Updated name"))).toBe(true);
});
it("rolls back both the booking and notification queue when the enclosing transaction fails", async () => {
  const f = await fixture(database.pool);
  await expect(transaction(database.pool, async client => { await insertCompleteBooking(client, f); throw new Error("rollback"); })).rejects.toThrow("rollback");
  expect(await rows()).toHaveLength(0); expect(await db.select().from(schema.bookings).where(eq(schema.bookings.organizerId, f.organizer.id))).toHaveLength(0);
});
it("rolls back cancellation if enqueue fails, then accepts an identical retry once", async () => {
  const f = await setup(); const command = { version: 1, requestId: randomUUID(), reason: "Отмена" };
  const actor = { kind: "organizer" as const, organizerId: f.organizer.id, bookingId: f.booking.id };
  await database.adminPool.query("ALTER TABLE slotly.notification_outbox ADD CONSTRAINT stage8_reject CHECK (false) NOT VALID");
  try { await expect(changeBooking(deps, actor, "cancel", command)).rejects.toThrow(); }
  finally { await database.adminPool.query("ALTER TABLE slotly.notification_outbox DROP CONSTRAINT stage8_reject"); }
  expect((await db.select().from(schema.occupancies).where(eq(schema.occupancies.id, f.occupancy.id)))[0]!.releasedAt).toBeNull();
  expect(await rows()).toHaveLength(2);
  await changeBooking(deps, actor, "cancel", command); await changeBooking(deps, actor, "cancel", command);
  expect(await rows()).toHaveLength(4);
});
it("delivers guest capability and authenticated organizer link with distinct time zones", async () => {
  const f = await fixture(database.pool); await db.update(schema.schedules).set({ timezone: "America/New_York" }).where(eq(schema.schedules.id, f.schedule.id));
  const made = await transaction(database.pool, client => insertCompleteBooking(client, f));
  await drain(); expect(messages).toHaveLength(2);
  const guest = messages.find(m => m.to === made.booking.guestEmail)!;
  const owner = messages.find(m => m.to !== made.booking.guestEmail)!;
  expect(guest.text).toContain("13:00"); expect(guest.text).toContain("Europe/Minsk");
  expect(owner.text).toContain("05:00"); expect(owner.text).toContain("America/New_York");
  const token = new URL(guest.actionUrl!).hash.slice("#token=".length);
  expect(validManagementToken(secret, made.booking, token)).toBe(true);
  expect(owner.actionUrl).toBe(`${appUrl}/dashboard/bookings/${made.booking.id}`);
  expect(owner.text).not.toContain("#token=");
  expect(await notificationQueueStatus(db)).toEqual({ sent: 2, pending: 0, failed: 0 });
});
it("preserves historical intervals and sends create, move, cancel in order for each audience", async () => {
  const f = await setup();
  await transaction(database.pool, client => moveBooking(client, f.booking.id, f.occupancy, "2027-01-04T11:00:00Z"));
  const [occupied] = await db.select().from(schema.occupancies).where(eq(schema.occupancies.id, f.occupancy.id));
  await transaction(database.pool, client => cancelBooking(client, f.booking.id, occupied!, "organizer", "Не смогу провести встречу"));
  await drain(); expect(messages).toHaveLength(6);
  for (const recipient of new Set(messages.map(m => m.to))) {
    const mail = messages.filter(m => m.to === recipient);
    expect(mail.map(m => m.text.match(/Изменение: (\d+)/u)![1])).toEqual(["1", "2", "3"]);
    expect(mail[0]!.text).toContain("13:00"); expect(mail[0]!.text).not.toContain("14:00");
    expect(mail[1]!.text).toContain("Раньше:"); expect(mail[1]!.text).toContain("Новое время:");
    expect(mail[2]!.text).toContain("Не смогу провести встречу");
  }
});
it("parallel workers claim each delivery once and preserve per-audience event order", async () => {
  const f = await setup(); await transaction(database.pool, client => cancelBooking(client, f.booking.id, f.occupancy));
  await Promise.all(Array.from({ length: 6 }, () => drain({ ...deps, sendMail: async mail => { await new Promise(resolve => setTimeout(resolve, 20)); messages.push(mail); } })));
  expect(messages).toHaveLength(4); expect(new Set(messages.map(m => m.messageId)).size).toBe(4);
  for (const recipient of new Set(messages.map(m => m.to))) expect(messages.filter(m => m.to === recipient).map(m => m.text.match(/Изменение: (\d+)/u)![1])).toEqual(["1", "2"]);
});
it("does not expose uncommitted events or send rolled-back notifications", async () => {
  const f = await fixture(database.pool); const client = await database.pool.connect();
  try { await client.query("BEGIN"); await insertCompleteBooking(client, f);
    expect(await deliverNextNotification(deps)).toBe("idle");
    await client.query("ROLLBACK"); expect(await rows()).toHaveLength(0);
  } finally { await client.query("ROLLBACK"); client.release(); }
});
it("backs off delivery errors without leaking sensitive exception details", async () => {
  await setup();
  const broken = { ...deps, sendMail: async () => { throw new Error("secret token=private guest@example.invalid"); } };
  expect(await deliverNextNotification(broken)).toBe("retry"); expect(await deliverNextNotification(broken)).toBe("retry");
  expect(await deliverNextNotification(broken)).toBe("idle");
  for (const row of await rows()) expect(row).toMatchObject({ attempts: 1, sentAt: null, failedAt: null, lastError: "DELIVERY_FAILED", availableAt: new Date(now.getTime() + 5000), leaseToken: null });
  now = new Date(now.getTime() + 5000); await drain(); expect(messages).toHaveLength(2);
});
it("failed predecessor blocks newer messages only until terminal failure; manual retry is explicit", async () => {
  const f = await setup(); await transaction(database.pool, client => cancelBooking(client, f.booking.id, f.occupancy));
  const broken = { ...deps, sendMail: async (mail: LocalMail) => { if (mail.text.includes("Изменение: 1")) throw new Error("offline"); messages.push(mail); } };
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
    expect(await deliverNextNotification(broken)).toBe("retry");
    expect(await deliverNextNotification(broken)).toBe("retry");
    expect(await deliverNextNotification(broken)).toBe("idle");
    now = new Date(now.getTime() + 3_600_000);
  }
  await drain(broken); expect(messages).toHaveLength(2); expect(messages.every(m => m.text.includes("Изменение: 2"))).toBe(true);
  expect(await notificationQueueStatus(db)).toEqual({ sent: 2, pending: 0, failed: 2 });
  expect(await retryFailedNotifications(db, now)).toHaveLength(2); await drain();
  expect(await notificationQueueStatus(db)).toEqual({ sent: 4, pending: 0, failed: 0 });
});
it("recovers an abandoned lease and fences a stale worker's acknowledgement", async () => {
  await setup(); let release!: () => void, started!: () => void;
  const claimed = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const first = deliverNextNotification({ ...deps, sendMail: async () => { started(); await wait; } });
  await claimed;
  // Other audience is independent and can finish while the first is suspended.
  expect(await deliverNextNotification(deps)).toBe("sent");
  now = new Date(now.getTime() + LEASE_MS + 1);
  expect(await deliverNextNotification(deps)).toBe("sent");
  release(); expect(await first).toBe("lease-lost");
  expect(await notificationQueueStatus(db)).toEqual({ sent: 2, pending: 0, failed: 0 });
});
it("recovers an expired final-attempt lease instead of stranding the queue", async () => {
  await setup(); const [row] = await rows();
  await db.update(schema.notificationOutbox).set({ attempts: 8, leaseToken: randomUUID(), lockedUntil: new Date(now.getTime() - 1) }).where(eq(schema.notificationOutbox.id, row!.id));
  await drain(); expect(await notificationQueueStatus(db)).toEqual({ sent: 1, failed: 1, pending: 0 });
  expect((await rows()).find(r => r.id === row!.id)!.lastError).toBe("LEASE_EXHAUSTED");
});
it("publishes one local message when a send succeeds but acknowledgement is lost", async () => {
  const f = await setup();
  const directory = await mkdtemp(resolve(tmpdir(), "slotly-notification-test-"));
  try {
    const [content] = await db.select({ delivery: schema.notificationOutbox, event: schema.bookingEvents, booking: schema.bookings })
      .from(schema.notificationOutbox).innerJoin(schema.bookingEvents, eq(schema.bookingEvents.id, schema.notificationOutbox.eventId))
      .innerJoin(schema.bookings, eq(schema.bookings.id, schema.bookingEvents.bookingId)).where(eq(schema.bookings.id, f.booking.id)).limit(1);
    await sendLocalMail(renderBookingNotification(content!, appUrl, secret), directory); // crash before DB ack
    await drain({ ...deps, sendMail: mail => sendLocalMail(mail, directory) });
    expect((await readdir(directory)).filter(name => name.endsWith(".json"))).toHaveLength(2);
    expect(await readLocalMail(directory)).toHaveLength(2);
    expect(await notificationQueueStatus(db)).toEqual({ sent: 2, failed: 0, pending: 0 });
  } finally {
    if (dirname(directory) === resolve(tmpdir()) && basename(directory).startsWith("slotly-notification-test-")) await rm(directory, { recursive: true, force: true });
  }
});

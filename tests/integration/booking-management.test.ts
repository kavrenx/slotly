import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import * as schema from "../../src/server/db/schema";
import type { Database } from "../../src/server/db/types";
import { createTestDatabase, transaction } from "../helpers/database";
import { fixture, insertCompleteBooking, insertOccupancy, type Fixture } from "../helpers/domain";
import { saveSchedule } from "../../src/modules/availability/service";
import { getPublicAvailability } from "../../src/modules/availability/public-service";
import { updatePage, changePageState } from "../../src/modules/booking-pages/service";
import { pageDefaults } from "../../src/modules/booking-pages/validation";
import { changeBooking, getGuestBooking, getManagedBooking, getRescheduleSlots, type ManagementDependencies } from "../../src/modules/booking-management/service";
import { createManagementToken } from "../../src/modules/booking-management/token";
import { handleGuestManagement, handleOrganizerBooking, type ManagementOperation } from "../../src/modules/booking-management/http";
import { createOrganizerAuth, type OrganizerAuth } from "../../src/modules/identity/auth";
import { handleIdentityRequest } from "../../src/modules/identity/http";
import { loadEnvironment } from "../../scripts/lib/environment";
import { parseIdentityEnv } from "../../src/server/config/schema";

let database: Awaited<ReturnType<typeof createTestDatabase>>, db: Database, deps: ManagementDependencies, now: Date, auth: OrganizerAuth;
const secret = randomBytes(32).toString("hex"), origin = "http://localhost:3000";
beforeAll(async () => { database = await createTestDatabase({ restricted: true }); db = drizzle(database.pool, { schema }); deps = { database: db, secret, clock: () => now };
  auth = createOrganizerAuth(db, parseIdentityEnv({ ...loadEnvironment(), NODE_ENV: "test", APP_URL: origin, BETTER_AUTH_SECRET: secret, MAIL_TRANSPORT: "local" }), async () => {});
});
beforeEach(async () => { now = new Date("2027-01-04T06:00:00Z"); await db.delete(schema.guestRateLimits); });
afterAll(async () => { await database?.close(); });
async function setup(options: { start?: string; duration?: number; before?: number; after?: number } = {}) {
  const f = await fixture(database.pool);
  await saveSchedule(db, f.organizer.id, { version: 1, timezone: "UTC", weekly: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinute: 540, endMinute: 1020 })), overrides: [] });
  const made = await transaction(database.pool, client => insertCompleteBooking(client, f, { start: "2027-01-04T10:00:00Z", ...options }));
  const token = createManagementToken(secret, made.booking); const actor = { kind: "guest" as const, token };
  return { ...f, ...made, token, actor, owner: { kind: "organizer" as const, organizerId: f.organizer.id, bookingId: made.booking.id } };
}
const cancel = (version = 1, reason?: string) => ({ requestId: randomUUID(), version, ...(reason === undefined ? {} : { reason }) });
const move = (startAt = "2027-01-04T11:00:00.000Z", version = 1, minutes = 30) => ({ requestId: randomUUID(), version, startAt, endAt: new Date(Date.parse(startAt) + minutes * 60_000).toISOString() });
const query = { date: "2027-01-04", timezone: "UTC" };
async function events(id: string) { return db.select().from(schema.bookingEvents).where(eq(schema.bookingEvents.bookingId, id)).orderBy(schema.bookingEvents.version); }
function guestHttp(operation: ManagementOperation, data: unknown, headers: Record<string, string> = {}) { return handleGuestManagement(deps, new Request(origin + `/api/booking-management/${operation}`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(data) }), operation, origin); }
async function changeSettings(f: Fixture) { await updatePage(db, f.organizer.id, f.page.id, { ...pageDefaults, title: "New settings", durationMinutes: 60, bufferBeforeMinutes: 60, bufferAfterMinutes: 60, minNoticeMinutes: 1440, horizonDays: 1, cancelCutoffMinutes: 1440, rescheduleCutoffMinutes: 1440, version: 1 }); }

it("returns actual occupancy time and history only to the owner or a valid capability", async () => {
  const f = await setup(), other = await setup();
  expect(await getGuestBooking(deps, { token: f.token })).toMatchObject({ id: f.booking.id, startAt: "2027-01-04T10:00:00.000Z", version: 1, canCancel: true, canReschedule: true });
  expect((await getManagedBooking(deps, f.owner)).managementToken).toBe(f.token);
  expect((await getGuestBooking(deps, { token: f.token })).managementToken).toBeUndefined();
  await expect(getManagedBooking(deps, { ...f.owner, organizerId: other.organizer.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(getGuestBooking(deps, { token: createManagementToken(secret + "x", f.booking) })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(getGuestBooking(deps, { token: f.token, organizerId: f.organizer.id })).rejects.toMatchObject({ code: "INVALID_INPUT" });
});
it("cancels atomically, frees the shared schedule and preserves the booking snapshot", async () => {
  const f = await setup(); const result = await changeBooking(deps, f.actor, "cancel", cancel());
  expect(result).toMatchObject({ status: "cancelled", version: 2, canCancel: false, canReschedule: false });
  expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.booking.id)))[0]).toEqual(f.booking);
  expect((await events(f.booking.id)).map(e => [e.type, e.version])).toEqual([["created", 1], ["cancelled", 2]]);
  expect((await getPublicAvailability(db, f.page.publicId, query, now)).slots.map(s => s.startAt)).toContain("2027-01-04T10:00:00.000Z");
});
it("requires an organizer reason and allows organizer cancellation after the guest cutoff", async () => {
  const f = await setup(); now = new Date("2027-01-04T09:30:00Z");
  await expect(changeBooking(deps, f.owner, "cancel", cancel())).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(changeBooking(deps, f.actor, "cancel", cancel())).rejects.toMatchObject({ code: "CHANGE_NOT_ALLOWED" });
  expect((await changeBooking(deps, f.owner, "cancel", cancel(1, "Не смогу провести встречу"))).status).toBe("cancelled");
  expect((await events(f.booking.id))[1]).toMatchObject({ actor: "organizer", reason: "Не смогу провести встречу" });
});
it.each(["cancel", "reschedule"] as const)("honors the exact saved %s deadline and rejects one millisecond later", async operation => {
  const a = await setup(), b = await setup(); now = new Date("2027-01-04T08:00:00.000Z");
  const command = operation === "cancel" ? cancel() : move();
  await changeBooking(deps, a.actor, operation, command);
  now = new Date("2027-01-04T08:00:00.001Z");
  await expect(changeBooking(deps, b.actor, operation, operation === "cancel" ? cancel() : move())).rejects.toMatchObject({ code: "CHANGE_NOT_ALLOWED" });
});
it("cannot change a started meeting even with zero cutoff or organizer authority", async () => {
  const f = await setup(); now = new Date("2027-01-04T10:00:00Z");
  expect((await getManagedBooking(deps, f.owner)).canCancel).toBe(false);
  await expect(changeBooking(deps, f.owner, "cancel", cancel(1, "Причина"))).rejects.toMatchObject({ code: "CHANGE_NOT_ALLOWED" });
});
it("moves one occupancy, keeps duration and buffers, and appends an immutable history event", async () => {
  const f = await setup({ start: "2027-01-04T10:00:00Z", before: 15, after: 20 });
  const result = await changeBooking(deps, f.actor, "reschedule", move());
  expect(result).toMatchObject({ version: 2, startAt: "2027-01-04T11:00:00.000Z", endAt: "2027-01-04T11:30:00.000Z", durationMinutes: 30 });
  const [occupied] = await db.select().from(schema.occupancies).where(eq(schema.occupancies.id, f.occupancy.id));
  expect(occupied).toMatchObject({ bufferBeforeMinutes: 15, bufferAfterMinutes: 20, busyStartAt: new Date("2027-01-04T10:45:00Z"), busyEndAt: new Date("2027-01-04T11:50:00Z") });
  expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, f.booking.id)))[0]).toEqual(f.booking);
  expect((await events(f.booking.id))[1]).toMatchObject({ type: "rescheduled", oldStartAt: f.occupancy.startAt, newStartAt: new Date("2027-01-04T11:00:00Z") });
});
it("excludes only this booking when offering an overlapping new time", async () => {
  const f = await setup(); const slots = await getRescheduleSlots(deps, f.actor, query);
  expect(slots.slots.map(s => s.startAt)).not.toContain("2027-01-04T10:00:00.000Z");
  expect(slots.slots.map(s => s.startAt)).toContain("2027-01-04T10:15:00.000Z");
  await changeBooking(deps, f.actor, "reschedule", move("2027-01-04T10:15:00.000Z"));
});
it("uses saved duration, buffers, notice, horizon and cutoffs after page edits", async () => {
  const f = await setup({ before: 10, after: 10 }); await changeSettings(f);
  now = new Date("2027-01-04T07:00:00Z");
  expect((await changeBooking(deps, f.actor, "reschedule", move("2027-01-05T11:00:00.000Z"))).durationMinutes).toBe(30);
  expect((await getGuestBooking(deps, { token: f.token })).title).toBe(f.page.title);
});
it("uses the current schedule and rejects a slot closed after it was displayed", async () => {
  const f = await setup(); expect((await getRescheduleSlots(deps, f.actor, query)).slots.length).toBeGreaterThan(0);
  await saveSchedule(db, f.organizer.id, { version: 2, timezone: "UTC", weekly: [], overrides: [] });
  await expect(changeBooking(deps, f.actor, "reschedule", move())).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  expect((await getGuestBooking(deps, { token: f.token })).version).toBe(1);
});
it("keeps existing booking management available after its page is archived", async () => {
  const f = await setup(); await changePageState(db, f.organizer.id, f.page.id, { version: 1, state: "archived" });
  expect((await changeBooking(deps, f.actor, "reschedule", move())).version).toBe(2);
  expect((await changeBooking(deps, f.actor, "cancel", cancel(2))).status).toBe("cancelled");
});
it("rejects another occupancy including its buffer and keeps the old time", async () => {
  const f = await setup(); await insertOccupancy(database.pool, f, { kind: "manual", start: "2027-01-04T11:20:00Z", duration: 30 });
  await expect(changeBooking(deps, f.actor, "reschedule", move())).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  expect((await getGuestBooking(deps, { token: f.token })).startAt).toBe("2027-01-04T10:00:00.000Z"); expect(await events(f.booking.id)).toHaveLength(1);
});
it("rejects changing duration, the current time, unknown commands and organizer rescheduling", async () => {
  const f = await setup();
  await expect(changeBooking(deps, f.actor, "reschedule", move(undefined, 1, 60))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(changeBooking(deps, f.actor, "reschedule", move("2027-01-04T10:00:00.000Z"))).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  await expect(changeBooking(deps, f.owner, "reschedule", move())).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(changeBooking(deps, f.actor, "cancel", { ...cancel(), releasedAt: now.toISOString() })).rejects.toMatchObject({ code: "INVALID_INPUT" });
});
it("replays concurrent identical commands once, even after the change deadline", async () => {
  const f = await setup(); const command = move();
  const results = await Promise.all(Array.from({ length: 4 }, () => changeBooking(deps, f.actor, "reschedule", command)));
  expect(results.every(r => r.version === 2)).toBe(true); expect(await events(f.booking.id)).toHaveLength(2);
  now = new Date("2027-01-04T10:30:00Z"); expect((await changeBooking(deps, f.actor, "reschedule", command)).version).toBe(2);
  await expect(changeBooking(deps, f.actor, "reschedule", { ...command, startAt: "2027-01-04T12:00:00.000Z", endAt: "2027-01-04T12:30:00.000Z" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});
it("allows only one of concurrent cancellation and rescheduling from the same version", async () => {
  const f = await setup(); const results = await Promise.allSettled([changeBooking(deps, f.actor, "cancel", cancel()), changeBooking(deps, f.actor, "reschedule", move())]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "VERSION_CONFLICT" } }); expect(await events(f.booking.id)).toHaveLength(2);
});
it("lets only one of two bookings move into the same slot", async () => {
  const f = await setup(); const other = await transaction(database.pool, client => insertCompleteBooking(client, f, { start: "2027-01-04T12:00:00Z" }));
  const actor = { kind: "guest" as const, token: createManagementToken(secret, other.booking) };
  const results = await Promise.allSettled([changeBooking(deps, f.actor, "reschedule", move()), changeBooking(deps, actor, "reschedule", move())]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(results.find(r => r.status === "rejected")).toMatchObject({ reason: { code: "SLOT_UNAVAILABLE" } });
});
it("rolls back time, version, history and command id if event insertion fails", async () => {
  const f = await setup(); const command = move();
  await database.adminPool.query("ALTER TABLE slotly.booking_events ADD CONSTRAINT stage7_reject_event CHECK (type <> 'rescheduled') NOT VALID");
  try { await expect(changeBooking(deps, f.actor, "reschedule", command)).rejects.toBeDefined(); }
  finally { await database.adminPool.query("ALTER TABLE slotly.booking_events DROP CONSTRAINT stage7_reject_event"); }
  expect((await getGuestBooking(deps, { token: f.token })).version).toBe(1); expect(await events(f.booking.id)).toHaveLength(1);
  expect((await changeBooking(deps, f.actor, "reschedule", command)).version).toBe(2);
});
it("maps a last-moment PostgreSQL exclusion conflict and rolls back the injected blocker", async () => {
  const f = await setup();
  await database.adminPool.query(`CREATE FUNCTION slotly.stage7_race() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN
    IF OLD.id = '${f.occupancy.id}'::uuid AND NEW.start_at <> OLD.start_at THEN
      INSERT INTO slotly.occupancies(organizer_id,kind,start_at,end_at,busy_start_at,busy_end_at) VALUES(NEW.organizer_id,'manual',NEW.start_at,NEW.end_at,NEW.start_at,NEW.end_at);
    END IF; RETURN NEW; END $body$`);
  await database.adminPool.query("CREATE TRIGGER stage7_race BEFORE UPDATE ON slotly.occupancies FOR EACH ROW EXECUTE FUNCTION slotly.stage7_race()");
  try { await expect(changeBooking(deps, f.actor, "reschedule", move())).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" }); }
  finally { await database.adminPool.query("DROP TRIGGER stage7_race ON slotly.occupancies"); await database.adminPool.query("DROP FUNCTION slotly.stage7_race()"); }
  expect((await getGuestBooking(deps, { token: f.token })).version).toBe(1);
  expect((await db.select().from(schema.occupancies).where(eq(schema.occupancies.organizerId, f.organizer.id)))).toHaveLength(1);
  expect(await events(f.booking.id)).toHaveLength(1);
});
it("checks the clock again after waiting for the organizer lock", async () => {
  const f = await setup(); now = new Date("2027-01-04T08:00:00Z");
  const holding = await database.pool.connect();
  await holding.query("BEGIN"); await holding.query("SELECT id FROM slotly.organizers WHERE id=$1 FOR UPDATE", [f.organizer.id]);
  const pending = changeBooking(deps, f.actor, "cancel", cancel());
  const checked = expect(pending).rejects.toMatchObject({ code: "CHANGE_NOT_ALLOWED" });
  try { await new Promise(resolve => setTimeout(resolve, 50)); now = new Date("2027-01-04T08:00:00.001Z"); await holding.query("COMMIT"); await checked; }
  finally { await holding.query("ROLLBACK"); holding.release(); }
  expect(await events(f.booking.id)).toHaveLength(1);
});
it("keeps cancelled meetings terminal and replays the original cancellation without duplicates", async () => {
  const f = await setup(); const command = cancel(); await changeBooking(deps, f.actor, "cancel", command);
  expect((await changeBooking(deps, f.actor, "cancel", command)).version).toBe(2);
  await expect(changeBooking(deps, f.actor, "reschedule", move(undefined, 2))).rejects.toMatchObject({ code: "CHANGE_NOT_ALLOWED" });
  await expect(changeBooking(deps, f.actor, "cancel", cancel(2))).rejects.toMatchObject({ code: "CHANGE_NOT_ALLOWED" });
  expect(await events(f.booking.id)).toHaveLength(2);
});
it("expires participant access thirty days after the actual meeting end", async () => {
  const f = await setup(); now = new Date(f.occupancy.endAt.getTime() + 30 * 86_400_000 + 1);
  await expect(getGuestBooking(deps, { token: f.token })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await getManagedBooking(deps, f.owner)).id).toBe(f.booking.id);
});
it("preserves the two real instants of a repeated local DST hour when rescheduling", async () => {
  const f = await setup({ start: "2027-11-07T05:00:00Z" }); now = new Date("2027-11-06T00:00:00Z");
  await saveSchedule(db, f.organizer.id, { version: 2, timezone: "America/New_York", weekly: [{ weekday: 7, startMinute: 60, endMinute: 180 }], overrides: [] });
  const slots = await getRescheduleSlots(deps, f.actor, { date: "2027-11-07", timezone: "America/New_York" });
  expect(slots.hasOffsetChange).toBe(true); expect(slots.slots.map(s => s.startAt)).toContain("2027-11-07T06:00:00.000Z");
  expect((await changeBooking(deps, f.actor, "reschedule", move("2027-11-07T06:00:00.000Z"))).startAt).toBe("2027-11-07T06:00:00.000Z");
});
it("requires exact Origin, JSON, strict bodies and hides forged-link data", async () => {
  const f = await setup();
  expect((await guestHttp("read", { token: f.token }, { origin: "https://unexpected.invalid" })).status).toBe(403);
  expect((await guestHttp("read", { token: f.token }, { "content-type": "text/plain" })).status).toBe(415);
  expect((await guestHttp("read", { token: f.token, ownerId: randomUUID() })).status).toBe(400);
  const response = await guestHttp("read", { token: createManagementToken(secret + "x", f.booking) }); expect(response.status).toBe(404); expect(await response.text()).not.toContain(f.booking.guestEmail);
  expect((await guestHttp("cancel", { ...cancel(), token: f.token, reason: "x".repeat(9000) })).status).toBe(413);
  const good = await guestHttp("read", { token: f.token }); expect(good.status).toBe(200); expect(good.headers.get("cache-control")).toBe("private, no-store");
});
it("throttles invalid capability attempts without trusting spoofed forwarding headers", async () => {
  const f = await setup(); const forged = createManagementToken(secret + "x", f.booking);
  const key = (await import("../../src/modules/guest-booking/crypto")).guestDigest(secret, "rate-key", "management-ip:127.0.0.1");
  await db.insert(schema.guestRateLimits).values({ key, count: 120, expiresAt: new Date(now.getTime() + 600_000) });
  const response = await guestHttp("read", { token: forged }, { "x-forwarded-for": "203.0.113.55" }); expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("600");
});
it("authorizes organizer reads and cancellations through a real verified session", async () => {
  const f = await setup(), other = await setup(); const password = "Management-test-password-47!";
  await db.insert(schema.authAccounts).values({ userId: f.organizer.userId!, accountId: f.organizer.userId!, providerId: "credential", password: await hashPassword(password) });
  const [user] = await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, f.organizer.userId!));
  const login = await handleIdentityRequest(auth, new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email: user!.email, password }) }), origin);
  expect(login.status).toBe(200); const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const request = (id: string, operation: "read" | "cancel", withCookie = true) => handleOrganizerBooking({ ...deps, auth, appUrl: origin }, new Request(origin + `/api/organizer/bookings/${id}`, { method: operation === "read" ? "GET" : "POST", headers: { origin, "content-type": "application/json", ...(withCookie ? { cookie } : {}) }, ...(operation === "cancel" ? { body: JSON.stringify(cancel(1, "Изменились планы")) } : {}) }), id, operation);
  expect((await request(f.booking.id, "read", false)).status).toBe(401); expect((await request(other.booking.id, "read")).status).toBe(404);
  expect((await request(f.booking.id, "read")).status).toBe(200); expect((await request(f.booking.id, "cancel")).status).toBe(200);
  expect((await events(f.booking.id))[1]).toMatchObject({ actor: "organizer", reason: "Изменились планы" });
});

import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as schema from "../../src/server/db/schema";
import type { Database } from "../../src/server/db/types";
import type { LocalMail } from "../../src/server/mail/local";
import { createTestDatabase } from "../helpers/database";
import { fixture, insertOccupancy } from "../helpers/domain";
import { saveSchedule } from "../../src/modules/availability/service";
import { getPublicAvailability } from "../../src/modules/availability/public-service";
import { changePageState, updatePage } from "../../src/modules/booking-pages/service";
import { pageDefaults } from "../../src/modules/booking-pages/validation";
import { confirmGuestBooking, pruneGuestData, requestGuestCode, type GuestBookingDependencies } from "../../src/modules/guest-booking/service";
import { getBookingList } from "../../src/modules/organizers/dashboard-service";
import { handleGuestBooking } from "../../src/modules/guest-booking/http";
import { guestDigest } from "../../src/modules/guest-booking/crypto";
import type { CodeChallenge } from "../../src/modules/guest-booking/contract";

let database: Awaited<ReturnType<typeof createTestDatabase>>; let db: Database;
const secret = randomBytes(32).toString("hex"); const ip = "127.0.0.1"; const origin = "http://localhost:3000";
let time: Date; let deliveryFails = false;
const mail = new Map<string, LocalMail>();
let deps: GuestBookingDependencies;
beforeAll(async () => { database = await createTestDatabase({ restricted: true }); db = drizzle(database.pool, { schema });
  deps = { database: db, secret, clock: () => time, sendMail: async (message) => { if (deliveryFails) throw new Error("private-mail-failure"); mail.set(message.messageId!, message); } };
});
beforeEach(async () => { time = new Date("2027-01-04T06:00:00Z"); deliveryFails = false; mail.clear(); await db.delete(schema.guestRateLimits); });
afterAll(async () => { await database?.close(); });
async function configured() {
  const f = await fixture(database.pool);
  await saveSchedule(db, f.organizer.id, { version: 1, timezone: "UTC", weekly: Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, startMinute: 540, endMinute: 1020 })), overrides: [] });
  return f;
}
const input = (email = `${randomUUID()}@example.invalid`) => ({ requestId: randomUUID(), name: " Гость ", email, timezone: "Europe/Minsk", startAt: "2027-01-04T09:00:00.000Z", endAt: "2027-01-04T09:30:00.000Z" });
function code(challenge: CodeChallenge) {
  const result = mail.get(challenge.challengeId)?.text.match(/Ваш код: ([0-9]{6})/u)?.[1]; if (!result) throw new Error("Expected intercepted OTP"); return result;
}
const confirm = (publicId: string, challenge: CodeChallenge, pin = code(challenge)) => confirmGuestBooking(deps, publicId, { challengeId: challenge.challengeId, code: pin }, ip);
async function counts(owner: string) {
  const result = await database.pool.query("SELECT (SELECT count(*)::int FROM slotly.bookings WHERE organizer_id=$1) AS bookings,(SELECT count(*)::int FROM slotly.occupancies WHERE organizer_id=$1) AS occupancies,(SELECT count(*)::int FROM slotly.booking_events WHERE organizer_id=$1) AS events", [owner]); return result.rows[0];
}
function http(publicId: string, operation: "code" | "confirm", body: unknown, headers: Record<string, string> = {}) {
  return handleGuestBooking(deps, new Request(`${origin}/api/guest-bookings/${publicId}/${operation}`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) }), publicId, operation, origin);
}

it("issues an expiring code without a guest account, hold or plaintext database code", async () => {
  const f = await configured(); const before = await db.select().from(schema.authUsers); const data = input(" GUEST@EXAMPLE.INVALID ");
  const challenge = await requestGuestCode(deps, f.page.publicId, data, ip);
  expect(Object.keys(challenge).sort()).toEqual(["challengeId", "expiresAt", "quote", "resendAt"]);
  expect(Object.keys(challenge.quote).sort()).toEqual(["cancelCutoffMinutes", "durationMinutes", "location", "rescheduleCutoffMinutes", "title"]);
  expect(Date.parse(challenge.expiresAt) - time.getTime()).toBe(600_000);
  const [row] = await db.select().from(schema.guestChallenges).where(eq(schema.guestChallenges.id, challenge.challengeId));
  expect(row!.guestEmail).toBe("guest@example.invalid"); expect(row!.guestName).toBe("Гость");
  expect(row!.codeHash).toHaveLength(64); expect(row!.codeHash).not.toBe(code(challenge)); expect(row!.sealedCode).not.toBe(code(challenge));
  expect(row!.sentAt).not.toBeNull(); expect(row!.consumedAt).toBeNull();
  expect(await counts(f.organizer.id)).toEqual({ bookings: 0, occupancies: 0, events: 0 });
  expect(await db.select().from(schema.authUsers)).toEqual(before);
});
it("replays an identical code request but rejects reuse with different contact data", async () => {
  const f = await configured(); const data = input();
  const a = await requestGuestCode(deps, f.page.publicId, data, ip);
  expect(await requestGuestCode(deps, f.page.publicId, data, ip)).toEqual(a);
  expect(mail.size).toBe(1);
  await expect(requestGuestCode(deps, f.page.publicId, { ...data, email: "different@example.invalid" }, ip)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  expect((await db.select().from(schema.guestChallenges).where(eq(schema.guestChallenges.organizerId, f.organizer.id)))).toHaveLength(1);
});
it("atomically creates one occupancy, immutable booking snapshot and creation event", async () => {
  const f = await configured(); const data = input(); const challenge = await requestGuestCode(deps, f.page.publicId, data, ip);
  const receipt = await confirm(f.page.publicId, challenge);
  expect(receipt).toMatchObject({ startAt: data.startAt, endAt: data.endAt, status: "confirmed", guestName: "Гость", guestEmail: data.email, timezone: data.timezone });
  expect(await counts(f.organizer.id)).toEqual({ bookings: 1, occupancies: 1, events: 1 });
  const [booked] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, receipt.id));
  expect(booked!.emailVerifiedAt).toEqual(time); expect(booked!.titleSnapshot).toBe(f.page.title); expect(booked!.cancelCutoffMinutes).toBe(120);
  const [challengeRow] = await db.select().from(schema.guestChallenges).where(eq(schema.guestChallenges.id, challenge.challengeId));
  expect(challengeRow!.bookingId).toBe(receipt.id); expect(challengeRow!.consumedAt).toEqual(time);
  expect((await getPublicAvailability(db, f.page.publicId, { date: "2027-01-04", timezone: "UTC" }, time)).slots.map((s) => s.startAt)).not.toContain(data.startAt);
});
it("commits failed attempts and allows at most five guesses under concurrent requests", async () => {
  const f = await configured(); const challenge = await requestGuestCode(deps, f.page.publicId, input(), ip); const actual = code(challenge);
  const wrong = actual === "000000" ? "000001" : "000000";
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => confirm(f.page.publicId, challenge, wrong)));
  expect(results.every((r) => r.status === "rejected")).toBe(true);
  expect((await db.select().from(schema.guestChallenges).where(eq(schema.guestChallenges.id, challenge.challengeId)))[0]!.attempts).toBe(5);
  await expect(confirm(f.page.publicId, challenge)).rejects.toMatchObject({ code: "INVALID_CODE" });
  expect((await counts(f.organizer.id)).bookings).toBe(0);
});
it("rejects the exact expiration boundary", async () => {
  const f = await configured(); const challenge = await requestGuestCode(deps, f.page.publicId, input(), ip);
  time = new Date(challenge.expiresAt); await expect(confirm(f.page.publicId, challenge)).rejects.toMatchObject({ code: "INVALID_CODE" });
});
it("binds a challenge to its page and rejects unknown ids", async () => {
  const f = await configured(); const other = await configured(); const challenge = await requestGuestCode(deps, f.page.publicId, input(), ip);
  await expect(confirm(other.page.publicId, challenge)).rejects.toMatchObject({ code: "INVALID_CODE" });
  await expect(confirmGuestBooking(deps, f.page.publicId, { challengeId: randomUUID(), code: "123456" }, ip)).rejects.toMatchObject({ code: "INVALID_CODE" });
  expect((await db.select().from(schema.guestChallenges).where(eq(schema.guestChallenges.id, challenge.challengeId)))[0]!.attempts).toBe(0);
});
it("enforces resend cooldown, invalidates only the previous challenge, and accepts the new code", async () => {
  const f = await configured(); const data = input(); const first = await requestGuestCode(deps, f.page.publicId, data, ip);
  const again = { ...data, requestId: randomUUID(), previousChallengeId: first.challengeId };
  await expect(requestGuestCode(deps, f.page.publicId, again, ip)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfter: 60 });
  time = new Date(time.getTime() + 60_000); const second = await requestGuestCode(deps, f.page.publicId, again, ip);
  expect(second.challengeId).not.toBe(first.challengeId);
  await expect(confirm(f.page.publicId, first)).rejects.toMatchObject({ code: "INVALID_CODE" });
  expect((await confirm(f.page.publicId, second)).status).toBe("confirmed");
});
it("does not invalidate another independent flow just because the email matches", async () => {
  const f = await configured(); const data = input(); const first = await requestGuestCode(deps, f.page.publicId, data, ip);
  time = new Date(time.getTime() + 60_000);
  await requestGuestCode(deps, f.page.publicId, { ...data, requestId: randomUUID() }, ip);
  expect((await confirm(f.page.publicId, first)).status).toBe("confirmed");
});
it("retries confirmation after a lost response without creating a second booking", async () => {
  const f = await configured(); const challenge = await requestGuestCode(deps, f.page.publicId, input(), ip);
  const results = await Promise.all([confirm(f.page.publicId, challenge), confirm(f.page.publicId, challenge)]);
  expect(results[0]).toEqual(results[1]); expect(await counts(f.organizer.id)).toEqual({ bookings: 1, occupancies: 1, events: 1 });
  await changePageState(db, f.organizer.id, f.page.id, { version: 1, state: "archived" });
  time = new Date(time.getTime() + 3_600_000); expect(await confirm(f.page.publicId, challenge)).toEqual(results[0]);
});
it("returns the original confirmation description for calendar export even after editing the page", async () => {
  const f = await configured();
  await updatePage(db, f.organizer.id, f.page.id, { ...pageDefaults, title: "Консультация", description: "Исходное описание", version: 1 });
  const challenge = await requestGuestCode(deps, f.page.publicId, input(), ip);
  const first = await confirm(f.page.publicId, challenge);
  expect(first.description).toBe("Исходное описание");
  await updatePage(db, f.organizer.id, f.page.id, { ...pageDefaults, title: "Другое название", description: "Новое описание", version: 2 });
  const replay = await confirm(f.page.publicId, challenge);
  expect(replay.description).toBe("Исходное описание"); expect(replay.id).toBe(first.id);
});
it("lets exactly one of two verified guests book the same time", async () => {
  const f = await configured(); const a = await requestGuestCode(deps, f.page.publicId, input(), ip); const b = await requestGuestCode(deps, f.page.publicId, input(), ip);
  const results = await Promise.allSettled([confirm(f.page.publicId, a), confirm(f.page.publicId, b)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "SLOT_UNAVAILABLE" } });
  expect(await counts(f.organizer.id)).toEqual({ bookings: 1, occupancies: 1, events: 1 });
});
it.each(["page", "schedule", "paused"])("rechecks current %s conditions after code delivery", async (kind) => {
  const f = await configured(); const challenge = await requestGuestCode(deps, f.page.publicId, input(), ip);
  if (kind === "page") await updatePage(db, f.organizer.id, f.page.id, { ...pageDefaults, title: "Изменённая встреча", version: 1 });
  if (kind === "schedule") await saveSchedule(db, f.organizer.id, { version: 2, timezone: "Europe/Minsk", weekly: [{ weekday: 1, startMinute: 540, endMinute: 1020 }], overrides: [] });
  if (kind === "paused") await changePageState(db, f.organizer.id, f.page.id, { version: 1, state: "paused" });
  await expect(confirm(f.page.publicId, challenge)).rejects.toMatchObject({ code: kind === "paused" ? "NOT_FOUND" : "CONDITIONS_CHANGED" });
  expect((await counts(f.organizer.id)).bookings).toBe(0);
});
it("rechecks occupied time after issuing a code", async () => {
  const f = await configured(); const challenge = await requestGuestCode(deps, f.page.publicId, input(), ip);
  await insertOccupancy(database.pool, f, { kind: "manual", start: "2027-01-04T09:00:00Z" });
  await expect(confirm(f.page.publicId, challenge)).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  expect(await counts(f.organizer.id)).toEqual({ bookings: 0, occupancies: 1, events: 0 });
});
it("rolls back the booking, occupancy and code consumption if history insertion fails", async () => {
  const f = await configured(); const challenge = await requestGuestCode(deps, f.page.publicId, input(), ip);
  await database.adminPool.query("ALTER TABLE slotly.booking_events ADD CONSTRAINT test_reject_created CHECK (type <> 'created') NOT VALID");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await http(f.page.publicId, "confirm", { challengeId: challenge.challengeId, code: code(challenge) });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "SERVICE_UNAVAILABLE" });
    expect(await counts(f.organizer.id)).toEqual({ bookings: 0, occupancies: 0, events: 0 });
    expect((await db.select().from(schema.guestChallenges).where(eq(schema.guestChallenges.id, challenge.challengeId)))[0]!.bookingId).toBeNull();
  } finally { await database.adminPool.query("ALTER TABLE slotly.booking_events DROP CONSTRAINT test_reject_created"); log.mockRestore(); }
  expect((await confirm(f.page.publicId, challenge)).status).toBe("confirmed");
});
it("maps a last-moment PostgreSQL exclusion failure and leaves the code unconsumed", async () => {
  const f = await configured(); const challenge = await requestGuestCode(deps, f.page.publicId, input(), ip);
  await database.adminPool.query("CREATE FUNCTION slotly.test_race_block() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='booking' THEN INSERT INTO slotly.occupancies(organizer_id,kind,start_at,end_at,busy_start_at,busy_end_at) VALUES (NEW.organizer_id,'manual',NEW.start_at,NEW.end_at,NEW.start_at,NEW.end_at); END IF; RETURN NEW; END; $$");
  await database.adminPool.query("CREATE TRIGGER test_race_block BEFORE INSERT ON slotly.occupancies FOR EACH ROW EXECUTE FUNCTION slotly.test_race_block()");
  try {
    await expect(confirm(f.page.publicId, challenge)).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE", status: 409 });
    expect(await counts(f.organizer.id)).toEqual({ bookings: 0, occupancies: 0, events: 0 });
  } finally { await database.adminPool.query("DROP TRIGGER test_race_block ON slotly.occupancies"); await database.adminPool.query("DROP FUNCTION slotly.test_race_block()"); }
  expect((await confirm(f.page.publicId, challenge)).status).toBe("confirmed");
});
it("recovers a failed delivery with the same request, challenge and code", async () => {
  const f = await configured(); const data = input(); deliveryFails = true;
  await expect(requestGuestCode(deps, f.page.publicId, data, ip)).rejects.toThrow("private-mail-failure");
  const [before] = await db.select().from(schema.guestChallenges).where(eq(schema.guestChallenges.requestId, data.requestId));
  expect(before!.sentAt).toBeNull(); deliveryFails = false;
  const challenge = await requestGuestCode(deps, f.page.publicId, data, ip);
  expect(challenge.challengeId).toBe(before!.id);
  expect((await db.select().from(schema.guestChallenges).where(eq(schema.guestChallenges.id, challenge.challengeId)))[0]!.codeHash).toBe(before!.codeHash);
  expect((await confirm(f.page.publicId, challenge)).status).toBe("confirmed");
});
it("limits a recipient across IP addresses without extending the cooldown window", async () => {
  const f = await configured(); const data = input();
  for (let i = 0; i < 5; i++) {
    await requestGuestCode(deps, f.page.publicId, { ...data, requestId: randomUUID() }, `192.0.2.${i}`);
    time = new Date(time.getTime() + 60_000);
  }
  await expect(requestGuestCode(deps, f.page.publicId, { ...data, requestId: randomUUID() }, "198.51.100.1")).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfter: 3300 });
});
it("does not trust spoofed forwarding headers and persists concurrent IP limits", async () => {
  const f = await configured(); const data = input(); await requestGuestCode(deps, f.page.publicId, data, ip);
  await db.update(schema.guestRateLimits).set({ count: 59 }).where(eq(schema.guestRateLimits.key, guestDigest(secret, "rate-key", `send-ip:${ip}`)));
  const responses = await Promise.all([http(f.page.publicId, "code", data, { "x-forwarded-for": "192.0.2.1" }), http(f.page.publicId, "code", data, { "x-forwarded-for": "192.0.2.2" })]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 429]); expect(responses.find((r) => r.status === 429)!.headers.get("retry-after")).toBe("3600");
});
it("validates Origin, JSON, body size and strict guest inputs before sending mail", async () => {
  const f = await configured(); const data = input();
  expect((await http(f.page.publicId, "code", data, { origin: "https://untrusted.invalid" })).status).toBe(403);
  expect((await http(f.page.publicId, "code", data, { "content-type": "text/plain" })).status).toBe(415);
  expect((await http(f.page.publicId, "code", { data: "x".repeat(9000) })).status).toBe(413);
  expect((await http(f.page.publicId, "code", { ...data, organizerId: f.organizer.id })).status).toBe(400);
  expect((await http(f.page.publicId, "confirm", { challengeId: randomUUID(), code: "123456", emailVerified: true })).status).toBe(400);
  expect(mail.size).toBe(0);
});
it("keeps both occurrences of a repeated hour as distinct bookings with elapsed duration", async () => {
  const f = await configured(); time = new Date("2026-10-31T00:00:00Z");
  await saveSchedule(db, f.organizer.id, { version: 2, timezone: "America/New_York", weekly: [{ weekday: 7, startMinute: 60, endMinute: 180 }], overrides: [] });
  for (const startAt of ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"]) {
    const endAt = new Date(Date.parse(startAt) + 30 * 60_000).toISOString();
    const challenge = await requestGuestCode(deps, f.page.publicId, { ...input(), timezone: "America/New_York", startAt, endAt }, ip);
    const receipt = await confirm(f.page.publicId, challenge); expect(receipt.startAt).toBe(startAt); expect(receipt.endAt).toBe(endAt);
  }
  expect(await counts(f.organizer.id)).toEqual({ bookings: 2, occupancies: 2, events: 2 });
});
it("exposes upcoming bookings only to the requested owner through the internal read service", async () => {
  const a = await configured(); const b = await configured(); const c = await requestGuestCode(deps, a.page.publicId, input(), ip); const booked = await confirm(a.page.publicId, c);
  expect((await getBookingList(db, a.organizer.id, {}, time)).items.map((r) => r.id)).toEqual([booked.id]);
  expect((await getBookingList(db, b.organizer.id, {}, time)).items).toEqual([]);
});
it("prunes expired verification secrets while preserving the complete booking history", async () => {
  const f = await configured(); const c = await requestGuestCode(deps, f.page.publicId, input(), ip); await confirm(f.page.publicId, c);
  time = new Date(time.getTime() + 48 * 3_600_000); await pruneGuestData(db, time);
  expect(await db.select().from(schema.guestChallenges).where(and(eq(schema.guestChallenges.id, c.challengeId), eq(schema.guestChallenges.organizerId, f.organizer.id)))).toEqual([]);
  expect(await counts(f.organizer.id)).toEqual({ bookings: 1, occupancies: 1, events: 1 });
});

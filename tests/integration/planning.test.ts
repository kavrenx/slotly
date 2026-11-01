import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { hashPassword } from "better-auth/crypto";
import * as schema from "../../src/server/db/schema";
import type { Database } from "../../src/server/db/types";
import { parseIdentityEnv } from "../../src/server/config/schema";
import { loadEnvironment } from "../../scripts/lib/environment";
import { createTestDatabase, transaction } from "../helpers/database";
import { fixture, insertCompleteBooking } from "../helpers/domain";
import { createOrganizerAuth, type OrganizerAuth } from "../../src/modules/identity/auth";
import { handleIdentityRequest } from "../../src/modules/identity/http";
import { handlePlanningRequest, type PlanningResource } from "../../src/modules/organizers/planning-http";
import { getSchedule, saveSchedule } from "../../src/modules/availability/service";
import { changePageState, createPage, getPage, getPublicPage, listPages, updatePage } from "../../src/modules/booking-pages/service";
import { pageDefaults, pageInput } from "../../src/modules/booking-pages/validation";

const origin = "http://localhost:3000";
const password = "Planning-test-password-47";
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
let auth: OrganizerAuth;
let passwordHash: string;
beforeAll(async () => {
  database = await createTestDatabase(); db = drizzle(database.pool, { schema });
  passwordHash = await hashPassword(password);
  auth = createOrganizerAuth(db, parseIdentityEnv({ ...loadEnvironment(), NODE_ENV: "test", APP_URL: origin, BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), MAIL_TRANSPORT: "local" }), async () => {});
});
beforeEach(async () => { await database.pool.query("DELETE FROM slotly.auth_rate_limits"); });
afterAll(async () => { await database?.close(); });
async function owner(verified = true) {
  const userId = randomUUID(); const email = `${userId}@example.invalid`;
  await db.insert(schema.authUsers).values({ id: userId, name: "Planning organizer", email, emailVerified: verified });
  await db.insert(schema.authAccounts).values({ userId, accountId: userId, providerId: "credential", password: passwordHash });
  const [organizer] = await db.select().from(schema.organizers).where(eq(schema.organizers.userId, userId));
  return { id: organizer!.id, userId, email };
}
async function session(email: string) {
  const response = await handleIdentityRequest(auth, new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }), origin);
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ");
}
function api(resource: PlanningResource, method: string, cookie: string, body?: unknown, headers: Record<string, string> = {}) {
  const request = new Request(origin + "/api/organizer/test", { method, headers: { origin, "content-type": "application/json", cookie, ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return handlePlanningRequest({ database: db, auth, appUrl: origin }, request, resource);
}
const baseSchedule = () => ({ version: 0, timezone: "Europe/Minsk", weekly: [{ weekday: 1, startMinute: 540, endMinute: 1020 }], overrides: [] });
const newPage = () => ({ ...pageDefaults, title: "Встреча" });
const settings = (page: Awaited<ReturnType<typeof getPage>>) => pageInput.parse(Object.fromEntries(Object.keys(pageDefaults).map((key) => [key, page[key as keyof typeof pageDefaults]])));

it("does not create a schedule or page as a side effect of reading", async () => {
  const a = await owner();
  expect(await getSchedule(db, a.id)).toBeNull(); expect(await listPages(db, a.id)).toEqual([]);
  expect((await database.pool.query("SELECT id FROM slotly.schedules WHERE organizer_id=$1", [a.id])).rowCount).toBe(0);
  await expect(createPage(db, a.id, newPage())).rejects.toMatchObject({ code: "SCHEDULE_REQUIRED" });
});
it("saves complete schedules atomically and preserves local values across DST dates", async () => {
  const a = await owner();
  const payload = { ...baseSchedule(), timezone: "America/New_York", overrides: [
    { localDate: "2026-03-08", mode: "replace", windows: [{ startMinute: 150, endMinute: 210 }] },
    { localDate: "2026-11-01", mode: "closed", windows: [] },
  ] };
  expect(await saveSchedule(db, a.id, payload)).toEqual({ ...payload, version: 1 });
  expect(await getSchedule(db, a.id)).toEqual({ ...payload, version: 1 });
  const next = { ...payload, version: 1, timezone: "Europe/Berlin", overrides: [{ localDate: "2026-11-01", mode: "replace", windows: [{ startMinute: 0, endMinute: 1440 }] }] };
  await saveSchedule(db, a.id, next);
  expect(await getSchedule(db, a.id)).toEqual({ ...next, version: 2 });
});
it("rolls back all settings if a database write fails after deletion of old windows", async () => {
  const a = await owner(); const initial = await saveSchedule(db, a.id, baseSchedule());
  await database.pool.query("ALTER TABLE slotly.weekly_windows ADD CONSTRAINT test_reject_window CHECK (start_minute <> 777) NOT VALID");
  try {
    await expect(saveSchedule(db, a.id, { ...initial, timezone: "UTC", weekly: [{ weekday: 2, startMinute: 777, endMinute: 800 }] })).rejects.toBeDefined();
    expect(await getSchedule(db, a.id)).toEqual(initial);
  } finally { await database.pool.query("ALTER TABLE slotly.weekly_windows DROP CONSTRAINT test_reject_window"); }
});
it("allows only one concurrent creation or edit at a given schedule version", async () => {
  const a = await owner();
  for (const version of [0, 1]) {
    const results = await Promise.allSettled([saveSchedule(db, a.id, { ...baseSchedule(), version }), saveSchedule(db, a.id, { ...baseSchedule(), version, timezone: "UTC" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "VERSION_CONFLICT" } });
  }
  expect((await getSchedule(db, a.id))?.version).toBe(2);
});
it("uses the same schedule for several independent pages", async () => {
  const a = await owner(); await saveSchedule(db, a.id, baseSchedule());
  const first = await createPage(db, a.id, newPage()); const second = await createPage(db, a.id, { ...newPage(), title: "Урок", durationMinutes: 60 });
  expect(first.state).toBe("draft"); expect(first.version).toBe(1); expect(first.publicId).not.toBe(second.publicId);
  const rows = await database.pool.query("SELECT schedule_id FROM slotly.booking_pages WHERE organizer_id=$1", [a.id]);
  expect(new Set(rows.rows.map((r) => r.schedule_id)).size).toBe(1);
  const edited = await updatePage(db, a.id, first.id, { ...settings(first), version: first.version, durationMinutes: 45 });
  expect(edited.version).toBe(2); expect((await getPage(db, a.id, second.id)).durationMinutes).toBe(60);
});
it("prevents another owner from reading, editing or publishing a page", async () => {
  const a = await owner(); const b = await owner(); await saveSchedule(db, a.id, baseSchedule());
  const page = await createPage(db, a.id, newPage());
  await expect(getPage(db, b.id, page.id)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  await expect(updatePage(db, b.id, page.id, { ...newPage(), version: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(changePageState(db, b.id, page.id, { version: 1, state: "published" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await listPages(db, b.id)).toEqual([]); expect((await getPage(db, a.id, page.id)).version).toBe(1);
});
it("exposes only published pages, retains their link and makes archiving terminal", async () => {
  const a = await owner(); await saveSchedule(db, a.id, baseSchedule());
  let page = await createPage(db, a.id, newPage());
  await expect(getPublicPage(db, page.publicId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  page = await changePageState(db, a.id, page.id, { version: page.version, state: "published" });
  const publicData = await getPublicPage(db, page.publicId);
  expect(Object.keys(publicData).sort()).toEqual(["description", "durationMinutes", "location", "organizerName", "timezone", "title"]);
  const publicId = page.publicId;
  page = await changePageState(db, a.id, page.id, { version: page.version, state: "paused" });
  await expect(getPublicPage(db, publicId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  page = await changePageState(db, a.id, page.id, { version: page.version, state: "published" });
  expect(page.publicId).toBe(publicId); expect((await getPublicPage(db, publicId)).title).toBe(page.title);
  page = await changePageState(db, a.id, page.id, { version: page.version, state: "archived" });
  await expect(getPublicPage(db, publicId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(changePageState(db, a.id, page.id, { version: page.version, state: "published" })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  await expect(updatePage(db, a.id, page.id, { ...newPage(), version: page.version })).rejects.toMatchObject({ code: "ARCHIVED_PAGE" });
});
it("requires working hours for publishing and accepts an override-only schedule", async () => {
  const a = await owner(); await saveSchedule(db, a.id, { ...baseSchedule(), weekly: [] });
  const page = await createPage(db, a.id, newPage());
  await expect(changePageState(db, a.id, page.id, { version: 1, state: "published" })).rejects.toMatchObject({ code: "SCHEDULE_EMPTY" });
  expect((await getPage(db, a.id, page.id)).version).toBe(1);
  await saveSchedule(db, a.id, { ...baseSchedule(), version: 1, weekly: [], overrides: [{ localDate: "2027-01-04", mode: "replace", windows: [{ startMinute: 540, endMinute: 600 }] }] });
  expect((await changePageState(db, a.id, page.id, { version: 1, state: "published" })).state).toBe("published");
});
it("rejects concurrent page edits and state changes instead of losing an update", async () => {
  const a = await owner(); await saveSchedule(db, a.id, baseSchedule()); const page = await createPage(db, a.id, newPage());
  const results = await Promise.allSettled([updatePage(db, a.id, page.id, { ...newPage(), version: 1, title: "Новое название" }), changePageState(db, a.id, page.id, { version: 1, state: "published" })]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "VERSION_CONFLICT" } });
  expect((await getPage(db, a.id, page.id)).version).toBe(2);
});
it("preserves existing booking time, conditions and history when settings change or a page is archived", async () => {
  const f = await fixture(database.pool);
  const existing = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  const snapshot = async () => ({
    occupancy: (await database.pool.query("SELECT * FROM slotly.occupancies WHERE id=$1", [existing.occupancy.id])).rows,
    booking: (await database.pool.query("SELECT * FROM slotly.bookings WHERE id=$1", [existing.booking.id])).rows,
    events: (await database.pool.query("SELECT * FROM slotly.booking_events WHERE booking_id=$1 ORDER BY version", [existing.booking.id])).rows,
  });
  const before = await snapshot();
  await saveSchedule(db, f.organizer.id, { ...baseSchedule(), version: 1, timezone: "America/New_York", weekly: [] });
  await updatePage(db, f.organizer.id, f.page.id, { ...newPage(), version: 1, title: "Новая встреча", durationMinutes: 60, bufferBeforeMinutes: 20, cancelCutoffMinutes: 300 });
  await changePageState(db, f.organizer.id, f.page.id, { version: 2, state: "archived" });
  expect(await snapshot()).toEqual(before);
});
it("protects HTTP operations with a real verified session and prevents cross-owner access", async () => {
  const a = await owner(); const b = await owner(); await saveSchedule(db, a.id, baseSchedule()); const page = await createPage(db, a.id, newPage());
  const sessionA = await session(a.email); const sessionB = await session(b.email);
  expect((await api({ kind: "schedule" }, "GET", "")).status).toBe(401);
  expect((await api({ kind: "schedule" }, "GET", "slotly.session_token=forged")).status).toBe(401);
  expect((await api({ kind: "page", id: page.id }, "GET", sessionB)).status).toBe(404);
  expect((await api({ kind: "page", id: page.id }, "PUT", sessionB, { ...newPage(), version: 1 })).status).toBe(404);
  const response = await api({ kind: "page", id: page.id }, "GET", sessionA);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
  expect((await api({ kind: "schedule" }, "PUT", sessionA, { ...baseSchedule(), version: 1 }, { origin: "https://untrusted.invalid" })).status).toBe(403);
  expect((await getSchedule(db, a.id))?.version).toBe(1);
});
it("validates JSON, size and forbidden fields at the HTTP boundary", async () => {
  const a = await owner(); const sessionA = await session(a.email);
  expect((await api({ kind: "schedule" }, "PUT", sessionA, { ...baseSchedule(), organizerId: randomUUID() })).status).toBe(400);
  expect((await api({ kind: "schedule" }, "PUT", sessionA, baseSchedule(), { "content-type": "text/plain" })).status).toBe(415);
  expect((await api({ kind: "schedule" }, "PUT", sessionA, { payload: "x".repeat(70_000) })).status).toBe(413);
  expect((await handlePlanningRequest({ database: db, auth, appUrl: origin }, new Request(origin + "/api/organizer/schedule", { method: "PUT", headers: { origin, cookie: sessionA, "content-type": "application/json" }, body: "{broken" }), { kind: "schedule" })).status).toBe(400);
  expect(await getSchedule(db, a.id)).toBeNull();
  const saved = await api({ kind: "schedule" }, "PUT", sessionA, baseSchedule()); expect(saved.status).toBe(200);
  const created = await api({ kind: "pages" }, "POST", sessionA, newPage()); expect(created.status).toBe(201);
  const page = await created.json();
  expect((await api({ kind: "page", id: page.id }, "PUT", sessionA, { ...newPage(), durationMinutes: 31, version: 1 })).status).toBe(400);
  expect((await getPage(db, a.id, page.id)).durationMinutes).toBe(30);
});

it("rejects sessions after revocation or loss of verified email", async () => {
  const a = await owner(); const cookie = await session(a.email);
  expect((await api({ kind: "schedule" }, "GET", cookie)).status).toBe(200);
  await db.update(schema.authUsers).set({ emailVerified: false }).where(eq(schema.authUsers.id, a.userId));
  expect((await api({ kind: "schedule" }, "GET", cookie)).status).toBe(401);
  await db.update(schema.authUsers).set({ emailVerified: true }).where(eq(schema.authUsers.id, a.userId));
  await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, a.userId));
  expect((await api({ kind: "schedule" }, "GET", cookie)).status).toBe(401);
});

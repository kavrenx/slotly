import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as schema from "../../src/server/db/schema";
import type { Database } from "../../src/server/db/types";
import { createTestDatabase, transaction } from "../helpers/database";
import { cancelBooking, fixture, insertCompleteBooking, insertOccupancy } from "../helpers/domain";
import { saveSchedule } from "../../src/modules/availability/service";
import { getPublicAvailability } from "../../src/modules/availability/public-service";
import { handlePublicAvailability } from "../../src/modules/availability/http";
import { createPage, changePageState, updatePage } from "../../src/modules/booking-pages/service";
import { pageDefaults } from "../../src/modules/booking-pages/validation";

const now = new Date("2027-01-04T00:00:00Z");
const query = { date: "2027-01-04", timezone: "UTC" };
let database: Awaited<ReturnType<typeof createTestDatabase>>;
let db: Database;
beforeAll(async () => { database = await createTestDatabase({ restricted: true }); db = drizzle(database.pool, { schema }); });
afterAll(async () => { await database?.close(); });
async function configured() {
  const f = await fixture(database.pool);
  await saveSchedule(db, f.organizer.id, { version: 1, timezone: "UTC", weekly: [{ weekday: 1, startMinute: 540, endMinute: 720 }], overrides: [] });
  return f;
}
const starts = (data: Awaited<ReturnType<typeof getPublicAvailability>>) => data.slots.map((s) => s.startAt);
function api(publicId: string, params = new URLSearchParams(query)) {
  return handlePublicAvailability(db, new Request(`http://localhost:3000/api/availability/${publicId}?${params}`), publicId, now);
}

it("shows availability without an account and returns no private scheduling data", async () => {
  const f = await configured();
  const response = await api(f.page.publicId); expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json(); expect(body.slots).toHaveLength(11);
  expect(Object.keys(body).sort()).toEqual(["date", "generatedAt", "hasOffsetChange", "range", "slots", "timezone"]);
  expect(Object.keys(body.slots[0]).sort()).toEqual(["endAt", "startAt"]);
  expect(JSON.stringify(body)).not.toContain(f.organizer.id); expect(JSON.stringify(body)).not.toContain("@example.invalid");
});
it("subtracts saved buffers of bookings from other pages and manual blocks of the same owner", async () => {
  const f = await configured();
  const booked = await transaction(database.pool, (client) => insertCompleteBooking(client, f, { start: "2027-01-04T09:30:00Z", before: 15, after: 15 }));
  const manual = await insertOccupancy(database.pool, f, { kind: "manual", start: "2027-01-04T10:30:00Z", duration: 30 });
  let page = await createPage(db, f.organizer.id, { ...pageDefaults, title: "Другой формат" });
  page = await changePageState(db, f.organizer.id, page.id, { version: page.version, state: "published" });
  const other = await configured(); await insertOccupancy(database.pool, other, { kind: "manual", start: "2027-01-04T09:00:00Z", duration: 180 });
  const before = await getPublicAvailability(db, page.publicId, query, now);
  expect(starts(before)).toEqual(["2027-01-04T11:00:00.000Z", "2027-01-04T11:15:00.000Z", "2027-01-04T11:30:00.000Z"]);
  await transaction(database.pool, (client) => cancelBooking(client, booked.booking.id, booked.occupancy));
  const released = await getPublicAvailability(db, page.publicId, query, now);
  expect(starts(released)).toContain("2027-01-04T09:00:00.000Z"); expect(starts(released)).not.toContain("2027-01-04T10:30:00.000Z");
  await db.update(schema.occupancies).set({ version: 2, releasedAt: now }).where(eq(schema.occupancies.id, manual.id));
  expect((await getPublicAvailability(db, page.publicId, query, now)).slots).toHaveLength(11);
});
it("uses current page rules and both buffers without allowing the caller to override them", async () => {
  const f = await configured();
  await updatePage(db, f.organizer.id, f.page.id, { ...pageDefaults, title: "Длинная встреча", version: 1, durationMinutes: 60, stepMinutes: 30, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 });
  expect(starts(await getPublicAvailability(db, f.page.publicId, query, now))).toEqual(["2027-01-04T09:30:00.000Z", "2027-01-04T10:00:00.000Z", "2027-01-04T10:30:00.000Z"]);
  expect((await api(f.page.publicId, new URLSearchParams({ ...query, durationMinutes: "5" }))).status).toBe(400);
});
it("honors closed and replaced dates and groups slots in the selected viewer zone", async () => {
  const f = await configured();
  await saveSchedule(db, f.organizer.id, { version: 2, timezone: "Asia/Kathmandu", weekly: [{ weekday: 1, startMinute: 540, endMinute: 720 }], overrides: [
    { localDate: "2027-01-04", mode: "replace", windows: [{ startMinute: 30, endMinute: 90 }] },
    { localDate: "2027-01-05", mode: "closed", windows: [] },
  ] });
  const result = await getPublicAvailability(db, f.page.publicId, { date: "2027-01-03", timezone: "America/New_York" }, new Date("2027-01-03T00:00:00Z"));
  expect(starts(result)).toContain("2027-01-03T18:45:00.000Z");
  expect((await getPublicAvailability(db, f.page.publicId, { date: "2027-01-05", timezone: "Asia/Kathmandu" }, now)).slots).toEqual([]);
});
it("closes public availability for drafts, paused pages, archives and unknown links", async () => {
  const f = await configured();
  const draft = await createPage(db, f.organizer.id, { ...pageDefaults, title: "Черновик" });
  expect((await api(draft.publicId)).status).toBe(404);
  await changePageState(db, f.organizer.id, f.page.id, { version: 1, state: "paused" });
  expect((await api(f.page.publicId)).status).toBe(404);
  await changePageState(db, f.organizer.id, f.page.id, { version: 2, state: "archived" });
  expect((await api(f.page.publicId)).status).toBe(404);
  expect((await api(randomUUID())).status).toBe(404); expect((await api("malformed")).status).toBe(404);
});
it("uses server time and applies horizon limits before generating work intervals", async () => {
  const f = await configured();
  const before = await getPublicAvailability(db, f.page.publicId, query, new Date("2027-01-04T07:00:00Z"));
  expect(before.slots[0]?.startAt).toBe("2027-01-04T09:00:00.000Z");
  const after = await getPublicAvailability(db, f.page.publicId, query, new Date("2027-01-04T07:00:00.001Z"));
  expect(after.slots[0]?.startAt).toBe("2027-01-04T09:15:00.000Z");
  expect((await api(f.page.publicId, new URLSearchParams({ ...query, now: "2026-01-01" }))).status).toBe(400);
  expect((await getPublicAvailability(db, f.page.publicId, { ...query, date: "9999-12-31" }, now)).slots).toEqual([]);
});
it("never reserves, creates or changes records when calculating slots", async () => {
  const f = await configured();
  await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  const snapshot = async () => JSON.stringify({
    bookings: (await database.pool.query("SELECT * FROM slotly.bookings WHERE organizer_id=$1 ORDER BY id", [f.organizer.id])).rows,
    occupied: (await database.pool.query("SELECT * FROM slotly.occupancies WHERE organizer_id=$1 ORDER BY id", [f.organizer.id])).rows,
    events: (await database.pool.query("SELECT * FROM slotly.booking_events WHERE organizer_id=$1 ORDER BY id", [f.organizer.id])).rows,
  });
  const before = await snapshot();
  await api(f.page.publicId); await api(f.page.publicId);
  expect(await snapshot()).toBe(before);
});
it("reads one coherent snapshot while another transaction replaces settings", async () => {
  const f = await configured(); const writer = await database.pool.connect();
  try {
    await writer.query("BEGIN");
    await writer.query("SELECT id FROM slotly.organizers WHERE id=$1 FOR UPDATE", [f.organizer.id]);
    await writer.query("UPDATE slotly.schedules SET version=version+1 WHERE id=$1", [f.schedule.id]);
    await writer.query("DELETE FROM slotly.weekly_windows WHERE schedule_id=$1", [f.schedule.id]);
    expect((await getPublicAvailability(db, f.page.publicId, query, now)).slots).toHaveLength(11);
    await writer.query("COMMIT");
    expect((await getPublicAvailability(db, f.page.publicId, query, now)).slots).toEqual([]);
  } finally { await writer.query("ROLLBACK"); writer.release(); }
});
it.each([
  new URLSearchParams({ ...query, date: "2027-02-29" }),
  new URLSearchParams({ ...query, timezone: "+03:00" }),
  new URLSearchParams({ ...query, timezone: "Unknown/Timezone" }),
  new URLSearchParams({ date: query.date }),
  new URLSearchParams([["date", query.date], ["date", "2027-01-05"], ["timezone", "UTC"]]),
])("rejects malformed public queries", async (params) => {
  expect((await api(randomUUID(), params)).status).toBe(400);
});
it("sanitizes unexpected database failures", async () => {
  const fake = { transaction: async () => { throw new Error("private-database-secret"); } } as unknown as Database;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await handlePublicAvailability(fake, new Request(`http://localhost/api/availability/${randomUUID()}?${new URLSearchParams(query)}`), randomUUID(), now);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private-database-secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-database-secret");
  } finally { log.mockRestore(); }
});

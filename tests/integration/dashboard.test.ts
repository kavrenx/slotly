import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as schema from "../../src/server/db/schema";
import type { Database } from "../../src/server/db/types";
import { getBookingList, getDashboardOverview } from "../../src/modules/organizers/dashboard-service";
import { fixture, insertCompleteBooking, cancelBooking, moveBooking } from "../helpers/domain";
import { createTestDatabase, transaction } from "../helpers/database";

let test: Awaited<ReturnType<typeof createTestDatabase>>, db: Database;
const now = new Date("2027-01-04T10:15:00Z");
beforeAll(async () => { test = await createTestDatabase(); db = drizzle(test.pool, { schema }); });
afterAll(async () => { await test?.close(); });

it("includes ongoing meetings until their exact end, then places them in the past", async () => {
  const f = await fixture(test.pool); const made = await transaction(test.pool, client => insertCompleteBooking(client, f));
  const upcoming = await getBookingList(db, f.organizer.id, {}, now);
  expect(upcoming.items.map(b => b.id)).toEqual([made.booking.id]);
  const atEnd = new Date("2027-01-04T10:30:00Z");
  expect((await getBookingList(db, f.organizer.id, {}, atEnd)).items).toHaveLength(0);
  expect((await getBookingList(db, f.organizer.id, { view: "past" }, atEnd)).items.map(b => b.id)).toEqual([made.booking.id]);
});
it("isolates every view and aggregate to its organizer and separates all cancellations", async () => {
  const f = await fixture(test.pool), other = await fixture(test.pool);
  await transaction(test.pool, async client => {
    await insertCompleteBooking(client, f, { start: "2027-01-04T09:00:00Z" });
    await insertCompleteBooking(client, f, { start: "2027-01-04T10:00:00Z" });
    const future = await insertCompleteBooking(client, f, { start: "2027-01-05T10:00:00Z" });
    await cancelBooking(client, future.booking.id, future.occupancy);
    const past = await insertCompleteBooking(client, f, { start: "2027-01-03T10:00:00Z" });
    await cancelBooking(client, past.booking.id, past.occupancy);
    await insertCompleteBooking(client, other);
  });
  for (const [view, count] of [["upcoming", 1], ["past", 1], ["cancelled", 2]] as const) {
    const result = await getBookingList(db, f.organizer.id, { view }, now);
    expect(result.counts).toEqual({ upcoming: 1, past: 1, cancelled: 2 }); expect(result.items).toHaveLength(count);
  }
  expect((await getDashboardOverview(db, f.organizer.id, now)).counts).toEqual({ today: 2, upcoming: 1 });
  expect((await getBookingList(db, randomUUID(), {}, now)).counts).toEqual({ upcoming: 0, past: 0, cancelled: 0 });
});
it("paginates stably without omissions, clamps oversize pages, and retains descending history order", async () => {
  const f = await fixture(test.pool);
  await transaction(test.pool, async client => {
    // Bulk fixture avoids 75 round trips; this test exercises pagination, not
    // the already-covered booking mutation API.
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query(`insert into slotly.occupancies (organizer_id,kind,start_at,end_at,busy_start_at,busy_end_at)
      select $1,'booking',at,at+interval '30 minutes',at,at+interval '30 minutes'
      from (select '2027-01-05T10:00:00Z'::timestamptz+i*interval '30 minutes' as at from generate_series(0,24) i) times`, [f.organizer.id]);
    await client.query(`insert into slotly.bookings (organizer_id,page_id,occupancy_id,guest_name,guest_email,email_verified_at,guest_timezone,
      title_snapshot,location_snapshot,schedule_timezone_snapshot,min_notice_minutes,horizon_days,cancel_cutoff_minutes,reschedule_cutoff_minutes)
      select $1,$2,id,'Test guest','guest@example.invalid',now(),'Europe/Minsk','Test meeting','','Europe/Minsk',120,60,120,120
      from slotly.occupancies where organizer_id=$1`, [f.organizer.id, f.page.id]);
    await client.query(`insert into slotly.booking_events (booking_id,organizer_id,version,type,actor,new_start_at,new_end_at)
      select b.id,b.organizer_id,1,'created','guest',o.start_at,o.end_at from slotly.bookings b
      join slotly.occupancies o on o.id=b.occupancy_id where b.organizer_id=$1`, [f.organizer.id]);
  });
  const a = await getBookingList(db, f.organizer.id, { page: 1 }, now), b = await getBookingList(db, f.organizer.id, { page: 2 }, now);
  expect(a.items).toHaveLength(20); expect(b.items).toHaveLength(5); expect(a.totalPages).toBe(2);
  expect(new Set([...a.items, ...b.items].map(b => b.id)).size).toBe(25);
  const clamped = await getBookingList(db, f.organizer.id, { page: 1_000_000 }, now);
  expect(clamped.page).toBe(2); expect(clamped.items).toEqual(b.items);
  const history = await getBookingList(db, f.organizer.id, { view: "past" }, new Date("2027-01-10T00:00:00Z"));
  expect(history.items[0]!.id).toBe(b.items.at(-1)!.id);
  expect(history.items.every((item, i) => i === 0 || item.startAt <= history.items[i - 1]!.startAt)).toBe(true);
}, 60_000);
it("reads the current occupancy after rescheduling and cancellation without changing snapshots", async () => {
  const f = await fixture(test.pool), made = await transaction(test.pool, client => insertCompleteBooking(client, f));
  await transaction(test.pool, client => moveBooking(client, made.booking.id, made.occupancy, "2027-01-05T10:00:00Z"));
  expect((await getBookingList(db, f.organizer.id, {}, now)).items[0]!.startAt.toISOString()).toBe("2027-01-05T10:00:00.000Z");
  expect((await getDashboardOverview(db, f.organizer.id, now)).counts.today).toBe(0);
  const [occupied] = await db.select().from(schema.occupancies).where(eq(schema.occupancies.id, made.occupancy.id));
  await transaction(test.pool, client => cancelBooking(client, made.booking.id, occupied!));
  expect((await getDashboardOverview(db, f.organizer.id, now)).next).toHaveLength(0);
  expect((await getBookingList(db, f.organizer.id, { view: "cancelled" }, now)).items[0]!.id).toBe(made.booking.id);
  expect((await db.select().from(schema.bookings).where(eq(schema.bookings.id, made.booking.id)))[0]).toEqual(made.booking);
});
it("counts meetings overlapping the local day and excludes exact adjacent boundaries", async () => {
  const f = await fixture(test.pool);
  await transaction(test.pool, async client => {
    // Local Jan 5 (Minsk) is Jan 4 21:00Z through Jan 5 21:00Z.
    for (const start of ["2027-01-04T20:30:00Z", "2027-01-04T21:00:00Z", "2027-01-05T20:45:00Z", "2027-01-05T21:15:00Z"])
      await insertCompleteBooking(client, f, { start });
  });
  const overview = await getDashboardOverview(db, f.organizer.id, new Date("2027-01-04T22:00:00Z"));
  expect(overview.counts.today).toBe(2); expect(overview.next).toHaveLength(2); expect(overview.timezone).toBe("Europe/Minsk");
});
it("supports a fresh account with no schedule and rejects invalid service filters", async () => {
  const [user] = await db.insert(schema.authUsers).values({ name: "New organizer", email: `${randomUUID()}@example.invalid`, emailVerified: true }).returning();
  const [owner] = await db.select().from(schema.organizers).where(eq(schema.organizers.userId, user!.id));
  const data = await getDashboardOverview(db, owner!.id, now);
  expect(data).toMatchObject({ schedule: null, pages: [], counts: { today: 0, upcoming: 0 }, next: [], progress: { hours: false, page: false, published: false } });
  await expect(getBookingList(db, owner!.id, { view: "any", page: -1 }, now)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(getBookingList(db, owner!.id, { organizerId: randomUUID() }, now)).rejects.toMatchObject({ code: "INVALID_INPUT" });
});

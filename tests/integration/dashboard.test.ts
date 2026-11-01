import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as schema from "../../src/server/db/schema";
import type { Database } from "../../src/server/db/types";
import { getBookingList, getDashboardOverview, getOrganizerActivity } from "../../src/modules/organizers/dashboard-service";
import { fixture, insertCompleteBooking, cancelBooking, moveBooking } from "../helpers/domain";
import { createTestDatabase, transaction } from "../helpers/database";

let test: Awaited<ReturnType<typeof createTestDatabase>>, db: Database;
const now = new Date("2027-01-04T10:15:00Z");
beforeAll(async () => { test = await createTestDatabase({ restricted: true }); db = drizzle(test.pool, { schema }); });
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

it("loads selected-day meetings and week indicators from occupancy, excluding cancellations and other owners", async () => {
  const f = await fixture(test.pool), other = await fixture(test.pool);
  let movedId: string;
  await transaction(test.pool, async client => {
    // Minsk Jan 5 begins Jan 4 21:00Z. Exact-adjacent meetings are excluded.
    await insertCompleteBooking(client, f, { start: "2027-01-04T20:30:00Z" });
    const moved = await insertCompleteBooking(client, f, { start: "2027-01-04T21:00:00Z" }); movedId = moved.booking.id;
    await moveBooking(client, moved.booking.id, moved.occupancy, "2027-01-06T09:00:00Z");
    await insertCompleteBooking(client, f, { start: "2027-01-05T20:45:00Z" });
    const cancelled = await insertCompleteBooking(client, f, { start: "2027-01-05T10:00:00Z" });
    await cancelBooking(client, cancelled.booking.id, cancelled.occupancy);
    await insertCompleteBooking(client, other, { start: "2027-01-05T12:00:00Z" });
  });
  const overview = await getDashboardOverview(db, f.organizer.id, now, { date: "2027-01-05" });
  expect(overview.week.filtered).toBe(true); expect(overview.week.total).toBe(1); expect(overview.week.meetings).toHaveLength(1);
  expect(overview.week.days.find(d => d.date === "2027-01-05")!.count).toBe(1);
  expect(overview.week.days.find(d => d.date === "2027-01-06")!.count).toBe(2); // midnight-crossing + moved
  const after = await getDashboardOverview(db, f.organizer.id, now, { date: "2027-01-06" });
  expect(after.week.meetings.map(m => m.id)).toContain(movedId!);
  const empty = await getDashboardOverview(db, other.organizer.id, now, { date: "2027-01-06" });
  expect(empty.week.total).toBe(0); expect(empty.week.meetings).toEqual([]);
});

it("paginates a full selected day, clamps URL pages and keeps the default nearest view", async () => {
  const f = await fixture(test.pool);
  await transaction(test.pool, async client => {
    await client.query("SET LOCAL statement_timeout='30s'");
    for (let i = 0; i < 23; i++) await insertCompleteBooking(client, f, { start: new Date(Date.parse("2027-01-05T00:00:00Z") + i * 1_800_000).toISOString() });
  });
  const first = await getDashboardOverview(db, f.organizer.id, now, { date: "2027-01-05" });
  const last = await getDashboardOverview(db, f.organizer.id, now, { date: "2027-01-05", dayPage: "999999" });
  expect(first.week).toMatchObject({ total: 23, totalPages: 2, page: 1 }); expect(first.week.meetings).toHaveLength(20);
  expect(last.week.page).toBe(2); expect(last.week.meetings).toHaveLength(3); expect(new Set([...first.week.meetings, ...last.week.meetings].map(m => m.id)).size).toBe(23);
  const nearest = await getDashboardOverview(db, f.organizer.id, now, { date: ["2027-01-05"] });
  expect(nearest.week.filtered).toBe(false); expect(nearest.week.meetings).toEqual(nearest.next); expect(nearest.next).toHaveLength(3);
}, 60_000);

it("does not assign meetings to a civil date skipped entirely by a timezone change", async () => {
  const f = await fixture(test.pool);
  await test.pool.query("update slotly.schedules set timezone='Pacific/Apia' where id=$1", [f.schedule.id]);
  await transaction(test.pool, client => insertCompleteBooking(client, f, { start: "2011-12-30T09:45:00Z" }));
  const skipped = await getDashboardOverview(db, f.organizer.id, now, { date: "2011-12-30" });
  expect(skipped.week.total).toBe(0); expect(skipped.week.meetings).toEqual([]);
  expect(skipped.week.days.find(day => day.date === "2011-12-29")!.count).toBe(1);
  expect(skipped.week.days.find(day => day.date === "2011-12-31")!.count).toBe(1);
});

it("shows only the owner's latest five real booking events without contacts or capability links", async () => {
  const f = await fixture(test.pool), other = await fixture(test.pool);
  await transaction(test.pool, async client => {
    for (let day = 1; day <= 6; day++) await insertCompleteBooking(client, f, { start: `2027-02-0${day}T10:00:00Z` });
    const changed = await insertCompleteBooking(client, f, { start: "2027-02-07T10:00:00Z" });
    await moveBooking(client, changed.booking.id, changed.occupancy, "2027-02-08T10:00:00Z");
    // The move is in this transaction, so release its current version here.
    await cancelBooking(client, changed.booking.id, { ...changed.occupancy, version: 2, startAt: new Date("2027-02-08T10:00:00Z"), endAt: new Date("2027-02-08T10:30:00Z") });
    await insertCompleteBooking(client, other, { start: "2027-02-08T10:00:00Z" });
  });
  const feed = await getOrganizerActivity(db, f.organizer.id);
  expect(feed).toHaveLength(5); expect(feed[0]!.type).toBe("cancelled"); expect(feed[1]!.type).toBe("rescheduled");
  expect(feed.every(event => event.title === "Test meeting")).toBe(true);
  expect(Object.keys(feed[0]!).sort()).toEqual(["bookingId", "createdAt", "id", "timezone", "title", "type"]);
  expect(await getOrganizerActivity(db, randomUUID())).toEqual([]);
  expect(await getOrganizerActivity(db, other.organizer.id)).toHaveLength(1);
});

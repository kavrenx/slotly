import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import * as schema from "../../src/server/db/schema";
import { createTestDatabase, postgresError, transaction } from "../helpers/database";
import { cancelBooking, fixture, insertBooking, insertCompleteBooking, insertOccupancy, moveBooking } from "../helpers/domain";

let database: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => { database = await createTestDatabase(); });
afterAll(async () => { await database?.close(); });
const baseStart = "2027-01-04T10:00:00Z";

async function rejects(action: () => Promise<unknown>, code: string, constraint?: string) {
  try { await action(); } catch (error) {
    expect(postgresError(error).code).toBe(code);
    if (constraint) expect(postgresError(error).constraint).toBe(constraint);
    return;
  }
  throw new Error("Expected PostgreSQL to reject the operation");
}

it("requires a known named timezone", async () => {
  const f = await fixture(database.pool);
  await rejects(() => database.pool.query("UPDATE slotly.schedules SET timezone='+03:00' WHERE id=$1", [f.schedule.id]), "23514", "schedules_timezone");
});

it("cannot attach a page to another organizer's schedule", async () => {
  const a = await fixture(database.pool);
  const b = await fixture(database.pool);
  await rejects(() => database.pool.query("UPDATE slotly.booking_pages SET schedule_id=$2 WHERE id=$1", [a.page.id, b.schedule.id]), "23503", "booking_pages_schedule_owner");
});

it.each([
  ["duration_minutes", "0"], ["duration_minutes", "31"], ["step_minutes", "0"],
  ["step_minutes", "7"], ["buffer_before_minutes", "-5"], ["buffer_after_minutes", "245"],
  ["horizon_days", "366"], ["min_notice_minutes", "-1"], ["cancel_cutoff_minutes", "-1"],
  ["reschedule_cutoff_minutes", "43201"],
])("rejects invalid policy %s=%s", async (column, value) => {
  const f = await fixture(database.pool);
  // Identifiers and values come only from this fixed test matrix.
  await rejects(() => database.pool.query(`UPDATE slotly.booking_pages SET ${column}=${value} WHERE id=$1`, [f.page.id]), "23514");
});

it("rejects overlapping weekly windows but accepts touching boundaries", async () => {
  const f = await fixture(database.pool);
  const db = drizzle(database.pool);
  await db.insert(schema.weeklyWindows).values({ scheduleId: f.schedule.id, weekday: 1, startMinute: 540, endMinute: 600 });
  await rejects(() => db.insert(schema.weeklyWindows).values({ scheduleId: f.schedule.id, weekday: 1, startMinute: 570, endMinute: 630 }).then(() => {}), "23P01", "weekly_windows_no_overlap");
  await db.insert(schema.weeklyWindows).values({ scheduleId: f.schedule.id, weekday: 1, startMinute: 600, endMinute: 660 });
});

it("does not allow a replacement day without windows at commit", async () => {
  const f = await fixture(database.pool);
  await rejects(() => database.pool.query("INSERT INTO slotly.date_overrides(schedule_id,local_date,mode) VALUES ($1,'2027-01-04','replace')", [f.schedule.id]), "23514", "date_overrides_windows");
});

it("supports atomic replacement windows and rejects their overlap", async () => {
  const f = await fixture(database.pool);
  const override = await transaction(database.pool, async (client) => {
    const result = await client.query("INSERT INTO slotly.date_overrides(schedule_id,local_date,mode) VALUES ($1,'2027-01-04','replace') RETURNING id", [f.schedule.id]);
    const id: string = result.rows[0].id;
    await client.query("INSERT INTO slotly.override_windows(override_id,start_minute,end_minute) VALUES ($1,540,600)", [id]);
    return id;
  });
  await rejects(() => database.pool.query("INSERT INTO slotly.override_windows(override_id,start_minute,end_minute) VALUES ($1,570,630)", [override]), "23P01", "override_windows_no_overlap");
  await rejects(() => database.pool.query("DELETE FROM slotly.override_windows WHERE override_id=$1", [override]), "23514", "date_overrides_windows");
});

it("does not attach working windows to a closed date", async () => {
  const f = await fixture(database.pool);
  const { rows } = await database.pool.query("INSERT INTO slotly.date_overrides(schedule_id,local_date,mode) VALUES ($1,'2027-01-04','closed') RETURNING id", [f.schedule.id]);
  await rejects(() => database.pool.query("INSERT INTO slotly.override_windows(override_id,start_minute,end_minute) VALUES ($1,540,600)", [rows[0].id]), "23503");
});

it("creates a complete booking atomically and rejects orphaned occupancy", async () => {
  const f = await fixture(database.pool);
  await rejects(() => insertOccupancy(database.pool, f), "23514", "booking_occupancy_pair");
  const result = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  expect(result.occupancy.releasedAt).toBeNull();
  const count = await database.pool.query("SELECT count(*)::int AS count FROM slotly.booking_events WHERE booking_id=$1", [result.booking.id]);
  expect(count.rows[0].count).toBe(1);
});

it("does not commit a booking without creation history", async () => {
  const f = await fixture(database.pool);
  await rejects(() => transaction(database.pool, async (client) => {
    const occupancy = await insertOccupancy(client, f);
    await insertBooking(client, f, occupancy);
  }), "23514", "booking_history_complete");
  const count = await database.pool.query("SELECT count(*)::int AS count FROM slotly.occupancies WHERE organizer_id=$1", [f.organizer.id]);
  expect(count.rows[0].count).toBe(0);
});

it("does not use manual blocks as bookings or link other owners", async () => {
  const a = await fixture(database.pool);
  const b = await fixture(database.pool);
  const manual = await insertOccupancy(database.pool, a, { kind: "manual" });
  await rejects(() => transaction(database.pool, (client) => insertBooking(client, a, manual)), "23503", "bookings_occupancy_owner_kind");
  await rejects(() => transaction(database.pool, async (client) => {
    const occupancy = await insertOccupancy(client, a, { start: "2027-01-05T10:00:00Z" });
    await insertBooking(client, b, occupancy);
  }), "23503", "bookings_occupancy_owner_kind");
});

it("rejects overlapping intervals with different starts", async () => {
  const f = await fixture(database.pool);
  await transaction(database.pool, (client) => insertCompleteBooking(client, f, { duration: 60 }));
  await rejects(() => transaction(database.pool, (client) => insertCompleteBooking(client, f, { start: "2027-01-04T10:30:00Z" })), "23P01", "occupancies_no_overlap");
});

it("accepts adjacent appointments without buffers", async () => {
  const f = await fixture(database.pool);
  await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await transaction(database.pool, (client) => insertCompleteBooking(client, f, { start: "2027-01-04T10:30:00Z" }));
});

it("includes buffers and manual blocks in the same exclusion constraint", async () => {
  const f = await fixture(database.pool);
  await transaction(database.pool, (client) => insertCompleteBooking(client, f, { after: 15 }));
  await rejects(() => insertOccupancy(database.pool, f, { kind: "manual", start: "2027-01-04T10:30:00Z" }), "23P01", "occupancies_no_overlap");
  await insertOccupancy(database.pool, f, { kind: "manual", start: "2027-01-04T10:45:00Z" });
});

it("does not accept incorrect busy boundaries", async () => {
  const f = await fixture(database.pool);
  const manual = await insertOccupancy(database.pool, f, { kind: "manual" });
  await rejects(() => database.pool.query("UPDATE slotly.occupancies SET busy_start_at=start_at-interval '1 minute',version=version+1 WHERE id=$1", [manual.id]), "23514", "occupancies_busy_bounds");
});

it("shares occupancy across pages but not across organizers", async () => {
  const a = await fixture(database.pool);
  const b = await fixture(database.pool);
  const [otherPage] = await drizzle(database.pool).insert(schema.bookingPages).values({ organizerId: a.organizer.id, scheduleId: a.schedule.id, title: "Another page" }).returning();
  if (!otherPage) throw new Error("Missing page");
  await transaction(database.pool, (client) => insertCompleteBooking(client, a));
  await rejects(() => transaction(database.pool, (client) => insertCompleteBooking(client, { ...a, page: otherPage })), "23P01", "occupancies_no_overlap");
  await transaction(database.pool, (client) => insertCompleteBooking(client, b));
});

it("compares absolute instants even when input offsets differ", async () => {
  const f = await fixture(database.pool);
  await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await rejects(() => transaction(database.pool, (client) => insertCompleteBooking(client, f, { start: "2027-01-04T13:00:00+03:00" })), "23P01", "occupancies_no_overlap");
});

it("allows only one of eight concurrent bookings without an application mutex", async () => {
  const f = await fixture(database.pool);
  const results = await Promise.allSettled(Array.from({ length: 8 }, () =>
    transaction(database.pool, (client) => insertCompleteBooking(client, f))));
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const failures = results.filter((r) => r.status === "rejected");
  expect(failures).toHaveLength(7);
  for (const result of failures) if (result.status === "rejected") {
    expect(postgresError(result.reason).code).toBe("23P01");
  }
  const count = await database.pool.query("SELECT count(*)::int AS count FROM slotly.bookings WHERE organizer_id=$1", [f.organizer.id]);
  expect(count.rows[0].count).toBe(1);
});

it("preserves original conditions when the page changes", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f, { before: 5, after: 10 }));
  await database.pool.query("UPDATE slotly.booking_pages SET duration_minutes=60,cancel_cutoff_minutes=0,title='Updated' WHERE id=$1", [f.page.id]);
  const { rows } = await database.pool.query("SELECT b.title_snapshot,b.cancel_cutoff_minutes,o.buffer_before_minutes,o.end_at-o.start_at=interval '30 minutes' AS duration_saved FROM slotly.bookings b JOIN slotly.occupancies o ON o.id=b.occupancy_id WHERE b.id=$1", [saved.booking.id]);
  expect(rows[0]).toMatchObject({ title_snapshot: "Test meeting", cancel_cutoff_minutes: 120, buffer_before_minutes: 5, duration_saved: true });
  await rejects(() => database.pool.query("UPDATE slotly.bookings SET cancel_cutoff_minutes=0 WHERE id=$1", [saved.booking.id]), "23514", "immutable_record");
  await rejects(() => database.pool.query("UPDATE slotly.occupancies SET end_at=end_at+interval '30 minutes',busy_end_at=busy_end_at+interval '30 minutes',version=version+1 WHERE id=$1", [saved.occupancy.id]), "23514", "occupancies_saved_conditions");
});

it("reschedules atomically, preserves duration/buffers and appends history", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f, { before: 5, after: 10 }));
  await transaction(database.pool, (client) => moveBooking(client, saved.booking.id, saved.occupancy, "2027-01-04T12:00:00Z"));
  const { rows } = await database.pool.query("SELECT version,start_at,buffer_before_minutes,buffer_after_minutes,released_at FROM slotly.occupancies WHERE id=$1", [saved.occupancy.id]);
  expect(rows[0]).toMatchObject({ version: 2, start_at: new Date("2027-01-04T12:00:00Z"), buffer_before_minutes: 5, buffer_after_minutes: 10, released_at: null });
  const events = await database.pool.query("SELECT type FROM slotly.booking_events WHERE booking_id=$1 ORDER BY version", [saved.booking.id]);
  expect(events.rows.map((r) => r.type)).toEqual(["created", "rescheduled"]);
});

it("rolls back a conflicting reschedule including its version and history", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await insertOccupancy(database.pool, f, { kind: "manual", start: "2027-01-04T12:00:00Z" });
  await rejects(() => transaction(database.pool, (client) => moveBooking(client, saved.booking.id, saved.occupancy, "2027-01-04T12:00:00Z")), "23P01");
  const { rows } = await database.pool.query("SELECT version,start_at FROM slotly.occupancies WHERE id=$1", [saved.occupancy.id]);
  expect(rows[0]).toMatchObject({ version: 1, start_at: new Date(baseStart) });
});

it("rejects an unlogged reschedule at commit and preserves the old time", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await rejects(() => database.pool.query("UPDATE slotly.occupancies SET start_at=start_at+interval '1 hour',end_at=end_at+interval '1 hour',busy_start_at=busy_start_at+interval '1 hour',busy_end_at=busy_end_at+interval '1 hour',version=version+1 WHERE id=$1", [saved.occupancy.id]), "23514", "booking_history_complete");
  const { rows } = await database.pool.query("SELECT version,start_at FROM slotly.occupancies WHERE id=$1", [saved.occupancy.id]);
  expect(rows[0]).toMatchObject({ version: 1, start_at: new Date(baseStart) });
});

it("requires exact version increments", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await rejects(() => database.pool.query("UPDATE slotly.occupancies SET version=version+1 WHERE id=$1", [saved.occupancy.id]), "23514", "occupancies_version_transition");
});

it("cancels with history, frees time, and cannot restore or delete the old record", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await transaction(database.pool, (client) => cancelBooking(client, saved.booking.id, saved.occupancy));
  await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  const { rows } = await database.pool.query("SELECT released_at,version FROM slotly.occupancies WHERE id=$1", [saved.occupancy.id]);
  expect(rows[0].released_at).toBeInstanceOf(Date);
  expect(rows[0].version).toBe(2);
  await rejects(() => database.pool.query("UPDATE slotly.occupancies SET released_at=NULL,version=version+1 WHERE id=$1", [saved.occupancy.id]), "23514", "occupancies_final_release");
  await rejects(() => database.pool.query("DELETE FROM slotly.bookings WHERE id=$1", [saved.booking.id]), "23514", "immutable_record");
});

it("requires an explanation for organizer cancellation", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await rejects(() => transaction(database.pool, (client) => cancelBooking(client, saved.booking.id, saved.occupancy, "organizer")), "23514", "booking_events_reason");
  await transaction(database.pool, (client) => cancelBooking(client, saved.booking.id, saved.occupancy, "organizer", "Test explanation"));
});

it("does not edit or delete history", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await rejects(() => database.pool.query("UPDATE slotly.booking_events SET actor='system' WHERE booking_id=$1", [saved.booking.id]), "23514", "immutable_record");
  await rejects(() => database.pool.query("DELETE FROM slotly.booking_events WHERE booking_id=$1", [saved.booking.id]), "23514", "immutable_record");
});

it("cannot change saved buffers", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await rejects(() => database.pool.query("UPDATE slotly.occupancies SET buffer_after_minutes=15,busy_end_at=end_at+interval '15 minutes',version=version+1 WHERE id=$1", [saved.occupancy.id]), "23514", "occupancies_saved_conditions");
});

it("cannot cancel without history and does not free that interval", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await rejects(() => database.pool.query("UPDATE slotly.occupancies SET released_at=clock_timestamp(),version=version+1 WHERE id=$1", [saved.occupancy.id]), "23514", "booking_history_complete");
  await rejects(() => transaction(database.pool, (client) => insertCompleteBooking(client, f)), "23P01");
});

it("rejects a false previous time in history and rolls back the change", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await rejects(() => transaction(database.pool, async (client) => {
    await client.query("UPDATE slotly.occupancies SET start_at=start_at+interval '2 hours',end_at=end_at+interval '2 hours',busy_start_at=busy_start_at+interval '2 hours',busy_end_at=busy_end_at+interval '2 hours',version=version+1 WHERE id=$1", [saved.occupancy.id]);
    await drizzle(client).insert(schema.bookingEvents).values({
      bookingId: saved.booking.id, organizerId: f.organizer.id, version: 2, type: "rescheduled", actor: "guest",
      oldStartAt: new Date("2027-01-04T09:00:00Z"), oldEndAt: new Date("2027-01-04T09:30:00Z"),
      newStartAt: new Date("2027-01-04T12:00:00Z"), newEndAt: new Date("2027-01-04T12:30:00Z"),
    });
  }), "23514", "booking_events_chain");
  const { rows } = await database.pool.query("SELECT version FROM slotly.occupancies WHERE id=$1", [saved.occupancy.id]);
  expect(rows[0].version).toBe(1);
});

it("preserves the full create-move-cancel chain", async () => {
  const f = await fixture(database.pool);
  const saved = await transaction(database.pool, (client) => insertCompleteBooking(client, f));
  await transaction(database.pool, (client) => moveBooking(client, saved.booking.id, saved.occupancy, "2027-01-04T12:00:00Z"));
  const [current] = await drizzle(database.pool).select().from(schema.occupancies).where(eq(schema.occupancies.id, saved.occupancy.id));
  if (!current) throw new Error("Missing occupancy");
  await transaction(database.pool, (client) => cancelBooking(client, saved.booking.id, current));
  const events = await database.pool.query("SELECT type,version FROM slotly.booking_events WHERE booking_id=$1 ORDER BY version", [saved.booking.id]);
  expect(events.rows).toEqual([{ type: "created", version: 1 }, { type: "rescheduled", version: 2 }, { type: "cancelled", version: 3 }]);
});

it.each(["infinity", "2027-01-04T10:30:01Z"])("rejects invalid interval boundary %s", async (end) => {
  const f = await fixture(database.pool);
  await rejects(() => database.pool.query("INSERT INTO slotly.occupancies(organizer_id,kind,start_at,end_at,busy_start_at,busy_end_at) VALUES ($1,'manual',$2,$3,$2,$3)", [f.organizer.id, baseStart, end]), "23514");
});

it("keeps at least one replacement window under concurrent deletes", async () => {
  const f = await fixture(database.pool);
  const keys = await transaction(database.pool, async (client) => {
    const result = await client.query("INSERT INTO slotly.date_overrides(schedule_id,local_date,mode) VALUES ($1,'2027-01-04','replace') RETURNING id", [f.schedule.id]);
    const id: string = result.rows[0].id;
    const windows = await client.query("INSERT INTO slotly.override_windows(override_id,start_minute,end_minute) VALUES ($1,540,600),($1,660,720) RETURNING id", [id]);
    return { id, windows: windows.rows.map((r) => r.id as string) };
  });
  const results = await Promise.allSettled(keys.windows.map((id) =>
    transaction(database.pool, (client) => client.query("DELETE FROM slotly.override_windows WHERE id=$1", [id]))));
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const failures = results.filter((r) => r.status === "rejected");
  expect(failures).toHaveLength(1);
  if (failures[0]?.status === "rejected") expect(postgresError(failures[0].reason).constraint).toBe("date_overrides_windows");
  const remaining = await database.pool.query("SELECT count(*)::int AS count FROM slotly.override_windows WHERE override_id=$1", [keys.id]);
  expect(remaining.rows[0].count).toBe(1);
});

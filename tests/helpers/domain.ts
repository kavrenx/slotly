import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import * as schema from "../../src/server/db/schema";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

function first<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error("Fixture insert returned no row");
  return row;
}

export async function fixture(pool: Pool) {
  const db = drizzle(pool);
  const userId = randomUUID();
  await db.insert(schema.authUsers).values({ id: userId, name: "Test organizer", email: `${userId}@example.invalid`, emailVerified: true });
  const organizer = first(await db.select().from(schema.organizers).where(eq(schema.organizers.userId, userId)));
  const schedule = first(await db.insert(schema.schedules).values({ organizerId: organizer.id, timezone: "Europe/Minsk" }).returning());
  const page = first(await db.insert(schema.bookingPages).values({
    organizerId: organizer.id, scheduleId: schedule.id, title: "Test meeting", state: "published",
  }).returning());
  return { organizer, schedule, page };
}

export type Fixture = Awaited<ReturnType<typeof fixture>>;
export type Occupancy = typeof schema.occupancies.$inferSelect;

export async function insertOccupancy(client: Pool | PoolClient, f: Fixture, options: {
  start?: string; duration?: number; before?: number; after?: number; kind?: "manual" | "booking";
} = {}) {
  const startAt = new Date(options.start ?? "2027-01-04T10:00:00Z");
  const endAt = new Date(startAt.getTime() + (options.duration ?? 30) * 60_000);
  const before = options.before ?? 0;
  const after = options.after ?? 0;
  return first(await drizzle(client).insert(schema.occupancies).values({
    organizerId: f.organizer.id, kind: options.kind ?? "booking", startAt, endAt,
    bufferBeforeMinutes: before, bufferAfterMinutes: after,
    busyStartAt: new Date(startAt.getTime() - before * 60_000),
    busyEndAt: new Date(endAt.getTime() + after * 60_000),
  }).returning());
}

export async function insertBooking(client: PoolClient, f: Fixture, occupancy: Occupancy) {
  return first(await drizzle(client).insert(schema.bookings).values({
    organizerId: f.organizer.id, pageId: f.page.id, occupancyId: occupancy.id,
    guestName: "Test guest", guestEmail: "guest@example.invalid", emailVerifiedAt: new Date(),
    guestTimezone: "Europe/Minsk", titleSnapshot: f.page.title, locationSnapshot: f.page.location,
    scheduleTimezoneSnapshot: f.schedule.timezone, minNoticeMinutes: f.page.minNoticeMinutes,
    horizonDays: f.page.horizonDays, cancelCutoffMinutes: f.page.cancelCutoffMinutes,
    rescheduleCutoffMinutes: f.page.rescheduleCutoffMinutes,
  }).returning());
}

export async function insertCompleteBooking(client: PoolClient, f: Fixture, options: Parameters<typeof insertOccupancy>[2] = {}) {
  const occupancy = await insertOccupancy(client, f, options);
  const booking = await insertBooking(client, f, occupancy);
  await drizzle(client).insert(schema.bookingEvents).values({
    bookingId: booking.id, organizerId: f.organizer.id, version: 1, type: "created", actor: "guest",
    newStartAt: occupancy.startAt, newEndAt: occupancy.endAt,
  });
  return { booking, occupancy };
}

// Test fixtures only, not application operations: no auth, slot selection or API.
export async function moveBooking(client: PoolClient, bookingId: string, occupancy: Occupancy, start: string) {
  const startAt = new Date(start);
  const endAt = new Date(startAt.getTime() + occupancy.endAt.getTime() - occupancy.startAt.getTime());
  const { rows } = await client.query(
    "UPDATE slotly.occupancies SET start_at=$2, end_at=$3, busy_start_at=$4, busy_end_at=$5, version=version+1 WHERE id=$1 RETURNING version",
    [occupancy.id, startAt, endAt,
      new Date(startAt.getTime() - occupancy.bufferBeforeMinutes * 60_000),
      new Date(endAt.getTime() + occupancy.bufferAfterMinutes * 60_000)],
  );
  await drizzle(client).insert(schema.bookingEvents).values({
    bookingId, organizerId: occupancy.organizerId, version: rows[0].version,
    type: "rescheduled", actor: "guest", oldStartAt: occupancy.startAt, oldEndAt: occupancy.endAt,
    newStartAt: startAt, newEndAt: endAt,
  });
}

export async function cancelBooking(client: PoolClient, bookingId: string, occupancy: Occupancy, actor = "guest", reason: string | null = null) {
  const { rows } = await client.query(
    "UPDATE slotly.occupancies SET released_at=clock_timestamp(), version=version+1 WHERE id=$1 RETURNING version",
    [occupancy.id],
  );
  await drizzle(client).insert(schema.bookingEvents).values({
    bookingId, organizerId: occupancy.organizerId, version: rows[0].version,
    type: "cancelled", actor, reason, oldStartAt: occupancy.startAt, oldEndAt: occupancy.endAt,
  });
}

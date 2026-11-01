import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { bookingPages, occupancies, schedules } from "../../server/db/schema";
import type { Database } from "../../server/db/types";
import { DomainError, validate } from "../../shared/domain-error";
import { availabilityQuery, type SlotPolicy } from "./contract";
import { readSchedule } from "./service";
import { bookingRange, calculateAvailability, queryWindow } from "./slots";
import type { SlotQuery } from "./contract";

export async function readPublishedPage(database: Database, publicId: string) {
  const [page] = await database.select({ id: bookingPages.id, organizerId: bookingPages.organizerId, timezone: schedules.timezone,
    pageVersion: bookingPages.version, scheduleVersion: schedules.version, title: bookingPages.title, description: bookingPages.description, location: bookingPages.location,
    durationMinutes: bookingPages.durationMinutes, stepMinutes: bookingPages.stepMinutes, bufferBeforeMinutes: bookingPages.bufferBeforeMinutes, bufferAfterMinutes: bookingPages.bufferAfterMinutes,
    minNoticeMinutes: bookingPages.minNoticeMinutes, horizonDays: bookingPages.horizonDays, cancelCutoffMinutes: bookingPages.cancelCutoffMinutes, rescheduleCutoffMinutes: bookingPages.rescheduleCutoffMinutes })
    .from(bookingPages).innerJoin(schedules, eq(schedules.id, bookingPages.scheduleId))
    .where(and(eq(bookingPages.publicId, publicId), eq(bookingPages.state, "published")));
  if (!page) throw new DomainError("NOT_FOUND", 404);
  return page;
}
export type PublishedPage = Awaited<ReturnType<typeof readPublishedPage>>;
export async function readSlotContext(database: Database, page: PublishedPage, query: SlotQuery, now: Date, excludeOccupancyId?: string) {
  const policy: SlotPolicy = page;
  const bounds = queryWindow(query, policy, bookingRange(now, policy, page.timezone, query.timezone));
  if (!bounds) return { policy, schedule: { version: page.scheduleVersion, timezone: page.timezone, weekly: [], overrides: [] }, busy: [] };
  const schedule = await readSchedule(database, page.organizerId);
  if (!schedule) throw new DomainError("NOT_FOUND", 404);
  const occupied = await database.select({ start: occupancies.busyStartAt, end: occupancies.busyEndAt }).from(occupancies)
    .where(and(eq(occupancies.organizerId, page.organizerId), isNull(occupancies.releasedAt), excludeOccupancyId ? ne(occupancies.id, excludeOccupancyId) : undefined,
      sql`tstzrange(${occupancies.busyStartAt}, ${occupancies.busyEndAt}, '[)') && tstzrange(${new Date(bounds.busyStart).toISOString()}::timestamptz, ${new Date(bounds.busyEnd).toISOString()}::timestamptz, '[)')`));
  return { policy, schedule, busy: occupied.map((o) => ({ start: o.start.getTime(), end: o.end.getTime() })) };
}

export async function getPublicAvailability(database: Database, publicId: string, input: unknown, now = new Date()) {
  if (!z.uuid().safeParse(publicId).success) throw new DomainError("NOT_FOUND", 404);
  const query = validate(availabilityQuery, input);
  const snapshot = await database.transaction(async (tx) => {
    return readSlotContext(tx, await readPublishedPage(tx, publicId), query, now);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  // Release the connection/snapshot before CPU work. Displaying slots never holds one.
  return calculateAvailability({ query, ...snapshot, now });
}

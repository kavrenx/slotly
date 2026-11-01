import { Temporal } from "@js-temporal/polyfill";
import { and, asc, desc, eq, gt, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "../../server/db/types";
import { bookings, occupancies } from "../../server/db/schema";
import { validate } from "../../shared/domain-error";
import { readSchedule } from "../availability/service";
import type { ScheduleData } from "../availability/validation";
import { listPages, type PageData } from "../booking-pages/service";
import { bookingListInput, BOOKINGS_PER_PAGE } from "./dashboard-contract";

const meetingFields = { id: bookings.id, title: bookings.titleSnapshot, guestName: bookings.guestName, guestEmail: bookings.guestEmail,
  startAt: occupancies.startAt, endAt: occupancies.endAt, cancelledAt: occupancies.releasedAt, timezone: bookings.scheduleTimezoneSnapshot };
export type MeetingSummary = { id: string; title: string; guestName: string; guestEmail: string; startAt: Date; endAt: Date; cancelledAt: Date | null; timezone: string };

export function organizerDay(now: Date, timezone: string) {
  const local = Temporal.Instant.from(now.toISOString()).toZonedDateTimeISO(timezone);
  return { date: local.toPlainDate().toString(), start: new Date(local.startOfDay().epochMilliseconds),
    end: new Date(local.add({ days: 1 }).startOfDay().epochMilliseconds), minute: local.hour * 60 + local.minute };
}
export function setupProgress(schedule: ScheduleData | null, pages: Pick<PageData, "id" | "state">[], now: Date) {
  const day = organizerDay(now, schedule?.timezone ?? "UTC");
  const hours = Boolean(schedule && (schedule.weekly.length || schedule.overrides.some(o => o.mode === "replace" &&
    (o.localDate > day.date || o.localDate === day.date && o.windows.some(w => w.endMinute > day.minute)) && o.windows.length)));
  const active = pages.filter(p => p.state !== "archived");
  return { hours, page: active.length > 0, published: active.some(p => p.state === "published"),
    pageHref: active[0] ? `/dashboard/pages/${active[0].id}` : "/dashboard/pages/new" };
}

export async function getBookingList(database: Database, organizerId: string, input: unknown, now = new Date()) {
  const filter = validate(bookingListInput, input);
  return database.transaction(async tx => {
    const owner = eq(bookings.organizerId, organizerId);
    const [counts] = await tx.select({
      upcoming: sql<number>`count(*) filter (where ${occupancies.releasedAt} is null and ${occupancies.endAt} > ${now.toISOString()}::timestamptz)::int`,
      past: sql<number>`count(*) filter (where ${occupancies.releasedAt} is null and ${occupancies.endAt} <= ${now.toISOString()}::timestamptz)::int`,
      cancelled: sql<number>`count(*) filter (where ${occupancies.releasedAt} is not null)::int`,
    }).from(bookings).innerJoin(occupancies, eq(occupancies.id, bookings.occupancyId)).where(owner);
    const total = counts![filter.view], totalPages = Math.max(1, Math.ceil(total / BOOKINGS_PER_PAGE));
    const page = Math.min(filter.page, totalPages);
    const state = filter.view === "cancelled" ? isNotNull(occupancies.releasedAt)
      : and(isNull(occupancies.releasedAt), filter.view === "past" ? lte(occupancies.endAt, now) : gt(occupancies.endAt, now));
    const order = filter.view === "upcoming" ? asc : desc;
    const items = await tx.select(meetingFields).from(bookings).innerJoin(occupancies, eq(occupancies.id, bookings.occupancyId))
      .where(and(owner, state)).orderBy(order(occupancies.startAt), order(bookings.id)).limit(BOOKINGS_PER_PAGE).offset((page - 1) * BOOKINGS_PER_PAGE);
    return { items, counts: counts!, view: filter.view, page, totalPages, total, generatedAt: now };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getDashboardOverview(database: Database, organizerId: string, now = new Date()) {
  return database.transaction(async tx => {
    const schedule = await readSchedule(tx, organizerId);
    const pages = await listPages(tx, organizerId);
    const timezone = schedule?.timezone ?? "UTC", day = organizerDay(now, timezone);
    const owner = eq(bookings.organizerId, organizerId);
    const [counts] = await tx.select({
      today: sql<number>`count(*) filter (where ${occupancies.startAt} < ${day.end.toISOString()}::timestamptz and ${occupancies.endAt} > ${day.start.toISOString()}::timestamptz)::int`,
      upcoming: sql<number>`count(*) filter (where ${occupancies.endAt} > ${now.toISOString()}::timestamptz)::int`,
    }).from(bookings).innerJoin(occupancies, eq(occupancies.id, bookings.occupancyId)).where(and(owner, isNull(occupancies.releasedAt)));
    const next = await tx.select(meetingFields).from(bookings).innerJoin(occupancies, eq(occupancies.id, bookings.occupancyId))
      .where(and(owner, isNull(occupancies.releasedAt), gt(occupancies.endAt, now))).orderBy(asc(occupancies.startAt), asc(bookings.id)).limit(3);
    return { schedule, pages, timezone, counts: counts!, next, progress: setupProgress(schedule, pages, now), generatedAt: now };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

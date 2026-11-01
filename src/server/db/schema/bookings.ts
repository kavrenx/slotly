import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { bookingPages } from "./booking-pages";
import { createdAt, slotlySchema } from "./namespace";
import { organizers } from "./scheduling";

export const occupancies = slotlySchema.table("occupancies", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizerId: uuid("organizer_id").notNull().references(() => organizers.id, { onDelete: "restrict" }),
  kind: varchar("kind", { length: 8 }).notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
  bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
  busyStartAt: timestamp("busy_start_at", { withTimezone: true }).notNull(),
  busyEndAt: timestamp("busy_end_at", { withTimezone: true }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  note: varchar("note", { length: 1000 }),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
}, (t) => [
  unique("occupancies_id_owner_kind").on(t.id, t.organizerId, t.kind),
  index("occupancies_owner_start").on(t.organizerId, t.startAt),
  check("occupancies_kind", sql`${t.kind} in ('booking', 'manual')`),
  check("occupancies_bounds", sql`${t.startAt} < ${t.endAt} and isfinite(${t.startAt}) and isfinite(${t.endAt}) and isfinite(${t.busyStartAt}) and isfinite(${t.busyEndAt})`),
  check("occupancies_minute_precision", sql`date_trunc('minute', ${t.startAt}) = ${t.startAt} and date_trunc('minute', ${t.endAt}) = ${t.endAt}`),
  check("occupancies_buffers", sql`${t.bufferBeforeMinutes} between 0 and 240 and ${t.bufferBeforeMinutes} % 5 = 0 and ${t.bufferAfterMinutes} between 0 and 240 and ${t.bufferAfterMinutes} % 5 = 0`),
  check("occupancies_busy_bounds", sql`${t.startAt} - ${t.busyStartAt} = make_interval(mins => ${t.bufferBeforeMinutes}) and ${t.busyEndAt} - ${t.endAt} = make_interval(mins => ${t.bufferAfterMinutes})`),
  check("occupancies_duration", sql`${t.kind} = 'manual' or (extract(epoch from (${t.endAt} - ${t.startAt})) between 300 and 28800 and mod(extract(epoch from (${t.endAt} - ${t.startAt})), 300) = 0)`),
  check("occupancies_manual_buffers", sql`${t.kind} <> 'manual' or (${t.bufferBeforeMinutes} = 0 and ${t.bufferAfterMinutes} = 0)`),
  check("occupancies_release_finite", sql`${t.releasedAt} is null or isfinite(${t.releasedAt})`),
  check("occupancies_version", sql`${t.version} > 0`),
]);

export const bookings = slotlySchema.table("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizerId: uuid("organizer_id").notNull(),
  pageId: uuid("page_id").notNull(),
  occupancyId: uuid("occupancy_id").notNull().unique(),
  occupancyKind: varchar("occupancy_kind", { length: 8 }).notNull().default("booking"),
  guestName: varchar("guest_name", { length: 100 }).notNull(),
  guestEmail: varchar("guest_email", { length: 254 }).notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }).notNull(),
  guestTimezone: varchar("guest_timezone", { length: 64 }).notNull(),
  locale: varchar("locale", { length: 8 }).notNull().default("ru"),
  titleSnapshot: varchar("title_snapshot", { length: 120 }).notNull(),
  locationSnapshot: varchar("location_snapshot", { length: 1000 }).notNull(),
  scheduleTimezoneSnapshot: varchar("schedule_timezone_snapshot", { length: 64 }).notNull(),
  minNoticeMinutes: integer("min_notice_minutes").notNull(),
  horizonDays: integer("horizon_days").notNull(),
  cancelCutoffMinutes: integer("cancel_cutoff_minutes").notNull(),
  rescheduleCutoffMinutes: integer("reschedule_cutoff_minutes").notNull(),
  createdAt: createdAt(),
}, (t) => [
  unique("bookings_id_owner").on(t.id, t.organizerId),
  foreignKey({ name: "bookings_page_owner", columns: [t.pageId, t.organizerId], foreignColumns: [bookingPages.id, bookingPages.organizerId] }).onDelete("restrict"),
  foreignKey({ name: "bookings_occupancy_owner_kind", columns: [t.occupancyId, t.organizerId, t.occupancyKind], foreignColumns: [occupancies.id, occupancies.organizerId, occupancies.kind] }).onDelete("restrict"),
  index("bookings_owner_created").on(t.organizerId, t.createdAt),
  index("bookings_page").on(t.pageId),
  check("bookings_occupancy_kind", sql`${t.occupancyKind} = 'booking'`),
  check("bookings_guest_name", sql`length(trim(${t.guestName})) between 1 and 100`),
  check("bookings_guest_email", sql`length(${t.guestEmail}) between 3 and 254 and ${t.guestEmail} = lower(trim(${t.guestEmail})) and position('@' in ${t.guestEmail}) > 1`),
  check("bookings_verified_finite", sql`isfinite(${t.emailVerifiedAt})`),
  check("bookings_zones", sql`slotly.is_known_timezone(${t.guestTimezone}) and slotly.is_known_timezone(${t.scheduleTimezoneSnapshot})`),
  check("bookings_locale", sql`${t.locale} in ('ru', 'en')`),
  check("bookings_title", sql`length(trim(${t.titleSnapshot})) between 1 and 120`),
  check("bookings_notice", sql`${t.minNoticeMinutes} between 0 and 43200`),
  check("bookings_horizon", sql`${t.horizonDays} between 1 and 365`),
  check("bookings_cutoffs", sql`${t.cancelCutoffMinutes} between 0 and 43200 and ${t.rescheduleCutoffMinutes} between 0 and 43200`),
]);

export const bookingEvents = slotlySchema.table("booking_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id").notNull(),
  organizerId: uuid("organizer_id").notNull(),
  version: integer("version").notNull(),
  type: varchar("type", { length: 12 }).notNull(),
  actor: varchar("actor", { length: 12 }).notNull(),
  reason: text("reason"),
  requestId: uuid("request_id").unique(),
  requestHash: varchar("request_hash", { length: 64 }),
  oldStartAt: timestamp("old_start_at", { withTimezone: true }),
  oldEndAt: timestamp("old_end_at", { withTimezone: true }),
  newStartAt: timestamp("new_start_at", { withTimezone: true }),
  newEndAt: timestamp("new_end_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ name: "booking_events_booking_owner", columns: [t.bookingId, t.organizerId], foreignColumns: [bookings.id, bookings.organizerId] }).onDelete("restrict"),
  unique("booking_events_version").on(t.bookingId, t.version),
  check("booking_events_version_positive", sql`${t.version} > 0`),
  check("booking_events_type", sql`${t.type} in ('created', 'rescheduled', 'cancelled')`),
  check("booking_events_actor", sql`${t.actor} in ('guest', 'organizer', 'system')`),
  check("booking_events_request", sql`(${t.requestId} is null) = (${t.requestHash} is null) and (${t.requestHash} is null or ${t.requestHash} ~ '^[a-f0-9]{64}$')`),
  check("booking_events_reason", sql`(${t.reason} is null or length(trim(${t.reason})) between 1 and 1000) and (${t.type} = 'cancelled' or ${t.reason} is null) and (${t.type} <> 'cancelled' or ${t.actor} <> 'organizer' or ${t.reason} is not null)`),
  check("booking_events_shape", sql`(
    (${t.type} = 'created' and ${t.version} = 1 and ${t.oldStartAt} is null and ${t.oldEndAt} is null and ${t.newStartAt} is not null and ${t.newEndAt} is not null) or
    (${t.type} = 'rescheduled' and ${t.version} > 1 and ${t.oldStartAt} is not null and ${t.oldEndAt} is not null and ${t.newStartAt} is not null and ${t.newEndAt} is not null and ${t.oldStartAt} <> ${t.newStartAt}) or
    (${t.type} = 'cancelled' and ${t.version} > 1 and ${t.oldStartAt} is not null and ${t.oldEndAt} is not null and ${t.newStartAt} is null and ${t.newEndAt} is null)
  )`),
  check("booking_events_bounds", sql`(${t.oldStartAt} is null or (isfinite(${t.oldStartAt}) and isfinite(${t.oldEndAt}) and ${t.oldStartAt} < ${t.oldEndAt})) and (${t.newStartAt} is null or (isfinite(${t.newStartAt}) and isfinite(${t.newEndAt}) and ${t.newStartAt} < ${t.newEndAt}))`),
]);

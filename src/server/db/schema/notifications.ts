import { sql } from "drizzle-orm";
import { check, index, integer, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { bookingEvents } from "./bookings";
import { createdAt, slotlySchema } from "./namespace";

// Event and recipient snapshots are immutable; delivery bookkeeping is separate
// from booking state. The INSERT trigger enqueues both audiences atomically.
export const notificationOutbox = slotlySchema.table("notification_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => bookingEvents.id, { onDelete: "restrict" }),
  audience: varchar("audience", { length: 12 }).notNull(),
  recipientEmail: varchar("recipient_email", { length: 254 }).notNull(),
  recipientTimezone: varchar("recipient_timezone", { length: 64 }).notNull(),
  organizerName: varchar("organizer_name", { length: 100 }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseToken: uuid("lease_token"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  lastError: varchar("last_error", { length: 32 }),
  createdAt: createdAt(),
}, (t) => [
  unique("notification_outbox_event_audience").on(t.eventId, t.audience),
  index("notification_outbox_due").on(t.availableAt).where(sql`${t.sentAt} is null and ${t.failedAt} is null`),
  check("notification_outbox_audience", sql`${t.audience} in ('guest', 'organizer')`),
  check("notification_outbox_recipient", sql`length(trim(${t.recipientEmail})) between 3 and 254 and position('@' in ${t.recipientEmail}) > 1`),
  check("notification_outbox_timezone", sql`slotly.is_known_timezone(${t.recipientTimezone})`),
  check("notification_outbox_attempts", sql`${t.attempts} between 0 and 8`),
  check("notification_outbox_lease", sql`(${t.leaseToken} is null) = (${t.lockedUntil} is null)`),
  check("notification_outbox_terminal", sql`not (${t.sentAt} is not null and ${t.failedAt} is not null) and ((${t.sentAt} is null and ${t.failedAt} is null) or ${t.leaseToken} is null)`),
  check("notification_outbox_finite", sql`isfinite(${t.availableAt}) and isfinite(${t.createdAt}) and (${t.lockedUntil} is null or isfinite(${t.lockedUntil})) and (${t.sentAt} is null or isfinite(${t.sentAt})) and (${t.failedAt} is null or isfinite(${t.failedAt}))`),
]);

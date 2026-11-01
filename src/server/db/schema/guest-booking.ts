import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, smallint, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { slotlySchema, createdAt } from "./namespace";
import { bookingPages } from "./booking-pages";
import { bookings } from "./bookings";
import type { BookingQuote } from "../../../modules/guest-booking/contract";

export const guestChallenges = slotlySchema.table("guest_challenges", {
  id: uuid("id").primaryKey().defaultRandom(), requestId: uuid("request_id").notNull().unique(), requestHash: varchar("request_hash", { length: 64 }).notNull(),
  organizerId: uuid("organizer_id").notNull(), pageId: uuid("page_id").notNull(),
  guestName: varchar("guest_name", { length: 100 }).notNull(), guestEmail: varchar("guest_email", { length: 254 }).notNull(), guestTimezone: varchar("guest_timezone", { length: 64 }).notNull(),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(), endAt: timestamp("end_at", { withTimezone: true }).notNull(), quote: jsonb("quote").$type<BookingQuote>().notNull(),
  codeHash: varchar("code_hash", { length: 64 }).notNull(), sealedCode: varchar("sealed_code", { length: 256 }).notNull(), attempts: smallint("attempts").notNull().default(0), createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), sentAt: timestamp("sent_at", { withTimezone: true }), invalidatedAt: timestamp("invalidated_at", { withTimezone: true }), consumedAt: timestamp("consumed_at", { withTimezone: true }), bookingId: uuid("booking_id").unique(),
}, (t) => [
  foreignKey({ name: "guest_challenges_page_owner", columns: [t.pageId, t.organizerId], foreignColumns: [bookingPages.id, bookingPages.organizerId] }).onDelete("restrict"),
  foreignKey({ name: "guest_challenges_booking_owner", columns: [t.bookingId, t.organizerId], foreignColumns: [bookings.id, bookings.organizerId] }).onDelete("restrict"),
  index("guest_challenges_expiry").on(t.expiresAt),
  check("guest_challenges_hashes", sql`${t.codeHash} ~ '^[a-f0-9]{64}$' and ${t.requestHash} ~ '^[a-f0-9]{64}$'`),
  check("guest_challenges_attempts", sql`${t.attempts} between 0 and 5`),
  check("guest_challenges_bounds", sql`isfinite(${t.startAt}) and isfinite(${t.endAt}) and ${t.startAt} < ${t.endAt}`),
  check("guest_challenges_expiration", sql`isfinite(${t.expiresAt}) and ${t.expiresAt} > ${t.createdAt} and ${t.expiresAt} <= ${t.createdAt} + interval '10 minutes'`),
  check("guest_challenges_contact", sql`length(trim(${t.guestName})) between 1 and 100 and ${t.guestEmail} = lower(trim(${t.guestEmail})) and position('@' in ${t.guestEmail}) > 1 and slotly.is_known_timezone(${t.guestTimezone})`),
  check("guest_challenges_quote", sql`jsonb_typeof(${t.quote}) = 'object'`),
  check("guest_challenges_consumption", sql`(${t.consumedAt} is null) = (${t.bookingId} is null) and (${t.consumedAt} is null or (isfinite(${t.consumedAt}) and ${t.invalidatedAt} is null))`),
]);
export const guestRateLimits = slotlySchema.table("guest_rate_limits", {
  key: varchar("key", { length: 64 }).primaryKey(), count: integer("count").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("guest_rate_limits_expiry").on(t.expiresAt), check("guest_rate_limits_count", sql`${t.count} > 0`)]);

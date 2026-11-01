import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, text, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, slotlySchema } from "./namespace";
import { organizers, schedules } from "./scheduling";

export const bookingPages = slotlySchema.table("booking_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicId: uuid("public_id").notNull().defaultRandom().unique(),
  organizerId: uuid("organizer_id").notNull().references(() => organizers.id, { onDelete: "restrict" }),
  scheduleId: uuid("schedule_id").notNull(),
  title: varchar("title", { length: 120 }).notNull(),
  description: text("description").notNull().default(""),
  location: varchar("location", { length: 1000 }).notNull().default(""),
  state: varchar("state", { length: 12 }).notNull().default("draft"),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  stepMinutes: integer("step_minutes").notNull().default(15),
  bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
  bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
  minNoticeMinutes: integer("min_notice_minutes").notNull().default(120),
  horizonDays: integer("horizon_days").notNull().default(60),
  cancelCutoffMinutes: integer("cancel_cutoff_minutes").notNull().default(120),
  rescheduleCutoffMinutes: integer("reschedule_cutoff_minutes").notNull().default(120),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
}, (t) => [
  unique("booking_pages_id_owner").on(t.id, t.organizerId),
  foreignKey({ name: "booking_pages_schedule_owner", columns: [t.scheduleId, t.organizerId], foreignColumns: [schedules.id, schedules.organizerId] }).onDelete("restrict"),
  index("booking_pages_owner_state").on(t.organizerId, t.state),
  check("booking_pages_title", sql`length(trim(${t.title})) between 1 and 120`),
  check("booking_pages_description", sql`length(${t.description}) <= 4000`),
  check("booking_pages_state", sql`${t.state} in ('draft', 'published', 'paused', 'archived')`),
  check("booking_pages_duration", sql`${t.durationMinutes} between 5 and 480 and ${t.durationMinutes} % 5 = 0`),
  check("booking_pages_step", sql`${t.stepMinutes} between 5 and 120 and ${t.stepMinutes} % 5 = 0`),
  check("booking_pages_buffers", sql`${t.bufferBeforeMinutes} between 0 and 240 and ${t.bufferBeforeMinutes} % 5 = 0 and ${t.bufferAfterMinutes} between 0 and 240 and ${t.bufferAfterMinutes} % 5 = 0`),
  check("booking_pages_notice", sql`${t.minNoticeMinutes} between 0 and 43200`),
  check("booking_pages_horizon", sql`${t.horizonDays} between 1 and 365`),
  check("booking_pages_cutoffs", sql`${t.cancelCutoffMinutes} between 0 and 43200 and ${t.rescheduleCutoffMinutes} between 0 and 43200`),
  check("booking_pages_version", sql`${t.version} > 0`),
]);

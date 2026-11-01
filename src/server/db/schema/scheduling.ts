import { sql } from "drizzle-orm";
import { check, date, foreignKey, integer, smallint, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { createdAt, slotlySchema } from "./namespace";
import { authUsers } from "./auth";

export const organizers = slotlySchema.table("organizers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: varchar("user_id", { length: 128 }).notNull().unique().references(() => authUsers.id, { onDelete: "restrict" }),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  locale: varchar("locale", { length: 8 }).notNull().default("ru"),
  createdAt: createdAt(),
}, (t) => [
  check("organizers_name", sql`length(trim(${t.displayName})) between 1 and 100`),
  check("organizers_locale", sql`${t.locale} in ('ru', 'en')`),
]);

export const schedules = slotlySchema.table("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizerId: uuid("organizer_id").notNull().references(() => organizers.id, { onDelete: "restrict" }),
  timezone: varchar("timezone", { length: 64 }).notNull(),
  version: integer("version").notNull().default(1),
  createdAt: createdAt(),
}, (t) => [
  unique("schedules_one_per_organizer").on(t.organizerId),
  unique("schedules_id_owner").on(t.id, t.organizerId),
  check("schedules_timezone", sql`slotly.is_known_timezone(${t.timezone})`),
  check("schedules_version", sql`${t.version} > 0`),
]);

export const weeklyWindows = slotlySchema.table("weekly_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduleId: uuid("schedule_id").notNull().references(() => schedules.id, { onDelete: "cascade" }),
  weekday: smallint("weekday").notNull(), // ISO: Monday=1, Sunday=7.
  startMinute: smallint("start_minute").notNull(),
  endMinute: smallint("end_minute").notNull(),
}, (t) => [
  check("weekly_windows_weekday", sql`${t.weekday} between 1 and 7`),
  check("weekly_windows_bounds", sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.startMinute} < ${t.endMinute}`),
]);

export const dateOverrides = slotlySchema.table("date_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduleId: uuid("schedule_id").notNull().references(() => schedules.id, { onDelete: "cascade" }),
  localDate: date("local_date").notNull(),
  mode: varchar("mode", { length: 8 }).notNull(),
}, (t) => [
  unique("date_overrides_date").on(t.scheduleId, t.localDate),
  unique("date_overrides_id_mode").on(t.id, t.mode),
  check("date_overrides_mode", sql`${t.mode} in ('closed', 'replace')`),
  check("date_overrides_finite", sql`isfinite(${t.localDate})`),
]);

export const overrideWindows = slotlySchema.table("override_windows", {
  id: uuid("id").primaryKey().defaultRandom(),
  overrideId: uuid("override_id").notNull(),
  overrideMode: varchar("override_mode", { length: 8 }).notNull().default("replace"),
  startMinute: smallint("start_minute").notNull(),
  endMinute: smallint("end_minute").notNull(),
}, (t) => [
  foreignKey({ name: "override_windows_parent", columns: [t.overrideId, t.overrideMode], foreignColumns: [dateOverrides.id, dateOverrides.mode] }).onDelete("cascade"),
  check("override_windows_replace_only", sql`${t.overrideMode} = 'replace'`),
  check("override_windows_bounds", sql`${t.startMinute} >= 0 and ${t.endMinute} <= 1440 and ${t.startMinute} < ${t.endMinute}`),
]);

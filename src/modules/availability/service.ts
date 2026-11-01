import { asc, eq, inArray, sql } from "drizzle-orm";
import { dateOverrides, overrideWindows, schedules, weeklyWindows } from "../../server/db/schema";
import type { Database } from "../../server/db/types";
import { DomainError, validate } from "../../shared/domain-error";
import { lockOrganizer } from "../organizers/locking";
import { scheduleInput, type ScheduleData } from "./validation";

export async function getSchedule(database: Database, organizerId: string): Promise<ScheduleData | null> {
  return database.transaction(async (tx) => {
    await lockOrganizer(tx, organizerId, "share");
    return readSchedule(tx, organizerId);
  });
}

// Caller supplies a transaction/snapshot for a coherent multi-table read.
export async function readSchedule(database: Database, organizerId: string): Promise<ScheduleData | null> {
  const [schedule] = await database.select().from(schedules).where(eq(schedules.organizerId, organizerId));
  if (!schedule) return null;
  const weekly = await database.select({ weekday: weeklyWindows.weekday, startMinute: weeklyWindows.startMinute, endMinute: weeklyWindows.endMinute })
    .from(weeklyWindows).where(eq(weeklyWindows.scheduleId, schedule.id)).orderBy(asc(weeklyWindows.weekday), asc(weeklyWindows.startMinute));
  const overrides = await database.select().from(dateOverrides).where(eq(dateOverrides.scheduleId, schedule.id)).orderBy(asc(dateOverrides.localDate));
  const windows = overrides.length ? await database.select().from(overrideWindows).where(inArray(overrideWindows.overrideId, overrides.map((o) => o.id))).orderBy(asc(overrideWindows.startMinute)) : [];
  return { version: schedule.version, timezone: schedule.timezone, weekly,
    overrides: overrides.map((o) => ({ localDate: o.localDate, mode: o.mode as "closed" | "replace",
      windows: windows.filter((w) => w.overrideId === o.id).map(({ startMinute, endMinute }) => ({ startMinute, endMinute })) })) };
}

export async function saveSchedule(database: Database, organizerId: string, input: unknown): Promise<ScheduleData> {
  const data = validate(scheduleInput, input);
  return database.transaction(async (tx) => {
    await lockOrganizer(tx, organizerId);
    // PostgreSQL and ICU must both recognize the named zone.
    const known = await tx.execute<{ valid: boolean }>(sql`select slotly.is_known_timezone(${data.timezone}) as valid`);
    if (!known.rows[0]?.valid) throw new DomainError("INVALID_INPUT");
    let [schedule] = await tx.select().from(schedules).where(eq(schedules.organizerId, organizerId));
    if ((schedule?.version ?? 0) !== data.version) throw new DomainError("VERSION_CONFLICT", 409);
    if (!schedule) {
      [schedule] = await tx.insert(schedules).values({ organizerId, timezone: data.timezone }).returning();
    } else {
      [schedule] = await tx.update(schedules).set({ timezone: data.timezone, version: schedule.version + 1 }).where(eq(schedules.id, schedule.id)).returning();
    }
    if (!schedule) throw new DomainError("SERVICE_UNAVAILABLE", 503);
    await tx.delete(weeklyWindows).where(eq(weeklyWindows.scheduleId, schedule.id));
    // Child windows cascade; the deferred integrity checks see the complete new set.
    await tx.delete(dateOverrides).where(eq(dateOverrides.scheduleId, schedule.id));
    if (data.weekly.length) await tx.insert(weeklyWindows).values(data.weekly.map((w) => ({ ...w, scheduleId: schedule.id })));
    for (const override of data.overrides) {
      const [parent] = await tx.insert(dateOverrides).values({ scheduleId: schedule.id, localDate: override.localDate, mode: override.mode }).returning({ id: dateOverrides.id });
      if (override.windows.length) await tx.insert(overrideWindows).values(override.windows.map((w) => ({ ...w, overrideId: parent!.id })));
    }
    return { ...data, version: schedule.version };
  });
}

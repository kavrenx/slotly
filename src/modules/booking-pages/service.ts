import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { bookingPages, dateOverrides, organizers, overrideWindows, schedules, weeklyWindows } from "../../server/db/schema";
import type { Database } from "../../server/db/types";
import { DomainError, validate } from "../../shared/domain-error";
import { lockOrganizer } from "../organizers/locking";
import { pageInput, pageStateUpdate, pageUpdate, stateTransitions, type PageState } from "./validation";

const fields = {
  id: bookingPages.id, publicId: bookingPages.publicId, title: bookingPages.title,
  description: bookingPages.description, location: bookingPages.location, state: bookingPages.state, version: bookingPages.version,
  durationMinutes: bookingPages.durationMinutes, stepMinutes: bookingPages.stepMinutes,
  bufferBeforeMinutes: bookingPages.bufferBeforeMinutes, bufferAfterMinutes: bookingPages.bufferAfterMinutes,
  minNoticeMinutes: bookingPages.minNoticeMinutes, horizonDays: bookingPages.horizonDays,
  cancelCutoffMinutes: bookingPages.cancelCutoffMinutes, rescheduleCutoffMinutes: bookingPages.rescheduleCutoffMinutes,
};
export type PageData = { id: string; publicId: string; version: number; state: PageState } & z.infer<typeof pageInput>;
const typed = (page: Omit<PageData, "state"> & { state: string }): PageData => ({ ...page, state: page.state as PageState });
function pageId(value: string) { if (!z.uuid().safeParse(value).success) throw new DomainError("NOT_FOUND", 404); return value; }

export async function listPages(database: Database, organizerId: string): Promise<PageData[]> {
  return (await database.select(fields).from(bookingPages).where(eq(bookingPages.organizerId, organizerId)).orderBy(desc(bookingPages.createdAt), desc(bookingPages.id))).map(typed);
}
export async function getPage(database: Database, organizerId: string, id: string): Promise<PageData> {
  const [page] = await database.select(fields).from(bookingPages).where(and(eq(bookingPages.id, pageId(id)), eq(bookingPages.organizerId, organizerId)));
  if (!page) throw new DomainError("NOT_FOUND", 404);
  return typed(page);
}
export async function createPage(database: Database, organizerId: string, input: unknown): Promise<PageData> {
  const data = validate(pageInput, input);
  return database.transaction(async (tx) => {
    await lockOrganizer(tx, organizerId);
    const [schedule] = await tx.select({ id: schedules.id }).from(schedules).where(eq(schedules.organizerId, organizerId));
    if (!schedule) throw new DomainError("SCHEDULE_REQUIRED", 409);
    const [page] = await tx.insert(bookingPages).values({ ...data, organizerId, scheduleId: schedule.id }).returning(fields);
    return typed(page!);
  });
}
export async function updatePage(database: Database, organizerId: string, id: string, input: unknown): Promise<PageData> {
  const { version, ...data } = validate(pageUpdate, input);
  pageId(id);
  return database.transaction(async (tx) => {
    await lockOrganizer(tx, organizerId);
    const page = await getPage(tx, organizerId, id);
    if (page.version !== version) throw new DomainError("VERSION_CONFLICT", 409);
    if (page.state === "archived") throw new DomainError("ARCHIVED_PAGE", 409);
    const [updated] = await tx.update(bookingPages).set({ ...data, version: version + 1 }).where(and(eq(bookingPages.id, id), eq(bookingPages.organizerId, organizerId))).returning(fields);
    return typed(updated!);
  });
}
export async function changePageState(database: Database, organizerId: string, id: string, input: unknown): Promise<PageData> {
  const { version, state } = validate(pageStateUpdate, input);
  pageId(id);
  return database.transaction(async (tx) => {
    await lockOrganizer(tx, organizerId);
    const page = await getPage(tx, organizerId, id);
    if (page.version !== version) throw new DomainError("VERSION_CONFLICT", 409);
    if (!stateTransitions[page.state].includes(state)) throw new DomainError("INVALID_TRANSITION", 409);
    if (state === "published") {
      const [schedule] = await tx.select({ id: schedules.id }).from(schedules).where(eq(schedules.organizerId, organizerId));
      if (!schedule) throw new DomainError("SCHEDULE_REQUIRED", 409);
      const weekly = await tx.select({ id: weeklyWindows.id }).from(weeklyWindows).where(eq(weeklyWindows.scheduleId, schedule.id)).limit(1);
      const special = await tx.select({ id: overrideWindows.id }).from(overrideWindows).innerJoin(dateOverrides, eq(dateOverrides.id, overrideWindows.overrideId))
        .where(eq(dateOverrides.scheduleId, schedule.id)).limit(1);
      if (!weekly.length && !special.length) throw new DomainError("SCHEDULE_EMPTY", 409);
    }
    const [updated] = await tx.update(bookingPages).set({ state, version: version + 1 }).where(and(eq(bookingPages.id, id), eq(bookingPages.organizerId, organizerId))).returning(fields);
    return typed(updated!);
  });
}

// Public DTO intentionally excludes email, internal ids, policies and working hours.
export async function getPublicPage(database: Database, publicId: string) {
  const [page] = await database.select({ title: bookingPages.title, description: bookingPages.description,
    location: bookingPages.location, durationMinutes: bookingPages.durationMinutes, organizerName: organizers.displayName, timezone: schedules.timezone })
    .from(bookingPages).innerJoin(organizers, eq(organizers.id, bookingPages.organizerId))
    .innerJoin(schedules, eq(schedules.id, bookingPages.scheduleId))
    .where(and(eq(bookingPages.publicId, pageId(publicId)), eq(bookingPages.state, "published")));
  if (!page) throw new DomainError("NOT_FOUND", 404);
  return page;
}
